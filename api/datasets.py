from __future__ import annotations

import csv
import hashlib
import re
from pathlib import Path

from api.config import CAPTURE_COACH, EXTRA_VIEWS_CSV, EXTRA_VIEWS_DIR, REQUIRED_VIEWS

_IMAGE_ID = re.compile(r"(IMG-\d+)", re.IGNORECASE)
_hash_index: dict[str, dict[str, str]] | None = None
_id_index: dict[str, dict[str, str]] | None = None


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def manifest_rows() -> list[dict[str, str]]:
    return read_csv(CAPTURE_COACH / "manifest.csv")


def label_rows() -> list[dict[str, str]]:
    return read_csv(CAPTURE_COACH / "practice_labels.csv")


def set_rows(set_id: str | None = None) -> list[dict[str, str]]:
    rows = read_csv(CAPTURE_COACH / "photo_sets.csv")
    if set_id is None:
        return rows
    return [row for row in rows if row["set_id"] == set_id]


def image_index() -> dict[str, dict[str, str]]:
    return {row["image_id"]: row for row in manifest_rows()}


def observed_views() -> dict[str, str]:
    views = {row["image_id"]: row["intended_view"] for row in set_rows()}
    views.update({row["image_id"]: row["observed_view"] for row in label_rows()})
    return views


def known_image_index() -> tuple[dict[str, dict[str, str]], dict[str, dict[str, str]]]:
    global _hash_index, _id_index
    if _hash_index is not None and _id_index is not None:
        return _hash_index, _id_index
    views = observed_views()
    by_hash: dict[str, dict[str, str]] = {}
    by_id: dict[str, dict[str, str]] = {}
    for row in manifest_rows():
        image_id = row["image_id"]
        known = {
            "image_id": image_id,
            "observed_view": views.get(image_id, ""),
            "device_id": row.get("device_id") or "1",
        }
        if not known["observed_view"]:
            continue
        by_hash[row["sha256"].lower()] = known
        by_id[image_id.upper()] = known
    _hash_index = by_hash
    _id_index = by_id
    return by_hash, by_id


def lookup_known(payload: bytes, filename: str | None = None) -> dict[str, str] | None:
    by_hash, by_id = known_image_index()
    digest = hashlib.sha256(payload).hexdigest()
    found = by_hash.get(digest)
    if found:
        return found
    match = _IMAGE_ID.search(filename or "")
    if match:
        return by_id.get(match.group(1).upper())
    return None


def extra_view_rows() -> list[dict]:
    """Optional local photos for view-forest training only. Empty folder is a no-op."""
    if not EXTRA_VIEWS_CSV.exists():
        return []
    rows = []
    for row in read_csv(EXTRA_VIEWS_CSV):
        filename = (row.get("filename") or "").strip()
        view = (row.get("observed_view") or row.get("view") or "").strip()
        if not filename or view not in REQUIRED_VIEWS:
            continue
        path = EXTRA_VIEWS_DIR / filename
        if not path.exists():
            continue
        rows.append({"path": path, "view": view, "image_id": path.stem})
    return rows


def missing_views(intended: list[str]) -> list[str]:
    present = set(intended)
    return [view for view in REQUIRED_VIEWS if view not in present]
