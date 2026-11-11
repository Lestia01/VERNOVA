# CATATAN PERUBAHAN PERANGKAT LUNAK (CHANGELOG)
Semua perubahan penting pada kode program website dan perangkat lunak proyek **VERNOVA (R-LAB Smart Sorting Factory)** didokumentasikan di sini.

Format mengikuti prinsip [Keep a Changelog](https://keepachangelog.com/id/1.0.0/) dan menganut [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.1.0] - 2026-11-11

### Ditambahkan (Added)
- **Suite Pengujian Otomatis (`tests/*.test.js`):**
  - `tests/export_sanitization.test.js`: Validasi sanitasi formula injection (`safeCell`) dan enkapsulasi CSV (`csvEscape`).
  - `tests/rai_knowledge.test.js`: Validasi normalisasi warna, interpolasi warna kosong, dan aturan perlindungan privasi kredensial.
  - `tests/rule_engine.test.js`: Validasi parsing perintah aturan otomasi dan evaluasi penembakan pemicu.
  - `tests/security_auth.test.js`: Validasi kriptografis hash password admin SHA-256.
- **Konfigurasi Cloud Deployment (`vercel.json`):**
  - Security headers bawaan: `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`.
  - Routing clean URLs untuk `index.html` dan `guest.html`.
- **Integrasi Ekspor Word DOCX (`docx@8.5.0`):**
  - Pustaka UMD dimuat via CDN di `index.html` dan `guest.html`.
  - Tombol unduh "Word (.docx)" ditambahkan ke modal dialog ekspor.
  - Penambahan MIME type `.docx` (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`) di `server.ps1`.
- **Filter Live History:**
  - Tombol penyaring instan (Semua, Kuning, Biru, Merah, Error) pada antarmuka admin (`index.html`) dan portal tamu (`guest.html`).
- **Template Kunci API (`keys.example.json`):**
  - Template aman tanpa membocorkan kredensial rahasia.
- **Suite Dokumentasi Teknis Komprehensif (`docs/*.md`):**
  - `MASTER_CHECKLIST_WEB.md`: Pelacak status implementasi setiap task.
  - `PROJECT_AUDIT_WEB.md`: Laporan audit fitur dan inventaris kode lengkap.
  - `ARCHITECTURE_WEB.md`: Diagram alur data end-to-end dan arsitektur toleransi kegagalan.
  - `DATABASE_SCHEMA.md`: Spesifikasi struktur Realtime Database dan aturan keamanan Firebase.
  - `SECURITY_REVIEW_WEB.md`: Tinjauan kepatuhan OWASP Top 10 dan mitigasi kerentanan.
  - `TEST_PLAN_WEB.md`: Strategi, cakupan, dan matriks pengujian aplikasi.
  - `TEST_RESULTS_WEB.md`: Rekapitulasi hasil uji otomatis 20/20 lulus dan verifikasi manual.
  - `DEPLOYMENT_GUIDE_WEB.md`: Petunjuk setup server lokal dan publikasi cloud Vercel.
  - `CHANGELOG_WEB.md`: Riwayat lengkap perubahan kode dan dasar pertimbangannya.

### Diubah (Changed)
- **Pengamanan Password Admin (WEB-001):**
  - Menghapus string plaintext `ADMIN_PASS = "098765"` dari JavaScript publik.
  - Mengimplementasikan hash SHA-256 (`4a9ca4596692e94f9d2912b06a0d007564a22ee750339a6021c2392149b25d6d`).
  - Menambahkan verifikasi primer melalui endpoint backend `/api/auth` pada `server.ps1` dengan fallback Web Crypto API di sisi klien.
- **Ketahanan Backend Server (WEB-003):**
  - Menghapus pernyataan fatal `exit 1` saat berkas `_secrets/keys.json` tidak ditemukan di `server.ps1`. Server beralih secara anggun (*graceful fallback*) ke mode file statis.
- **Integritas Penulisan Firebase (WEB-004):**
  - Mengubah metode penulisan log sorting dari indexing array berbasis panjang `[category][length - 1]` menjadi `push()` dengan unique ID.
  - Menambahkan metadata terstruktur: `runId`, `sortResult`, `executionStatus`, `durationMs`, `errorCode`, dan `timestamp` ISO 8601.
  - Memastikan kompatibilitas mundur pada loop pembacaan (`Object.values(...)`).
- **Urutan Penanganan Privasi R-AI (WEB-013):**
  - Mengatur ulang urutan pencocokan aturan di `rai-knowledge.js` agar pertanyaan terkait kata sandi/kredensial dicegat sebelum aturan kata kunci database umum dievaluasi.
- **Penguatan UX Web Bluetooth API (WEB-012):**
  - Menangkap error pembatalan dialog oleh pengguna (`NotFoundError`) dan menggantinya dengan toast notifikasi informasi ramah pengguna.
  - Menambahkan state visual `BT: CONNECTING...`.
- **Standarisasi URL Google Teachable Machine (WEB-010):**
  - Menyelaraskan URL di `teachable_machine_url.txt` dan `index.html` ke format kanonik `https://teachablemachine.withgoogle.com/models/j0nanBWFa/`.
- **Perbaikan Path Aset Font Lokal (WEB-020):**
  - Mengoreksi path font dari `assets/fonts/` menjadi `assets/font/Inter-Variable.woff2`.
- **Pembersihan Alias Usang (WEB-023):**
  - Memperbaiki `window.exportExcel = () => exportCSV()` menjadi `window.exportExcel = () => exportXLSX()`.
- **Proteksi Berkas Rahasia (`.gitignore`):**
  - Menambahkan pengecualian komprehensif untuk `_secrets/`, `keys.json`, `.env`, sertifikat SSL/TLS, dan build artifacts.

---

## [2.0.0] - 2026-11-10
### Baseline R-LAB Smart Sorting Factory
- Rilis awal kode sumber frontend, antarmuka guest, kontrol Web Bluetooth, integrasi model Teachable Machine, dan script server PowerShell.
