# AUDIT MENYELURUH WEBSITE & SOFTWARE VERNOVA
**Proyek:** VERNOVA — R-LAB Smart Sorting Factory  
**Tanggal Audit:** 11 November 2026  
**Auditor:** Senior Software Engineer, Cybersecurity Specialist & QA Engineer  
**Status Audit:** SELESAI (Audited & Hardened)  

---

## 1. RINGKASAN EKSEKUTIF (EXECUTIVE SUMMARY)

Audit ini dilakukan secara menyeluruh terhadap seluruh aset perangkat lunak proyek **VERNOVA (R-LAB Smart Sorting Factory)**, mencakup kode frontend (HTML5/CSS3/JavaScript ES6+), backend proxy (`server.ps1`), integrasi Firebase Realtime Database, pipeline kecerdasan buatan (Computer Vision Google Teachable Machine & LLM R-AI), komunikasi perangkat keras Web Bluetooth Low Energy (BLE), mesin otomasi aturan, serta sistem pelaporan multi-format (PDF, Excel XLSX, Word DOCX, CSV).

### Batasan Ruang Lingkup Ketat (Out-of-Scope Hardware Boundary)
Audit dan perbaikan ini **secara ketat berfokus pada perangkat lunak, web, database, keamanan, dan deployment**. Seluruh konstruksi mekanik lengan robotik, motor servo, mekanik conveyor belt, pengkabelan/pinout mikrokontroler fisik, serta kode program embedded (firmware micro:bit C++/MakeCode) berada di luar cakupan manipulasi kode ini. Tidak ada klaim penyortiran fisik yang dibuat semata-mata berdasarkan respon perangkat lunak web.

---

## 2. INVENTARISASI TEKNOLOGI & ARSITEKTUR KODE

### 2.1 Stack Teknologi
| Lapisan / Komponen | Teknologi / Pustaka | Versi / Sumber | Catatan Implementasi |
| :--- | :--- | :--- | :--- |
| **Frontend UI** | HTML5, CSS3, Vanilla JS ES6+ | Native Browser | Antarmuka ganda: `index.html` (Admin) & `guest.html` (Monitoring) |
| **Styling & Icons** | Tailwind CSS CDN + FontAwesome 6 | Tailwind v3 (CDN), FA 6.4.0 | Responsive grid, dark cyber-industrial theme, Glassmorphism |
| **Font Typography** | Inter Variable Woff2 & Google CDN | Local asset & Google Fonts | Fallback lokal di `assets/font/Inter-Variable.woff2` |
| **Backend Proxy** | PowerShell HTTP Listener | PowerShell 5.1+ (`server.ps1`) | Menyediakan static file hosting, API auth, AI proxy, dan CORS |
| **Database** | Firebase Realtime Database | Firebase JS SDK v9.22.0 (compat) | Sinkronisasi real-time sorting counter, log transaksi, & device state |
| **Computer Vision** | Google Teachable Machine / TF.js | TensorFlow.js v1.3.1 + TM Image v0.8 | Model pengenalan objek warna (Kuning, Biru, Merah) |
| **Hardware Link** | Web Bluetooth Low Energy (BLE) | W3C Web Bluetooth API | Komunikasi nirkabel dengan BBC micro:bit via Nordic UART Service |
| **AI Assistant** | Multi-tiered Fallback Pipeline | Gemini / Groq / Pollinations / Deterministic | R-AI Assistant (Jarvis) dengan failover bertingkat |
| **Reporting / Export** | jsPDF, SheetJS, docx.js | jsPDF 2.5.1, XLSX 0.18.5, docx 8.5.0 | Ekspor instan dokumen PDF, Excel, Word, dan CSV |
| **Test Runner** | Node.js Native Test Runner | Node.js v24.13.0 (`node:test`) | Pengujian otomatis zero-dependency |

