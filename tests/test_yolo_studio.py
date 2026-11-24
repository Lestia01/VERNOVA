# Test Suite: YOLO Training Studio Backend
import os
import io
import time
import json
import base64
import shutil
import unittest
import numpy as np
import cv2
from PIL import Image

from yolo_studio.config import DATA_DIR
from yolo_studio.project_manager import ProjectManager
from yolo_studio.dataset_manager import DatasetManager
from yolo_studio.training_engine import TrainingEngine, TrainingJob
from yolo_studio.model_registry import ModelRegistry
from yolo_studio.inference_engine import InferenceEngine

class TestYoloStudio(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = DATA_DIR / "_test_workspace"
        cls.test_dir.mkdir(parents=True, exist_ok=True)
        cls.projects_dir = cls.test_dir / "projects"
        cls.models_dir = cls.test_dir / "models"
        cls.jobs_dir = cls.test_dir / "jobs"

        cls.pm = ProjectManager(cls.projects_dir)
        cls.dm = DatasetManager(cls.pm)
        cls.registry = ModelRegistry(cls.models_dir)
        cls.engine = TrainingEngine(jobs_dir=cls.jobs_dir, pm=cls.pm, dm=cls.dm, registry=cls.registry)
        cls.infer = InferenceEngine(registry=cls.registry)

    @classmethod
    def tearDownClass(cls):
        if cls.test_dir.exists():
            shutil.rmtree(cls.test_dir, ignore_errors=True)

    def _create_sample_image(self, color_bgr=(0, 240, 255), width=200, height=200) -> bytes:
        img = np.zeros((height, width, 3), dtype=np.uint8)
        # Draw a colored circle in the center (representing sorting cap)
        cv2.circle(img, (width // 2, height // 2), width // 3, color_bgr, -1)
        _, buf = cv2.imencode(".jpg", img)
        return buf.tobytes()

    def test_01_project_lifecycle(self):
        # Create project
        p = self.pm.create_project(name="Test Sorting Project", description="Testing", classes=["merah", "kuning", "biru"])
        self.assertIn("id", p)
        self.assertEqual(p["name"], "Test Sorting Project")
        self.assertEqual(p["classes"], ["merah", "kuning", "biru"])

        # Get project
        p_get = self.pm.get_project(p["id"])
        self.assertIsNotNone(p_get)
        self.assertEqual(p_get["id"], p["id"])

        # Update project
        p_up = self.pm.update_project(p["id"], {"description": "Updated Description"})
        self.assertEqual(p_up["description"], "Updated Description")

        # List projects
        all_p = self.pm.list_projects()
        self.assertTrue(any(x["id"] == p["id"] for x in all_p))

    def test_02_dataset_image_and_annotations(self):
        p = self.pm.create_project(name="Dataset Test Proj", classes=["merah", "kuning", "biru"])
        p_id = p["id"]

        # Upload image bytes
        img_bytes = self._create_sample_image(color_bgr=(0, 240, 255)) # Yellow
        saved = self.dm.save_image_bytes(p_id, img_bytes, "test_yellow.jpg")
        self.assertIn("id", saved)
        img_id = saved["id"]

        # Camera capture base64
        b64_str = "data:image/jpeg;base64," + base64.b64encode(img_bytes).decode("utf-8")
        captured = self.dm.save_camera_capture(p_id, b64_str)
        self.assertIn("id", captured)

        # List images
        images = self.dm.list_images(p_id)
        self.assertGreaterEqual(len(images), 2)

        # Annotate bounding box
        bboxes = [{
            "class_id": 1,
            "class_name": "kuning",
            "x_center": 0.5,
            "y_center": 0.5,
            "width": 0.35,
            "height": 0.35
        }]
        ann_res = self.dm.save_annotations(p_id, img_id, bboxes)
        self.assertEqual(ann_res["count"], 1)

        # Verify YOLO txt label file written
        p_dir = self.pm._get_project_dir(p_id)
        label_file = p_dir / "labels" / f"{img_id}.txt"
        self.assertTrue(label_file.exists())
        with open(label_file, "r") as f:
            content = f.read().strip()
            self.assertTrue(content.startswith("1 0.5 0.5 0.35 0.35"))

        # Get annotation
        got_ann = self.dm.get_annotation(p_id, img_id)
        self.assertEqual(len(got_ann["bboxes"]), 1)

    def test_03_dataset_validation(self):
        p = self.pm.create_project(name="Validation Proj", classes=["merah", "kuning", "biru"])
        p_id = p["id"]

        # Validate empty project
        val_empty = self.dm.validate_dataset(p_id)
        self.assertFalse(val_empty["is_ready"])
        self.assertTrue(len(val_empty["warnings"]) > 0)

        # Add 3 annotated images
        colors = [
            ("merah", (0, 0, 255), 0),
            ("kuning", (0, 240, 255), 1),
            ("biru", (255, 120, 0), 2)
        ]
        for c_name, bgr, c_id in colors:
            img_b = self._create_sample_image(color_bgr=bgr)
            saved = self.dm.save_image_bytes(p_id, img_b, f"{c_name}.jpg")
            self.dm.save_annotations(p_id, saved["id"], [{
                "class_id": c_id,
                "class_name": c_name,
                "x_center": 0.5,
                "y_center": 0.5,
                "width": 0.4,
                "height": 0.4
            }])

        val_ready = self.dm.validate_dataset(p_id)
        self.assertTrue(val_ready["is_ready"])
        self.assertEqual(val_ready["annotated_images"], 3)
        self.assertEqual(val_ready["class_distribution"]["merah"], 1)
        self.assertEqual(val_ready["class_distribution"]["kuning"], 1)
        self.assertEqual(val_ready["class_distribution"]["biru"], 1)

    def test_04_training_job_and_model_registry(self):
        p = self.pm.create_project(name="Training Proj", classes=["merah", "kuning", "biru"])
        p_id = p["id"]

        # Add 3 annotated images for training
        for c_name, bgr, c_id in [("merah", (0, 0, 255), 0), ("kuning", (0, 240, 255), 1), ("biru", (255, 120, 0), 2)]:
            img_b = self._create_sample_image(color_bgr=bgr)
            saved = self.dm.save_image_bytes(p_id, img_b, f"{c_name}.jpg")
            self.dm.save_annotations(p_id, saved["id"], [{
                "class_id": c_id, "class_name": c_name, "x_center": 0.5, "y_center": 0.5, "width": 0.4, "height": 0.4
            }])

        # Launch training job (2 epochs for fast test)
        job = self.engine.start_training(p_id, {"epochs": 2, "batch_size": 4, "imgsz": 320})
        self.assertIn("job_", job.job_id)

        # Wait for worker thread to complete
        max_wait = 25
        start_wait = time.time()
        while job.status not in ["Completed", "Failed", "Cancelled"] and (time.time() - start_wait) < max_wait:
            time.sleep(0.5)
            job = self.engine.get_job(job.job_id) or job

        self.assertEqual(job.status, "Completed")
        self.assertEqual(job.current_epoch, 2)
        self.assertGreater(job.current_metrics["mAP50"], 0.5)
        self.assertIsNotNone(job.model_id)

        # Verify model registered in registry
        reg_model = self.registry.get_model(job.model_id)
        self.assertIsNotNone(reg_model)
        self.assertEqual(reg_model["engine"], "yolo")
        self.assertEqual(reg_model["classes"], ["merah", "kuning", "biru"])

        # Verify active model
        active_m = self.registry.get_active_model()
        self.assertIsNotNone(active_m)

    def test_05_inference_engine(self):
        # Create a test yellow image
        yellow_img = self._create_sample_image(color_bgr=(0, 240, 255))
        pred = self.infer.predict(yellow_img)

        self.assertEqual(pred["engine"], "yolo")
        self.assertIn("detections", pred)
        self.assertGreaterEqual(len(pred["detections"]), 1)

        top_det = pred["detections"][0]
        self.assertEqual(top_det["class_name"], "kuning")
        self.assertGreater(top_det["confidence"], 0.7)
        self.assertIn("bbox", top_det)
        self.assertIn("x1", top_det["bbox"])

        # Test draw detections
        annotated_b64 = self.infer.draw_detections(yellow_img, pred["detections"])
        self.assertTrue(len(annotated_b64) > 100)


if __name__ == "__main__":
    unittest.main()
