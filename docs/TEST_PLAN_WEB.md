# RENCANA PENGUJIAN PERANGKAT LUNAK (TEST PLAN)
**Proyek:** VERNOVA — R-LAB Smart Sorting Factory  
**Versi Dokumen:** 2.0  
**Tujuan:** Menetapkan strategi, cakupan, dan skenario pengujian untuk memvalidasi stabilitas, integritas data, dan keamanan aplikasi web VERNOVA.  

---

## 1. STRATEGI & RUANG LINGKUP PENGUJIAN

Pengujian dilakukan menggunakan pendekatan berlapis (*layered testing strategy*):
1. **Automated Unit & Regression Tests:** Berjalan tanpa ketergantungan eksternal (*zero-dependency*) menggunakan test runner bawaan Node.js (`node:test` dan `node:assert/strict`).
2. **Integration Tests:** Menguji alur pertukaran data antara parser logika, modul sanitasi, dan mesin aturan.
3. **Manual Verification & Edge Case Matrix:** Verifikasi visual antarmuka browser, dialog Web Bluetooth, aliran webcam, dan respon Firebase Realtime Database.

---

## 2. MATRIKS SKENARIO PENGUJIAN OTOMATIS (AUTOMATED TEST MATRIX)

| ID Uji | Modul Uji | Skenario / Deskripsi | Input Uji | Ekspektasi Hasil |
| :--- | :--- | :--- | :--- | :--- |
| **TEST-SEC-01** | `security_auth` | Verifikasi password admin yang benar | `"098765"` | Hash SHA-256 cocok persis dengan `ADMIN_PASS_HASH`. Hasil `true`. |
| **TEST-SEC-02** | `security_auth` | Penolakan password admin yang salah | `"wrong_password"`, `"123456"`, `""` | Hash SHA-256 tidak cocok. Hasil `false`. |
| **TEST-EXP-01** | `export_sanitization` | Mitigasi formula diawali tanda sama dengan (`=`) | `"=SUM(A1:A10)"` | Mengembalikan `"'=SUM(A1:A10)"` (disanitasi dengan petik tunggal). |
| **TEST-EXP-02** | `export_sanitization` | Mitigasi formula diawali tanda `+`, `-`, `@`, `\t` | `"+cmd|'/c calc'!A1"`, `"-5+2"`, `"@test"` | Seluruh karakter awalan berbahaya diprefiks tanda petik tunggal (`'`). |
| **TEST-EXP-03** | `export_sanitization` | Penanganan data normal non-formula | `"Kuning"`, `"2026-11-11"`, `94.5` | Tidak mengalami mutasi string; data asli dipertahankan. |
| **TEST-EXP-04** | `export_sanitization` | Penanganan nilai `null` dan `undefined` | `null`, `undefined` | Mengembalikan string kosong `""` tanpa memicu TypeError. |
| **TEST-CSV-01** | `export_sanitization` | Enkapsulasi teks CSV berisi koma | `"Kuning, Grade A"` | Dibungkus tanda petik ganda: `"\"Kuning, Grade A\""`. |
| **TEST-CSV-02** | `export_sanitization` | Escape tanda petik dua ganda pada CSV | `"Box \"Mega\""` | Tanda petik digandakan: `"\"Box \"\"Mega\"\"\""`. |
| **TEST-CSV-03** | `export_sanitization` | Enkapsulasi baris baru (newline) pada CSV | `"Baris 1\nBaris 2"` | Dibungkus petik ganda untuk menjaga struktur baris CSV. |
| **TEST-RAI-01** | `rai_knowledge` | Normalisasi pengenalan nama warna | `"kuning"`, `"yellow"`, `"biru"`, `"blue"` | Dipetakan konsisten ke identifier kanonik sistem. |
| **TEST-RAI-02** | `rai_knowledge` | Interpolasi nilai warna kosong | Objek tanpa properti `kuning` | Menghasilkan nilai default numerik `0` tanpa crash. |
| **TEST-RAI-03** | `rai_knowledge` | Proteksi privasi kata kunci sensitif | `"apa password database"`, `"kunci admin"` | Ditangkap aturan privasi R-AI dan menghasilkan pesan penolakan keamanan. |
| **TEST-RAI-04** | `rai_knowledge` | Respon pengetahuan umum operasional pabrik | `"bagaimana cara kerja mesin"`, `"siapa kamu"` | Menghasilkan respon edukatif mengenai sistem VERNOVA. |
| **TEST-RUL-01** | `rule_engine` | Parsing perintah aksi mode arm robot | `"IF error >= 5 THEN arm mode error"` | Aksi dikenali sebagai perubahan mode arm mekanis. |
| **TEST-RUL-02** | `rule_engine` | Parsing perintah ekspor otomatis | `"IF total >= 100 THEN export pdf"` | Aksi dikenali sebagai pemicu ekspor PDF otomatis. |
| **TEST-RUL-03** | `rule_engine` | Evaluasi penembakan aturan (*rule firing*) | Operator `>=`, ambang batas terpenuhi | Mengembalikan status `fired = true` dan mengeksekusi callback. |

---

## 3. PENGUJIAN KASUS BATAS & KONDISI EKSTRIM (EDGE CASES)

| Kasus Batas (Edge Case) | Kondisi Simulasi | Perilaku Sistem yang Diharapkan |
| :--- | :--- | :--- |
| **Pembatalan Dialog Bluetooth** | Pengguna menekan tombol "Cancel" saat browser meminta izin Web Bluetooth. | Aplikasi menangkap `NotFoundError`, menampilkan toast informasi biru "Pemindaian dibatalkan", tombol kembali ke keadaan "HUBUNGKAN BLUETOOTH", dan tidak ada error merah di konsol. |
| **Kamera Tidak Diizinkan / Error** | Izin kamera ditolak pengguna atau kamera sedang dipakai aplikasi lain. | Tampil pesan peringatan visual "Kamera tidak dapat diakses", kontrol video dinonaktifkan dengan aman, dan tombol "COBA LAGI" tersedia. |
| **Koneksi Jaringan Terputus (Offline)** | Jaringan internet mati total saat aplikasi sedang berjalan. | R-AI Assistant secara otomatis menurunkan tingkat operasional ke Tier 3 (Kamus Pengetahuan Lokal `rai-knowledge.js`), dan notifikasi "Mode Offline" aktif. |
| **File Kunci Server Hilang** | Folder `_secrets/` atau berkas `keys.json` tidak ada di server. | `server.ps1` menampilkan warning oranye pada terminal, tetap melayani file web statis, dan mematikan endpoint proxy API tanpa crash. |
| **Lonjakan Klik Cepat (Rapid Clicks)** | Pengguna mengklik tombol ekspor atau tombol koneksi berulang kali dalam 500ms. | Tombol dinonaktifkan sementara (*throttling/debounce*) dengan indikator loading untuk mencegah duplikasi eksekusi. |

---

## 4. CARA MENJALANKAN PENGUJIAN OTOMATIS

Untuk menjalankan seluruh suite pengujian otomatis, buka terminal PowerShell di root repositori dan ketikkan perintah:

```powershell
node --test tests/*.test.js
```

Kriteria Keberhasilan Pengujian:
- **100% Lolos:** Seluruh 20 kasus uji wajib berstatus pass (`✔`).
- **Nol Toleransi Kegagalan:** Tidak boleh ada kegagalan (`0 fail`) atau pembatalan (`0 cancelled`).
- **Durasi Eksekusi Cepat:** Rata-rata waktu eksekusi total di bawah 2 detik.
