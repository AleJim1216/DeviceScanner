from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Header, HTTPException, Query

from api.config import REQUIRED_VIEWS, accounts_dir

USERNAME_RE = re.compile(r"^[a-z0-9_]{3,32}$")
PHOTO_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")
ALLOWED_VIEWS = set(REQUIRED_VIEWS)
ALLOWED_STATUS = {"", "usable", "retake", "needs_review"}
ITERATIONS = 210_000
_lock = threading.Lock()


def _users_path() -> Path:
    return accounts_dir() / "users.json"


def _user_dir(username: str) -> Path:
    return accounts_dir() / username


def _read_users() -> dict:
    path = _users_path()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_users(users: dict) -> None:
    root = accounts_dir()
    root.mkdir(parents=True, exist_ok=True)
    path = _users_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(users, indent=2), encoding="utf-8")
    tmp.replace(path)


def normalize_username(value: str) -> str:
    return str(value or "").strip().lower()


def parse_bearer(authorization: str | None) -> str:
    text = str(authorization or "").strip()
    if text.lower().startswith("bearer "):
        return text[7:].strip()
    return ""


def require_user(
    authorization: str | None = Header(default=None),
    token: str | None = Query(default=None),
) -> str:
    secret = parse_bearer(authorization) or str(token or "").strip()
    if not secret:
        raise HTTPException(status_code=401, detail="Sign in required")
    with _lock:
        users = _read_users()
        for username, row in users.items():
            if isinstance(row, dict) and row.get("token") == secret:
                return username
    raise HTTPException(status_code=401, detail="Sign in required")


def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS).hex()


def login(username: str, password: str) -> dict:
    name = normalize_username(username)
    secret = str(password or "")
    if not USERNAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Use a short username (letters, numbers, _)")
    if len(secret) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    with _lock:
        users = _read_users()
        row = users.get(name)
        if row is None:
            salt = os.urandom(16)
            users[name] = {
                "salt": salt.hex(),
                "password_hash": _hash_password(secret, salt),
                "token": secrets.token_hex(32),
            }
        else:
            try:
                salt = bytes.fromhex(str(row.get("salt") or ""))
            except ValueError:
                salt = b""
            if not salt or _hash_password(secret, salt) != row.get("password_hash"):
                raise HTTPException(status_code=401, detail="That password does not match")
            if not row.get("token"):
                users[name] = {**row, "token": secrets.token_hex(32)}
        _write_users(users)
        token = users[name]["token"]
    return {"username": name, "token": token}


def _decode_photo(text: str) -> bytes:
    raw = (text or "").strip()
    if raw.lower().startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1]
    if not raw:
        return b""
    try:
        return base64.b64decode(raw)
    except Exception:
        return b""


def sanitize_id(value: str) -> str:
    text = str(value or "").strip()
    if not PHOTO_ID_RE.match(text):
        raise HTTPException(status_code=400, detail="Unknown photo")
    return text


def _optional_group(value) -> str | None:
    if value is None or value == "":
        return None
    return str(value)


def _clean_photo(row: dict, index: int) -> dict:
    photo_id = sanitize_id(row.get("id") or f"shot-{index}")
    view = str(row.get("view") or row.get("intended_view") or "front").strip()
    intended = str(row.get("intended_view") or view or "front").strip()
    if view not in ALLOWED_VIEWS:
        raise HTTPException(status_code=400, detail=f"Unknown view: {view}")
    if intended not in ALLOWED_VIEWS:
        raise HTTPException(status_code=400, detail=f"Unknown view: {intended}")
    status = str(row.get("status") or "")
    if status not in ALLOWED_STATUS:
        raise HTTPException(status_code=400, detail="Unknown status")
    codes = row.get("issue_codes") or []
    if not isinstance(codes, list):
        codes = []
    return {
        "id": photo_id,
        "name": str(row.get("name") or f"{photo_id}.jpg"),
        "view": view,
        "intended_view": intended,
        "status": status,
        "issue_codes": [str(code) for code in codes if code],
        "reason": str(row.get("reason") or ""),
        "guidance": str(row.get("guidance") or ""),
        "view_uncertain": bool(row.get("view_uncertain")),
        "group_id": _optional_group(row.get("group_id")),
        "image_base64": row.get("image_base64") or "",
    }


def build_sets(photos: list[dict]) -> list[dict]:
    order = []
    buckets: dict[str, list[int]] = {}
    for index, photo in enumerate(photos):
        group_id = photo.get("group_id")
        if not group_id:
            continue
        key = str(group_id)
        if key not in buckets:
            order.append(key)
            buckets[key] = []
        buckets[key].append(index)
    sets = []
    for sequence, group_id in enumerate(order):
        indexes = buckets[group_id]
        intended = [
            photos[index]["intended_view"]
            for index in indexes
            if not photos[index].get("view_uncertain") and photos[index].get("intended_view")
        ]
        missing = [view for view in REQUIRED_VIEWS if view not in set(intended)]
        sets.append(
            {
                "group_id": group_id,
                "label": f"Set {group_id}" if group_id.isdigit() else f"Device {sequence + 1}",
                "missing_views": missing,
                "photo_indexes": indexes,
            }
        )
    return sets


def public_snapshot(username: str, data: dict) -> dict:
    photos = list(data.get("photos") or [])
    sets = data.get("sets") or build_sets(photos)
    public_photos = []
    for photo in photos:
        row = {key: value for key, value in photo.items() if key != "image_base64"}
        row["image_url"] = f"/account/photos/{photo['id']}"
        public_photos.append(row)
    public_sets = []
    for group in sets:
        indexes = group.get("photo_indexes") or []
        public_sets.append(
            {
                "group_id": group["group_id"],
                "label": group["label"],
                "missing_views": group.get("missing_views") or [],
                "photos": [public_photos[index] for index in indexes if 0 <= index < len(public_photos)],
            }
        )
    return {
        "username": username,
        "updated_at": data.get("updated_at"),
        "photos": public_photos,
        "sets": public_sets,
    }


def save_snapshot(username: str, photos: list[dict]) -> dict:
    cleaned = [_clean_photo(row, index + 1) for index, row in enumerate(photos or [])]
    user_dir = _user_dir(username)
    photo_dir = user_dir / "photos"
    photo_dir.mkdir(parents=True, exist_ok=True)
    keep = set()
    stored = []
    for row in cleaned:
        photo_id = row["id"]
        keep.add(photo_id)
        dest = photo_dir / f"{photo_id}.jpg"
        payload = _decode_photo(row["image_base64"])
        if payload:
            dest.write_bytes(payload)
        elif not dest.exists():
            raise HTTPException(status_code=400, detail="Empty photo upload")
        stored.append({key: value for key, value in row.items() if key != "image_base64"})
    for path in photo_dir.glob("*.jpg"):
        if path.stem not in keep:
            path.unlink()
    snapshot = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "photos": stored,
        "sets": build_sets(stored),
    }
    path = user_dir / "snapshot.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    tmp.replace(path)
    return public_snapshot(username, snapshot)


def load_snapshot(username: str) -> dict:
    path = _user_dir(username) / "snapshot.json"
    if not path.exists():
        return public_snapshot(username, {"updated_at": None, "photos": [], "sets": []})
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {"updated_at": None, "photos": [], "sets": []}
    if not data.get("sets"):
        data["sets"] = build_sets(data.get("photos") or [])
    return public_snapshot(username, data)


def photo_path(username: str, photo_id: str) -> Path:
    path = _user_dir(username) / "photos" / f"{sanitize_id(photo_id)}.jpg"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Unknown photo")
    return path
