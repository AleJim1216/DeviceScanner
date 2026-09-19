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


def average_hash(image: np.ndarray, size: int = 16) -> np.ndarray:
    gray = cv2.cvtColor(_resize(image), cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (size, size), interpolation=cv2.INTER_AREA)
    return (small > float(small.mean())).astype(np.uint8)


def hash_distance(left: np.ndarray, right: np.ndarray) -> int:
    return int(np.count_nonzero(left.reshape(-1) != right.reshape(-1)))


def resize_to_side(image: np.ndarray, max_side: int) -> np.ndarray:
    height, width = image.shape[:2]
    scale = max_side / max(height, width)
    if scale >= 1:
        return image
    return cv2.resize(image, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)


def resize_for_measure(image: np.ndarray) -> np.ndarray:
    return resize_to_side(image, MAX_SIDE)


def _resize(image: np.ndarray) -> np.ndarray:
    return resize_for_measure(image)


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


def orange_mask(image: np.ndarray, redacted: np.ndarray | None = None) -> np.ndarray:
    """Orange/red DEMO-tape stencil used to recolor existing labels."""
    if redacted is None:
        redacted = redaction_mask(image)
    return _orange_mask(image, redacted)


def _solidity(region: np.ndarray) -> float:
    ys, xs = np.where(region)
    if ys.size < 3:
        return 0.0
    hull = cv2.convexHull(np.stack([xs, ys], axis=1))
    hull_area = float(cv2.contourArea(hull)) if len(hull) >= 3 else float(region.sum())
    return float(region.sum() / max(hull_area, 1.0))


def _tape_mask(image: np.ndarray, redacted: np.ndarray) -> np.ndarray:
    """Orange tape, or another saturated/pale sticker when orange is absent."""
    orange = _orange_mask(image, redacted)
    if float(orange.mean()) >= 0.005:
        return orange
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    tape = orange.copy()

    colorful = (saturation >= 90) & (value >= 50) & ~redacted
    min_color = 0.0025 * colorful.size
    for area, blob_w, blob_h, region in _components(colorful, 0.001):
        if float(orange[region].mean()) >= 0.45:
            tape |= region
            continue
        if area < min_color:
            continue
        aspect = max(blob_w, blob_h) / max(min(blob_w, blob_h), 1)
        if aspect > 14:
            continue
        if _solidity(region) < 0.72:
            continue
        tape |= region

    pale = (value >= 165) & (saturation <= 55) & ~redacted
    pale_min = 0.004 * pale.size
    pale_max = 0.28 * pale.size
    height, width = pale.shape
    band = 2
    for area, blob_w, blob_h, region in _components(pale, 0.002):
        if area < pale_min or area > pale_max:
            continue
        aspect = max(blob_w, blob_h) / max(min(blob_w, blob_h), 1)
        if aspect < 1.8 or aspect > 10:
            continue
        touches = sum(
            (
                bool(region[:band, :].any()),
                bool(region[-band:, :].any()),
                bool(region[:, :band].any()),
                bool(region[:, -band:].any()),
            )
        )
        if touches >= 3:
            continue
        if blob_w >= 0.92 * width or blob_h >= 0.92 * height:
            continue
        if _solidity(region) < 0.78:
            continue
        tape |= region

    kernel = np.ones((3, 3), np.uint8)
    return cv2.morphologyEx(tape.astype(np.uint8), cv2.MORPH_OPEN, kernel).astype(bool)


def _components(mask: np.ndarray, min_frac: float = 0.0004) -> list[tuple]:
    _count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    min_area = min_frac * mask.size
    items = []
    for index in range(1, _count):
        area = int(stats[index, cv2.CC_STAT_AREA])
        if area < min_area:
            continue
        width = int(stats[index, cv2.CC_STAT_WIDTH])
        height = int(stats[index, cv2.CC_STAT_HEIGHT])
        items.append((area, width, height, labels == index))
    return items


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

    orange = _tape_mask(image, redacted)
    orange_blobs = _components(orange)
    blobs = len(orange_blobs)
    edges = cv2.Canny(gray, 80, 160)

    touches = 0.0
    orange_edge = 0.0
    orange_std = 0.0
    orange_flat = 0.0
    orange_text = 0.0
    ink = 0.0
    label_aspect = 0.0
    label_solidity = 0.0
    label_ink_edge = 0.0
    blank_tape = 0.0
    if orange.any():
        touches = float(
            max(
                orange[:band, :].mean(),
                orange[-band:, :].mean(),
                orange[:, :band].mean(),
                orange[:, -band:].mean(),
            )
        )
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

        kernel = np.ones((5, 5), np.uint8)
        if orange_blobs:
            largest = max(orange_blobs, key=lambda item: item[0])
            _area, blob_w, blob_h, region = largest
            label_aspect = float(max(blob_w, blob_h) / max(min(blob_w, blob_h), 1))
            ys, xs = np.where(region)
            hull = cv2.convexHull(np.stack([xs, ys], axis=1))
            hull_area = float(cv2.contourArea(hull)) if len(hull) >= 3 else float(region.sum())
            label_solidity = float(region.sum() / max(hull_area, 1.0))
            ink_region = (gray < 90) & region
            border = cv2.dilate(region.astype(np.uint8), kernel).astype(bool) & ~region
            label_ink_edge = float(((gray < 90) & border).sum() / max(int(ink_region.sum()), 1))
        for _area, _w, _h, region in orange_blobs:
            blob_ink = float(((gray < 90) & region).sum() / max(int(region.sum()), 1))
            if 0.01 <= blob_ink <= 0.15 and int(region.sum()) >= 1500:
                blank_tape += 1.0

    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    io_color = (
        (hsv[:, :, 0] >= 80)
        & (hsv[:, :, 0] <= 150)
        & (hsv[:, :, 1] >= 60)
        & (hsv[:, :, 2] >= 40)
        & subject
        & ~redacted
    )
    io_color_frac = float(io_color.mean())
    subject_edge = float(edges[subject].mean() / 255.0) if int(subject.sum()) > 50 else 0.0

    dark = (gray < 55) & subject & ~redacted
    port_holes = 0.0
    for area, blob_w, blob_h, _region in _components(dark, 0.00005):
        if 40 <= area <= 8000 and 8 <= blob_w <= 160 and 8 <= blob_h <= 80:
            port_holes += 1.0
    port_score = subject_edge + 0.002 * port_holes + 5.0 * io_color_frac

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
        "label_aspect": label_aspect,
        "label_solidity": label_solidity,
        "label_ink_edge": label_ink_edge,
        "blank_tape": blank_tape,
        "port_holes": port_holes,
        "io_color_frac": io_color_frac,
        "subject_edge": subject_edge,
        "port_score": port_score,
        "bbox_margin": margin,
        "touch_sides": touch_sides,
        "subject_frac": float(subject.mean()),
        "bright_frac": float(np.mean(subject_luma >= 200)),
        "redacted_frac": float(redacted.mean()),
    }
