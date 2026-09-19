from pathlib import Path

import cv2

from api.config import CAPTURE_COACH
from api.datasets import image_index, label_rows, lookup_known
from api.features import load_bgr
from api.inference import evaluate_bytes
from api.main import app
from fastapi.testclient import TestClient

client = TestClient(app)
WRONG_CHIP = {"front": "label", "label": "rear_ports", "rear_ports": "front"}


def jpeg80(path: Path) -> bytes:
    image = load_bgr(path)
    ok, buffer = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    assert ok
    return buffer.tobytes()


def main() -> None:
    labels = {row["image_id"]: row for row in label_rows()}
    index = image_index()
    folder = CAPTURE_COACH / "images"
    files = sorted(path for path in folder.iterdir() if path.suffix.lower() in {".jpg", ".jpeg", ".png"})
    missing_label = [path.name for path in files if path.stem.upper() not in labels]
    extra_label = [image_id for image_id in labels if not any(path.stem.upper() == image_id for path in files)]
    if missing_label or extra_label:
        raise SystemExit(f"folder/label mismatch files={missing_label} labels={extra_label}")

    view_fails = []
    status_fails = []
    rows = []
    for path in files:
        image_id = path.stem.upper()
        label = labels[image_id]
        expected_view = label["observed_view"]
        expected_status = label["status"]
        payload = path.read_bytes()
        claimed = WRONG_CHIP[expected_view]
        mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"

        known = lookup_known(payload, "upload.bin")
        original = evaluate_bytes(payload, claimed, f"upload-{image_id}")
        recompressed = evaluate_bytes(jpeg80(path), claimed, f"{image_id}{path.suffix}")
        phone = evaluate_bytes(jpeg80(path), claimed, "shot-1.jpg")
        response = client.post(
            "/analyze",
            files={"files": ("shot-1.jpg", jpeg80(path), "image/jpeg")},
            data={"views": [claimed]},
        )
        api = response.json()["photos"][0]

        row = {
            "image_id": image_id,
            "path": index[image_id]["relative_path"],
            "expected_view": expected_view,
            "hash_view": known["observed_view"] if known else None,
            "original_view": original["intended_view"],
            "recompress_view": recompressed["intended_view"],
            "phone_view": phone["intended_view"],
            "api_view": api["intended_view"],
            "expected_status": expected_status,
            "api_status": api["status"],
            "api_issues": ",".join(api["issue_codes"]),
        }
        rows.append(row)
        if not known or known["image_id"] != image_id or known["observed_view"] != expected_view:
            view_fails.append(f"{image_id} hash {known}")
        if original["intended_view"] != expected_view:
            view_fails.append(f"{image_id} original got {original['intended_view']}")
        if recompressed["intended_view"] != expected_view:
            view_fails.append(f"{image_id} recompress got {recompressed['intended_view']}")
        if phone["intended_view"] != expected_view:
            view_fails.append(f"{image_id} phone got {phone['intended_view']}")
        if api["intended_view"] != expected_view:
            view_fails.append(f"{image_id} api got {api['intended_view']}")
        if api["status"] != expected_status:
            status_fails.append(
                f"{image_id} status expected {expected_status} got {api['status']} issues={api['issue_codes']}"
            )
        print(
            f"{image_id:9} view {expected_view:11} -> {api['intended_view']:11} "
            f"status {expected_status:12} -> {api['status']:12} {api['issue_codes']}"
        )

    print(f"tested {len(rows)} / {len(files)} images")
    print(f"view mismatches {len(view_fails)}")
    print(f"status mismatches {len(status_fails)}")
    for line in view_fails:
        print("VIEW", line)
    for line in status_fails:
        print("STATUS", line)
    if view_fails or status_fails:
        raise SystemExit("all-image retest failed")
    print("all-image view and status retest passed")


if __name__ == "__main__":
    main()
