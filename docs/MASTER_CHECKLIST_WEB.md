# MASTER CHECKLIST — VERNOVA WEBSITE & SOFTWARE IMPROVEMENT

**Project:** VERNOVA (R-LAB Smart Sorting Factory)  
**Terakhir Diperbarui:** 11 November 2026  
**Status Legend:**
- `[ ]` BELUM DIKERJAKAN
- `[-]` SEDANG DIKERJAKAN
- `[?]` MENUNGGU
- `[!]` GAGAL
- `[x]` SELESAI DAN TERVERIFIKASI
- `[M]` PERLU PENGUJIAN MANUAL
- `[N/A]` TIDAK RELEVAN

---

## 1. P0 — KRITIS (SECURITY, CREDENTIALS, ACCESS CONTROL & DATA INTEGRITY)

- [x] **WEB-001 (P0)**: Isolasi dan Pengamanan Password Admin
  - **Alasan:** Password admin `098765` sebelumnya tersimpan plaintext di JavaScript publik.
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Solusi:** Diubah menggunakan hash SHA-256 (`4a9ca4596692e94f9d2912b06a0d007564a22ee750339a6021c2392149b25d6d`) dengan verifikasi primer via `/api/auth` backend dan fallback hash lokal.
  - **File:** `index.html`, `server.ps1`, `tests/security_auth.test.js`.

- [M] **WEB-002 (P0)**: Pengamanan Kredensial Firebase & Rules Realtime Database
  - **Alasan:** Kredensial Firebase berada di client-side; keamanan mutasi data memerlukan Firebase Database Security Rules.
  - **Status:** `[M] PERLU PENGUJIAN MANUAL` (Aturan keamanan database disiapkan di `docs/DATABASE_SCHEMA.md` untuk diterapkan di Firebase Console).
  - **File:** `index.html`, `guest.html`, `docs/DATABASE_SCHEMA.md`.

- [x] **WEB-003 (P0)**: Penanganan Ketergantungan Server `_secrets/keys.json`
  - **Alasan:** `server.ps1` sebelumnya crash fatal (`exit 1`) jika file kunci tidak ditemukan.
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Solusi:** `server.ps1` dimodifikasi agar menangani ketiadaan `keys.json` secara elegan (*graceful fallback*) tanpa menghentikan web server statis, dan disediakan template `keys.example.json`.
  - **File:** `server.ps1`, `keys.example.json`.

- [x] **WEB-004 (P0)**: Refaktorisasi Penulisan Firebase (Eliminasi Overwrite Race Condition)
  - **Alasan:** Penulisan data sebelumnya menggunakan indexing manual `[category][length - 1]` yang rentan tertimpa (*collision*) pada multi-klien.
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Solusi:** Menggunakan metode `push()` dengan unique ID (`runId`, `sortResult`, `executionStatus`, `durationMs`) dan skema data komprehensif yang kompatibel dengan parser snapshot.
  - **File:** `index.html`.

- [x] **WEB-005 (P0)**: Pencegahan Broken Access Control Client-Side
  - **Alasan:** Mode tamu (`guest.html`) harus memiliki batasan fungsi read-only yang jelas dan tidak dapat mengeksekusi perintah kontrol perangkat.
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Solusi:** Penguncian fungsi mutasi pada antarmuka guest dan pemisahan logika respons R-AI khusus tamu.
  - **File:** `guest.html`.

---

## 2. P1 — TINGGI (CORE FEATURES, AI VISION, HARDWARE COMM & ASYNC PIPELINE)

- [x] **WEB-010 (P1)**: Sinkronisasi dan Standarisasi URL Google Teachable Machine
  - **Alasan:** Ketidakcocokan akhiran URL `/s` pada file teks referensi.
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Solusi:** URL distandarisasi ke format canonical `https://teachablemachine.withgoogle.com/models/j0nanBWFa/`.
  - **File:** `teachable_machine_url.txt`, `index.html`.

- [M] **WEB-011 (P1)**: Pemetaan Kategori AI Vision (Enam Kategori Objek / Dual Mode)
  - **Alasan:** Memastikan integrasi model mengenali objek fisik dengan ambang keyakinan >85%.
  - **Status:** `[M] PERLU PENGUJIAN MANUAL` (Logika inferensi aktif; memerlukan webcam fisik dan objek untuk evaluasi confusion matrix di lapangan).
  - **File:** `index.html`.

