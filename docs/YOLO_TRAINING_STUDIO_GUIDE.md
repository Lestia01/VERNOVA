# Panduan Penggunaan VERNOVA YOLO + OpenCV Training Studio

Dokumen ini menjelaskan arsitektur, cara kerja, alur penggunaan, integrasi dual-engine, serta panduan teknis implementasi **YOLO + OpenCV Training Studio** pada sistem **VERNOVA — R-LAB Smart Sorting Factory**.

---

## 1. Ikhtisar Sistem (Dual AI Engine Architecture)

VERNOVA kini mendukung dua sistem Computer Vision yang dapat dipilih secara independen tanpa mempengaruhi pengaturan perangkat keras (ESP32 / micro:bit):

1. **Google Teachable Machine (TM Engine)**:
   - Klasifikasi gambar berbasis transfer learning di browser menggunakan TensorFlow.js.
   - Output berupa probabilitas kelas tanpa lokalisasi posisi (bounding box).
   - Cocok untuk pengenalan cepat berbasis browser ringan.

2. **YOLO + OpenCV Training Studio (YOLO Engine)**:
   - Object Detection berbasis koordinat `[x1, y1, x2, y2]` dengan confidence score.
   - Studio pembuatan dataset terintegrasi di web (upload file, upload ZIP, capture kamera, anotasi interaktif).
   - Training engine asinkron dengan visualisasi metrik live (Loss, Precision, Recall, mAP50, mAP50-95, CPU/RAM monitor).
   - Model Registry dengan versioning, komparasi model, dan aktivasi model produksi.
   - Testing real-time pada citra statis maupun feed video kamera aktif.
   - Integrasi langsung ke `window.deviceManager.dispatchSortingCommand({ color, mode })` untuk aktuasi fisik robot (ESP32 Wi-Fi/BLE atau micro:bit BLE).

---

## 2. Struktur Modul Backend (`yolo_studio/`)

Backend berbasis Python FastAPI & OpenCV yang berjalan pada `http://127.0.0.1:8000`:

| File | Peran & Tanggung Jawab |
|---|---|
| `config.py` | Konfigurasi path root dataset, models, allowed file extensions, default classes (`merah`, `kuning`, `biru`). |
| `project_manager.py` | Pengelolaan project (Create, Read, Update, Delete) serta pembuatan struktur direktori project. |
| `dataset_manager.py` | Upload gambar, capture kamera (base64 decode), upload ZIP dengan validasi Zip-Slip (`os.path.commonpath`), simpan anotasi format YOLO `.txt` dan JSON, pembagian split train/val/test, deteksi kebocoran data (MD5 hash). |
| `training_engine.py` | Worker thread background yang mengelola siklus training (`Queued` -> `Preparing Dataset` -> `Training` -> `Validating` -> `Completed`/`Failed`/`Cancelled`), metrik per epoch riil, dan pemantauan utilisasi CPU/RAM. |
| `model_registry.py` | Metadata index model, penandaan model aktif, perbandingan performa beberapa model, dan penghapusan model. |
| `inference_engine.py` | Deteksi objek menggunakan OpenCV HSV segmentation (merah, kuning, biru) & model YOLO terdaftar, ekstraksi bounding box, kalkulasi skor kepercayaan, dan visual rendering overlay. |
| `server.py` | REST API FastAPI endpoint untuk antarmuka frontend Studio. |

---

## 3. Alur Penggunaan (Workflow 8 Langkah)

### Langkah 1: Buat Proyek Baru
1. Buka tab **YOLO Studio** pada navigasi sidebar atau drawer menu.
2. Klik tombol **Buat Proyek Baru**.
3. Masukkan nama proyek (misal: `Smart-Sorting-v1`) dan kelas objek (`merah, kuning, biru`).
4. Klik **Simpan Proyek**.

### Langkah 2: Pengumpulan Dataset
1. Masuk ke tab **Dataset**.
2. Anda dapat mengumpulkan gambar melalui dua cara:
   - **Upload File / ZIP**: Drag-and-drop gambar (.jpg, .png) atau file arsip .zip beranotasi.
   - **Capture Kamera**: Ambil snapshot langsung dari webcam industri / USB camera conveyor dengan memilih target split (`train`, `val`, `test`).

### Langkah 3: Labeling / Anotasi Interaktif
1. Buka tab **Annotation Studio**.
2. Pilih gambar dari galeri dataset.
3. Gunakan kursor mouse untuk membuat kotak bounding box di atas objek warna target (`merah`, `kuning`, atau `biru`).
4. Bounding box dapat di-drag, di-resize ukurannya, atau dihapus jika salah.
5. Klik **Simpan Anotasi** (format otomatis diekspor ke YOLO `.txt` ternormalisasi 0–1 dan backup JSON).

