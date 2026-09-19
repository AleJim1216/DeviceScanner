"""Image measurements. Redacted pixels are excluded from every measurement."""

from __future__ import annotations

import cv2
import numpy as np

MAX_SIDE = 960


def load_bgr(path) -> np.ndarray:
    data = np.fromfile(str(path), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Could not read image: {path}")
    return image


def load_bgr_bytes(payload: bytes) -> np.ndarray:
    data = np.frombuffer(payload, dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not read uploaded image")
    return image


def _resize(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    scale = MAX_SIDE / max(height, width)
    if scale >= 1:
        return image
    return cv2.resize(image, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)


def redaction_mask(image: np.ndarray) -> np.ndarray:
    """Large, nearly solid black rectangles. Textured black devices are not masks."""
    black = np.all(image <= 12, axis=2).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(black, 8)
    mask = np.zeros(black.shape, dtype=bool)
    min_area = 0.002 * black.size
    for index in range(1, count):
        _x, _y, width, height, area = stats[index]
        if area < min_area or width < 8 or height < 8:
            continue
        if area / float(width * height) < 0.8:
            continue
        region = image[labels == index]
        if region.size == 0 or float(region.std()) > 4:
            continue
        mask[labels == index] = True
    if mask.any():
        kernel = np.ones((5, 5), np.uint8)
        mask = cv2.dilate(mask.astype(np.uint8), kernel).astype(bool)
    return mask


def _subject_mask(image: np.ndarray, redacted: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    background = (hsv[:, :, 1] < 45) & (hsv[:, :, 2] > 175)
    subject = ~background & ~redacted
    kernel = np.ones((5, 5), np.uint8)
    subject = cv2.morphologyEx(subject.astype(np.uint8), cv2.MORPH_OPEN, kernel).astype(bool)
    subject = cv2.morphologyEx(subject.astype(np.uint8), cv2.MORPH_CLOSE, kernel).astype(bool)
    return subject


def _orange_mask(image: np.ndarray, redacted: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    hue = hsv[:, :, 0]
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    orange = ((hue <= 20) | (hue >= 170)) & (saturation >= 90) & (value >= 50)
    orange &= ~redacted
    kernel = np.ones((3, 3), np.uint8)
    return cv2.morphologyEx(orange.astype(np.uint8), cv2.MORPH_OPEN, kernel).astype(bool)


def measure(image: np.ndarray) -> dict[str, float]:
    image = _resize(image)
    redacted = redaction_mask(image)
    valid = ~redacted
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    if int(valid.sum()) < 50:
        valid = np.ones(gray.shape, dtype=bool)

    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    lap_values = laplacian[valid]
    lap_var = float(lap_values.var()) if lap_values.size else 0.0

    luma = gray[valid].astype(np.float32)
    subject = _subject_mask(image, redacted)
    subject_luma = gray[subject].astype(np.float32) if int(subject.sum()) > 50 else luma

    height, width = gray.shape
    band = max(2, int(0.015 * min(height, width)))
    if int(subject.sum()) > 50:
        edge_fracs = [
            float(subject[:band, :].mean()),
            float(subject[-band:, :].mean()),
            float(subject[:, :band].mean()),
            float(subject[:, -band:].mean()),
        ]
    else:
        edge_fracs = [0.0, 0.0, 0.0, 0.0]

    orange = _orange_mask(image, redacted)
    _count, _labels, stats, _ = cv2.connectedComponentsWithStats(orange.astype(np.uint8), 8)
    blobs = 0
    if len(stats) > 1:
        min_blob = 0.0004 * orange.size
        blobs = int(np.sum(stats[1:, cv2.CC_STAT_AREA] >= min_blob))

    touches = 0.0
    orange_edge = 0.0
    orange_std = 0.0
    if orange.any():
        touches = float(
            max(
                orange[:band, :].mean(),
                orange[-band:, :].mean(),
                orange[:, :band].mean(),
                orange[:, -band:].mean(),
            )
        )
        edges = cv2.Canny(gray, 80, 160)
        orange_edge = float(edges[orange].mean() / 255.0)
        orange_std = float(gray[orange].std())
        blurred = cv2.blur(gray.astype(np.float32), (21, 21))
        squared = cv2.blur(gray.astype(np.float32) ** 2, (21, 21))
        local_std = np.sqrt(np.maximum(squared - blurred ** 2, 0))
        low = orange & (local_std < 10)
        high = orange & (local_std > 14)
        orange_flat = float(low.sum() / max(int(orange.sum()), 1))
        orange_text = float(high.sum() / max(int(orange.sum()), 1))
        ink = float(((gray < 90) & orange).sum() / max(int(orange.sum()), 1))
    else:
        orange_flat = 0.0
        orange_text = 0.0
        ink = 0.0

    margin = 1.0
    touch_sides = 0.0
    if int(subject.sum()) > 50:
        ys, xs = np.where(subject)
        top, bottom = int(ys.min()), int(ys.max())
        left, right = int(xs.min()), int(xs.max())
        margins = [
            top / height,
            (height - 1 - bottom) / height,
            left / width,
            (width - 1 - right) / width,
        ]
        margin = float(min(margins))
        touch_sides = float(sum(side <= 0.01 for side in margins))

    return {
        "lap_var": lap_var,
        "log_lap": float(np.log1p(lap_var)),
        "mean_luma": float(luma.mean()),
        "p10": float(np.percentile(luma, 10)),
        "p95": float(np.percentile(subject_luma, 95)),
        "hot_frac": float(np.mean(subject_luma >= 245)),
        "subject_mean": float(subject_luma.mean()),
        "edge_max": float(max(edge_fracs)),
        "edge_sum": float(sum(edge_fracs)),
        "orange_frac": float(orange.mean()),
        "orange_blobs": float(blobs),
        "orange_touch": touches,
        "orange_edge": orange_edge,
        "orange_std": orange_std,
        "orange_flat": orange_flat,
        "orange_text": orange_text,
        "ink_frac": ink,
        "bbox_margin": margin,
        "touch_sides": touch_sides,
        "subject_frac": float(subject.mean()),
        "bright_frac": float(np.mean(subject_luma >= 200)),
        "redacted_frac": float(redacted.mean()),
    }
