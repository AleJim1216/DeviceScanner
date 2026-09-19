from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from api.config import CAPTURE_COACH
from api.datasets import image_index
from api.inference import checklist, evaluate_bytes, evaluate_set, list_sets, load_models


@asynccontextmanager
async def lifespan(_app):
    load_models()
    yield


app = FastAPI(title="DeviceScanner", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SetRequest(BaseModel):
    set_id: str


@app.get("/health")
def health() -> dict:
    return {"ok": True}


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


@app.post("/analyze")
async def analyze(
    files: list[UploadFile] = File(...),
    views: list[str] = Form(...),
) -> dict:
    if len(files) != len(views):
        raise HTTPException(status_code=400, detail="Each photo needs one intended view")
    allowed = {"front", "rear_ports", "label"}
    photos = []
    intended = []
    for index, (upload, view) in enumerate(zip(files, views), start=1):
        if view not in allowed:
            raise HTTPException(status_code=400, detail=f"Unknown view: {view}")
        payload = await upload.read()
        image_id = upload.filename or f"upload-{index}"
        photos.append(evaluate_bytes(payload, view, image_id))
        intended.append(view)
    return {
        "set_id": None,
        "device_id": None,
        "missing_views": checklist(intended),
        "photos": photos,
    }
