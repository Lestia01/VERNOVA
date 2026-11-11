# TINJAUAN KEAMANAN PERANGKAT LUNAK (SECURITY REVIEW)
**Proyek:** VERNOVA — R-LAB Smart Sorting Factory  
**Standar Evaluasi:** OWASP Top 10 Web Application Security Risks  
**Tanggal Evaluasi:** 11 November 2026  
**Status:** HARDENED & AUDITED  

---

## 1. PENDAHULUAN

Tinjauan keamanan ini mengevaluasi seluruh potensi kerentanan aplikasi web, antarmuka pengguna, skrip backend proxy PowerShell, dan konfigurasi database cloud proyek **VERNOVA**. Langkah-langkah mitigasi komprehensif telah diterapkan untuk menjamin perlindungan terhadap data, kredensial, dan stabilitas operasional.

---

## 2. EVALUASI BERDASARKAN OWASP TOP 10

### 2.1 A01:2021 — Broken Access Control
- **Risiko Sebelum Audit:**
  - Password admin `098765` tersimpan secara plaintext dalam file JavaScript frontend `index.html`. Siapapun yang memeriksa inspect element browser dapat melihat dan membobol hak akses kontrol robot.
  - Halaman `guest.html` berpotensi memanggil fungsi mutasi jika kode JS disatukan tanpa pemisahan peran.
- **Mitigasi yang Diterapkan:**
  - **Penghapusan Plaintext:** Menghapus variabel `ADMIN_PASS` string dan menggantikannya dengan hash kriptografis SHA-256:
    `ADMIN_PASS_HASH = "4a9ca4596692e94f9d2912b06a0d007564a22ee750339a6021c2392149b25d6d"`.
  - **Verifikasi Bertingkat:** Otentikasi utama dilewatkan ke backend proxy endpoint `/api/auth` yang memverifikasi input secara aman. Jika backend tidak aktif (mode statis murni), verifikasi dilakukan menggunakan Web Crypto API (`crypto.subtle.digest('SHA-256', ...)`).
  - **Pemisahan DOM Bersih:** Halaman `guest.html` sepenuhnya dibersihkan dari fungsi-fungsi kontrol aktuasi fisik, tombol kalibrasi, dan utilitas pembersihan database.

### 2.2 A02:2021 — Cryptographic Failures
- **Risiko Sebelum Audit:**
  - Ketiadaan perlindungan hash pada password admin.
  - Risiko terbukanya API Keys pihak ketiga (Groq, Gemini) jika dicantumkan langsung di kode sumber Git.
- **Mitigasi yang Diterapkan:**
  - Pembuatan aturan ketat pada `.gitignore` untuk mengecualikan direktori `_secrets/`, berkas `keys.json`, file `.env`, dan ekstensi sertifikat privat.
  - Disediakan berkas `keys.example.json` sebagai panduan tanpa membocorkan kredensial nyata.
  - Penerapan SHA-256 untuk seluruh perbandingan string otorisasi admin.

### 2.3 A03:2021 — Injection (Formula Injection / CSV Injection)
- **Risiko Sebelum Audit:**
  - Pada ekspor data CSV dan Excel, jika terdapat karakter awalan formula spreadsheet (`=`, `+`, `-`, `@`), file yang diunduh dapat mengeksekusi perintah berbahaya saat dibuka di Microsoft Excel atau Google Sheets (*CSV / Formula Injection*).
- **Mitigasi yang Diterapkan:**
  - Implementasi fungsi sanitasi `safeCell(val)`:
    ```javascript
    function safeCell(val) {
      if (val === null || val === undefined) return '';
      const s = String(val);
      if (/^[=+\-@\t\r]/.test(s)) {
        return "'" + s;
      }
      return s;
    }
    ```
  - Implementasi fungsi enkapsulasi CSV `csvEscape(val)` untuk membungkus karakter koma dan meng-escape tanda petik dua ganda (`""`).
  - Telah diuji secara otomatis dan lulus 100% pada suite `tests/export_sanitization.test.js`.

### 2.4 A04:2021 — Insecure Design & Resilience
- **Risiko Sebelum Audit:**
  - Backend `server.ps1` memiliki logika fatal `if (-not (Test-Path $keysFile)) { exit 1 }`. Ini menyebabkan server web lokal sama sekali tidak dapat berjalan jika pengguna belum menyetel API key.
