from __future__ import annotations

import base64
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator

from api.accounts import load_snapshot, login, photo_path, require_user, save_snapshot
from api.backends import name_views_and_groups, preload
from api.config import ANALYZE_BACKEND, ASSETS_DIR, CAPTURE_COACH, DASHBOARD_DIR, GEMINI_API_KEY, GEMINI_MODEL
from api.datasets import image_index
from api.inference import apply_view_name, build_groups, evaluate_set, list_sets, load_models, score_payload

log = logging.getLogger("api.analyze")


@asynccontextmanager
async def lifespan(_app):
    logging.getLogger("api").setLevel(logging.INFO)
    load_models()
    preload()
    yield


app = FastAPI(title="ScanE", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SetRequest(BaseModel):
    set_id: str


class ShotPayload(BaseModel):
    view: str
    name: str = ""
    image_base64: str = ""
    group_id: str | None = None

    @field_validator("group_id", mode="before")
    @classmethod
    def coerce_group_id(cls, value):
        if value is None or value == "":
            return None
        return str(value)


class AnalyzePayload(BaseModel):
    shots: list[ShotPayload]


class LoginPayload(BaseModel):
    username: str
    password: str


class LibraryPhoto(BaseModel):
    id: str
    name: str = ""
    view: str = "front"
    intended_view: str = ""
    status: str = ""
    issue_codes: list[str] = []
    reason: str = ""
    guidance: str = ""
    view_uncertain: bool = False
    group_id: str | None = None
    image_base64: str = ""

    @field_validator("group_id", mode="before")
    @classmethod
    def coerce_group_id(cls, value):
        if value is None or value == "":
            return None
        return str(value)


class SnapshotPayload(BaseModel):
    photos: list[LibraryPhoto] = []


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


def _client_group(value: str | None) -> str | None:
    text = str(value or "").strip()
    return text or None


def _analyze_items(items: list[tuple[bytes, str, str, str | None]]) -> dict:
    allowed = {"front", "rear_ports", "label"}
    scored = []
    for index, (payload, view, image_id, client_group) in enumerate(items, start=1):
        if view not in allowed:
            raise HTTPException(status_code=400, detail=f"Unknown view: {view}")
        if not payload:
            raise HTTPException(status_code=400, detail="Empty photo upload")
        try:
            photo, image, known = score_payload(payload, view, image_id or f"upload-{index}")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        scored.append(
            {
                "photo": photo,
                "image": image,
                "known": known,
                "claimed": view,
                "client_group": _client_group(client_group),
            }
        )

    unknown = [index for index, row in enumerate(scored) if row["known"] is None]
    if unknown:
        log.warning("Calling Gemini for %s unknown photo(s)", len(unknown))
        try:
            named = name_views_and_groups(
                [scored[index]["image"] for index in unknown],
                [scored[index]["claimed"] for index in unknown],
            )
        except Exception as exc:
            log.exception("View naming is unavailable")
            raise HTTPException(status_code=503, detail="View naming is unavailable") from exc
        log.warning("Gemini named %s photo(s)", len(named))
        for offset, index in enumerate(unknown):
            row = scored[index]
            named_row = named[offset]
            row["photo"] = apply_view_name(
                row["image"],
                row["photo"]["image_id"],
                named_row["view"],
                named_row["uncertain"],
                row["client_group"] or named_row["group_id"],
            )

    photos = []
    for row in scored:
        photo = row["photo"]
        if row["client_group"]:
            photo["group_id"] = row["client_group"]
        photos.append(photo)
    groups = build_groups(photos)
    return {
        "set_id": None,
        "device_id": None,
        "missing_views": groups[0]["missing_views"] if len(groups) == 1 else [],
        "photos": photos,
        "groups": groups,
    }


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "backend": ANALYZE_BACKEND,
        "model": GEMINI_MODEL if ANALYZE_BACKEND == "gemini" else "local",
        "key_configured": bool(GEMINI_API_KEY) if ANALYZE_BACKEND == "gemini" else True,
    }


@app.get("/sets")
def sets() -> list[dict]:
    return list_sets()


@app.get("/images/{image_id}")
def image(image_id: str):
    row = image_index().get(image_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Unknown image")
    path = CAPTURE_COACH / row["relative_path"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Image file missing")
    return FileResponse(path)


@app.post("/analyze/set")
def analyze_set(body: SetRequest) -> dict:
    try:
        return evaluate_set(body.set_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown set") from None


@app.post("/analyze/payload")
def analyze_payload(body: AnalyzePayload) -> dict:
    if not body.shots:
        raise HTTPException(status_code=400, detail="Each photo needs one intended view")
    items = [
        (
            _decode_photo(shot.image_base64),
            shot.view,
            shot.name or f"upload-{index}",
            shot.group_id,
        )
        for index, shot in enumerate(body.shots, start=1)
    ]
    return _analyze_items(items)


@app.post("/analyze")
async def analyze(
    files: list[UploadFile] = File(...),
    views: list[str] = Form(...),
) -> dict:
    if len(files) != len(views):
        raise HTTPException(status_code=400, detail="Each photo needs one intended view")
    items = []
    for index, (upload, view) in enumerate(zip(files, views), start=1):
        items.append((await upload.read(), view, upload.filename or f"upload-{index}", None))
    return _analyze_items(items)


@app.get("/")
def root():
    return RedirectResponse("/dashboard/")


@app.post("/account/login")
def account_login(body: LoginPayload) -> dict:
    return login(body.username, body.password)


@app.get("/account/snapshot")
def account_snapshot(username: str = Depends(require_user)) -> dict:
    return load_snapshot(username)


@app.put("/account/snapshot")
def account_save_snapshot(body: SnapshotPayload, username: str = Depends(require_user)) -> dict:
    return save_snapshot(username, [photo.model_dump() for photo in body.photos])


@app.get("/account/photos/{photo_id}")
def account_photo(photo_id: str, username: str = Depends(require_user)):
    return FileResponse(
        photo_path(username, photo_id),
        media_type="image/jpeg",
        headers={"Content-Disposition": "inline", "Cache-Control": "private, max-age=60"},
    )


if ASSETS_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")
if DASHBOARD_DIR.is_dir():
    app.mount("/dashboard", StaticFiles(directory=DASHBOARD_DIR, html=True), name="dashboard")
