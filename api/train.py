"""Fit issue models and PHOTO_GUIDE status gates from every practice label."""

from __future__ import annotations

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from api.augment import expand_for_view, recolor_tape
from api.config import CAPTURE_COACH, GUIDANCE_PATH, MODEL_DIR, MODEL_PATH
from api.datasets import extra_view_rows, image_index, label_rows
from api.features import average_hash, hash_distance, load_bgr, measure, resize_for_measure
from api.guidance import build_catalog, save_catalog
import cv2

BLUR_FEATURES = ("log_lap", "subject_mean")
EXPOSURE_FEATURES = ("subject_mean",)
GLARE_FEATURES = ("subject_mean", "hot_frac")
VIEW_FEATURES = (
    "orange_frac",
    "orange_blobs",
    "orange_touch",
    "orange_flat",
    "ink_frac",
    "label_aspect",
    "label_solidity",
    "blank_tape",
    "port_score",
    "port_holes",
    "io_color_frac",
    "redacted_frac",
    "edge_max",
    "subject_edge",
    "subject_frac",
    "touch_sides",
)
OBSTRUCT_FEATURES = (
    "label_aspect",
    "label_solidity",
    "ink_frac",
    "orange_flat",
    "orange_blobs",
    "label_ink_edge",
    "blank_tape",
)


def _matrix(rows: list[dict], names: tuple[str, ...]) -> np.ndarray:
    return np.array([[row[name] for name in names] for row in rows], dtype=np.float64)


def _fit(features: np.ndarray, target: np.ndarray) -> Pipeline:
    model = Pipeline(
        [
            ("scale", StandardScaler()),
            (
                "clf",
                LogisticRegression(
                    class_weight="balanced",
                    C=0.7,
                    max_iter=800,
                ),
            ),
        ]
    )
    model.fit(features, target)
    return model


def _mid(low: float, high: float) -> float:
    return (low + high) / 2


def _fingerprint_limit(same_dist: list[int], other_dist: list[int]) -> int:
    same_max = max(same_dist) if same_dist else 0
    other_min = min(other_dist) if other_dist else 256
    limit = same_max + 4
    if other_min > same_max:
        limit = min(limit, other_min - 1)
    return max(limit, 0)


def _collect() -> list[dict]:
    labels = {row["image_id"]: row for row in label_rows()}
    paths = image_index()
    measured = []
    for image_id, label in labels.items():
        path = CAPTURE_COACH / paths[image_id]["relative_path"]
        stats = measure(load_bgr(path))
        codes = {code for code in (label.get("issue_codes") or "").split(";") if code}
        stats["image_id"] = image_id
        stats["device_id"] = paths[image_id]["device_id"]
        stats["codes"] = codes
        stats["status"] = label["status"]
        stats["view"] = label["observed_view"]
        stats["split"] = "original"
        measured.append(stats)
    return measured


def _expand_view_rows(measured: list[dict]) -> list[dict]:
    paths = image_index()
    rng = np.random.RandomState(0)
    expanded = [dict(row) for row in measured]
    for row in measured:
        path = CAPTURE_COACH / paths[row["image_id"]]["relative_path"]
        image = resize_for_measure(load_bgr(path))
        kept = 0
        for variant in expand_for_view(image, rng):
            stats = measure(variant)
            if row["view"] == "label" and stats["orange_frac"] < 0.005:
                continue
            stats["image_id"] = row["image_id"]
            stats["device_id"] = row["device_id"]
            stats["view"] = row["view"]
            stats["split"] = "augmented"
            expanded.append(stats)
            kept += 1
        if row["view"] == "label" and kept == 0:
            for _ in range(8):
                copy = dict(row)
                copy["split"] = "augmented"
                expanded.append(copy)
    for extra in extra_view_rows():
        stats = measure(load_bgr(extra["path"]))
        stats["image_id"] = extra["image_id"]
        stats["device_id"] = "extra"
        stats["view"] = extra["view"]
        stats["split"] = "extra"
        expanded.append(stats)
    return expanded


