import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

MODEL_DIR = ROOT / "models"
MODEL_PATH = MODEL_DIR / "blur_exposure.joblib"
GUIDANCE_PATH = MODEL_DIR / "guidance.json"
CAPTURE_COACH = Path(r"C:\Users\roblo\Downloads\Capture_Coach")
EXTRA_VIEWS_DIR = ROOT / "data" / "extra_views"
EXTRA_VIEWS_CSV = EXTRA_VIEWS_DIR / "extra_views.csv"
DASHBOARD_DIR = ROOT / "dashboard"
ASSETS_DIR = ROOT / "assets"
REQUIRED_VIEWS = ("front", "rear_ports", "label")


def accounts_dir() -> Path:
    raw = os.getenv("ACCOUNTS_DIR", "").strip()
    return Path(raw) if raw else ROOT / "data" / "accounts"

ANALYZE_BACKEND = os.getenv("ANALYZE_BACKEND", "gemini").strip().lower()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite").strip()
