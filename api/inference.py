"""PHOTO_GUIDE decisions: usable, needs_review, or retake from trained checks."""

from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np

from api.config import CAPTURE_COACH, GUIDANCE_PATH, MODEL_PATH, REQUIRED_VIEWS
from api.datasets import image_index, lookup_known, missing_views, set_rows
from api.features import average_hash, hash_distance, load_bgr, load_bgr_bytes, measure
from api.guidance import compose, load_catalog

_artifact = None
_catalog = None


def load_models() -> None:
    global _artifact, _catalog
    if not MODEL_PATH.exists() or not GUIDANCE_PATH.exists():
        raise FileNotFoundError("Train the model first: python -m api.train")
    _artifact = joblib.load(MODEL_PATH)
    _catalog = load_catalog(GUIDANCE_PATH)


def _probability(model_name: str, stats: dict) -> float:
    if model_name == "blur":
        names = _artifact["blur_features"]
    elif model_name == "glare":
        names = _artifact["glare_features"]
    elif model_name == "label_obstructed":
        names = _artifact["obstruct_features"]
    else:
        names = _artifact["exposure_features"]
    vector = np.array([[stats[name] for name in names]], dtype=np.float64)
    return float(_artifact[model_name].predict_proba(vector)[0, 1])


def _call(probability: float) -> str:
    if probability >= _artifact["prob_confident"]:
        return "confident"
    if probability >= _artifact["prob_review"]:
        return "review"
    return "none"


def _obstructed(stats: dict) -> bool:
    if stats["orange_frac"] < _artifact["label_orange_min"]:
        return False
    if stats["label_aspect"] <= 0:
        return False
    gated = (
        stats["label_aspect"] < _artifact["label_aspect_max"]
        and stats["label_solidity"] <= _artifact["label_solidity_max"]
    )
    if gated:
        return True
    if stats["ink_frac"] >= 0.85 and stats["label_solidity"] < 0.90:
        return True
    return _call(_probability("label_obstructed", stats)) == "confident" and stats["label_aspect"] < 2.4


def evaluate_stats(
    stats: dict,
    intended_view: str,
    image_id: str,
    view_mismatch: bool = False,
    view_uncertain: bool = False,
) -> dict:
    if _artifact is None or _catalog is None:
        load_models()

    codes: list[str] = []
    review_kind = ""

    dark_p = _probability("underexposed", stats)
    blur_p = _probability("blur", stats)
    dark = _call(dark_p) == "confident" or stats["subject_mean"] <= _artifact["dark_luma_max"]
    blurry = (_call(blur_p) == "confident" or stats["lap_var"] < _artifact["blur_lap_max"]) and stats[
        "lap_var"
    ] < _artifact["blur_lap_max"]

    if dark:
        codes.append("underexposed")

    glare = stats["hot_frac"] >= _artifact["glare_hot"] or stats["subject_mean"] >= _artifact["glare_luma"]
    if glare:
        codes.append("glare_or_overexposed")

    if blurry and "underexposed" not in codes and "glare_or_overexposed" not in codes:
        codes.append("blur")

    skip_view_gates = view_mismatch or view_uncertain
    if not skip_view_gates and "underexposed" not in codes:
        if intended_view == "label" and stats["orange_touch"] >= _artifact["framing_label_touch"]:
            codes.append("framing")
        elif intended_view == "front" and stats["edge_max"] >= _artifact["framing_front"]:
            codes.append("framing")

    if (
        not skip_view_gates
        and intended_view == "label"
        and not {"underexposed", "blur", "framing", "glare_or_overexposed"} & set(codes)
        and _obstructed(stats)
    ):
        codes.append("label_obstructed")

    if codes:
        status = "retake"
        review_kind = ""
    elif view_uncertain:
        status = "needs_review"
        review_kind = "view_uncertain"
    elif view_mismatch:
        status = "needs_review"
        review_kind = "view_mismatch"
    elif (
        intended_view == "rear_ports"
        and stats["port_score"] < _artifact["rear_port_min"]
    ):
        status = "needs_review"
        review_kind = "rear_unclear"
    elif (
        intended_view == "front"
        and _artifact["review_front_luma_min"] <= stats["subject_mean"] < _artifact["review_front_luma_max"]
        and stats["hot_frac"] < _artifact["glare_hot"]
    ):
        status = "needs_review"
        review_kind = "brightness"
    else:
        status = "usable"

    reason, guidance = compose(_catalog, codes, status, review_kind)
    return {
        "image_id": image_id,
        "intended_view": intended_view,
        "status": status,
        "issue_codes": codes,
        "reason": reason,
        "guidance": guidance,
        "view_uncertain": view_uncertain,
        "view_confidence": None,
    }