- [x] **WEB-012 (P1)**: Penguatan Web Bluetooth API & UX Handling
  - **Alasan:** Error popup unhandled saat pengguna membatalkan dialog pemindaian Bluetooth.
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Solusi:** Menangani `NotFoundError` secara ramah pengguna dan menambahkan indikator status `BT: CONNECTING...`.
  - **File:** `index.html`.

- [x] **WEB-013 (P1)**: Keandalan Asisten R-AI / Jarvis & Prioritisasi Privasi
  - **Alasan:** Pengecekan privasi kredensial harus diprioritaskan sebelum pencocokan kata kunci database umum.
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Solusi:** Urutan entri pada `rai-knowledge.js` diatur agar query kata sandi/kredensial selalu diblokir dengan pesan privasi.
  - **File:** `rai-knowledge.js`, `tests/rai_knowledge.test.js`.

- [x] **WEB-014 (P1)**: Pipeline Audio STT / TTS & Voice Recognition Fallback
  - **Alasan:** Keandalan perekaman audio cross-browser dan failover speech synthesis.
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Solusi:** Transkoder audio WAV 16-bit mono di browser dan balapan TTS multi-provider dengan fallback Web Speech API.
  - **File:** `index.html`, `guest.html`.

---

## 3. P2 — MENENGAH (DASHBOARD, EXPORTING, ASSETS & REFACTORING)

- [x] **WEB-020 (P2)**: Perbaikan Typo Path Font Lokal `assets/font`
  - **Alasan:** Folder bernama `assets/font/` tetapi sebelumnya ditulis `assets/fonts/`.
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **File:** `index.html`, `guest.html`.

- [x] **WEB-021 (P2)**: Integrasi Pustaka & Tombol Ekspor Dokumen DOCX (Word)
  - **Alasan:** Fungsi ekspor DOCX sebelumnya berstatus kode mati karena library belum dimuat dan tombol belum ada.
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Solusi:** Pustaka `docx.umd.js` dimuat via CDN, tombol Word DOCX ditambahkan ke modal, dan router ekspor diperbarui.
  - **File:** `index.html`, `guest.html`, `server.ps1`.

- [ ] **WEB-022 (P2)**: Konsolidasi Kode Bersama (Modularisasi JS)
  - **Alasan:** Redundansi kode antar file `index.html` dan `guest.html`.
  - **Status:** `[ ] BELUM DIKERJAKAN` (Direncanakan pada Milestone Refaktorisasi Lanjutan).
  - **File:** `index.html`, `guest.html`.

- [x] **WEB-023 (P2)**: Perbaikan Alias Fungsi Usang `exportExcel`
  - **Alasan:** `window.exportExcel = () => exportCSV()` sebelumnya mengarahkan Excel ke format CSV.
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Solusi:** Diperbaiki menjadi `window.exportExcel = () => exportXLSX()`.
  - **File:** `index.html`.

- [x] **WEB-024 (P2)**: Filter Rentang Waktu dan Riwayat Proses di Dashboard
  - **Alasan:** Kebutuhan penyaringan log aktivitas berdasarkan kategori warna dan status error.
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Solusi:** Menambahkan tombol filter interaktif (Semua / Kuning / Biru / Merah / Error) pada Live History di dasbor admin dan guest.
  - **File:** `index.html`, `guest.html`.

---

## 4. P3 — TAMBAHAN (TESTING AUTOMATION, DEPLOYMENT & DEVOPS)

- [x] **WEB-030 (P3)**: Inisialisasi Git Repository & Konfigurasi `.gitignore`
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **File:** `.gitignore`, `.git/`.

- [x] **WEB-031 (P3)**: Pembuatan Suite Pengujian Otomatis (Unit Tests)
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Hasil:** 20/20 test passing (Sanitasi formula injection, knowledge base R-AI, rule engine, SHA-256 password hash).
  - **File:** `tests/*.test.js`.

- [x] **WEB-032 (P3)**: Konfigurasi Deployment Vercel & Environment Variables
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Solusi:** File `vercel.json` dibuat dengan security headers lengkap dan instruksi deploy didokumentasikan di `docs/DEPLOYMENT_GUIDE_WEB.md`.
  - **File:** `vercel.json`, `docs/DEPLOYMENT_GUIDE_WEB.md`.

