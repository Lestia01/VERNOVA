# CATATAN PERUBAHAN PERANGKAT LUNAK (CHANGELOG)
Semua perubahan penting pada kode program website dan perangkat lunak proyek **VERNOVA (R-LAB Smart Sorting Factory)** didokumentasikan di sini.

Format mengikuti prinsip [Keep a Changelog](https://keepachangelog.com/id/1.0.0/) dan menganut [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.1] - 2026-11-15

### Diperbaiki (Fixed)
- **Pemisahan Ketat Kueri Analitik vs Kontrol Robot (Bug 1):**
  - Implementasi fungsi `isAnalyticQuery()` dan `isRobotControlCommand()` untuk memastikan kueri analitis (seperti *"Analisa mode Arm dan Servo mana lebih efektif?"*) tidak pernah memicu perubahan mode kerja fisik robot (`changeSortingMode`).
  - Regex kontrol hardware di `window.jarvisSend` dan `processCommand` di `index.html` diperketat dengan mewajibkan kata kerja perintah eksplisit (`ubah`, `ganti`, `set`, `switch`, `pindah`). Kata `'mode'` dihapus dari daftar kata aksi pemicu di fallback command.
  - Penanganan kueri ambigu (`"mode arm"`, `"servo"`): sistem menahan aksi fisik dan meminta klarifikasi intent (`AMBIGUOUS_CLARIFICATION`).
- **Riwayat Lengkap Kejadian Error (Bug 2):**
  - Pemisahan intent `ERROR_LATEST` (hanya 1 error terbaru) dan `ERROR_HISTORY` (seluruh kejadian error).
  - Intent `ERROR_HISTORY` menyajikan daftar kejadian error secara kronologis menurun (terbaru ke terlama) dengan format waktu WIB, kode error, mode, warna, status, runId, dan catatan paginasi.
- **Validasi Pembagi Nol & Penanganan Data Kosong/Null (Bug 3):**
  - Mode dengan 0 percobaan kini menghasilkan error rate `null` yang dilaporkan sebagai `"Belum dapat dihitung — tidak ada data percobaan (N/A)"`, bukan 0% dan tidak disimpulkan bebas error.
  - Penanganan database null atau unreachable: menghasilkan pesan transparan `"Data tidak tersedia"` tanpa memalsukan angka 0.
- **Komparasi Efektivitas Multi-Metrik (Bug 4):**
  - Implementasi intent `COMPARE_MODE_EFFECTIVENESS` yang mengevaluasi Servo vs Arm melalui tabel komparasi 8 metrik riil: Total Percobaan, Jumlah Berhasil, Jumlah Gagal, Success Rate, Error Rate, Rata-rata Durasi Siklus (`durationMs`), Salah Sortir (Missort), dan Throughput.
  - Pernyataan eksplisit jika salah satu mode belum memiliki data percobaan yang memadai.
- **Konsistensi Basis Perhitungan (Bug 5):**
  - Standarisasi pelaporan basis perhitungan pada seluruh respons analitik (Total percobaan sortir = sukses + gagal).
- **Konteks Percakapan Multi-Turn / Follow-Up (Bug 6):**
  - Pelacakan `conversationContext` pada `SmartDataAssistant` sehingga pertanyaan lanjutan singkat (seperti *"Bagaimana dengan Arm?"*, *"Bandingkan keduanya"*, *"Bagaimana kemarin?"*) diproses sesuai topik analitik sebelumnya tanpa salah memicu kontrol hardware.
- **Uji Regresi Otomatis (Bug 7):**
  - Penambahan 11 skenario pengujian regresi di `tests/smart_data_assistant.test.js`.
  - Total test suite proyek meningkat menjadi 53 test case (100% Passing).

---

## [2.3.0] - 2026-11-15

### Ditambahkan (Added)
- **Modul Inti Smart Data Assistant (`assets/js/smart-data-assistant.js`):**
  - Mesin asisten data deterministik 100% tanpa model AI / LLM (*zero-LLM architecture*).
  - Normalisasi teks bahasa Indonesia dan kamus slang/singkatan (*typo expander*).
  - Klasifikasi intent multi-kategori (Kategori A: Statistik Sorting, Kategori B: Analisis Error, Kategori C: Pola Mode Kerja, Kategori D: Analisis Waktu & Tren, Kategori E: Status Sistem & Hardware, Kategori F: Ringkasan & SOP Masalah).
  - Penanganan batas waktu presisi berbasis zona waktu WIB (UTC+7 / `Asia/Jakarta`).
  - Agregasi data aktual dari Firebase Realtime Database path `smart_factory/sorting_line` dan cache lokal.
  - Perhitungan persentase error rate transparan: `errorRate = (errors / total) * 100%`.
  - Catatan basis perhitungan eksplisit pada setiap jawaban.
  - *Disclaimer* etika data pemisahan korelasi frekuensi mode terhadap kausalitas kerusakan mekanis hardware.
- **Suite Pengujian Unit Smart Data Assistant (`tests/smart_data_assistant.test.js`):**
  - 13 test case komprehensif mencakup normalisasi teks, 20+ intent patterns, agregasi record Firebase, perhitungan formula, penanganan database kosong, dan fallback terarah.
  - Total pengujian unit proyek kini mencapai 41 passing (100% lulus, 0 gagal).
- **Dokumentasi Teknis Lengkap (`docs/SMART_DATA_ASSISTANT.md`):**
  - Panduan arsitektur, taksonomi intent, formula statistik, dan analisis keamanan tanpa kebocoran data.

### Diubah (Changed)
- **Antarmuka Pengguna & Panel Asisten (`index.html` & `guest.html`):**
  - Branding diperbarui dari "R-AI" menjadi "VERNOVA Smart Data Assistant".
  - Dialog chat kini menyajikan *dynamic suggestion chips* interaktif setelah setiap jawaban.
  - Pemanggilan eksternal `https://text.pollinations.ai/` dan dependensi token LLM dilepas sepenuhnya.
  - Perintah suara STT/TTS tetap didukung secara lokal.
- **Backend Lokal (`server.ps1`):**
  - Endpoint `/api/chat` diperbarui dengan respons deterministik ramah tanpa melempar HTTP 502 bila API eksternal tidak aktif.

---

## [2.2.0] - 2026-11-15

### Ditambahkan (Added)
- **Modul Klien Komunikasi ESP32 Wi-Fi (`assets/js/esp32-client.js`):**
  - Adapter HTTP REST API terpadu (`/api/status`, `/api/sort`, `/api/mode`, `/api/stop`).
  - Mode simulasi mock (*virtual hardware*) bawaan untuk demo offline dan Vercel cloud tanpa hardware fisik.
  - Listener reaktif event perubahan status telemetri perangkat.
- **Modal Konfigurasi ESP32 Wi-Fi (`index.html`):**
  - Input kustom alamat IP/Host ESP32 dengan preset SoftAP (`192.168.4.1`) dan proxy lokal.
  - Tombol uji latensi ("Test Ping"), toggle switch Mode Simulasi, dan telemetri live (RSSI, Free Heap, Uptime).
- **Backend Proxy `/api/esp32` (`server.ps1`):**
  - Reverse proxy perantara untuk meneruskan instruksi ke ESP32 pada subnet LAN lokal dengan dukungan CORS penuh.
- **Firmware Referensi ESP32 C++ Arduino (`firmware/esp32_vernova_sorting/esp32_vernova_sorting.ino`):**
  - Mendukung hotspot mandiri SoftAP (`VERNOVA-ROBOT` / `192.168.4.1`) dan Station mode router sekolah.
  - Server HTTP REST port 80 dengan header CORS dan kontrol PWM servo pemilah (Flap & Arm).
- **Suite Pengujian Unit Klien ESP32 (`tests/esp32_client.test.js`):**
  - 8 pengujian otomatis baru mencakup validasi input, sanitasi host, transisi state machine, dan penanganan offline.
  - Total pengujian unit proyek meningkat menjadi 28 passing (0 gagal).
- **Suite Dokumentasi Migrasi ESP32 (`docs/`):**
  - `ESP32_WIFI_ARCHITECTURE.md`, `ESP32_COMMUNICATION_PROTOCOL.md`, `ESP32_MIGRATION_PLAN.md`, `ESP32_SECURITY_REVIEW.md`, `ESP32_TEST_PLAN.md`, `ESP32_TEST_RESULTS.md`, `ESP32_SETUP_GUIDE.md`.

### Diubah (Changed)
- **Antarmuka Pengguna (`index.html`):**
  - Mengganti status pill `#status-bt` menjadi `#status-esp32`.
  - Mengganti tombol koneksi Bluetooth menjadi tombol `#btn-conn-esp32` berikon Wi-Fi.
  - Memperbarui kartu alur data arsitektur sistem dari BLE UART ke ESP32 Wi-Fi REST Bridge.
- **Pipeline AI Vision & Manual QC (`index.html`):**
  - Mengarahkan inferensi warna Teachable Machine (`confidence > 0.85`) ke `esp32Client.sendSortingCommand`.
  - Memperbarui skema penulisan log Firebase RTDB dengan metadata `esp32DeviceId`, `commandId`, dan `executionStatus`.
- **Pustaka Pengetahuan R-AI (`rai-knowledge.js`):**
  - Menyelaraskan informasi mikrokontroler robot ke ESP32 Wi-Fi REST API.

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
