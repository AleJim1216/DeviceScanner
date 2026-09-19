import base64
import os
import tempfile

import cv2
import numpy as np
from fastapi.testclient import TestClient

os.environ["ACCOUNTS_DIR"] = tempfile.mkdtemp()

from api.main import app

client = TestClient(app)


def _jpeg() -> bytes:
    ok, buf = cv2.imencode(".jpg", np.zeros((24, 32, 3), np.uint8))
    assert ok
    return buf.tobytes()


def main() -> None:
    created = client.post("/account/login", json={"username": "Demo_user", "password": "pass"})
    assert created.status_code == 200
    body = created.json()
    assert body["username"] == "demo_user"
    token = body["token"]
    headers = {"Authorization": f"Bearer {token}"}

    bad = client.post("/account/login", json={"username": "demo_user", "password": "nope"})
    assert bad.status_code == 401

    assert client.get("/account/snapshot").status_code == 401
    empty = client.get("/account/snapshot", headers=headers).json()
    assert empty["photos"] == []
    assert empty["sets"] == []

    payload = base64.b64encode(_jpeg()).decode("ascii")
    saved = client.put(
        "/account/snapshot",
        headers=headers,
        json={
            "photos": [
                {
                    "id": "shot-open",
                    "name": "open.jpg",
                    "view": "front",
                    "intended_view": "front",
                    "group_id": None,
                    "image_base64": payload,
                },
                {
                    "id": "shot-set",
                    "name": "set.jpg",
                    "view": "label",
                    "intended_view": "label",
                    "status": "usable",
                    "group_id": "1",
                    "image_base64": payload,
                },
            ]
        },
    )
    assert saved.status_code == 200
    data = saved.json()
    assert [photo["id"] for photo in data["photos"]] == ["shot-open", "shot-set"]
    assert data["photos"][0]["group_id"] is None
    assert data["sets"][0]["label"] == "Set 1"
    assert data["sets"][0]["missing_views"] == ["front", "rear_ports"]

    photo = client.get("/account/photos/shot-set", headers=headers)
    assert photo.status_code == 200
    assert photo.content[:2] == b"\xff\xd8"

    again = client.post("/account/login", json={"username": "demo_user", "password": "pass"})
    assert again.status_code == 200
    assert again.json()["token"] == token
    assert client.get("/account/snapshot", headers=headers).status_code == 200
    print("account checks passed")


if __name__ == "__main__":
    main()
