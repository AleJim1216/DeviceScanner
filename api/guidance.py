"""Guidance lines grouped from practice labels. Not model-written text."""

from __future__ import annotations

import csv
import json
from pathlib import Path

FRAMING_GUIDANCE = "Part of the device is cut off. Step back so the whole device is in the frame."
REVIEW_GUIDANCE = "Ask a human to review the intended view and visible detail."

ISSUE_ORDER = (
    "blur",
    "underexposed",
    "glare_or_overexposed",
    "framing",
    "label_obstructed",
)


def _first_sentence(text: str, code: str) -> str:
    text = (text or "").strip()
    if not text:
        return ""
    if code == "framing":
        return FRAMING_GUIDANCE
    if ";" in text and code == "glare_or_overexposed":
        parts = [part.strip() for part in text.split(".") if part.strip()]
        for part in parts:
            if "glare" in part.lower() or "light" in part.lower() or "angle" in part.lower():
                return part if part.endswith(".") else part + "."
    sentence = text.split(".")[0].strip()
    return sentence + "." if sentence else ""


def build_catalog(labels_path: Path) -> dict:
    guidance: dict[str, str] = {}
    reasons: dict[str, str] = {}
    with labels_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            codes = [code for code in (row.get("issue_codes") or "").split(";") if code]
            reason = (row.get("reason") or "").strip()
            line = (row.get("retake_guidance") or "").strip()
            for code in codes:
                reasons.setdefault(code, reason.split(".")[0].strip())
                if code not in guidance and line:
                    guidance[code] = _first_sentence(line, code)
    guidance["framing"] = FRAMING_GUIDANCE
    guidance["needs_review"] = REVIEW_GUIDANCE
    reasons.setdefault("framing", "Part of the intended subject or label lies outside the frame")
    reasons.setdefault("needs_review", "The intended view or visible detail is uncertain")
    return {"guidance": guidance, "reasons": reasons, "order": list(ISSUE_ORDER)}


def save_catalog(catalog: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(catalog, indent=2), encoding="utf-8")


def load_catalog(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def compose(catalog: dict, codes: list[str], status: str) -> tuple[str, str]:
    if status == "usable":
        return "", ""
    if status == "needs_review" and not codes:
        return catalog["reasons"]["needs_review"], catalog["guidance"]["needs_review"]
    reasons = []
    lines = []
    for code in catalog["order"]:
        if code not in codes:
            continue
        reason = catalog["reasons"].get(code, "")
        line = catalog["guidance"].get(code, "")
        if reason:
            reasons.append(reason.rstrip("."))
        if line:
            lines.append(line if line.endswith(".") else line + ".")
    if status == "needs_review" and not lines:
        return catalog["reasons"]["needs_review"], catalog["guidance"]["needs_review"]
    return ". ".join(reasons) + ("." if reasons else ""), " ".join(lines)
