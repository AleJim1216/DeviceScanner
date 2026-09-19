from fastapi.testclient import TestClient

from api.config import CAPTURE_COACH
from api.main import app

client = TestClient(app)


def main() -> None:
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
    print("checks passed")
    print(photo["guidance"])


if __name__ == "__main__":
    main()
