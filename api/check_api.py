import base64

import cv2
import numpy as np
from fastapi.testclient import TestClient

from api.backends.gemini_context import GEMINI_SIDE, GUIDE_TEXT, jpeg_for_gemini
from api.backends.gemini_vision import _parse
from api.config import CAPTURE_COACH
from api.features import load_bgr
from api.inference import build_groups
from api.main import app

client = TestClient(app)


def main() -> None:
    assert "identification label" in GUIDE_TEXT
    assert "Prefer view=label" in GUIDE_TEXT
    assert "Do not require the word DEMO" in GUIDE_TEXT

    doubled = (
        '{"photos":[{"index":0,"view":"front","group_id":"1","uncertain":false}]}'
        '{"photos":[{"index":0,"view":"label","group_id":"2","uncertain":true}]}'
    )
    parsed = _parse(doubled, 1, ["rear_ports"])
    assert parsed[0]["view"] == "front"
    assert parsed[0]["group_id"] == "1"

    thought_then_photos = (
        '{"reasoning":"monitor chassis"}\n'
        '{"photos":[{"index":0,"view":"label","group_id":"1","uncertain":false}]}'
    )
    thought_parsed = _parse(thought_then_photos, 1, ["front"])
    assert thought_parsed[0]["view"] == "label"
    assert thought_parsed[0]["group_id"] == "1"

    user_sets = build_groups(
        [
            {"group_id": "1", "intended_view": "front", "view_uncertain": False},
            {"group_id": "2", "intended_view": "label", "view_uncertain": False},
        ]
    )
    assert [group["label"] for group in user_sets] == ["Set 1", "Set 2"]
    practice = build_groups(
        [{"group_id": "DEV-001", "intended_view": "front", "view_uncertain": False}]
    )
    assert practice[0]["label"] == "Device 1"

    assert client.get("/health").json()["ok"] is True
    sets = {row["set_id"]: row for row in client.get("/sets").json()}
    assert sets["SET-007"]["missing_views"] == ["rear_ports"]
    assert sets["SET-009"]["missing_views"] == ["label"]
    assert sets["SET-001"]["missing_views"] == []
    assert sets["SET-004"]["missing_views"] == ["rear_ports"]

    partial = client.post("/analyze/set", json={"set_id": "SET-007"}).json()
    assert partial["missing_views"] == ["rear_ports"]
    assert [photo["image_id"] for photo in partial["photos"]] == ["IMG-0001", "IMG-0002"]

    missing_label = client.post("/analyze/set", json={"set_id": "SET-009"}).json()
    assert missing_label["missing_views"] == ["label"]
    assert len(missing_label["photos"]) == 2

    full = client.post("/analyze/set", json={"set_id": "SET-006"}).json()
    assert full["missing_views"] == []
    front = next(photo for photo in full["photos"] if photo["image_id"] == "IMG-0001")
    assert front["status"] == "usable"
    assert front["guidance"] == ""

    path = CAPTURE_COACH / "images" / "IMG-0007.jpg"
    content = path.read_bytes()
    gemini_jpeg = jpeg_for_gemini(load_bgr(path))
    gemini_image = cv2.imdecode(np.frombuffer(gemini_jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert gemini_image is not None
    assert max(gemini_image.shape[:2]) <= GEMINI_SIDE
    assert len(gemini_jpeg) < len(content)
    response = client.post(
        "/analyze",
        files={"files": ("IMG-0007.jpg", content, "image/jpeg")},
        data={"views": "front"},
    )
    print("upload", response.status_code, response.text[:800])
    body = response.json()
    assert body["missing_views"] == ["rear_ports", "label"]
    photo = body["photos"][0]
    assert photo["status"] == "retake"
    assert "framing" in photo["issue_codes"]
    assert "Step back" in photo["guidance"]

    second = (CAPTURE_COACH / "images" / "IMG-0001.jpg").read_bytes()
    multi = client.post(
        "/analyze",
        files=[
            ("files", ("IMG-0007.jpg", content, "image/jpeg")),
            ("files", ("IMG-0001.jpg", second, "image/jpeg")),
        ],
        data={"views": ["front", "label"]},
    )
    print("multi-upload", multi.status_code, multi.text[:400])
    multi_body = multi.json()
    assert multi.status_code == 200
    assert len(multi_body["photos"]) == 2
    assert [photo["intended_view"] for photo in multi_body["photos"]] == ["front", "front"]
    assert multi_body["missing_views"] == ["rear_ports", "label"]

    packed = client.post(
        "/analyze/payload",
        json={
            "shots": [
                {
                    "view": "front",
                    "name": "shot-1.jpg",
                    "image_base64": base64.b64encode(content).decode("ascii"),
                }
            ]
        },
    )
    print("payload", packed.status_code, packed.text[:200])
    assert packed.status_code == 200
    assert packed.json()["photos"][0]["intended_view"] == "front"
    assert packed.json()["photos"][0]["group_id"] == "DEV-001"

    grouped = client.post(
        "/analyze/payload",
        json={
            "shots": [
                {
                    "view": "front",
                    "name": "shot-1.jpg",
                    "image_base64": base64.b64encode(content).decode("ascii"),
                    "group_id": "1",
                },
                {
                    "view": "front",
                    "name": "shot-2.jpg",
                    "image_base64": base64.b64encode(second).decode("ascii"),
                    "group_id": "2",
                },
            ]
        },
    )
    print("grouped", grouped.status_code, grouped.text[:200])
    grouped_body = grouped.json()
    assert grouped.status_code == 200
    assert [photo["group_id"] for photo in grouped_body["photos"]] == ["1", "2"]
    assert [group["group_id"] for group in grouped_body["groups"]] == ["1", "2"]
    assert [group["label"] for group in grouped_body["groups"]] == ["Set 1", "Set 2"]

    numbered = client.post(
        "/analyze/payload",
        json={
            "shots": [
                {
                    "view": "front",
                    "name": "shot-1.jpg",
                    "image_base64": base64.b64encode(content).decode("ascii"),
                    "group_id": 3,
                }
            ]
        },
    )
    assert numbered.status_code == 200
    assert numbered.json()["photos"][0]["group_id"] == "3"
    assert numbered.json()["groups"][0]["label"] == "Set 3"
    print("checks passed")
    print(photo["guidance"])


if __name__ == "__main__":
    main()
