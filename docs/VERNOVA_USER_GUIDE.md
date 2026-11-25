# PANDUAN PENGGUNA RESMI (USER GUIDE)
# VERNOVA — R-LAB Smart Sorting Factory

Dokumen ini merupakan panduan operasional komprehensif untuk sistem **VERNOVA Smart Sorting Factory**, yang mencakup sistem AI Computer Vision ganda (Google Teachable Machine & YOLO + OpenCV), pelatihan model langsung dari web, mode pengoperasian otomatis (Auto) dan manual, serta integrasi mikrokontroler robotik (ESP32 dan BBC micro:bit).

---

## Bab 1 — Pengenalan Sistem

### 1.1 Fungsi Utama VERNOVA
VERNOVA adalah platform smart factory edukatif berbasis kecerdasan buatan (AI) dan Internet of Things (IoT) yang dirancang untuk mendeteksi, mengklasifikasi, dan menyortir objek secara otomatis pada konveyor industri. Sistem ini mengintegrasikan:
- **AI Computer Vision Terpadu:** Pengenalan objek berkecepatan tinggi berbasis citra.
- **Aktuator Sortir Multi-Mekanisme:** Pilihan mekanisme pemilahan menggunakan **Servo Flap** (pembagi arah jalur) dan **Lengan Robot / Arm** (penolak/pemindah mekanik).
- **Komunikasi Mikrokontroler Universal:** Dukungan langsung untuk ESP32 DevKit V1 (Wi-Fi REST & Bluetooth Low Energy) serta BBC micro:bit (MakeCode BLE UART).
- **Dashboard Analitik & Pemantauan Real-Time:** Sinkronisasi cloud Firebase Realtime Database, ekspor laporan, dan Smart Data Assistant bebas LLM.

### 1.2 Arsitektur Umum Sistem
Alur kerja sistem VERNOVA dirancang dalam arsitektur berlapis:
```
[ Kamera Web / USB ]
        │
        ▼
[ AI Vision Engine (TM / YOLO) ] ──▶ [ Ekstraksi Kelas & Koordinat ]
        │
        ▼
[ Device Connection Manager ] ────▶ [ Two-Stage Execution & Transaction Engine ]
        │                              │
        ├─▶ [ Tahap 1: Konfirmasi Mekanisme (Arm / Servo) ]
        └─▶ [ Tahap 2: Eksekusi Kelas Warna (Merah / Kuning / Biru) ]
        │
        ▼
[ Hardware Robot: ESP32 / micro:bit ] ──▶ [ Konveyor, Servo & Lengan Robot ]
        │
        ▼
[ Verifikasi Sensor Fisik & Telemetri ] ──▶ [ Dashboard & Firebase RTDB ]
```

### 1.3 Perbedaan Google Teachable Machine vs YOLO + OpenCV

| Karakteristik | Google Teachable Machine (TM) | YOLO + OpenCV Training Studio |
|---|---|---|
| **Jenis Algoritma** | Image Classification (Klasifikasi Citra) | Object Detection (Deteksi Objek Berarah) |
| **Lokasi Eksekusi** | Browser (Client-side TensorFlow.js) | Backend Python (FastAPI + OpenCV) |
| **Output Deteksi** | Probabilitas kelas global (tanpa bounding box) | Bounding box koordinat `[x1, y1, x2, y2]`, kelas, confidence |
| **Pelatihan Model** | Melalui platform eksternal Google TM | Terintegrasi langsung di web VERNOVA Studio |
| **Dukungan Bounding Box** | Tidak ada | Ada (Editor Anotasi Interaktif) |
| **Beban Komputasi** | Sangat ringan, berjalan di browser apa pun | Memerlukan backend Python, akurasi lokalisasi tinggi |

---

## Bab 2 — Instalasi dan Menjalankan Sistem

### 2.1 Persyaratan Perangkat Lunak
- Komputer / Laptop dengan OS Windows, macOS, atau Linux.
- **Python 3.10+** (direkomendasikan Python 3.11 atau 3.12/3.14).
- **Node.js 18+** (opsional, untuk menjalankan test runner).
- Browser modern berbasis Chromium: **Google Chrome** atau **Microsoft Edge** (diperlukan untuk Web Bluetooth API).

### 2.2 Menjalankan Backend YOLO Training Studio (Port 8000)
1. Buka folder proyek `d:\website R-Lab\R-lab_Smart-Factory-AI-main`.
2. Pasang dependensi yang diperlukan:
   ```cmd
   pip install -r requirements.txt
   ```