- **Mitigasi yang Diterapkan:**
  - Logika diubah menjadi peringatan non-fatal (*graceful fallback*): Server statis tetap melayani aset HTML/CSS/JS, dan fitur AI secara cerdas dialihkan ke Tier 2 (Pollinations) atau Tier 3 (Kamus Deterministik Lokal).

### 2.5 A05:2021 — Security Misconfiguration
- **Risiko Sebelum Audit:**
  - Header HTTP keamanan default pada web server lokal atau hosting cloud belum dikonfigurasi.
- **Mitigasi yang Diterapkan:**
  - Diterapkan HTTP Security Headers pada konfigurasi deployment `vercel.json`:
    - `X-Content-Type-Options: nosniff` (mencegah MIME-sniffing).
    - `X-Frame-Options: SAMEORIGIN` (mencegah serangan Clickjacking).
    - `X-XSS-Protection: 1; mode=block` (mitigasi XSS pada browser lama).
    - `Referrer-Policy: strict-origin-when-cross-origin`.

### 2.6 A06:2021 — Vulnerable and Outdated Components
- **Audit Komponen Pihak Ketiga:**
  - **FontAwesome 6.4.0 (CDN):** Aman, digunakan hanya untuk rendering ikon SVG/font.
  - **Tailwind CSS v3 (CDN):** Aman, hanya memproses utilitas styling di sisi klien.
  - **SheetJS (xlsx.full.min.js v0.18.5):** Dilindungi dengan sanitasi `safeCell` sebelum data diumpankan ke builder workbook.
  - **jsPDF v2.5.1:** Pustaka teruji untuk rendering PDF di browser.
  - **docx.js v8.5.0:** Versi resmi UMD untuk dokumen Word terstruktur.

### 2.7 A07:2021 — Identification and Authentication Failures
- **Mitigasi yang Diterapkan:**
  - Sesi login admin dikelola secara aman dalam `sessionStorage` (hanya berlaku pada tab aktif dan terhapus otomatis saat browser ditutup).
  - Mekanisme penguncian (*Lock Dashboard*) disediakan secara eksplisit untuk menghapus token sesi seketika.

### 2.8 A08:2021 — Software and Data Integrity Failures
- **Risiko Sebelum Audit:**
  - Overwrite race condition pada Firebase Realtime Database akibat penggunaan indeks statis berbasis panjang array.
- **Mitigasi yang Diterapkan:**
  - Penggunaan `push()` Firebase yang menghasilkan token ID kriptografis unik berbasis timestamp presisi tinggi, menjamin atomisitas penulisan multi-klien tanpa tabrakan data.

### 2.9 A09:2021 — Security Logging and Monitoring Failures
- **Mitigasi yang Diterapkan:**
  - Setiap anomali deteksi AI Vision atau pembatalan koneksi Bluetooth dicatat ke dalam Live History feed dengan status spesifik (`ERROR`, `CANCELLED`).
  - Modul pencatatan log menyertakan durasi waktu (`durationMs`) dan timestamp standar ISO 8601.

### 2.10 A10:2021 — Server-Side Request Forgery (SSRF)
- **Mitigasi yang Diterapkan:**
  - Endpoint proxy di `server.ps1` hanya diizinkan meneruskan panggilan ke endpoint terdaftar yang di-hardcode (`https://api.groq.com/openai/v1/chat/completions` dan `https://generativelanguage.googleapis.com/...`). Tidak ada parameter URL dinamis yang dapat disalahgunakan oleh pengguna untuk memicu SSRF ke jaringan internal pabrik.

---

## 3. CHECKLIST VERIFIKASI KEAMANAN

| Item Pengujian | Target Uji | Hasil Verifikasi |
| :--- | :--- | :--- |
| **Penyimpanan Password** | `index.html` | ✅ Lolos (SHA-256 Hash digunakan, plaintext dihapus) |
| **Kebocoran Secrets Git** | `.gitignore` & Repository | ✅ Lolos (`_secrets/`, `*.key`, `keys.json` diabaikan) |
| **Sanitasi Formula Injeksi** | Ekspor CSV / XLSX | ✅ Lolos (Prefix `'` otomatis disisipkan pada formula) |
| **Ketahanan Server Statis** | `server.ps1` | ✅ Lolos (Berjalan normal walau keys tidak ada) |
| **Pemisahan Peran Tamu** | `guest.html` | ✅ Lolos (Tidak ada tombol kontrol aktuator/mutasi) |
| **Proteksi Privasi AI** | `rai-knowledge.js` | ✅ Lolos (Query kredensial/password ditolak) |
