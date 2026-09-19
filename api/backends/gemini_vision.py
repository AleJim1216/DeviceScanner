"""Gemini vision view/grouping. Imported only when ANALYZE_BACKEND=gemini."""

from __future__ import annotations

import json
import logging

from google import genai
from google.genai import types

from api.backends.gemini_context import GUIDE_TEXT, context_examples, example_caption, jpeg_for_gemini
from api.config import GEMINI_API_KEY, GEMINI_MODEL, REQUIRED_VIEWS

log = logging.getLogger("api.analyze")

_client = None
_examples = None


class GeminiUnavailable(RuntimeError):
    pass


def _client_or_raise():
    global _client
    if not GEMINI_API_KEY:
        raise GeminiUnavailable("GEMINI_API_KEY is missing from the project .env")
    if _client is None:
        _client = genai.Client(api_key=GEMINI_API_KEY)
    return _client


def preload() -> None:
    global _examples
    if _examples is None:
        _examples = context_examples()


def _parts_for_batch(images_bgr: list, claimed_views: list[str]) -> list:
    preload()

    parts: list = [types.Part.from_text(text=GUIDE_TEXT)]
    for example in _examples:
        parts.append(types.Part.from_text(text=example_caption(example)))
        parts.append(types.Part.from_bytes(data=example["jpeg"], mime_type="image/jpeg"))

    parts.append(
        types.Part.from_text(
            text=(
                f"Classify {len(images_bgr)} USER photo(s). "
                "Chip hints may be wrong. Other devices besides the examples are expected. "
                "Prefer view=label when the photo is a close-up of any identification label, not only DEMO tape. "
                f"Hints: {claimed_views} "
                'Return one JSON object with a photos array. Example: '
                '{"photos":[{"index":0,"view":"front","group_id":"1","uncertain":false}]}'
            )
        )
    )
    for index, image in enumerate(images_bgr):
        parts.append(types.Part.from_text(text=f"USER photo index={index}"))
        parts.append(types.Part.from_bytes(data=jpeg_for_gemini(image), mime_type="image/jpeg"))
    return parts


def _first_object(text: str) -> dict:
    raw = (text or "").strip()
    decoder = json.JSONDecoder()
    index = 0
    last_error = None
    saw_object = False
    while index < len(raw):
        brace = raw.find("{", index)
        if brace < 0:
            break
        try:
            payload, end = decoder.raw_decode(raw[brace:])
        except json.JSONDecodeError as exc:
            last_error = exc
            index = brace + 1
            continue
        index = brace + max(end, 1)
        if not isinstance(payload, dict):
            continue
        saw_object = True
        if isinstance(payload.get("photos"), list):
            return payload
    if last_error and not saw_object:
        raise GeminiUnavailable(f"Gemini returned invalid JSON: {last_error}") from last_error
    raise GeminiUnavailable("Gemini JSON missing photos[]")


def _parse(text: str, count: int, claimed_views: list[str]) -> list[dict]:
    payload = _first_object(text)
    rows = payload.get("photos") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise GeminiUnavailable("Gemini JSON missing photos[]")

    by_index = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            index = int(row.get("index"))
        except (TypeError, ValueError):
            continue
        view = str(row.get("view") or "")
        if view not in REQUIRED_VIEWS:
            view = ""
        group = str(row.get("group_id") or "1")
        uncertain = bool(row.get("uncertain")) or view == ""
        if not view:
            claimed = claimed_views[index] if index < len(claimed_views) else ""
            view = claimed if claimed in REQUIRED_VIEWS else "front"
            uncertain = True
        by_index[index] = {"view": view, "group_id": group, "uncertain": uncertain}

    results = []
    for index in range(count):
        if index in by_index:
            results.append(by_index[index])
            continue
        claimed = claimed_views[index] if index < len(claimed_views) else ""
        results.append(
            {
                "view": claimed if claimed in REQUIRED_VIEWS else "front",
                "group_id": str(index + 1),
                "uncertain": True,
            }
        )
    return results


def _response_text(response) -> str:
    texts = []
    for candidate in getattr(response, "candidates", None) or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", None) or []:
            if getattr(part, "thought", False):
                continue
            chunk = getattr(part, "text", None) or ""
            if chunk:
                texts.append(chunk)
    if texts:
        return "".join(texts)
    return getattr(response, "text", None) or ""


def _generate(client, images_bgr: list, claimed_views: list[str]) -> str:
    log.warning("Gemini request model=%s photos=%s", GEMINI_MODEL, len(images_bgr))
    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=_parts_for_batch(images_bgr, claimed_views),
            config=types.GenerateContentConfig(
                temperature=0.1,
                response_mime_type="application/json",
                thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.MINIMAL),
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            ),
        )
    except Exception as exc:
        raise GeminiUnavailable(f"Gemini request failed: {exc}") from exc
    text = _response_text(response)
    log.warning("Gemini response chars=%s", len(text))
    if not text:
        raise GeminiUnavailable("Gemini returned empty text")
    return text


def name_views_and_groups(images_bgr: list, claimed_views: list[str]) -> list[dict]:
    client = _client_or_raise()
    last = None
    for _attempt in range(2):
        try:
            return _parse(_generate(client, images_bgr, claimed_views), len(images_bgr), claimed_views)
        except GeminiUnavailable as exc:
            last = exc
            preview = str(exc)
            log.warning("Gemini attempt failed: %s", preview)
    raise last