3. Jalankan server studio:
   - **Melalui Batch File:** Klik dua kali file `start_yolo_studio.bat`.
   - **Melalui PowerShell:**
     ```powershell
     .\start_yolo_studio.ps1
     ```
   - **Melalui Command Line Langsung:**
     ```cmd
     python -m uvicorn yolo_studio.server:app --host 127.0.0.1 --port 8000 --reload
     ```
4. Indikator keberhasilan:
   Terminal akan menampilkan log:
   ```
   INFO: Started server process [PID]
   INFO: Uvicorn running on http://127.0.0.1:8000
   ```
   Anda dapat memeriksa status kesehatan melalui browser di [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health) atau membaca Swagger UI di [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

### 2.3 Menjalankan Web Server VERNOVA (Port 8080)
Buka terminal PowerShell terpisah dan jalankan:
```powershell
powershell -ExecutionPolicy Bypass -File server.ps1
```
Buka browser dan akses alamat:
```
http://localhost:8080/
```

### 2.4 Memeriksa Status Backend & Membaca Log
- Pada **Topbar Navigation**, perhatikan dua indikator:
  - **`ENGINE: TM` / `ENGINE: YOLO`**: Menunjukkan mesin AI vision yang sedang aktif.
  - **`YOLO: ONLINE` (Hijau)**: Menunjukkan backend Python terhubung dengan baik.
  - **`DEVICE: ONLINE / SIMULASI`**: Menunjukkan status mikrokontroler robot.
- Untuk memeriksa log transaksi riil, lihat kartu **Live History** di bagian bawah dashboard atau buka panel log perangkat melalui modal Device Manager.

---

## Bab 3 — Pelatihan Model YOLO (Training Studio)

VERNOVA menyediakan studio pelatihan lengkap tanpa memerlukan platform eksternal:

### 3.1 Membuat Proyek Baru
1. Buka menu navigasi **YOLO Studio**.
2. Masuk ke tab **1. Projects** dan klik tombol **Buat Proyek Baru**.
3. Masukkan nama proyek (contoh: `Sortir-Pabrik-v2`).
4. Tentukan kelas yang akan dideteksi:
   - **Preset 3 Warna Warisan:** `merah, kuning, biru`
   - **Preset 6 Kelas Mekanisme:** `merah_arm, kuning_arm, biru_arm, merah_servo, kuning_servo, biru_servo`
5. Klik **Simpan Proyek**.

### 3.2 Mengumpulkan Dataset
Masuk ke tab **2. Dataset**. Terdapat dua cara pengumpulan:
- **Unggah Berkas / ZIP:** Drag-and-drop file gambar `.jpg`, `.png`, atau arsip `.zip`. Sistem dilengkapi proteksi terhadap serangan *Zip-Slip*.
- **Capture Kamera Konveyor:** Arahkan webcam ke conveyor, pilih target split (`train` atau `val`), lalu klik **Capture Snapshot**.

### 3.3 Anotasi Bounding Box (Annotation Studio)
1. Masuk ke tab **3. Annotation Studio**.
2. Pilih gambar dari daftar di sebelah kiri.
3. Klik dan seret (drag) kursor mouse di atas objek warna untuk membentuk kotak pembatas (bounding box).
4. Pilih label kelas pada panel dropdown (misal: `merah_arm`).
5. Ukuran kotak dapat disesuaikan menggunakan titik sudut (corner handles) atau digeser posisinya.
6. Klik **Simpan Anotasi** (otomatis disimpan dalam format standar YOLO `.txt` dan JSON).

### 3.4 Validasi Dataset & Pembagian Split
1. Buka tab **4. Validation**.
2. Periksa grafik sebaran data per kelas.
3. Klik **Jalankan Auto-Split** (rasio rekomendasi: 70% Train, 20% Validation, 10% Testing).
4. Sistem secara otomatis memverifikasi bahwa tidak ada kebocoran data (*data leakage*) antar split menggunakan hashing MD5.

### 3.5 Melatih Model (Training)
1. Buka tab **5. Training**.
2. Konfigurasi hyperparameter:
   - **Model Backbone:** `YOLOv8n` (Nano - tercepat) atau `YOLOv8s` (Small).
   - **Epochs:** 25–100 epoch.
   - **Batch Size:** 4, 8, atau 16.
   - **Image Size:** 320, 416, atau 640.
3. Klik **Mulai Pelatihan**.
4. Pantau perkembangan pelatihan melalui grafik interaktif (Loss Curve, Precision, Recall, mAP50) serta utilisasi CPU & RAM. Pelatihan dapat dibatalkan sewaktu-waktu secara aman.

### 3.6 Mengaktifkan dan Menguji Model
1. Buka tab **7. Models**.
2. Pilih model yang baru selesai dilatih, lalu klik tombol **Jadikan Model Aktif**.
3. Buka tab **8. Testing** untuk menguji prediksi pada gambar statis maupun aliran kamera langsung.

---

## Bab 4 — Pengoperasian Mode AUTO

Dalam mode **AUTO**, keputusan mekanisme dan waktu sortir dikendalikan secara cerdas oleh hasil deteksi AI.

### 4.1 Langkah Menjalankan Auto Sorting
1. Di **Factory Dashboard**, pastikan toggle mode berada pada posisi **`AUTO (AI Driven)`** (berwarna hijau).
2. Pilih AI Engine yang diinginkan: **Teachable Machine** atau **YOLO + OpenCV**.
3. Jika menggunakan YOLO, pastikan model aktif sudah dipilih.
4. Klik tombol **START AI** pada kartu AI Vision untuk membuka kamera.

### 4.2 Pemetaan Kelas ke Mekanisme
- **Model 6 Kelas:** Jika model dilatih dengan kelas `merah_arm`, `biru_servo`, dsb., sistem secara otomatis mengekstrak warna dan mekanisme target secara langsung tanpa konfigurasi tambahan.
- **Model 3 Kelas Warisan:** Jika model hanya menghasilkan `merah`, `kuning`, atau `biru`, klik tombol **Mapping Kelas AI** pada dashboard untuk mengatur mekanisme target tiap warna:
  - Merah $\rightarrow$ Servo Flap atau Lengan Robot (Arm).
  - Kuning $\rightarrow$ Servo Flap atau Lengan Robot (Arm).
  - Biru $\rightarrow$ Servo Flap atau Lengan Robot (Arm).
  *(Catatan: Sistem tidak akan menebak mekanisme jika belum dikonfigurasi).*

### 4.3 Siklus Komunikasi Dua Tahap (Two-Stage Execution)
Ketika kamera mendeteksi objek (misal: `merah_arm`):
1. **Pemeriksaan Awal:** Sistem memverifikasi confidence score $\ge$ threshold (default 70%). Jika di bawah threshold, deteksi ditolak (*rejected*).
2. **Tahap 1 (Konfirmasi Mekanisme):** Sistem mengirim perintah pemilihan mekanisme (`setMechanism("arm")`) ke perangkat dengan menyertakan Transaction ID unik (misal: `TX_AUTO_...`). Sistem menunggu acknowledgment (`AWAITING_MECHANISM_ACK`).
3. **Tahap 2 (Eksekusi Sortir):** Setelah perangkat mengonfirmasi kesiapan (`READY`), sistem mengirim perintah pemilahan warna (`sortObject("merah", "arm")`).
4. **Tahap 3 (Status Verifikasi Sensor):** Sistem memantau status eksekusi:
   - Jika sensor photogate / verifikasi mendeteksi objek masuk bin: status dicatat sebagai **`VERIFIED`**.
   - Jika gerakan selesai dilaporkan mikrokontroler namun tanpa sensor verifikasi fisik: status dicatat sebagai **`COMPLETED_UNVERIFIED`** (Belum Terverifikasi Fisik).

---

## Bab 5 — Pengoperasian Mode MANUAL

Mode **MANUAL** dirancang untuk kendali operator, pengujian perawatan, atau penanganan material darurat.

### 5.1 Mengaktifkan Stasiun Kontrol Manual
1. Pada **Factory Dashboard**, klik tombol **`MANUAL`** pada bilah kontrol operasi.
2. Panel **Stasiun Kontrol Sortir Manual (Operator)** akan muncul dengan aksen kuning/amber.
3. Pada mode ini, **aliran kamera tetap menyala untuk inspeksi visual, namun seluruh perintah sortir otomatis dari kamera diblokir demi keselamatan kerja.**

### 5.2 Mengirim Perintah Manual
1. **Perangkat Tujuan:** Pilih `ESP32 DevKit V1` atau `BBC micro:bit`.
2. **Metode Koneksi:** Pilih `Wi-Fi Lokal (HTTP REST)` atau `Bluetooth BLE (GATT UART)`.
3. **Mekanisme Target:** Pilih `Servo Flap` atau `Lengan Robot (Arm)`.
4. **Kelas Warna:** Pilih `Merah`, `Kuning`, atau `Biru`.
5. Klik **KIRIM PERINTAH**.
6. Amati indikator:
   - `TX ID`: Menampilkan ID transaksi unik (contoh: `TX_MANUAL_1795...`).
   - `ACK`: Menampilkan konfirmasi kesiapan dari mikrokontroler (`ACK: READY`).
   - `VERIFIKASI`: Menampilkan status verifikasi sensor.

### 5.3 Tombol Emergency Stop
Jika terjadi kemacetan material atau situasi darurat:
- Klik tombol merah **EMERGENCY STOP**.
- Sistem segera membatalkan transaksi aktif dan mengirim sinyal `stop` ke mikrokontroler untuk mengembalikan servo ke sudut netral (90°) dan lengan robot ke posisi istirahat (20°).

---

## Bab 6 — Koneksi ESP32

Sistem mendukung dua protokol komunikasi untuk ESP32 DevKit V1:

### 6.1 ESP32 melalui Wi-Fi HTTP REST API
- **Karakteristik:** Menggunakan koneksi jaringan lokal LAN / Wi-Fi SoftAP mandiri (`VERNOVA-ROBOT` pada IP `192.168.4.1`).
- **Keunggulan:** Komunikasi berbasis Request-Response terstruktur dengan payload JSON, latensi rendah (~40-80ms), tidak memerlukan izin Bluetooth browser.
- **Cara Menghubungkan:**
  1. Hubungkan Wi-Fi laptop ke hotspot ESP32: `VERNOVA-ROBOT` (password: `vernova123`).
  2. Buka modal **Device Manager** di website.
  3. Pilih ESP32 dan metode Wi-Fi, masukkan Host URL `http://192.168.4.1`.
  4. Klik **Simpan & Hubungkan**.

### 6.2 ESP32 melalui Bluetooth Low Energy (BLE GATT Nordic UART)
- **Karakteristik:** Menggunakan Web Bluetooth API langsung dari browser Chrome/Edge tanpa memerlukan router Wi-Fi.
- **Service UUID:** `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`.
- **Cara Menghubungkan:**
  1. Pastikan Bluetooth laptop aktif.
  2. Pada Device Manager, pilih ESP32 dan metode BLE.
  3. Klik **Simpan & Hubungkan**. Browser akan memunculkan dialog pemindai BLE.
  4. Pilih perangkat bertuliskan `VERNOVA-ESP32` lalu klik **Pair**.

---

## Bab 7 — Koneksi BBC micro:bit

### 7.1 Karakteristik Koneksi
- BBC micro:bit (V1 / V2) berkomunikasi melalui **MakeCode Bluetooth UART Service** pada baud rate virtual nRF52.
- micro:bit **tidak memiliki Wi-Fi onboard**, sehingga sistem otomatis mengunci pilihan koneksi ke **Bluetooth Low Energy (BLE)** saat micro:bit dipilih.

### 7.2 Cara Menghubungkan
1. Flash program MakeCode ke micro:bit mengikuti panduan di `docs/MICROBIT_BLE_SETUP.md`.
2. Nyalakan micro:bit (layar LED 5x5 akan menampilkan huruf `V`).
3. Pada modal Device Manager, pilih perangkat **BBC micro:bit** dan klik **Hubungkan**.
4. Pilih perangkat `BBC micro:bit [...]` pada dialog browser dan pasangkan.
5. Layar LED micro:bit akan menampilkan tanda centang ($\checkmark$) sebagai konfirmasi terhubung.

---

## Bab 8 — Histori, Telemetri, dan Analitik

### 8.1 Membaca Log Riwayat (Live History)
Setiap transaksi yang terjadi dicatat secara kronologis:
- Ikon centang hijau: Transaksi berhasil dieksekusi.
- Label `TERVERIFIKASI`: Hasil sortir telah dikonfirmasi oleh sensor fisik.
- Label `BELUM TERVERIFIKASI FISIK`: Perangkat telah menyelesaikan gerakan, namun sensor verifikasi fisik belum tersedia pada unit tersebut.
- Ikon jam / silang merah: Kegagalan komunikasi atau batas waktu respon terlampaui (*watchdog timeout*).

### 8.2 Ekspor Data
Klik tombol **Export Report** di dashboard untuk mengunduh seluruh rekam jejak penyortiran dalam format **Excel (.xlsx)**, **PDF**, atau **CSV** dengan sanitasi formula injection (`safeCell`) bawaan.