### 2.2 Inventarisasi Berkas Proyek
| File / Direktori | Tipe | Peran & Fungsi Utama |
| :--- | :--- | :--- |
| `index.html` | HTML / JS / CSS | Portal utama Administrator: Kontrol sistem, kamera AI, BLE, kalibrasi robot, otomasi aturan, ekspor. |
| `guest.html` | HTML / JS / CSS | Portal Tamu / Monitoring: Read-only live metrics, live feed sorting, R-AI guest assistant, ekspor laporan. |
| `server.ps1` | PowerShell Script | HTTP server lokal multi-threaded, proxy AI API ke Groq/Gemini, verifikasi password admin. |
| `rai-knowledge.js` | JavaScript | Pustaka data deterministik R-AI, kamus respon cerdas, pemetaan warna, dan mitigasi privasi. |
| `keys.example.json` | Konfigurasi JSON | Template kredensial aman untuk API keys (Groq, Gemini, Firebase). |
| `MULAI-RLAB.bat` | Batch Script | Script peluncuran satu klik untuk mengaktifkan `server.ps1` dan membuka browser default. |
| `vercel.json` | Konfigurasi Cloud | Aturan routing serverless Vercel dan HTTP security headers. |
| `teachable_machine_url.txt`| Dokumen Konfigurasi | URL referensi model machine learning Google Teachable Machine. |
| `tests/*.test.js` | Automated Tests | Suite pengujian otomatis untuk sanitasi formula, NLP R-AI, rule engine, dan otentikasi. |
| `docs/*.md` | Dokumentasi Teknis | Dokumentasi arsitektur, database, keamanan, rencana pengujian, dan panduan deployment. |

---

## 3. AUDIT FITUR & FUNGSIONALITAS RINCI

### 3.1 Portal Administrator (`index.html`)
1. **Otentikasi & Keamanan Sesi:**
   - Proteksi akses admin menggunakan hash kriptografis SHA-256 (`4a9ca459...`).
   - Verifikasi melalui endpoint backend `/api/auth` dengan fallback verifikasi hash di sisi klien menggunakan Web Crypto API.
   - Sesi terenkapsulasi di `sessionStorage` dengan mekanisme auto-lockout.
2. **Konektivitas Hardware (Web Bluetooth API):**
   - Mendukung scanning dan koneksi nirkabel ke BBC micro:bit via Nordic UART Service (NUS).
   - Pengiriman sinyal string kontrol pergerakan servo dan motor DC conveyor.
   - Penanganan pembatalan dialog oleh pengguna (`NotFoundError`) tanpa memicu error unhandled.
3. **Pipeline AI Vision & Deteksi Objek:**
   - Integrasi kamera live via `navigator.mediaDevices.getUserMedia`.
   - Inferensi real-time berbasis TensorFlow.js dengan model Teachable Machine.
   - Mode inferensi adaptif: *Continuous Sorting Mode* dan *Snapshot Trigger Mode*.
4. **Otomasi & Rule Engine:**
   - Evaluasi kondisi dinamis: target kuantitas tercapai, rasio kesalahan (error threshold), durasi idle.
   - Tindakan otomatis: Stop conveyor, ubah mode lengan robot, picu ekspor laporan otomatis.
5. **Manajemen Data & Cloud Sync:**
   - Integrasi Firebase Realtime Database dengan metode `push()` ber-ID unik untuk mencegah race conditions.
   - Fitur Clear Cloud Data dengan proteksi konfirmasi password admin.
6. **Sistem Pelaporan Multi-Format:**
   - Ekspor data sorting ke PDF (desain tata letak visual), Excel (XLSX), Word (DOCX terstruktur), dan CSV terenkapsulasi.

### 3.2 Portal Tamu / Monitoring (`guest.html`)
1. **Pemisahan Hak Akses (Read-Only Enforcement):**
   - Seluruh kontrol perangkat (start/stop conveyor, kalibrasi servo, clear database) ditiadakan.
   - Konsumsi metrik live secara pasif dari Firebase Realtime Database.
2. **Visualisasi Data Interaktif:**
   - Kartu metrik live: Total Objek, Kuning, Biru, Merah, Error, Akurasi Sistem.
   - Grafik distribusi donat dan grafik riwayat throughput per waktu (Chart.js).
   - Filter Live History instan (Semua, Kuning, Biru, Merah, Error).
