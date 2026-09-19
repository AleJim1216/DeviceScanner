"""Fit blur and exposure only. Framing and label checks stay gated."""

from __future__ import annotations

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from api.config import CAPTURE_COACH, GUIDANCE_PATH, MODEL_DIR, MODEL_PATH
from api.datasets import image_index, label_rows
from api.features import load_bgr, measure
from api.guidance import build_catalog, save_catalog

BLUR_FEATURES = ("log_lap", "subject_mean")
EXPOSURE_FEATURES = ("subject_mean",)
GLARE_FEATURES = ("subject_mean", "hot_frac")


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


def _band(scores: list[float], positives: list[bool]) -> tuple[float, float]:
    pos = [score for score, flag in zip(scores, positives) if flag]
    neg = [score for score, flag in zip(scores, positives) if not flag]
    if not pos or not neg:
        return 0.5, 0.25
    pos_min = min(pos)
    neg_max = max(neg)
    if pos_min > neg_max:
        mid = (pos_min + neg_max) / 2
        return mid, (neg_max + mid) / 2
    strong = float(np.percentile(pos, 60))
    review = float(np.median(neg))
    if review >= strong:
        review = strong * 0.55
    return strong, max(review, 0.0)


def train() -> dict:
    labels = {row["image_id"]: row for row in label_rows()}
    paths = image_index()
    measured = []
    for image_id, label in labels.items():
        path = CAPTURE_COACH / paths[image_id]["relative_path"]
        stats = measure(load_bgr(path))
        codes = {code for code in (label.get("issue_codes") or "").split(";") if code}
        stats["image_id"] = image_id
        stats["codes"] = codes
        stats["status"] = label["status"]
        stats["view"] = label["observed_view"]
        measured.append(stats)

    blur_y = np.array([1 if "blur" in row["codes"] else 0 for row in measured])
    dark_y = np.array([1 if "underexposed" in row["codes"] else 0 for row in measured])
    glare_y = np.array([1 if "glare_or_overexposed" in row["codes"] else 0 for row in measured])

    artifact = {
        "blur": _fit(_matrix(measured, BLUR_FEATURES), blur_y),
        "underexposed": _fit(_matrix(measured, EXPOSURE_FEATURES), dark_y),
        "glare": _fit(_matrix(measured, GLARE_FEATURES), glare_y),
        "blur_features": BLUR_FEATURES,
        "exposure_features": EXPOSURE_FEATURES,
        "glare_features": GLARE_FEATURES,
        "prob_confident": 0.55,
        "prob_review": 0.40,
    }

    front = [row for row in measured if row["view"] == "front" and row["subject_mean"] > 50]
    front_pos = [row["edge_max"] for row in front if "framing" in row["codes"]]
    front_neg = [row["edge_max"] for row in front if "framing" not in row["codes"]]
    artifact["framing_front"] = (min(front_pos) + max(front_neg)) / 2

    labels_only = [row for row in measured if row["view"] == "label"]
    touch_pos = [row["orange_touch"] for row in labels_only if "framing" in row["codes"]]
    touch_neg = [row["orange_touch"] for row in labels_only if "framing" not in row["codes"]]
    artifact["framing_label_touch"] = (min(touch_pos) + max(touch_neg)) / 2

    glare_luma = [
        row["subject_mean"]
        for row in measured
        if "glare_or_overexposed" in row["codes"] and row["hot_frac"] < 0.001
    ]
    other_luma = [row["subject_mean"] for row in measured if "glare_or_overexposed" not in row["codes"]]
    artifact["glare_luma"] = (min(glare_luma) + max(other_luma)) / 2
    artifact["glare_hot"] = 0.001

    ink_pos = [
        row["ink_frac"]
        for row in labels_only
        if "label_obstructed" in row["codes"] and row["ink_frac"] < 0.2
    ]
    ink_neg = [
        row["ink_frac"]
        for row in labels_only
        if row["status"] == "usable" and row["orange_frac"] > 0.01
    ]
    print("ink_pos", sorted(ink_pos), "ink_neg", sorted(ink_neg))
    artifact["label_ink_max"] = (max(ink_pos) + min(ink_neg)) / 2
    artifact["label_orange_min"] = 0.02

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    import joblib

    joblib.dump(artifact, MODEL_PATH)
    save_catalog(build_catalog(CAPTURE_COACH / "practice_labels.csv"), GUIDANCE_PATH)
    _report(measured, artifact)
    return artifact


def _predict_flag(model, row: dict, names: tuple[str, ...]) -> float:
    vector = np.array([[row[name] for name in names]], dtype=np.float64)
    return float(model.predict_proba(vector)[0, 1])


def _report(measured: list[dict], artifact: dict) -> None:
    from api.inference import evaluate_stats, load_models

    load_models()
    print(
        "gates",
        f"front={artifact['framing_front']:.3f}",
        f"label_touch={artifact['framing_label_touch']:.3f}",
        f"glare_luma={artifact['glare_luma']:.1f}",
        f"ink={artifact['label_ink_max']:.3f}",
    )
    correct_issues = 0
    correct_status = 0
    for row in measured:
        result = evaluate_stats(row, row["view"], row["image_id"])
        predicted = set(result["issue_codes"])
        expected = row["codes"]
        issue_ok = predicted == expected
        status_ok = result["status"] == row["status"] or (
            row["status"] == "needs_review" and result["status"] == "needs_review"
        )
        if issue_ok:
            correct_issues += 1
        if result["status"] == row["status"]:
            correct_status += 1
        mark = "ok" if issue_ok else "MISS"
        print(
            f"{mark} {row['image_id']} exp={row['status']}:{sorted(expected) or '-'} "
            f"got={result['status']}:{sorted(predicted) or '-'}"
        )
    print(f"exact issue match {correct_issues}/{len(measured)} status {correct_status}/{len(measured)}")


if __name__ == "__main__":
    train()
