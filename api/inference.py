"""Hybrid decisions: fitted blur and exposure, gated framing and label checks."""

from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np

from api.config import CAPTURE_COACH, GUIDANCE_PATH, MODEL_PATH, REQUIRED_VIEWS
from api.datasets import image_index, missing_views, set_rows
from api.features import load_bgr, load_bgr_bytes, measure
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
    names = _artifact[f"{model_name}_features"] if model_name != "underexposed" else _artifact["exposure_features"]
    if model_name == "blur":
        names = _artifact["blur_features"]
    elif model_name == "glare":
        names = _artifact["glare_features"]
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


def evaluate_stats(stats: dict, intended_view: str, image_id: str) -> dict:
    if _artifact is None or _catalog is None:
        load_models()

    codes: list[str] = []
    ambiguous = False
    dark_p = _probability("underexposed", stats)
    blur_p = _probability("blur", stats)
    dark = _call(dark_p) == "confident"
    blurry = _call(blur_p) == "confident" and stats["lap_var"] < 45

    if dark:
        codes.append("underexposed")
    elif _call(dark_p) == "review" and stats["subject_mean"] < 50:
        ambiguous = True

    glare = stats["hot_frac"] >= _artifact["glare_hot"] or stats["subject_mean"] >= _artifact["glare_luma"]
    if glare:
        codes.append("glare_or_overexposed")
    elif stats["subject_mean"] >= _artifact["glare_luma"] - 16 and not dark:
        ambiguous = True

    if blurry and not dark and not glare:
        codes.append("blur")
    elif _call(blur_p) == "review" and stats["lap_var"] < 45 and not dark and not glare:
        ambiguous = True

    if not dark:
        if intended_view == "label" and stats["orange_touch"] >= _artifact["framing_label_touch"]:
            codes.append("framing")
        elif intended_view == "front" and stats["edge_max"] >= _artifact["framing_front"]:
            codes.append("framing")

    if (
        intended_view == "label"
        and "blur" not in codes
        and stats["orange_frac"] >= _artifact["label_orange_min"]
        and stats["ink_frac"] < _artifact["label_ink_max"]
        and stats["ink_frac"] > 0
    ):
        codes.append("label_obstructed")

    if codes:
        status = "retake"
    elif ambiguous:
        status = "needs_review"
    else:
        status = "usable"

    reason, guidance = compose(_catalog, codes, status)
    return {
        "image_id": image_id,
        "intended_view": intended_view,
        "status": status,
        "issue_codes": codes,
        "reason": reason,
        "guidance": guidance,
    }


def evaluate_image(image, intended_view: str, image_id: str) -> dict:
    return evaluate_stats(measure(image), intended_view, image_id)


def evaluate_path(path: Path, intended_view: str, image_id: str) -> dict:
    return evaluate_image(load_bgr(path), intended_view, image_id)


def evaluate_bytes(payload: bytes, intended_view: str, image_id: str) -> dict:
    return evaluate_image(load_bgr_bytes(payload), intended_view, image_id)


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
        photos.append(evaluate_path(path, row["intended_view"], image_id))
    return {
        "set_id": set_id,
        "device_id": rows[0]["device_id"],
        "missing_views": checklist([row["intended_view"] for row in rows]),
        "photos": photos,
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
