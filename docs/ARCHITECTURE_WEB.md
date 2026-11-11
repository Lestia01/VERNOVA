# ARSITEKTUR SISTEM & PERANGKAT LUNAK VERNOVA
**Proyek:** VERNOVA — R-LAB Smart Sorting Factory  
**Versi Arsitektur:** 2.1.0  
**Status:** Terverifikasi & Terimplementasi  

---

## 1. DESAIN ARSITEKTUR KESELURUHAN (HIGH-LEVEL ARCHITECTURE)

Sistem perangkat lunak **VERNOVA** mengadopsi arsitektur terdistribusi hibrida (*hybrid edge-cloud architecture*). Pemrosesan inferensi visual kecerdasan buatan dan kontrol hardware dilakukan secara real-time di sisi browser pengguna (*edge computing* via Web APIs), sementara persistensi metrik agregat dan sinkronisasi lintas perangkat dialirkan ke cloud melalui Firebase Realtime Database.

```
                      +---------------------------------------+
                      |           USER WEB BROWSER            |
                      |   (Admin: index.html / Guest: guest)   |
                      +---+-------------------------------+---+
                          |                               |
        (Webcam Stream)   |                               |  (Web BLE - Nordic UART)
                 +--------v-------+               +-------v--------+
                 | Google         |               | BBC micro:bit  |
                 | Teachable      |               | Sorting Line   |
                 | Machine (TF.js)|               | (Firmware Edge)|
                 +--------+-------+               +----------------+
                          | (Kategori: K/B/M/E)
                          v
                 +----------------+
                 | Rule Engine &  |
                 | State Manager  |
                 +--------+-------+
                          |
         +----------------+----------------+
         |                                 |
         v (push JSON data)                v (Multi-tiered Fallback)
+-------------------+             +----------------------------------+
| Firebase Realtime |             | R-AI Assistant Engine            |
| Database (Cloud)  |             | Tier 1: server.ps1 (Groq/Gemini) |
+-------------------+             | Tier 2: Pollinations.ai API      |
                                  | Tier 3: rai-knowledge.js (Local) |
                                  +----------------------------------+
```

---

## 2. DIAGRAM ALIR DATA END-TO-END (END-TO-END DATA FLOW)

### 2.1 Alur Deteksi & Pengurutan Objek (Vision-to-Actuation Pipeline)
1. **Pengambilan Frame Video:** Browser mengakses webcam pengguna via `navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })`.
2. **Inferensi Computer Vision:** Frame canvas diumpankan ke model `tmImage` (TensorFlow.js). Model menghasilkan array probabilitas kelas:
   - `Kuning` (Yellow)
   - `Biru` (Blue)
   - `Merah` (Red)
   - `Background / Noise`
3. **Thresholding & Filtering Keyakinan:** Prediksi hanya dianggap valid jika tingkat keyakinan (*confidence threshold*) melebihi 85% (`confidence >= 0.85`).
4. **Transmisi Hardware (Web Bluetooth API):**
   - Browser mengirimkan karakter perintah via Nordic UART Service (`TX Characteristic`):
     - `'K'` untuk wadah Kuning (Servo Bin 1)
     - `'B'` untuk wadah Biru (Servo Bin 2)
     - `'M'` untuk wadah Merah (Servo Bin 3)
     - `'E'` untuk penanganan anomali/gagal sortir
   - micro:bit menerima karakter via buffer serial dan memicu gerakan servo mekanis (out-of-scope).
5. **Persistensi Real-time ke Cloud:**
   - Objek log baru dibuat dengan metadata lengkap:
     ```json
     {
       "runId": "RUN-1731316800000-XYZ",
       "kategori": "kuning",
       "confidence": 0.942,
       "timestamp": "2026-11-11T09:12:00.000Z",
       "sortResult": "BERHASIL",
       "durationMs": 420
     }
     ```
   - Disimpan menggunakan metode `push()` pada node path Firebase: `/smart_factory/sorting_line/kuning`.
6. **Reaktivitas UI Dasbor:**
   - Listener Firebase `.on('value')` mendeteksi snapshot baru.
   - Counter metrik bertambah seketika, grafik Chart.js dirender ulang, dan Live History feed menyisipkan baris log terbaru.

---