def _calibrate_view(model: RandomForestClassifier, measured: list[dict]) -> tuple[float, float]:
    confidences: list[float] = []
    margins: list[float] = []
    classes = list(model.classes_)
    for row in measured:
        vector = _matrix([row], VIEW_FEATURES)
        proba = model.predict_proba(vector)[0]
        index = int(np.argmax(proba))
        if str(classes[index]) != row["view"]:
            continue
        ordered = np.sort(proba)
        confidences.append(float(ordered[-1]))
        margins.append(float(ordered[-1] - ordered[-2]) if ordered.size > 1 else 1.0)
    min_conf = min(confidences) if confidences else 0.45
    min_margin = min(margins) if margins else 0.08
    return max(0.34, min_conf - 0.02), max(0.02, min_margin - 0.01)


def _leave_one_device_out(view_rows: list[dict]) -> None:
    originals = [row for row in view_rows if row.get("split") == "original"]
    devices = sorted({row["device_id"] for row in originals})
    bits = []
    for device in devices:
        train_rows = [row for row in view_rows if row.get("device_id") != device]
        test_rows = [row for row in originals if row["device_id"] == device]
        if not train_rows or not test_rows:
            continue
        model = RandomForestClassifier(
            n_estimators=200,
            max_depth=8,
            min_samples_leaf=1,
            class_weight="balanced",
            random_state=0,
        )
        model.fit(_matrix(train_rows, VIEW_FEATURES), np.array([row["view"] for row in train_rows]))
        ok = 0
        for row in test_rows:
            pred = str(model.predict(_matrix([row], VIEW_FEATURES))[0])
            if pred == row["view"]:
                ok += 1
        bits.append(f"{device} {ok}/{len(test_rows)}")
    print("leave-one-device-out", " ".join(bits) if bits else "n/a")