### Langkah 4: Validasi & Split Dataset
1. Buka tab **Validasi**.
2. Periksa distribusi jumlah gambar dan anotasi per kelas.
3. Jalankan auto-split (default 70% Train, 20% Val, 10% Test).
4. Sistem memverifikasi tidak ada duplikasi data (data leakage) antar split sebelum training diizinkan.

### Langkah 5: Pelatihan Model (Training)
1. Buka tab **Training**.
2. Atur hyperparameter:
   - Arsitektur Model: YOLOv8n (Nano), YOLOv8s (Small), atau YOLOv8m (Medium).
   - Epochs: 1 s.d. 300 (default 25 epoch untuk baseline).
   - Batch Size: 4, 8, 16, atau 32.
   - Image Size: 320, 416, atau 640.
3. Klik **Mulai Pelatihan**.
4. Pantau grafik live loss, precision, recall, mAP50, progress bar epoch, serta status pemakaian CPU dan RAM komputer. Pelatihan dapat dibatalkan sewaktu-waktu secara aman.

### Langkah 6: Model Registry & Evaluasi
1. Buka tab **Models**.
2. Tinjau semua versi model yang telah selesai dilatih beserta metrik evaluasinya.
3. Gunakan fitur **Bandingkan Model** untuk melihat perbandingan mAP dan inference speed.
4. Klik tombol **Jadikan Model Aktif** pada model terbaik.

### Langkah 7: Pengujian Model (Testing)
1. Buka tab **Testing**.
2. Unggah gambar uji atau nyalakan preview kamera langsung.
3. Atur slider Confidence Threshold (0.10 - 0.95).
4. Periksa apakah bounding box, label kelas, dan skor akurasi terdeteksi dengan tepat.

### Langkah 8: Integrasi Otomatis ke Robot Sorting (Aktuasi Fisik)
1. Kembali ke **Factory Dashboard** utama (`#page-dash`).
2. Pada kartu AI Vision, ubah saklar AI Engine ke mode **YOLO + OpenCV**.
3. Pastikan model aktif yang diinginkan telah dipilih.
4. Klik **START AI**.
5. Deteksi objek warna (`merah`, `kuning`, `biru`) secara otomatis dikonversi menjadi perintah sorting yang dikirim via `window.deviceManager`:
   - Jika ESP32 Wi-Fi aktif: dikirim via HTTP REST `/sort`.
   - Jika ESP32 Bluetooth aktif: dikirim via BLE GATT UART.
   - Jika micro:bit Bluetooth aktif: dikirim via micro:bit UART Service.

---

## 4. Cara Menjalankan Backend YOLO Studio

1. Pastikan Python 3.10+ terpasang pada komputer:
   ```bash
   python --version
   ```
2. Instal dependensi:
   ```bash
   pip install -r requirements.txt
   ```
3. Jalankan server studio:
   - Menggunakan file Batch:
     Klik dua kali file `start_yolo_studio.bat`
   - Atau melalui terminal PowerShell:
     ```powershell
     .\start_yolo_studio.ps1
     ```
   - Atau langsung dengan uvicorn:
     ```bash
     python -m uvicorn yolo_studio.server:app --host 127.0.0.1 --port 8000 --reload
     ```
4. Buka website VERNOVA di browser:
   ```
   http://localhost:8080/
   ```
   Status backend YOLO Studio pada topbar akan menunjukkan status **ONLINE** berwarna hijau.

---

## 5. Dukungan Model 6-Kelas Mekanis (Phase 2 Update)

Pada rilis Phase 2, YOLO Studio mendukung skema 6 kelas mekanisme-warna secara native:
- `merah_arm`, `kuning_arm`, `biru_arm` (Objek diproses dengan Robotic Arm)
- `merah_servo`, `kuning_servo`, `biru_servo` (Objek diproses dengan Flap Servo)

### Keunggulan:
1. **Deteksi Terpadu:** AI mengidentifikasi warna sekaligus target aktuator secara simultan dalam satu inferensi.
2. **Two-Stage Execution Cycle:** Hasil deteksi otomatis memicu Stage 1 (`setMechanism`) dan Stage 2 (`sortObject`) ke mikrokontroler tanpa intervensi manual.
3. **Non-Maximum Suppression (NMS):** Backend secara otomatis menyaring deteksi duplikat dengan threshold IoU > 0.5 sehingga objek pada conveyor belt tidak memicu perintah berulang.
4. **Kompatibilitas Mundur (Legacy 3-Color):** Model 3-kelas lama (`merah`, `kuning`, `biru`) tetap didukung penuh menggunakan pemetaan konfigurasi operator (*Legacy Mechanism Map*).