3. **R-AI Guest Interactive Assistant:**
   - Membantu pengunjung pameran/auditor menanyakan statistik pabrik menggunakan bahasa alami (teks atau suara).
   - Proteksi privasi bawaan: Tidak akan membocorkan struktur kredensial atau password sistem.

---

## 4. TEMUAN AUDIT KEAMANAN & DEFEK KODE (SEBELUM & SESUDAH PERBAIKAN)

| ID Defek | Kategori | Tingkat Keparahan | Kondisi Sebelum Audit | Solusi & Status Pasca-Perbaikan |
| :--- | :--- | :--- | :--- | :--- |
| **WEB-001** | Kredensial / Auth | **P0 (Kritis)** | Password admin tersimpan secara plaintext (`ADMIN_PASS = "098765"`) di JavaScript publik. | **SELESAI**: Dikonversi ke hash SHA-256 dengan verifikasi backend `/api/auth` dan Web Crypto API fallback. |
| **WEB-002** | Database Security | **P0 (Kritis)** | Firebase Realtime Database rentan penulisan tidak sah jika Security Rules default berstatus terbuka (`.write: true`). | **SELESAI**: Skema aturan keamanan terstruktur (`rules.json`) didefinisikan dengan validasi skema ketat. |
| **WEB-003** | Server Resilience | **P0 (Kritis)** | `server.ps1` langsung crash (`exit 1`) jika file `_secrets/keys.json` tidak ada di direktori kerja. | **SELESAI**: Dirombak agar menjalankan *graceful fallback* ke mode server statis & offline AI, disertai `keys.example.json`. |
| **WEB-004** | Integritas Data | **P0 (Kritis)** | Penulisan Firebase menggunakan array indexing manual `[category][length - 1]` yang saling menimpa data pada multi-client. | **SELESAI**: Direfaktorisasi menggunakan `push()` dengan runId unik, timestamp ISO, dan metadata durasi proses. |
| **WEB-010** | Konfigurasi AI | **P1 (Tinggi)** | URL Google Teachable Machine memiliki inkonsistensi penamaan parameter path. | **SELESAI**: URL disinkronkan dan distandarisasi ke format canonical resmi. |
| **WEB-012** | UX Hardware Comm | **P1 (Tinggi)** | Pembatalan pemindaian Bluetooth oleh pengguna memunculkan notifikasi merah "Koneksi Gagal". | **SELESAI**: Error `NotFoundError` ditangkap secara spesifik dan direspons dengan notifikasi info ramah pengguna. |
| **WEB-020** | Asset Paths | **P2 (Menengah)** | Path font lokal salah ketik (`assets/fonts/` bukan `assets/font/`). | **SELESAI**: Diperbaiki ke path direktori yang valid `assets/font/Inter-Variable.woff2`. |
| **WEB-021** | Dead Code / Export | **P2 (Menengah)** | Tombol Word DOCX tidak tersedia di modal antarmuka dan pustaka `docx` belum dimuat di HTML. | **SELESAI**: Pustaka `docx.umd.js` diintegrasikan via CDN, tombol Word ditambahkan, dan MIME didaftarkan di server. |
| **WEB-023** | Defek Ekspor | **P2 (Menengah)** | Fungsi `exportExcel` salah dialiaskan ke `exportCSV()`. | **SELESAI**: Diarahkan dengan benar ke pustaka SheetJS (`exportXLSX()`). |
| **WEB-024** | UI Dashboard | **P2 (Menengah)** | Live history feed tidak memiliki tombol filter interaktif per kategori warna. | **SELESAI**: Tombol filter interaktif (Semua, Kuning, Biru, Merah, Error) diimplementasikan di admin & guest. |

---

## 5. KESIMPULAN AUDIT

Setelah perbaikan menyeluruh ini, platform website dan software VERNOVA kini berada dalam kondisi **siap produksi (production-ready)**, stabil, aman dari kebocoran kredensial sederhana, tahan terhadap kegagalan jaringan/server eksternal, dan dilengkapi dokumentasi arsitektur serta pengujian otomatis yang solid.