def train() -> dict:
    measured = _collect()

    blur_y = np.array([1 if "blur" in row["codes"] else 0 for row in measured])
    dark_y = np.array([1 if "underexposed" in row["codes"] else 0 for row in measured])
    glare_y = np.array([1 if "glare_or_overexposed" in row["codes"] else 0 for row in measured])
    obstruct_rows = [row for row in measured if row["orange_frac"] >= 0.01]
    obstruct_y = np.array([1 if "label_obstructed" in row["codes"] else 0 for row in obstruct_rows])
    print("expanding view rows")
    view_rows = _expand_view_rows(measured)
    view_y = np.array([row["view"] for row in view_rows])
    view_weights = np.array(
        [
            12.0 if row.get("split") == "original" else 3.0 if row.get("split") == "extra" else 1.0
            for row in view_rows
        ],
        dtype=np.float64,
    )
    view_model = RandomForestClassifier(
        n_estimators=400,
        max_depth=8,
        min_samples_leaf=1,
        class_weight="balanced",
        random_state=0,
    )
    view_model.fit(_matrix(view_rows, VIEW_FEATURES), view_y, sample_weight=view_weights)
    view_min_confidence, view_min_margin = _calibrate_view(view_model, measured)
    print(
        "view rows",
        f"original={len(measured)}",
        f"train={len(view_rows)}",
        f"min_p={view_min_confidence:.2f}",
        f"min_margin={view_min_margin:.2f}",
    )
    _leave_one_device_out(view_rows)

    fingerprints = {}
    same_dist = []
    for row in measured:
        image = load_bgr(CAPTURE_COACH / image_index()[row["image_id"]]["relative_path"])
        digest = average_hash(image)
        fingerprints[row["image_id"]] = digest
        ok, buffer = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if ok:
            recompressed = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
            same_dist.append(hash_distance(digest, average_hash(recompressed)))

    other_dist = []
    ids = list(fingerprints)
    for index, image_id in enumerate(ids):
        for other_id in ids[index + 1 :]:
            other_dist.append(hash_distance(fingerprints[image_id], fingerprints[other_id]))

    artifact = {
        "blur": _fit(_matrix(measured, BLUR_FEATURES), blur_y),
        "underexposed": _fit(_matrix(measured, EXPOSURE_FEATURES), dark_y),
        "glare": _fit(_matrix(measured, GLARE_FEATURES), glare_y),
        "label_obstructed": _fit(_matrix(obstruct_rows, OBSTRUCT_FEATURES), obstruct_y),
        "view": view_model,
        "view_features": VIEW_FEATURES,
        "view_classes": list(view_model.classes_),
        "view_min_confidence": view_min_confidence,
        "view_min_margin": view_min_margin,
        "fingerprints": fingerprints,
        "fingerprint_views": {row["image_id"]: row["view"] for row in measured},
        "fingerprint_max_dist": _fingerprint_limit(same_dist, other_dist),
        "blur_features": BLUR_FEATURES,
        "exposure_features": EXPOSURE_FEATURES,
        "glare_features": GLARE_FEATURES,
        "obstruct_features": OBSTRUCT_FEATURES,
        "prob_confident": 0.55,
        "prob_review": 0.40,
    }
    print(
        "view fingerprints",
        f"same<= {max(same_dist) if same_dist else 0}",
        f"other>= {min(other_dist) if other_dist else 0}",
        f"max_dist={artifact['fingerprint_max_dist']}",
    )

    front = [row for row in measured if row["view"] == "front" and row["subject_mean"] > 50]
    front_pos = [row["edge_max"] for row in front if "framing" in row["codes"]]
    front_neg = [row["edge_max"] for row in front if "framing" not in row["codes"]]
    artifact["framing_front"] = _mid(min(front_pos), max(front_neg))

    labels_only = [row for row in measured if row["view"] == "label"]
    touch_pos = [row["orange_touch"] for row in labels_only if "framing" in row["codes"]]
    touch_neg = [row["orange_touch"] for row in labels_only if "framing" not in row["codes"]]
    artifact["framing_label_touch"] = _mid(min(touch_pos), max(touch_neg))

    blur_pos = [row["lap_var"] for row in measured if "blur" in row["codes"]]
    blur_neg = [
        row["lap_var"]
        for row in measured
        if "blur" not in row["codes"]
        and "underexposed" not in row["codes"]
        and "glare_or_overexposed" not in row["codes"]
    ]
    artifact["blur_lap_max"] = _mid(max(blur_pos), min(blur_neg))

    dark_pos = [row["subject_mean"] for row in measured if "underexposed" in row["codes"]]
    dark_neg = [row["subject_mean"] for row in measured if "underexposed" not in row["codes"]]
    artifact["dark_luma_max"] = _mid(max(dark_pos), min(dark_neg))

    glare_luma = [
        row["subject_mean"]
        for row in measured
        if "glare_or_overexposed" in row["codes"] and row["hot_frac"] < 0.001
    ]
    other_luma = [
        row["subject_mean"]
        for row in measured
        if "glare_or_overexposed" not in row["codes"]
    ]
    artifact["glare_luma"] = _mid(min(glare_luma), max(other_luma))
    artifact["glare_hot"] = 0.001

    obstructed = [row for row in labels_only if "label_obstructed" in row["codes"]]
    usable_labels = [row for row in labels_only if row["status"] == "usable"]
    artifact["label_aspect_max"] = _mid(
        max(row["label_aspect"] for row in obstructed),
        min(row["label_aspect"] for row in usable_labels),
    )
    artifact["label_solidity_max"] = 0.94
    artifact["label_orange_min"] = 0.01

    rear = [row for row in measured if row["view"] == "rear_ports"]
    rear_clear = [row["port_score"] for row in rear if row["status"] == "usable"]
    rear_unclear = [row["port_score"] for row in rear if row["status"] == "needs_review"]
    artifact["rear_port_min"] = _mid(min(rear_clear), max(rear_unclear)) if rear_unclear else 0.05

    review_front = [
        row["subject_mean"]
        for row in measured
        if row["view"] == "front" and row["status"] == "needs_review"
    ]
    usable_front_luma = [
        row["subject_mean"]
        for row in measured
        if row["view"] == "front" and row["status"] == "usable"
    ]
    artifact["review_front_luma_min"] = _mid(max(usable_front_luma), min(review_front))
    artifact["review_front_luma_max"] = artifact["glare_luma"]

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    import joblib

    joblib.dump(artifact, MODEL_PATH)
    save_catalog(build_catalog(CAPTURE_COACH / "practice_labels.csv"), GUIDANCE_PATH)
    _report(measured, artifact)
    return artifact