- [x] **WEB-033 (P3)**: Dokumentasi Lengkap Proyek
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Solusi:** 8 berkas dokumentasi teknis mendalam dibuat di bawah folder `docs/` (`PROJECT_AUDIT_WEB.md`, `ARCHITECTURE_WEB.md`, `DATABASE_SCHEMA.md`, `SECURITY_REVIEW_WEB.md`, `TEST_PLAN_WEB.md`, `TEST_RESULTS_WEB.md`, `DEPLOYMENT_GUIDE_WEB.md`, `CHANGELOG_WEB.md`).
  - **File:** `docs/*.md`.

---

## 5. P1 — MIGRASI KOMUNIKASI ESP32 WI-FI LAN (V2.2)

- [x] **ESP-001 (P1)**: Pembuatan Adapter Klien Modular ESP32 Wi-Fi REST API
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Solusi:** Membuat `assets/js/esp32-client.js` dengan dukungan HTTP REST (`/api/status`, `/api/sort`, `/api/mode`, `/api/stop`), timeout abort controller, dan mode simulasi virtual hardware.
  - **File:** `assets/js/esp32-client.js`.

- [x] **ESP-002 (P1)**: Penggantian Kontrol UI Bluetooth ke ESP32 Wi-Fi
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Solusi:** Mengganti `#status-bt` dengan `#status-esp32` dan tombol koneksi dengan `#btn-conn-esp32`, serta menambahkan modal konfigurasi IP, ping test, dan telemetri diagnostik live.
  - **File:** `index.html`.

- [x] **ESP-003 (P1)**: Integrasi Loop AI Vision & Manual QC ke ESP32 Client
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Solusi:** Mengarahkan hasil inferensi Teachable Machine (`> 85%`) dan tombol QC manual langsung ke `window.esp32Client.sendSortingCommand`, dilengkapi cooldown latch dan watchdog 12s.
  - **File:** `index.html`.

- [x] **ESP-004 (P1)**: Backend Proxy `/api/esp32` pada Server Lokal PowerShell
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Solusi:** Menambahkan handler `Handle-Esp32Proxy` di `server.ps1` untuk meneruskan request ke target ESP32 dengan header CORS lengkap.
  - **File:** `server.ps1`.

- [x] **ESP-005 (P1)**: Firmware Referensi Arduino C++ ESP32 REST Server
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Solusi:** Membuat skrip firmware lengkap dengan dukungan SoftAP hotspot `VERNOVA-ROBOT` (IP: `192.168.4.1`), web server port 80, kontrol PWM servo flap & arm, serta header CORS.
  - **File:** `firmware/esp32_vernova_sorting/esp32_vernova_sorting.ino`.

- [x] **ESP-006 (P1)**: Suite Pengujian Otomatis Klien ESP32 (8 Kasus Uji Baru)
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Hasil:** 28/28 test passing (8 unit test klien ESP32 + 20 unit test existing) via runner `node:test`.
  - **File:** `tests/esp32_client.test.js`.

- [x] **ESP-007 (P1)**: Suite Dokumentasi Migrasi Komprehensif
  - **Status:** `[x] SELESAI DAN TERVERIFIKASI`
  - **Solusi:** Menyusun 7 berkas dokumentasi teknis migrasi (`ESP32_WIFI_ARCHITECTURE.md`, `ESP32_COMMUNICATION_PROTOCOL.md`, `ESP32_MIGRATION_PLAN.md`, `ESP32_SECURITY_REVIEW.md`, `ESP32_TEST_PLAN.md`, `ESP32_TEST_RESULTS.md`, `ESP32_SETUP_GUIDE.md`).
  - **File:** `docs/*.md`.

- [M] **ESP-008 (P0)**: Pengujian Integrasi Fisik Lengan Robotik di Lapangan
  - **Status:** `[M] PERLU PENGUJIAN MANUAL` (Memerlukan board ESP32 fisik yang diflash dan dihubungkan ke motor servo nyata di lini sorting).
  - **File:** `firmware/esp32_vernova_sorting/esp32_vernova_sorting.ino`, `docs/ESP32_SETUP_GUIDE.md`.
