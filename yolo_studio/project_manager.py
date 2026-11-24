# YOLO Training Studio — Project Manager
import json
import time
import shutil
from typing import List, Dict, Optional, Any
from pathlib import Path
from .config import PROJECTS_DIR, DEFAULT_CLASSES

class ProjectManager:
    def __init__(self, projects_dir: Path = PROJECTS_DIR):
        self.projects_dir = projects_dir
        self.projects_dir.mkdir(parents=True, exist_ok=True)

    def _get_project_dir(self, project_id: str) -> Path:
        # Prevent path traversal
        clean_id = Path(project_id).name
        p_dir = self.projects_dir / clean_id
        if not p_dir.resolve().is_relative_to(self.projects_dir.resolve()):
            raise ValueError("Akses direktori proyek tidak valid.")
        return p_dir

    def list_projects(self) -> List[Dict[str, Any]]:
        projects = []
        for p_dir in self.projects_dir.iterdir():
            if p_dir.is_dir():
                meta_file = p_dir / "project.json"
                if meta_file.exists():
                    try:
                        with open(meta_file, "r", encoding="utf-8") as f:
                            data = json.load(f)
                            # Update counts
                            self.sync_project_counts(data["id"], data)
                            projects.append(data)
                    except Exception as e:
                        print(f"Error loading project {p_dir.name}: {e}")
        projects.sort(key=lambda x: x.get("created_at", 0), reverse=True)
        return projects

    def create_project(self, name: str, description: str = "", classes: Optional[List[str]] = None) -> Dict[str, Any]:
        clean_name = name.strip()
        if not clean_name:
            raise ValueError("Nama proyek tidak boleh kosong.")

        if not classes or len(classes) == 0:
            classes = list(DEFAULT_CLASSES)
        
        # Normalize classes (lowercase, trimmed, unique)
        seen = set()
        clean_classes = []
        for c in classes:
            c_clean = str(c).strip().lower()
            if c_clean and c_clean not in seen:
                seen.add(c_clean)
                clean_classes.append(c_clean)

        if len(clean_classes) == 0:
            clean_classes = list(DEFAULT_CLASSES)

        project_id = f"proj_{int(time.time())}_{clean_name[:8].lower().replace(' ', '_')}"
        p_dir = self._get_project_dir(project_id)
        p_dir.mkdir(parents=True, exist_ok=True)

        # Create subdirectories
        (p_dir / "images").mkdir(exist_ok=True)
        (p_dir / "annotations").mkdir(exist_ok=True)
        (p_dir / "labels").mkdir(exist_ok=True)
        (p_dir / "splits").mkdir(exist_ok=True)

        now = time.time()
        project_data = {
            "id": project_id,
            "name": clean_name,
            "description": description.strip(),
            "task_type": "object_detection",
            "classes": clean_classes,
            "created_at": now,
            "updated_at": now,
            "image_count": 0,
            "annotated_count": 0,
            "active_model_id": None,
            "status": "ready"
        }

        with open(p_dir / "project.json", "w", encoding="utf-8") as f:
            json.dump(project_data, f, indent=2)

        return project_data

    def get_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        p_dir = self._get_project_dir(project_id)
        meta_file = p_dir / "project.json"
        if not meta_file.exists():
            return None
        with open(meta_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            self.sync_project_counts(project_id, data)
            return data

    def update_project(self, project_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        p = self.get_project(project_id)
        if not p:
            raise ValueError(f"Proyek {project_id} tidak ditemukan.")

        p_dir = self._get_project_dir(project_id)
        
        if "name" in updates and updates["name"].strip():
            p["name"] = updates["name"].strip()
        if "description" in updates:
            p["description"] = updates["description"].strip()
        if "classes" in updates and isinstance(updates["classes"], list):
            # Update classes safely
            seen = set()
            new_classes = []
            for c in updates["classes"]:
                c_clean = str(c).strip().lower()
                if c_clean and c_clean not in seen:
                    seen.add(c_clean)
                    new_classes.append(c_clean)
            if new_classes:
                p["classes"] = new_classes
        if "active_model_id" in updates:
            p["active_model_id"] = updates["active_model_id"]

        p["updated_at"] = time.time()
        with open(p_dir / "project.json", "w", encoding="utf-8") as f:
            json.dump(p, f, indent=2)

        return p

    def delete_project(self, project_id: str) -> bool:
        p_dir = self._get_project_dir(project_id)
        if p_dir.exists():
            shutil.rmtree(p_dir)
            return True
        return False

    def sync_project_counts(self, project_id: str, project_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        p_dir = self._get_project_dir(project_id)
        images_dir = p_dir / "images"
        ann_dir = p_dir / "annotations"

        img_count = len(list(images_dir.glob("*.*"))) if images_dir.exists() else 0
        ann_count = len(list(ann_dir.glob("*.json"))) if ann_dir.exists() else 0

        if project_data is None:
            meta_file = p_dir / "project.json"
            if meta_file.exists():
                with open(meta_file, "r", encoding="utf-8") as f:
                    project_data = json.load(f)
            else:
                return {"image_count": img_count, "annotated_count": ann_count}

        if project_data.get("image_count") != img_count or project_data.get("annotated_count") != ann_count:
            project_data["image_count"] = img_count
            project_data["annotated_count"] = ann_count
            try:
                with open(p_dir / "project.json", "w", encoding="utf-8") as f:
                    json.dump(project_data, f, indent=2)
            except Exception:
                pass

        return project_data