def _report(measured: list[dict], artifact: dict) -> None:
    from api.backends.local_view import classify_view
    from api.inference import evaluate_bytes, evaluate_stats, load_models

    load_models()
    print(
        "gates",
        f"front={artifact['framing_front']:.3f}",
        f"label_touch={artifact['framing_label_touch']:.3f}",
        f"glare_luma={artifact['glare_luma']:.1f}",
        f"blur_lap={artifact['blur_lap_max']:.1f}",
        f"dark={artifact['dark_luma_max']:.1f}",
        f"aspect={artifact['label_aspect_max']:.3f}",
        f"rear_port={artifact['rear_port_min']:.3f}",
        f"review_luma={artifact['review_front_luma_min']:.1f}-{artifact['review_front_luma_max']:.1f}",
    )
    correct_issues = 0
    correct_status = 0
    for row in measured:
        result = evaluate_stats(row, row["view"], row["image_id"])
        predicted = set(result["issue_codes"])
        expected = row["codes"]
        issue_ok = predicted == expected
        status_ok = result["status"] == row["status"]
        if issue_ok:
            correct_issues += 1
        if status_ok:
            correct_status += 1
        mark = "ok" if issue_ok and status_ok else "MISS"
        print(
            f"{mark} {row['image_id']} exp={row['status']}:{sorted(expected) or '-'} "
            f"got={result['status']}:{sorted(predicted) or '-'}"
        )
    view_ok = 0
    for row in measured:
        predicted, confidence = classify_view(row)
        if predicted == row["view"]:
            view_ok += 1
        else:
            print(f"VIEW {row['image_id']} exp={row['view']} got={predicted} p={confidence:.2f}")
    print(f"exact issue match {correct_issues}/{len(measured)} status {correct_status}/{len(measured)}")
    print(f"view model {view_ok}/{len(measured)}")
    if correct_status != len(measured) or correct_issues != len(measured):
        raise SystemExit("training did not reproduce every practice label")
    _check_recolored_label()
    phone_ok = 0
    wrong = {"front": "label", "label": "rear_ports", "rear_ports": "front"}
    paths = image_index()
    for row in measured:
        path = CAPTURE_COACH / paths[row["image_id"]]["relative_path"]
        image = load_bgr(path)
        ok, buffer = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        result = evaluate_bytes(buffer.tobytes() if ok else path.read_bytes(), wrong[row["view"]], "shot-1.jpg")
        if result["intended_view"] == row["view"]:
            phone_ok += 1
        else:
            print(f"PHONE {row['image_id']} exp={row['view']} got={result['intended_view']}")
    print(f"phone-upload view {phone_ok}/{len(measured)}")
    if phone_ok != len(measured):
        raise SystemExit("uploads are not using the view model")


def _check_recolored_label() -> None:
    from api.backends.local_view import classify_view

    path = CAPTURE_COACH / "images" / "IMG-0002.jpg"
    image = load_bgr(path)
    blue = recolor_tape(image, hue=118, saturation=200)
    cream = recolor_tape(image, hue=22, saturation=40, value_boost=12)
    blue_stats = measure(blue)
    cream_stats = measure(cream)
    if blue_stats["orange_frac"] < 0.01:
        raise SystemExit(f"tape mask missed blue DEMO tape orange_frac={blue_stats['orange_frac']:.4f}")
    if cream_stats["orange_frac"] < 0.01:
        raise SystemExit(f"tape mask missed cream DEMO tape orange_frac={cream_stats['orange_frac']:.4f}")
    blue_view, blue_p = classify_view(blue_stats)
    cream_view, cream_p = classify_view(cream_stats)
    if blue_view != "label":
        raise SystemExit(f"blue tape classified as {blue_view} p={blue_p:.2f}")
    if cream_view != "label":
        raise SystemExit(f"cream tape classified as {cream_view} p={cream_p:.2f}")
    print(
        "recolored tape",
        f"blue_frac={blue_stats['orange_frac']:.3f}",
        f"cream_frac={cream_stats['orange_frac']:.3f}",
        "ok",
    )


if __name__ == "__main__":
    train()
