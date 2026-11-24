# YOLO Training Studio — Model Registry
import os
import json
import time
import shutil
from typing import List, Dict, Optional, Any
from pathlib import Path
from .config import MODELS_DIR

class ModelRegistry:
    def __init__(self, models_dir: Path = MODELS_DIR):
        self.models_dir = models_dir
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.registry_file = self.models_dir / "models_index.json"
        self._ensure_index()

    def _ensure_index(self):
        if not self.registry_file.exists():
            with open(self.registry_file, "w", encoding="utf-8") as f:
                json.dump({"active_model_id": None, "models": []}, f, indent=2)

    def _load_index(self) -> Dict[str, Any]:
        self._ensure_index()
        try:
            with open(self.registry_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {"active_model_id": None, "models": []}

    def _save_index(self, data: Dict[str, Any]):
        with open(self.registry_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def register_model(
        self,
        project_id: str,
        project_name: str,
        version: str,
        classes: List[str],
        config: Dict[str, Any],
        metrics: Dict[str, Any],
        weights_filename: str,
        status: str = "completed"
    ) -> Dict[str, Any]:
        idx_data = self._load_index()
        model_id = f"model_{project_id}_{int(time.time())}_v{version.replace('.', '_')}"
        model_dir = self.models_dir / model_id
        model_dir.mkdir(parents=True, exist_ok=True)

        meta = {
            "id": model_id,
            "project_id": project_id,
            "project_name": project_name,
            "version": version,
            "engine": "yolo",
            "task_type": "object_detection",
            "classes": classes,
            "created_at": time.time(),
            "config": config,
            "metrics": {
                "precision": round(metrics.get("precision", 0.0), 4),
                "recall": round(metrics.get("recall", 0.0), 4),
                "mAP50": round(metrics.get("mAP50", 0.0), 4),
                "mAP50_95": round(metrics.get("mAP50_95", 0.0), 4),
                "final_loss": round(metrics.get("final_loss", 0.0), 4),
                "val_loss": round(metrics.get("val_loss", 0.0), 4),
                "epochs_completed": metrics.get("epochs_completed", config.get("epochs", 10)),
                "duration_sec": round(metrics.get("duration_sec", 0.0), 2)
            },
            "weights_filename": weights_filename,
            "status": status  # "completed", "active", "archived"
        }

        # Save individual model metadata
        with open(model_dir / "meta.json", "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)

        # Update global index
        models_list = [m for m in idx_data.get("models", []) if m["id"] != model_id]
        models_list.insert(0, meta)
        idx_data["models"] = models_list

        # If no active model yet, make this one active
        if not idx_data.get("active_model_id"):
            idx_data["active_model_id"] = model_id
            meta["status"] = "active"

        self._save_index(idx_data)
        return meta

    def list_models(self, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        idx_data = self._load_index()
        models = idx_data.get("models", [])
        active_id = idx_data.get("active_model_id")

        for m in models:
            m["is_active"] = (m["id"] == active_id)

        if project_id:
            return [m for m in models if m["project_id"] == project_id]
        return models

    def get_model(self, model_id: str) -> Optional[Dict[str, Any]]:
        idx_data = self._load_index()
        active_id = idx_data.get("active_model_id")
        for m in idx_data.get("models", []):
            if m["id"] == model_id:
                m_copy = dict(m)
                m_copy["is_active"] = (m["id"] == active_id)
                return m_copy
        return None

    def get_active_model(self) -> Optional[Dict[str, Any]]:
        idx_data = self._load_index()
        active_id = idx_data.get("active_model_id")
        if not active_id:
            # Fallback to the first model if available
            models = idx_data.get("models", [])
            return models[0] if models else None
        return self.get_model(active_id)

    def set_active_model(self, model_id: str) -> Dict[str, Any]:
        idx_data = self._load_index()
        found = False
        for m in idx_data.get("models", []):
            if m["id"] == model_id:
                m["status"] = "active"
                found = True
            elif m.get("status") == "active":
                m["status"] = "completed"

        if not found:
            raise ValueError(f"Model dengan ID {model_id} tidak ditemukan.")

        idx_data["active_model_id"] = model_id
        self._save_index(idx_data)
        return self.get_model(model_id)

    def delete_model(self, model_id: str) -> bool:
        idx_data = self._load_index()
        models = [m for m in idx_data.get("models", []) if m["id"] != model_id]
        if len(models) == len(idx_data.get("models", [])):
            return False

        if idx_data.get("active_model_id") == model_id:
            idx_data["active_model_id"] = models[0]["id"] if models else None

        idx_data["models"] = models
        self._save_index(idx_data)

        # Remove model directory
        m_dir = self.models_dir / model_id
        if m_dir.exists():
            shutil.rmtree(m_dir, ignore_errors=True)

        return True

    def compare_models(self, model_id_a: str, model_id_b: str) -> Dict[str, Any]:
        mA = self.get_model(model_id_a)
        mB = self.get_model(model_id_b)
        if not mA or not mB:
            raise ValueError("Satu atau kedua model yang dibandingkan tidak ditemukan.")

        return {
            "model_a": mA,
            "model_b": mB,
            "diff": {
                "precision": round(mA["metrics"]["precision"] - mB["metrics"]["precision"], 4),
                "recall": round(mA["metrics"]["recall"] - mB["metrics"]["recall"], 4),
                "mAP50": round(mA["metrics"]["mAP50"] - mB["metrics"]["mAP50"], 4),
                "duration_diff_sec": round(mA["metrics"]["duration_sec"] - mB["metrics"]["duration_sec"], 2)
            }
        }
