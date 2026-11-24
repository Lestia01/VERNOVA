# YOLO Training Studio — Dataset Manager
import os
import io
import re
import json
import time
import zipfile
import hashlib
from typing import List, Dict, Optional, Any, Tuple
from pathlib import Path
from PIL import Image
import cv2
import numpy as np

from .config import PROJECTS_DIR, ALLOWED_IMAGE_EXTS
from .project_manager import ProjectManager

class DatasetManager:
    def __init__(self, project_manager: Optional[ProjectManager] = None):
        self.pm = project_manager or ProjectManager()

    def _get_project(self, project_id: str) -> Dict[str, Any]:
        p = self.pm.get_project(project_id)
        if not p:
            raise ValueError(f"Proyek {project_id} tidak ditemukan.")
        return p

    def _get_paths(self, project_id: str) -> Tuple[Path, Path, Path, Path]:
        p_dir = self.pm._get_project_dir(project_id)
        return (
            p_dir / "images",
            p_dir / "annotations",
            p_dir / "labels",
            p_dir / "splits"
        )

    def list_images(self, project_id: str) -> List[Dict[str, Any]]:
        self._get_project(project_id)
        images_dir, ann_dir, _, _ = self._get_paths(project_id)
        
        items = []
        for img_path in images_dir.glob("*.*"):
            if img_path.suffix.lower() in ALLOWED_IMAGE_EXTS:
                img_id = img_path.stem
                ann_file = ann_dir / f"{img_id}.json"
                is_annotated = ann_file.exists()
                bboxes = []
                if is_annotated:
                    try:
                        with open(ann_file, "r", encoding="utf-8") as f:
                            ann_data = json.load(f)
                            bboxes = ann_data.get("bboxes", [])
                    except Exception:
                        pass

                stat = img_path.stat()
                items.append({
                    "id": img_id,
                    "filename": img_path.name,
                    "ext": img_path.suffix.lower(),
                    "size_bytes": stat.st_size,
                    "created_at": stat.st_mtime,
                    "is_annotated": is_annotated,
                    "annotation_count": len(bboxes),
                    "bboxes": bboxes
                })
        
        items.sort(key=lambda x: x["created_at"], reverse=True)
        return items

    def save_image_bytes(self, project_id: str, data: bytes, original_filename: str) -> Dict[str, Any]:
        self._get_project(project_id)
        images_dir, _, _, _ = self._get_paths(project_id)

        ext = Path(original_filename).suffix.lower()
        if ext not in ALLOWED_IMAGE_EXTS:
            ext = ".jpg"

        # Validate that the image data is valid
        try:
            pil_img = Image.open(io.BytesIO(data))
            pil_img.verify()
            # Reopen to read dimensions
            pil_img = Image.open(io.BytesIO(data))
            width, height = pil_img.size
        except Exception as e:
            raise ValueError(f"File gambar tidak valid atau rusak: {e}")

        # Generate unique image ID
        timestamp = int(time.time() * 1000)
        clean_base = re.sub(r"[^a-zA-Z0-9_-]", "_", Path(original_filename).stem)[:16]
        img_id = f"img_{timestamp}_{clean_base}"
        save_name = f"{img_id}{ext}"
        save_path = images_dir / save_name

        with open(save_path, "wb") as f:
            f.write(data)

        self.pm.sync_project_counts(project_id)

        return {
            "id": img_id,
            "filename": save_name,
            "width": width,
            "height": height,
            "size_bytes": len(data),
            "is_annotated": False,
            "annotation_count": 0
        }

    def save_camera_capture(self, project_id: str, base64_str: str) -> Dict[str, Any]:
        import base64
        # Strip header if present (e.g., 'data:image/jpeg;base64,')
        if "," in base64_str:
            base64_str = base64_str.split(",", 1)[1]
        
        try:
            data = base64.b64decode(base64_str)
        except Exception as e:
            raise ValueError(f"Format base64 capture tidak valid: {e}")

        return self.save_image_bytes(project_id, data, f"capture_{int(time.time())}.jpg")

    def delete_image(self, project_id: str, image_id: str) -> bool:
        self._get_project(project_id)
        images_dir, ann_dir, labels_dir, _ = self._get_paths(project_id)

        found = False
        for img_path in images_dir.glob(f"{image_id}.*"):
            img_path.unlink(missing_ok=True)
            found = True

        (ann_dir / f"{image_id}.json").unlink(missing_ok=True)
        (labels_dir / f"{image_id}.txt").unlink(missing_ok=True)

        self.pm.sync_project_counts(project_id)
        return found

    def save_annotations(self, project_id: str, image_id: str, bboxes: List[Dict[str, Any]]) -> Dict[str, Any]:
        project = self._get_project(project_id)
        classes = project["classes"]
        images_dir, ann_dir, labels_dir, _ = self._get_paths(project_id)

        # Check image exists
        img_files = list(images_dir.glob(f"{image_id}.*"))
        if not img_files:
            raise ValueError(f"Gambar dengan ID {image_id} tidak ditemukan.")

        validated_bboxes = []
        yolo_lines = []

        for b in bboxes:
            # Validate bounding box: normalized [0, 1]
            x_center = float(b.get("x_center", 0.5))
            y_center = float(b.get("y_center", 0.5))
            width = float(b.get("width", 0.1))
            height = float(b.get("height", 0.1))

            # Clamp coordinates to [0, 1]
            x_center = max(0.001, min(0.999, x_center))
            y_center = max(0.001, min(0.999, y_center))
            width = max(0.005, min(1.0, width))
            height = max(0.005, min(1.0, height))

            # Class ID / Name resolution
            class_id = b.get("class_id")
            class_name = b.get("class_name")

            if class_id is None and class_name:
                class_name_clean = str(class_name).strip().lower()
                if class_name_clean in classes:
                    class_id = classes.index(class_name_clean)
                else:
                    class_id = 0
            elif class_id is not None:
                class_id = int(class_id)
                if class_id < 0 or class_id >= len(classes):
                    class_id = 0
                class_name = classes[class_id]
            else:
                class_id = 0
                class_name = classes[0]

            box_obj = {
                "class_id": class_id,
                "class_name": class_name,
                "x_center": round(x_center, 6),
                "y_center": round(y_center, 6),
                "width": round(width, 6),
                "height": round(height, 6)
            }
            validated_bboxes.append(box_obj)
            yolo_lines.append(f"{class_id} {box_obj['x_center']} {box_obj['y_center']} {box_obj['width']} {box_obj['height']}")

        # Save JSON annotation
        ann_path = ann_dir / f"{image_id}.json"
        with open(ann_path, "w", encoding="utf-8") as f:
            json.dump({
                "image_id": image_id,
                "project_id": project_id,
                "updated_at": time.time(),
                "bboxes": validated_bboxes
            }, f, indent=2)

        # Save YOLO text file
        label_path = labels_dir / f"{image_id}.txt"
        with open(label_path, "w", encoding="utf-8") as f:
            f.write("\n".join(yolo_lines) + ("\n" if yolo_lines else ""))

        self.pm.sync_project_counts(project_id)

        return {
            "image_id": image_id,
            "count": len(validated_bboxes),
            "bboxes": validated_bboxes
        }

    def get_annotation(self, project_id: str, image_id: str) -> Dict[str, Any]:
        self._get_project(project_id)
        _, ann_dir, _, _ = self._get_paths(project_id)
        ann_path = ann_dir / f"{image_id}.json"

        if ann_path.exists():
            with open(ann_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return {"image_id": image_id, "bboxes": []}

    def upload_zip_dataset(self, project_id: str, zip_bytes: bytes) -> Dict[str, Any]:
        project = self._get_project(project_id)
        classes = project["classes"]
        images_dir, ann_dir, labels_dir, _ = self._get_paths(project_id)

        valid_images = 0
        valid_labels = 0
        corrupt_files = 0
        skipped_files = 0

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
            # Check for path traversal vulnerabilities (Zip Slip)
            for member in z.infolist():
                clean_path = Path(member.filename)
                if ".." in clean_path.parts or member.filename.startswith(("/", "\\")):
                    raise ValueError(f"Arsip ZIP berbahaya terdeteksi (Path Traversal): {member.filename}")

            extracted_images = {}
            extracted_labels = {}

            for member in z.infolist():
                if member.is_dir():
                    continue

                p = Path(member.filename)
                ext = p.suffix.lower()
                stem = p.stem

                if ext in ALLOWED_IMAGE_EXTS:
                    try:
                        data = z.read(member)
                        # Verify image
                        pil_img = Image.open(io.BytesIO(data))
                        pil_img.verify()
                        extracted_images[stem] = (data, ext, member.filename)
                    except Exception:
                        corrupt_files += 1
                elif ext == ".txt":
                    try:
                        txt_content = z.read(member).decode("utf-8")
                        extracted_labels[stem] = txt_content
                    except Exception:
                        corrupt_files += 1
                else:
                    skipped_files += 1

            # Save valid images and parse matching labels
            for stem, (img_data, ext, orig_path) in extracted_images.items():
                img_id = f"zip_{int(time.time())}_{re.sub(r'[^a-zA-Z0-9_-]', '_', stem)[:12]}"
                img_save_path = images_dir / f"{img_id}{ext}"
                with open(img_save_path, "wb") as f:
                    f.write(img_data)
                valid_images += 1

                # Check if matching label exists
                if stem in extracted_labels:
                    txt = extracted_labels[stem]
                    bboxes = []
                    for line in txt.splitlines():
                        parts = line.strip().split()
                        if len(parts) >= 5:
                            try:
                                c_id = int(parts[0])
                                x_c = float(parts[1])
                                y_c = float(parts[2])
                                w = float(parts[3])
                                h = float(parts[4])
                                c_name = classes[c_id] if 0 <= c_id < len(classes) else classes[0]
                                bboxes.append({
                                    "class_id": min(max(0, c_id), len(classes)-1),
                                    "class_name": c_name,
                                    "x_center": x_c,
                                    "y_center": y_c,
                                    "width": w,
                                    "height": h
                                })
                            except Exception:
                                pass
                    if bboxes:
                        self.save_annotations(project_id, img_id, bboxes)
                        valid_labels += 1

        self.pm.sync_project_counts(project_id)

        return {
            "valid_images": valid_images,
            "valid_labels": valid_labels,
            "corrupt_files": corrupt_files,
            "skipped_files": skipped_files
        }

    def validate_dataset(self, project_id: str, split_ratios: Tuple[float, float, float] = (0.7, 0.2, 0.1)) -> Dict[str, Any]:
        project = self._get_project(project_id)
        classes = project["classes"]
        images_dir, ann_dir, _, _ = self._get_paths(project_id)

        image_files = list(images_dir.glob("*.*"))
        total_images = len(image_files)

        class_counts = {c: 0 for c in classes}
        annotated_count = 0
        empty_annotations = 0
        warnings = []
        image_hashes = {}
        duplicates = []

        for img_path in image_files:
            img_id = img_path.stem
            
            # Check duplicate (data leakage)
            try:
                with open(img_path, "rb") as f:
                    h = hashlib.md5(f.read()).hexdigest()
                if h in image_hashes:
                    duplicates.append((img_path.name, image_hashes[h]))
                else:
                    image_hashes[h] = img_path.name
            except Exception:
                pass

            ann_file = ann_dir / f"{img_id}.json"
            if ann_file.exists():
                try:
                    with open(ann_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        boxes = data.get("bboxes", [])
                        if boxes:
                            annotated_count += 1
                            for b in boxes:
                                c_id = b.get("class_id", 0)
                                if 0 <= c_id < len(classes):
                                    class_counts[classes[c_id]] += 1
                        else:
                            empty_annotations += 1
                except Exception:
                    pass

        # Verification checks
        if total_images == 0:
            warnings.append("Dataset kosong. Tambahkan gambar melalui Upload atau Capture Kamera.")
        elif annotated_count == 0:
            warnings.append("Belum ada gambar yang dianotasi bounding box.")
        elif annotated_count < total_images:
            warnings.append(f"{total_images - annotated_count} gambar belum memiliki anotasi bounding box.")

        for c, count in class_counts.items():
            if count == 0:
                warnings.append(f"Kelas '{c}' tidak memiliki sampel anotasi sama sekali.")
            elif count < 3:
                warnings.append(f"Kelas '{c}' hanya memiliki {count} sampel (disarankan minimal 5–10 sampel per kelas).")

        if duplicates:
            warnings.append(f"Terdeteksi {len(duplicates)} gambar identik/duplikat (potensi data leakage pada split train/val).")

        # Split feasibility
        train_ratio, val_ratio, test_ratio = split_ratios
        n_train = int(round(annotated_count * train_ratio))
        n_val = int(round(annotated_count * val_ratio))
        n_test = annotated_count - n_train - n_val

        if annotated_count > 0 and n_val == 0:
            warnings.append("Jumlah gambar dianotasi terlalu sedikit untuk pembagian Validation Set yang memadai.")

        is_ready_for_training = (total_images >= 3 and annotated_count >= 3 and any(c > 0 for c in class_counts.values()))

        return {
            "is_ready": is_ready_for_training,
            "total_images": total_images,
            "annotated_images": annotated_count,
            "unannotated_images": total_images - annotated_count,
            "classes": classes,
            "class_distribution": class_counts,
            "splits": {
                "train_count": n_train,
                "val_count": n_val,
                "test_count": n_test,
                "ratios": {
                    "train": train_ratio,
                    "val": val_ratio,
                    "test": test_ratio
                }
            },
            "duplicates_detected": len(duplicates),
            "warnings": warnings
        }
