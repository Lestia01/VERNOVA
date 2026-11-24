# YOLO Training Studio Configuration
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
PROJECTS_DIR = DATA_DIR / "projects"
MODELS_DIR = DATA_DIR / "models"
JOBS_DIR = DATA_DIR / "jobs"
UPLOADS_DIR = DATA_DIR / "uploads"

# Ensure all base directories exist
for directory in [DATA_DIR, PROJECTS_DIR, MODELS_DIR, JOBS_DIR, UPLOADS_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

# Supported file extensions
ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_ARCHIVE_EXTS = {".zip"}

# Default sorting classes for VERNOVA
DEFAULT_CLASSES = ["merah", "kuning", "biru"]

# Server settings
HOST = "127.0.0.1"
PORT = 8000
