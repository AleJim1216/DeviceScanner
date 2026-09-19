from __future__ import annotations

import csv
from pathlib import Path

from api.config import CAPTURE_COACH, REQUIRED_VIEWS


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


def missing_views(intended: list[str]) -> list[str]:
    present = set(intended)
    return [view for view in REQUIRED_VIEWS if view not in present]
