from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "models"
MODEL_PATH = MODEL_DIR / "blur_exposure.joblib"
GUIDANCE_PATH = MODEL_DIR / "guidance.json"
CAPTURE_COACH = Path(r"C:\Users\roblo\Downloads\Capture_Coach")
REQUIRED_VIEWS = ("front", "rear_ports", "label")
