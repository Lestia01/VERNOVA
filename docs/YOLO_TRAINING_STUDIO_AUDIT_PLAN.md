# VERNOVA — Audit Repository & Desain Integrasi YOLO Training Studio

Dokumen ini mendokumentasikan hasil audit sistem eksisting VERNOVA (R-LAB Smart Sorting Factory) serta rancangan teknis integrasi **YOLO Training Studio** bersama **Google Teachable Machine**, komunikasi mikrokontroler (ESP32 & micro:bit), dan Smart Data Assistant.

---

## 1. Hasil Audit Sistem Eksisting

### A. Komponen Frontend
- **Arsitektur:** Single-Page Application (SPA) berbasis Vanilla HTML5, CSS3, dan JavaScript modular (ES6+).
- **Styling:** Tailwind CSS (CDN), custom CSS theme tokens (`--brand: #1a2456`, `--gold: #c69a45`), font Inter variable.
- **Visualisasi & Log:** Chart.js untuk grafik distribusi pemilahan (Kuning, Biru, Merah, Error).
- **Library Ekspor:** `xlsx-js-style` (Excel berformat warna), `jspdf` & `jspdf-autotable` (PDF laporan resmi), `docx` (Word).
- **Autentikasi & Keamanan:** SHA-256 password hash untuk otorisasi Administrator (`sessionStorage.getItem('rlab_admin_auth') === '1'`). Mode Guest pada `guest.html` bersifat read-only.

### B. Implementasi AI Vision Eksisting (Google Teachable Machine)
- Menggunakan `tf.min.js` (TensorFlow.js) dan `@teachablemachine/image`.
- WebCam browser diinisialisasi melalui `tmImage.Webcam(220, 220, true)`.
- Loop klasifikasi `tmLoop()` berjalan via `requestAnimationFrame` dan memanggil `model.predict(webcam.canvas)`.
- Ketika probabilitas prediksi kelas tertinggi > 0.85, sistem memicu pipeline sortir:
  ```javascript
  window.deviceManager.dispatchSortingCommand({
    color: colorCode,
    mode: state.pendingMode,
    objectType: 'CYLINDER_CAP'
  });
  ```
- Dilengkapi mekanisme *watchdog timeout 12s* (`executeTimeout`) dan debounce suppression 500ms.

### C. Sistem Komunikasi Mikrokontroler (Multi-Device & Dual-Connection)
- Diorkestrasikan oleh `DeviceConnectionManager` (`assets/js/device-manager.js`):
  1. **ESP32 Wi-Fi Adapter:** HTTP REST API (`/api/status`, `/api/sort`, `/api/mode`, `/api/stop`).
  2. **ESP32 BLE Adapter:** Web Bluetooth GATT Nordic UART Service (`6E400001-...`).
  3. **BBC micro:bit BLE Adapter:** MakeCode Bluetooth UART String format (`kuning\n`, `biru\n`, `merah\n`, `servo\n`, `arm\n`).
  4. **Mode Simulasi Virtual:** Simulator perangkat virtual terintegrasi pada setiap adapter.
- Kompatibilitas mundur dipelihara melalui `window.esp32Client = deviceManager.createLegacyEsp32ClientProxy()`.

### D. Database & Histori
- **Firebase Realtime Database:** URL `smart-factory-ai-7b576-default-rtdb.asia-southeast1.firebasedatabase.app`, path `smart_factory/sorting_line`.
- Histori lokal pada array `state.excelLogs` dan aktivitas live feed `state.feedLogs`.
- Asisten data berbasis aturan: `SmartDataAssistant` (`assets/js/smart-data-assistant.js`) membaca telemetri dan data Firebase tanpa memanggil LLM eksternal.

---

## 2. Rencana Arsitektur & Integrasi YOLO + OpenCV

### A. Dual AI Engine Selector
Menambahkan sistem pemilihan AI Engine di dashboard:
1. **Engine A — Google Teachable Machine (Eksisting):**
   - Tetap aktif dan tidak berubah.
   - Menggunakan model URL/JSON Teachable Machine dari cloud.
   - Output: Probabilitas klasifikasi per frame.
