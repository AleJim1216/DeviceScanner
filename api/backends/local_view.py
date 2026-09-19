"""Isolated local view forest. Imported only when ANALYZE_BACKEND=local."""

from __future__ import annotations

import joblib
import numpy as np

from api.config import MODEL_PATH, REQUIRED_VIEWS

_artifact = None


def _models() -> dict:
    global _artifact
    if _artifact is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError("Train the model first: python -m api.train")
        _artifact = joblib.load(MODEL_PATH)
    return _artifact


def classify_view_detail(stats: dict) -> tuple[str, float, bool]:
    artifact = _models()
    names = artifact["view_features"]
    vector = np.array([[stats[name] for name in names]], dtype=np.float64)
    model = artifact["view"]
    proba = model.predict_proba(vector)[0]
    classes = list(model.classes_)
    index = int(np.argmax(proba))
    ordered = np.sort(proba)
    confidence = float(ordered[-1])
    margin = float(ordered[-1] - ordered[-2]) if ordered.size > 1 else 1.0
    min_confidence = float(artifact.get("view_min_confidence", 0.45))
    min_margin = float(artifact.get("view_min_margin", 0.08))
    view = str(classes[index])
    uncertain = confidence < min_confidence or margin < min_margin
    return view, confidence, uncertain


def classify_view(stats: dict) -> tuple[str, float]:
    view, confidence, _uncertain = classify_view_detail(stats)
    return view, confidence


def name_views_and_groups(images_bgr: list, claimed_views: list[str]) -> list[dict]:
    from api.features import measure

    results = []
    for index, image in enumerate(images_bgr):
        view, _confidence, uncertain = classify_view_detail(measure(image))
        if view not in REQUIRED_VIEWS:
            claimed = claimed_views[index] if index < len(claimed_views) else ""
            view = claimed if claimed in REQUIRED_VIEWS else "front"
        results.append({"view": view, "group_id": "1", "uncertain": uncertain})
    return results