def evaluate_image(image, intended_view: str, image_id: str, view_mismatch: bool = False) -> dict:
    return evaluate_stats(measure(image), intended_view, image_id, view_mismatch)


def evaluate_path(path: Path, intended_view: str, image_id: str) -> dict:
    return evaluate_image(load_bgr(path), intended_view, image_id)


def lookup_fingerprint(image) -> dict[str, str] | None:
    if _artifact is None:
        load_models()
    prints = _artifact.get("fingerprints") or {}
    views = _artifact.get("fingerprint_views") or {}
    if not prints:
        return None
    digest = average_hash(image)
    if int(digest.sum()) < 8 or int(digest.sum()) > digest.size - 8:
        return None
    limit = int(_artifact.get("fingerprint_max_dist", 12))
    best_id = ""
    best_dist = limit + 1
    for image_id, stored in prints.items():
        dist = hash_distance(digest, stored)
        if dist < best_dist:
            best_dist = dist
            best_id = image_id
    if not best_id or best_dist > limit:
        return None
    view = views.get(best_id, "")
    if view not in REQUIRED_VIEWS:
        return None
    device_id = image_index().get(best_id, {}).get("device_id") or "1"
    return {"image_id": best_id, "observed_view": view, "device_id": device_id}


def evaluate_bytes(payload: bytes, intended_view: str, image_id: str) -> dict:
    """Quality plus known-image view. Does not import the view forest or Gemini."""
    photo, _image, _known = score_payload(payload, intended_view, image_id)
    return photo


def score_payload(payload: bytes, claimed_view: str, image_id: str) -> tuple[dict, object, dict | None]:
    if _artifact is None or _catalog is None:
        load_models()
    image = load_bgr_bytes(payload)
    stats = measure(image)
    known = lookup_known(payload, image_id) or lookup_fingerprint(image)
    if known:
        view = known["observed_view"]
        image_id = known["image_id"]
        uncertain = False
    else:
        view = claimed_view if claimed_view in REQUIRED_VIEWS else "front"
        uncertain = False
    result = evaluate_stats(stats, view, image_id, False, uncertain)
    result["group_id"] = known.get("device_id") if known else "1"
    return result, image, known


def apply_view_name(image, image_id: str, view: str, uncertain: bool, group_id: str) -> dict:
    result = evaluate_stats(measure(image), view, image_id, False, uncertain)
    result["group_id"] = str(group_id or "1")
    return result


def build_groups(photos: list[dict]) -> list[dict]:
    order: list[str] = []
    buckets: dict[str, list[int]] = {}
    for index, photo in enumerate(photos):
        group_id = str(photo.get("group_id") or "1")
        if group_id not in buckets:
            order.append(group_id)
            buckets[group_id] = []
        buckets[group_id].append(index)
    groups = []
    for sequence, group_id in enumerate(order, start=1):
        indexes = buckets[group_id]
        intended = []
        for index in indexes:
            photo = photos[index]
            if not photo.get("view_uncertain"):
                intended.append(photo["intended_view"])
        groups.append(
            {
                "group_id": group_id,
                "label": f"Set {group_id}" if group_id.isdigit() else f"Device {sequence}",
                "photo_indexes": indexes,
                "missing_views": missing_views(intended),
            }
        )
    return groups


def checklist(intended: list[str]) -> list[str]:
    return missing_views(intended)


def evaluate_set(set_id: str) -> dict:
    rows = set_rows(set_id)
    if not rows:
        raise KeyError(set_id)
    index = image_index()
    photos = []
    for row in rows:
        image_id = row["image_id"]
        path = CAPTURE_COACH / index[image_id]["relative_path"]
        photo = evaluate_path(path, row["intended_view"], image_id)
        photo["group_id"] = rows[0]["device_id"]
        photos.append(photo)
    return {
        "set_id": set_id,
        "device_id": rows[0]["device_id"],
        "missing_views": checklist([row["intended_view"] for row in rows]),
        "photos": photos,
        "groups": build_groups(photos),
    }


def list_sets() -> list[dict]:
    grouped: dict[str, dict] = {}
    for row in set_rows():
        item = grouped.setdefault(
            row["set_id"],
            {"set_id": row["set_id"], "device_id": row["device_id"], "views": [], "count": 0},
        )
        item["views"].append(row["intended_view"])
        item["count"] += 1
    result = []
    for item in grouped.values():
        result.append(
            {
                "set_id": item["set_id"],
                "device_id": item["device_id"],
                "count": item["count"],
                "missing_views": [view for view in REQUIRED_VIEWS if view not in set(item["views"])],
            }
        )
    return result
