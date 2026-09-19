"""Local view-set expansion: geometry, photometry, and DEMO-tape recolor."""

from __future__ import annotations

import cv2
import numpy as np

from api.features import orange_mask, redaction_mask

# hue (OpenCV 0-179), saturation, extra value on non-ink tape pixels
TAPE_PALETTE = (
    ("yellow", 28, 220, 0),
    ("lime", 45, 200, 0),
    ("green", 70, 180, 0),
    ("cyan", 90, 200, 0),
    ("blue", 118, 200, 0),
    ("purple", 140, 170, 0),
    ("magenta", 155, 180, 0),
    ("red", 3, 210, 0),
    ("cream", 22, 45, 12),
    ("white", 0, 12, 18),
)

N_GEOM = 8


def recolor_tape(
    image: np.ndarray,
    hue: int,
    saturation: int | None = None,
    value_boost: int = 0,
) -> np.ndarray:
    """Paint only the orange DEMO tape. Ink (low value) keeps its brightness."""
    redacted = redaction_mask(image)
    mask = orange_mask(image, redacted)
    if not mask.any():
        return image

    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    kernel = np.ones((5, 5), np.uint8)
    dilated = cv2.dilate(mask.astype(np.uint8), kernel)
    cover = dilated.astype(bool)
    ink = mask & (hsv[:, :, 2] < 90)

    painted = hsv.copy()
    painted[:, :, 0] = np.where(cover, np.uint8(hue % 180), painted[:, :, 0])
    if saturation is not None:
        painted[:, :, 1] = np.where(cover, np.uint8(np.clip(saturation, 0, 255)), painted[:, :, 1])
    if value_boost:
        boosted = np.clip(painted[:, :, 2].astype(np.int16) + int(value_boost), 0, 255).astype(np.uint8)
        painted[:, :, 2] = np.where(cover & ~ink, boosted, painted[:, :, 2])

    recolored = cv2.cvtColor(painted, cv2.COLOR_HSV2BGR)
    soft = cv2.GaussianBlur(dilated.astype(np.float32), (7, 7), 0)
    peak = float(soft.max()) if soft.size else 0.0
    if peak <= 0:
        return image
    alpha = (soft / peak)[:, :, None]
    blended = recolored.astype(np.float32) * alpha + image.astype(np.float32) * (1.0 - alpha)
    return np.clip(blended, 0, 255).astype(np.uint8)


def _photogeom(image: np.ndarray, rng: np.random.RandomState) -> np.ndarray:
    height, width = image.shape[:2]
    work = image
    if rng.rand() < 0.5:
        work = cv2.flip(work, 1)

    angle = float(rng.uniform(-8.0, 8.0))
    scale = float(rng.uniform(0.88, 1.12))
    matrix = cv2.getRotationMatrix2D((width / 2.0, height / 2.0), angle, scale)
    matrix[0, 2] += float(rng.uniform(-0.04, 0.04)) * width
    matrix[1, 2] += float(rng.uniform(-0.04, 0.04)) * height
    work = cv2.warpAffine(work, matrix, (width, height), borderMode=cv2.BORDER_REPLICATE)

    contrast = float(rng.uniform(0.82, 1.18))
    brightness = float(rng.uniform(-18.0, 18.0))
    work = np.clip(work.astype(np.float32) * contrast + brightness, 0, 255).astype(np.uint8)

    hsv = cv2.cvtColor(work, cv2.COLOR_BGR2HSV).astype(np.int16)
    hsv[:, :, 0] = (hsv[:, :, 0] + int(rng.randint(-6, 7))) % 180
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] + int(rng.randint(-15, 16)), 0, 255)
    work = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)

    quality = int(rng.randint(70, 91))
    ok, buffer = cv2.imencode(".jpg", work, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if ok:
        decoded = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
        if decoded is not None:
            return decoded
    return work


def expand_for_view(image: np.ndarray, rng: np.random.RandomState) -> list[np.ndarray]:
    """Geometry/photometry copies plus one recolor per tape color (and a jittered copy)."""
    variants = [_photogeom(image, rng) for _ in range(N_GEOM)]
    for _name, hue, saturation, value_boost in TAPE_PALETTE:
        recolored = recolor_tape(image, hue, saturation, value_boost)
        if recolored is image:
            continue
        variants.append(recolored)
        variants.append(_photogeom(recolored, rng))
    return variants