## 3. ARSITEKTUR KECERDASAN BUATAN MULTI-TIER (R-AI ASSISTANT / JARVIS)

Asisten suara dan teks **R-AI** dirancang dengan arsitektur toleran kesalahan tiga tingkat (*three-tiered graceful degradation*) guna menjamin sistem tetap dapat merespons perintah operator dalam segala kondisi jaringan:

```
[Permintaan Pengguna: Teks / Suara STT]
                 |
                 v
   < Apakah server.ps1 aktif & keys.json ada? >
         /                               \
       YA                                TIDAK
       v                                   v
[Tier 1: Backend Proxy]        < Apakah ada koneksi Internet? >
- Google Gemini 1.5 Flash             /                      \
- Groq LLaMA 3.3 70B Versatile      YA                       TIDAK
(Latensi rendah, reasoning kaya)    v                          v
                        [Tier 2: Cloud Free API]     [Tier 3: Offline Local]
                        - Pollinations.ai Text API   - rai-knowledge.js
                        - Multi-turn system prompt   - Regex / Intent Matcher
                                                     - Respons terjamin 100%
```

### Keamanan Privasi pada R-AI
Sebelum pertanyaan diteruskan ke model LLM Tier manapun, modul `rai-knowledge.js` melakukan penyaringan awal (*pre-filtering*). Pertanyaan terkait password sistem, kredensial database, atau kunci enkripsi langsung diintersepsi dan dibalas dengan penolakan keamanan formal (*Security Privacy Guard*).

---

## 4. ARSITEKTUR MODUL FRONTEND & PEMISAHAN PERAN (RBAC)

Aplikasi mengimplementasikan pemisahan hak akses berbasis peran (*Role-Based Access Control*) secara fisik melalui dua entry point berbeda:

### 4.1 Mode Admin (`index.html`)
- **Akses:** Dilindungi kata sandi dengan hash SHA-256 dan verifikasi backend.
- **Wewenang:**
  - Koneksi dan pemutusan Web Bluetooth.
  - Start, Stop, dan Kalibrasi Servo & Conveyor.
  - Mengubah mode AI Vision (Snapshot vs Continuous).
  - Mengonfigurasi aturan otomasi (*Rule Engine*).
  - Menghapus cloud database (*Destructive Action*).
  - Ekspor seluruh format laporan (PDF, Excel, Word, CSV).

### 4.2 Mode Tamu / Monitoring (`guest.html`)
- **Akses:** Terbuka publik untuk pengamat, tamu kehormatan, atau pameran.
- **Wewenang:**
  - Membaca metrik agregat secara real-time via Firebase listener pasif.
  - Membaca live log feed dan memfilter berdasarkan kategori.
  - Berinteraksi dengan R-AI Guest Assistant (edukasi cara kerja pabrik).
  - Mengunduh salinan laporan hasil produksi publik.
  - Seluruh tombol kontrol aktuasi fisik dan penghapusan data **tidak tersedia pada DOM**.

---

## 5. DUAL EXECUTION ENVIRONMENT (LOCAL VS CLOUD DEPLOYMENT)

Sistem dirancang secara fleksibel agar dapat beroperasi pada dua mode lingkungan kerja:

1. **Local Factory Execution (Offline/Intranet Ready):**
   - Diluncurkan melalui `MULAI-RLAB.bat` yang mengeksekusi `server.ps1`.
   - Menggunakan port HTTP lokal (default: `http://localhost:8000`).
   - Menyediakan proxy API lokal untuk mengamankan API Key LLM tanpa mengeksposnya ke browser.
   - Tetap dapat menghubungkan Web Bluetooth (karena `localhost` diperlakukan sebagai *Secure Context* oleh browser W3C).

2. **Cloud Serverless Execution (Vercel / Cloud CDN):**
   - Dikelola melalui konfigurasi deklaratif `vercel.json`.
   - Frontend statis didistribusikan melalui global edge network.
   - Fitur Web Bluetooth tetap berfungsi penuh berkat penegakan protokol HTTPS (*Secure Origin Requirement*).
   - Layanan R-AI secara otomatis beralih ke Tier 2 (Pollinations) dan Tier 3 (Local Knowledge) ketika backend PowerShell tidak dijalankan di cloud.
