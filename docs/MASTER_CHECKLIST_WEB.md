# MASTER CHECKLIST — VERNOVA WEBSITE & SOFTWARE IMPROVEMENT

**Project:** VERNOVA (R-LAB Smart Sorting Factory)  
**Status Legend:**
- `[ ]` BELUM DIKERJAKAN
- `[-]` SEDANG DIKERJAKAN
- `[?]` MENUNGGU
- `[!]` GAGAL
- `[x]` SELESAI DAN TERVERIFIKASI
- `[M]` PERLU PENGUJIAN MANUAL
- `[N/A]` TIDAK RELEVAN

**Priority Levels:**
- **P0 — Kritis:** Risiko keamanan, kebocoran secret, akses tidak sah, kerusakan data, atau crash server utama.
- **P1 — Tinggi:** Fitur inti, integritas database, pipeline Computer Vision, komunikasi Web Bluetooth, keandalan asisten AI.
- **P2 — Menengah:** Desain dashboard, ekspor laporan, validasi UX, perbaikan font/aset, optimasi performa.
- **P3 — Tambahan:** Pengayaan styling, transisi animasi, dokumentasi pengembang, otomatisasi CI/CD lanjutan.

---

## 1. P0 — KRITIS (SECURITY, CREDENTIALS, ACCESS CONTROL & DATA INTEGRITY)

- [ ] **WEB-001 (P0)**: Isolasi dan Pengamanan Password Admin
  - **Alasan:** Password admin `098765` di-hardcode di client-side JS (`index.html`).
  - **File:** `index.html`, `server.ps1`.
- [ ] **WEB-002 (P0)**: Pengamanan Kredensial Firebase & Rules Realtime Database
  - **Alasan:** Firebase API key & URL database terekspos di client JS tanpa otentikasi role backend.
  - **File:** `index.html`, `guest.html`, `docs/DATABASE_SCHEMA.md`.
- [ ] **WEB-003 (P0)**: Penanganan Ketergantungan Server `_secrets/keys.json`
  - **Alasan:** `server.ps1` langsung crash fatal jika file `_secrets/keys.json` tidak ada di direktori induk.
  - **File:** `server.ps1`, `.gitignore`, `docs/DEPLOYMENT_GUIDE_WEB.md`.
- [ ] **WEB-004 (P0)**: Refaktorisasi Penulisan Firebase (Eliminasi Overwrite Race Condition)
  - **Alasan:** Penulisan data penyortiran menggunakan index numerik klien `[state.sortingData[category] - 1]`, rentan collision data tertimpa jika multi-client.
  - **File:** `index.html`, `guest.html`.
- [ ] **WEB-005 (P0)**: Pencegahan Broken Access Control Client-Side
  - **Alasan:** Mode guest dibatasi murni via manipulasi CSS / DOM yang dapat di-bypass via console.
  - **File:** `index.html`, `guest.html`.

---

## 2. P1 — TINGGI (CORE FEATURES, AI VISION, HARDWARE COMM & ASYNC PIPELINE)

- [ ] **WEB-010 (P1)**: Sinkronisasi dan Standarisasi URL Google Teachable Machine
  - **Alasan:** Terdapat ketidakcocokan antara `teachable_machine_url.txt` (`.../models/j0nanBWFa/s`) dan input default `index.html`.
  - **File:** `index.html`, `teachable_machine_url.txt`.
- [ ] **WEB-011 (P1)**: Pemetaan Kategori AI Vision (Enam Kategori Objek / Dual Mode)
  - **Alasan:** Memastikan software dapat mengklasifikasikan objek (Tutup botol Kuning/Biru/Merah -> Servo, Balok Kuning/Biru/Merah -> Arm) dengan handling confidence threshold aman.
  - **File:** `index.html`, `guest.html`.
- [ ] **WEB-012 (P1)**: Penguatan Web Bluetooth API & UX Handling
  - **Alasan:** Penanganan status koneksi Web Bluetooth BLE Nordic UART harus membedakan disconnected, connecting, timeout, dan cancellation tanpa error unhandled.
  - **File:** `index.html`.
- [ ] **WEB-013 (P1)**: Keandalan Asisten R-AI / Jarvis & Pencegahan Data Leak ke Layanan Publik
  - **Alasan:** Fallback ke Pollinations.ai publik berpotensi membocorkan data interaksi. Diperlukan validasi prompt dan isolasi data sensitif.
  - **File:** `index.html`, `guest.html`, `server.ps1`.
- [ ] **WEB-014 (P1)**: Perbaikan Pipeline Audio STT / TTS & Voice Recognition Fallback
  - **Alasan:** MediaRecorder transcoder dan failover Web Speech API harus teruji stabil di seluruh browser target.
  - **File:** `index.html`, `guest.html`, `server.ps1`.

---

## 3. P2 — MENENGAH (DASHBOARD, EXPORTING, ASSETS & REFACTORING)

- [ ] **WEB-020 (P2)**: Perbaikan Typo Path Font Lokal `assets/font`
  - **Alasan:** `@font-face` menunjuk ke `assets/fonts/Inter-Variable.woff2` padahal direktori bernama `assets/font/`.
  - **File:** `index.html`, `guest.html`.
- [ ] **WEB-021 (P2)**: Perbaikan dan Integrasi Pustaka Ekspor Dokumen DOCX (Word)
  - **Alasan:** Fungsi `exportDOCX()` telah diimplementasikan namun pustaka `docx.js` belum dimuat di `<head>` dan tombol belum diintegrasikan ke modal.
  - **File:** `index.html`, `guest.html`.
- [ ] **WEB-022 (P2)**: Konsolidasi Kode Duplikat (Shared Utilities & Export Pipeline)
  - **Alasan:** `index.html` dan `guest.html` memiliki redundansi ribuan baris untuk formatting, styling, dan export.
  - **File:** `index.html`, `guest.html`.
- [ ] **WEB-023 (P2)**: Perbaikan Alias Fungsi Usang `exportExcel`
  - **Alasan:** `window.exportExcel = () => exportCSV()` mengarahkan ekspor Excel ke CSV.
  - **File:** `index.html`.
- [ ] **WEB-024 (P2)**: Filter Rentang Waktu dan Riwayat Proses di Dashboard
  - **Alasan:** Dasbor membutuhkan pencarian riwayat, filter tanggal/warna/mode, dan pagination untuk volume data besar.
  - **File:** `index.html`, `guest.html`.

---

## 4. P3 — TAMBAHAN (TESTING AUTOMATION, DEPLOYMENT & DEVOPS)

- [ ] **WEB-030 (P3)**: Inisialisasi Git Repository & Konfigurasi `.gitignore`
  - **Alasan:** Mencegah file kredensial/secret terunggah dan menyediakan version control serta rollback.
  - **File:** `.gitignore`, `.git/`.
- [ ] **WEB-031 (P3)**: Pembuatan Suite Pengujian Otomatis (Unit & Integration Tests)
  - **Alasan:** Menguji fungsi-fungsi kritis (sanitasi CSV, rule engine, inferensi warna, state calculator) secara otomatis.
  - **File:** `tests/`.
- [ ] **WEB-032 (P3)**: Konfigurasi Deployment Vercel & Environment Variables
  - **Alasan:** Menyediakan file `vercel.json` dan struktur serverless/proxy untuk deployment cloud tanpa mengorbankan keamanan secret.
  - **File:** `vercel.json`.
- [ ] **WEB-033 (P3)**: Dokumentasi Lengkap Proyek
  - **Alasan:** Memenuhi standarisasi dokumentasi di folder `docs/`.
  - **File:** `docs/*.md`.