2. **Engine B — YOLO + OpenCV (Fitur Baru):**
   - Menggunakan model Object Detection YOLO (Ultralytics YOLO / ONNX / PyTorch) yang dilatih langsung di YOLO Training Studio atau model pretrained.
   - Pemrosesan gambar/video frame dibantu OpenCV di backend dan Canvas HTML5 di frontend.
   - Output: Bounding boxes `[x1, y1, x2, y2]`, label kelas (`merah`, `kuning`, `biru`), dan confidence score.

### B. Standardisasi Output Deteksi
Kedua engine menghasilkan format deteksi kanonik:
```json
{
  "engine": "yolo",
  "model_id": "model_vernova_v1",
  "detections": [
    {
      "class_name": "merah",
      "class_id": 0,
      "confidence": 0.94,
      "bbox": { "x1": 120, "y1": 80, "x2": 240, "y2": 190 }
    }
  ],
  "inference_time_ms": 28.5,
  "timestamp": "2026-11-24T14:35:00.000Z"
}
```
Hasil deteksi diteruskan secara independen ke `window.deviceManager.dispatchSortingCommand({ color, mode })` tanpa mengubah konfigurasi koneksi robot.

### C. Modul Backend Python (`yolo_studio/`)
Membangun backend service FastAPI modular:
1. `server.py`: REST API & WebSocket/Streaming server (Port 8000).
2. `project_manager.py`: Manajemen proyek (CRUD, konfigurasi kelas warna).
3. `dataset_manager.py`:
   - Upload gambar (JPG, PNG, WebP) dengan validasi ukuran & format.
   - Upload arsip ZIP dataset (dengan pengamanan path traversal `os.path.commonpath`).
   - Kamera capture dari browser.
   - Anotasi bounding box (format YOLO `.txt`).
   - Validasi integritas dataset, split train/val/test, dan deteksi data leakage.
4. `training_engine.py`:
   - Asynchronous Job Manager (status: `Queued`, `Preparing Dataset`, `Training`, `Validating`, `Completed`, `Failed`, `Cancelled`).
   - Ultralytics YOLO training loop dengan logging metrik aktual per epoch (loss, precision, recall, mAP50, mAP50-95).
   - Penghentian job aman (safe cancellation).
5. `model_registry.py`:
   - Pencatatan versi model, parameter training, metrik evaluasi, dan model aktif.
6. `inference_engine.py`:
   - Inferensi gambar dan frame live camera dengan OpenCV.

### D. Modul Antarmuka Frontend (Page: `page-yolo-studio`)
Navigasi baru di sidebar & tab:
- **Project Manager:** Daftar proyek, buat proyek baru, kelola kelas.
- **Dataset Manager:** Upload gambar/ZIP, Capture dari Kamera, galeri gambar.
- **Annotation Studio:** Canvas interaktif untuk menggambar, memindah, mengubah ukuran, dan menghapus bounding box dengan color-coding per kelas.
- **Dataset Validation:** Ringkasan statistik, rasio split (70/20/10), peringatan sampel kosong.
- **Training Studio:** Pengaturan epoch, batch size, image size, monitoring grafik loss/mAP real-time, tombol batalkan training.
- **Model Registry & Evaluation:** Perbandingan model, skor precision/recall/mAP aktual, tombol aktivasi model.
- **Model Testing:** Live camera & image test dengan overlay bounding box dan latency counter.

---

## 3. Rencana Mitigasi Risiko & Kompatibilitas Mundur

1. **Fitur Lama Tetap Utuh:**
   - Script `index.html` lama untuk Teachable Machine tetap berfungsi tanpa perubahan alur.
   - Mode switching antara Teachable Machine dan YOLO menggunakan radio/switch yang jelas.
2. **Koneksi Robotik Tidak Terpengaruh:**
   - `DeviceConnectionManager` tetap menjadi satu-satunya jalur transmisi fisik ke ESP32 dan micro:bit.
   - Pemilihan AI Engine hanya menentukan penyedia sinyal klasifikasi warna.
3. **Keamanan File Upload:**
   - Sanitasi nama file, pembatasan ekstensi (`.jpg`, `.jpeg`, `.png`, `.webp`, `.zip`), dan sanitasi path ekstraksi ZIP.
