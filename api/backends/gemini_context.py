"""Capture_Coach examples for Gemini. Not an allowlist of devices."""

from __future__ import annotations

import cv2
import numpy as np

from api.config import CAPTURE_COACH
from api.datasets import image_index, label_rows
from api.features import load_bgr, resize_to_side

GUIDE_TEXT = """You evaluate equipment photos for a capture coach.

Required views:
- front: the front of a device, including its outer edges
- rear_ports: the rear or connection side, including ports
- label: any identification label that is the subject of the photo (manufacturer nameplate, serial or asset sticker, barcode/QR plate, paper tag, DEMO tape, or similar). A close-up is allowed and preferred

Statuses used by the app (you name the VIEW and GROUP only):
- usable / retake / needs_review are decided by local measurements
- A missing view is per device group, not a retake

Rules:
- Prefer view=label when the photo is mainly a label, sticker, or plate, even if some chassis is visible
- Orange DEMO tape is only one example from the practice photos. Do not require the word DEMO or orange tape
- A full front or rear that merely includes a small distant sticker stays front or rear_ports
- Devices may have different shapes, colors, ports, and label hues
- The attached example photos are EXAMPLES ONLY from a practice set
- Other equipment not shown in the examples will appear. Do not reject them
- Do not force a known device ID or brand. Do not read DEMO, serial, or privacy-box text
- Photos of different chassis in one batch are different groups (monitor rear vs PC front)
- Same chassis, different views, stay in one group
- Ignore black privacy rectangles and dark table backgrounds as defects

Return JSON only:
{"photos":[{"index":0,"view":"front|rear_ports|label","group_id":"1","uncertain":false}]}
"""

GEMINI_SIDE = 512
GEMINI_JPEG_QUALITY = 60

# One usable of each view plus a few labeled defects. Not the full 34.
EXEMPLARS = (
    "IMG-0001",
    "IMG-0002",
    "IMG-0003",
    "IMG-0004",
    "IMG-0005",
    "IMG-0007",
)


def jpeg_for_gemini(image: np.ndarray) -> bytes:
    work = resize_to_side(image, GEMINI_SIDE)
    ok, buffer = cv2.imencode(".jpg", work, [int(cv2.IMWRITE_JPEG_QUALITY), GEMINI_JPEG_QUALITY])
    if not ok:
        raise ValueError("Could not encode photo for Gemini")
    return buffer.tobytes()


def context_examples() -> list[dict]:
    labels = {row["image_id"]: row for row in label_rows()}
    paths = image_index()
    examples = []
    for image_id in EXEMPLARS:
        label = labels.get(image_id)
        row = paths.get(image_id)
        if not label or not row:
            continue
        image = load_bgr(CAPTURE_COACH / row["relative_path"])
        examples.append(
            {
                "image_id": image_id,
                "view": label["observed_view"],
                "status": label["status"],
                "issue_codes": label.get("issue_codes") or "",
                "jpeg": jpeg_for_gemini(image),
            }
        )
    return examples


def example_caption(example: dict) -> str:
    issues = example["issue_codes"] or "none"
    return (
        f"EXAMPLE only (not the only allowed device). "
        f"observed_view={example['view']} status={example['status']} issues={issues}"
    )
