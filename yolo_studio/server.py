# YOLO Training Studio — FastAPI Server
import os
import io
import time
from typing import List, Dict, Optional, Any
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel
import cv2

from .config import PROJECTS_DIR, MODELS_DIR, HOST, PORT
from .project_manager import ProjectManager
from .dataset_manager import DatasetManager
from .training_engine import TrainingEngine
from .model_registry import ModelRegistry
from .inference_engine import InferenceEngine

app = FastAPI(
    title="VERNOVA YOLO Training Studio API",
    description="Backend AI Vision Computer Vision berbasis YOLO & OpenCV untuk robot sortir VERNOVA",
    version="1.0.0"
)

# CORS Middleware (mengizinkan akses dari dashboard localhost:8080, 127.0.0.1, dsb.)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Core Modules
pm = ProjectManager(PROJECTS_DIR)
dm = DatasetManager(pm)
registry = ModelRegistry(MODELS_DIR)
engine = TrainingEngine(pm=pm, dm=dm, registry=registry)
infer = InferenceEngine(registry=registry)

# Pydantic Schemas
class CreateProjectReq(BaseModel):
    name: str
    description: Optional[str] = ""
    classes: Optional[List[str]] = None

class UpdateProjectReq(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    classes: Optional[List[str]] = None
    active_model_id: Optional[str] = None

class CaptureReq(BaseModel):
    image_base64: str

class BBoxItem(BaseModel):
    class_id: Optional[int] = 0
    class_name: Optional[str] = None
    x_center: float
    y_center: float
    width: float
    height: float

class AnnotationReq(BaseModel):
    bboxes: List[BBoxItem]

class TrainReq(BaseModel):
    epochs: Optional[int] = 10
    batch_size: Optional[int] = 16
    imgsz: Optional[int] = 640
    device: Optional[str] = "auto"
    model_name: Optional[str] = "yolov8n.pt"

class InferenceReq(BaseModel):
    image_base64: str
    model_id: Optional[str] = None
    conf_threshold: Optional[float] = 0.25
    draw_bboxes: Optional[bool] = False

class CompareReq(BaseModel):
    model_id_a: str
    model_id_b: str


# =============================================================================
# 1. HEALTH & SYSTEM STATUS ENDPOINTS
# =============================================================================
@app.get("/api/health")
def health_check():
    return {
        "status": "online",
        "engine": "YOLO + OpenCV Studio",
        "version": "1.0.0",
        "timestamp": time.time()
    }

@app.get("/api/engine/status")
def engine_status():
    active_model = registry.get_active_model()
    devices = engine.get_available_devices()
    return {
        "engine": "yolo",
        "opencv_version": cv2.__version__,
        "devices": devices,
        "active_model": active_model,
        "total_projects": len(pm.list_projects()),
        "total_models": len(registry.list_models())
    }


# =============================================================================
# 2. PROJECT MANAGEMENT ENDPOINTS
# =============================================================================
@app.get("/api/projects")
def get_projects():
    return pm.list_projects()

@app.post("/api/projects")
def create_project(req: CreateProjectReq):
    try:
        p = pm.create_project(name=req.name, description=req.description or "", classes=req.classes)
        return p
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/projects/{project_id}")
def get_project_detail(project_id: str):
    p = pm.get_project(project_id)
    if not p:
        raise HTTPException(status_code=404, detail=f"Proyek {project_id} tidak ditemukan.")
    return p

@app.put("/api/projects/{project_id}")
def update_project(project_id: str, req: UpdateProjectReq):
    try:
        p = pm.update_project(project_id, req.dict(exclude_unset=True))
        return p
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str):
    success = pm.delete_project(project_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Proyek {project_id} tidak ditemukan.")
    return {"ok": True, "message": f"Proyek {project_id} berhasil dihapus."}


# =============================================================================
# 3. DATASET & IMAGE ENDPOINTS
# =============================================================================
@app.get("/api/projects/{project_id}/images")
def list_images(project_id: str):
    try:
        return dm.list_images(project_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.post("/api/projects/{project_id}/upload")
async def upload_image(project_id: str, file: UploadFile = File(...)):
    try:
        data = await file.read()
        res = dm.save_image_bytes(project_id, data, file.filename or "image.jpg")
        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/projects/{project_id}/capture")
def capture_image(project_id: str, req: CaptureReq):
    try:
        res = dm.save_camera_capture(project_id, req.image_base64)
        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/projects/{project_id}/images/{image_id}")
def delete_image(project_id: str, image_id: str):
    try:
        success = dm.delete_image(project_id, image_id)
        return {"ok": success}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.post("/api/projects/{project_id}/upload-zip")
async def upload_zip_dataset(project_id: str, file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="File harus berformat arsip ZIP.")
    try:
        data = await file.read()
        res = dm.upload_zip_dataset(project_id, data)
        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/projects/{project_id}/validate")
def validate_dataset(project_id: str):
    try:
        return dm.validate_dataset(project_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.get("/api/projects/{project_id}/images/{filename}")
def serve_image(project_id: str, filename: str):
    p_dir = pm._get_project_dir(project_id)
    clean_name = Path(filename).name
    img_path = p_dir / "images" / clean_name
    if not img_path.exists():
        raise HTTPException(status_code=404, detail="Gambar tidak ditemukan.")
    return FileResponse(img_path)


# =============================================================================
# 4. ANNOTATION STUDIO ENDPOINTS
# =============================================================================
@app.get("/api/projects/{project_id}/annotations/{image_id}")
def get_annotation(project_id: str, image_id: str):
    try:
        return dm.get_annotation(project_id, image_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.post("/api/projects/{project_id}/annotations/{image_id}")
def save_annotation(project_id: str, image_id: str, req: AnnotationReq):
    try:
        bboxes = [b.dict() for b in req.bboxes]
        return dm.save_annotations(project_id, image_id, bboxes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# 5. TRAINING ENGINE & JOB MANAGER ENDPOINTS
# =============================================================================
@app.post("/api/projects/{project_id}/train")
def start_training(project_id: str, req: TrainReq):
    try:
        job = engine.start_training(project_id, req.dict())
        return job.to_dict()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/jobs/{job_id}")
def get_job_status(job_id: str):
    job = engine.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} tidak ditemukan.")
    return job.to_dict()

@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    ok = engine.cancel_job(job_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Job {job_id} tidak ditemukan.")
    return {"ok": True, "message": f"Job {job_id} berhasil dibatalkan."}

@app.get("/api/jobs")
def list_jobs(project_id: Optional[str] = None):
    return engine.list_jobs(project_id)


# =============================================================================
# 6. MODEL REGISTRY ENDPOINTS
# =============================================================================
@app.get("/api/models")
def list_models(project_id: Optional[str] = None):
    return registry.list_models(project_id)

@app.get("/api/models/active")
def get_active_model():
    m = registry.get_active_model()
    if not m:
        return {
            "id": "model_default_builtin",
            "name": "VERNOVA Built-in Vision",
            "classes": ["merah", "kuning", "biru"],
            "version": "1.0.0",
            "is_active": True
        }
    return m

@app.get("/api/models/{model_id}")
def get_model(model_id: str):
    m = registry.get_model(model_id)
    if not m:
        raise HTTPException(status_code=404, detail=f"Model {model_id} tidak ditemukan.")
    return m

@app.post("/api/models/{model_id}/activate")
def activate_model(model_id: str):
    try:
        m = registry.set_active_model(model_id)
        # Update project active model
        if m.get("project_id"):
            try:
                pm.update_project(m["project_id"], {"active_model_id": model_id})
            except Exception:
                pass
        return m
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.delete("/api/models/{model_id}")
def delete_model(model_id: str):
    ok = registry.delete_model(model_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Model {model_id} tidak ditemukan.")
    return {"ok": True, "message": f"Model {model_id} berhasil dihapus."}

@app.post("/api/models/compare")
def compare_models(req: CompareReq):
    try:
        return registry.compare_models(req.model_id_a, req.model_id_b)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# 7. INFERENCE ENDPOINTS (TESTING & ROBOT SORTING)
# =============================================================================
@app.post("/api/inference/image")
async def inference_image(
    file: Optional[UploadFile] = File(None),
    model_id: Optional[str] = Form(None),
    conf_threshold: Optional[float] = Form(0.25)
):
    if not file:
        raise HTTPException(status_code=400, detail="File gambar wajib diunggah.")
    data = await file.read()
    try:
        return infer.predict(data, model_id=model_id, conf_threshold=conf_threshold)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/inference/frame")
def inference_frame(req: InferenceReq):
    try:
        pred = infer.predict(req.image_base64, model_id=req.model_id, conf_threshold=req.conf_threshold or 0.25)
        if req.draw_bboxes:
            pred["annotated_image_base64"] = infer.draw_detections(req.image_base64, pred["detections"])
        return pred
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("yolo_studio.server:app", host=HOST, port=PORT, reload=False)
