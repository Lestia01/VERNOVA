# ARSITEKTUR KOMUNIKASI ESP32 WI-FI VERNOVA
**Proyek:** VERNOVA — R-LAB Smart Sorting Factory  
**Versi Arsitektur:** 2.2.0 (ESP32 Wi-Fi LAN Migration)  
**Status:** Terimplementasi & Teruji (Software & Unit Tests)  

---

## 1. DESAIN ARSITEKTUR KESELURUHAN (HIGH-LEVEL ARCHITECTURE)

Sistem migrasi komunikasi VERNOVA menggantikan tautan nirkabel titik-ke-titik Web Bluetooth Low Energy (micro:bit) dengan komunikasi jaringan lokal berbasis **ESP32 Wi-Fi HTTP REST API**:

```
+---------------------------------------------------------------------------------+
|                               WEB BROWSER CLIENT                                |
|  - Computer Vision (TensorFlow.js / Google Teachable Machine)                   |
|  - UI Dashboard, Real-time Chart.js Analytics & QC Controls                     |
|  - Modular Device Adapter: assets/js/esp32-client.js                            |
+------------------------+------------------------------------+-------------------+
                         |                                    |
          (HTTP REST API | /api/sort, /api/status)            | (Sync Telemetry / Logs)
                         v                                    v
     +---------------------------------------+      +--------------------+
     |             ESP32 ROBOT BRAIN         |      | Firebase Realtime  |
     |  - Wi-Fi SoftAP ('VERNOVA-ROBOT')     |      | Database (Cloud)   |
     |    IP: http://192.168.4.1             |      +--------------------+
     |  - WebServer (Port 80) + CORS Headers |
     |  - PWM Servo Actuation (Flap / Arm)   |
     +-------------------+-------------------+
                         |
                         v (Mechanical Actuation)
     +---------------------------------------+
     |     PHYSICAL SORTING MECHANISM        |
     |  - Bin 1: Kuning (Flap 40°)           |
     |  - Bin 2: Biru   (Flap 90°)           |
     |  - Bin 3: Merah  (Flap 140°)          |
     |  - Conveyor Belt & Arm Driver         |
     +---------------------------------------+
```

---

## 2. DUA LINGKUNGAN OPERASIONAL (DUAL TOPOLOGY DESIGN)

### 2.1 Lingkungan 1: Operasional Lokal Pabrik / Lab Sekolah (Local LAN Execution)
- **Topologi:** Komputer operator membuka dasbor di `http://localhost:8080/index.html` (melalui `MULAI-RLAB.bat` atau server statis).
- **Koneksi Wi-Fi:**
  - **Opsi A (Hotspot Mandiri / SoftAP):** Komputer terhubung langsung ke Wi-Fi SSID `VERNOVA-ROBOT`. IP ESP32 adalah `192.168.4.1`. Sangat ideal untuk demo di mana tidak tersedia router Wi-Fi eksternal.
  - **Opsi B (Router Sekolah / Station Mode):** ESP32 dan Komputer terhubung ke router Wi-Fi yang sama (misal `192.168.1.150`).
- **Keunggulan:** Komunikasi langsung via HTTP REST tanpa batasan mixed-content browser, latensi rendah (<15ms via Wi-Fi), dan tidak memerlukan koneksi internet.

### 2.2 Lingkungan 2: Cloud Public Deployment (Vercel over HTTPS) & Simulasi
- **Batasan Keamanan Browser:** Laman web yang di-host via HTTPS publik (`https://vernova...vercel.app`) secara ketat diblokir oleh browser dari memanggil IP privat HTTP lokal (`192.168.x.x`) demi mencegah serangan *Mixed Content* dan eksploitasi intranet.
- **Solusi Arsitektural VERNOVA:**
  1. **Mode Simulasi / Virtual Hardware Bawaan:** Klien `esp32-client.js` menyediakan toggle "Mode Simulasi". Dasbor dapat mensimulasikan latensi 280ms, pergerakan servo, dan acknowledgment `COMPLETED` sehingga sistem tetap dapat didemonstrasikan di Vercel secara online 100% interaktif tanpa koneksi fisik.
  2. **Firebase Realtime Database Bridge (Cloud-to-Physical):** Untuk mengendalikan robot fisik dari web publik Vercel, web menuliskan perintah ke node `/smart_factory/command_queue`, lalu firmware ESP32 (atau jembatan lokal) mengonsumsi perintah antrean melalui koneksi HTTPS/WSS FirebaseClient.

---

## 3. ADAPTER MODULAR: `assets/js/esp32-client.js`

Logika komunikasi dipisahkan secara bersih dari file UI `index.html`. Adapter ini mengimplementasikan antarmuka standar:

| Metode Antarmuka | Deskripsi Operasi | Protokol / Pola |
| :--- | :--- | :--- |
| `configure(opts)` | Mengatur host IP, timeout, atau mode simulasi | Konfigurasi internal |
| `checkHealth()` | Mengambil status, RSSI, dan heap dari ESP32 | `GET /api/status` |
| `sendSortingCommand(p)` | Mengirimkan perintah pemilahan warna | `POST /api/sort` |
| `sendModeCommand(m)` | Mengatur mode kerja (`Servo` / `Arm`) | `POST /api/mode` |
| `sendEmergencyStop()` | Menghentikan sistem dan me-reset servo | `POST /api/stop` |
| `onStatusChange(fn)` | Callback reaktif pembaruan status UI | Pub/Sub Event Pattern |
| `setSimulation(bool)` | Mengaktifkan/menonaktifkan virtual mock | Simulasi internal |

---

## 4. PERAN MASING-MASING KOMPONEN

1. **Website VERNOVA (Edge Intelligence):**
   - Mengambil frame video dari webcam operator.
   - Menjalankan inferensi model Google Teachable Machine di browser.
   - Menegakkan ambang batas keyakinan (confidence threshold >= 85%).
   - Mengirimkan perintah HTTP POST terstruktur ke ESP32.
   - Mencatat telemetri dan log sorting ke Firebase Realtime Database.
2. **ESP32 (Physical Controller):**
   - Menjalankan web server HTTP di port 80 dengan header CORS.
   - Memvalidasi payload JSON dan mencocokkan `commandId`.
   - Menggerakkan sinyal PWM servo pemilah (Flap / Arm) sesuai sudut bin warna.
   - Mengembalikan respons acknowledgment instan ke browser.
3. **Firebase Realtime Database (Historical Cloud Sync):**
   - Menyimpan seluruh log proses sortir ber-ID unik (`runId`, `commandId`, `esp32DeviceId`, `durationMs`).
   - Menyediakan aliran sinkronisasi live untuk portal pemantauan tamu (`guest.html`).
