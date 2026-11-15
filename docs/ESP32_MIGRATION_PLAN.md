# RENCANA & STRATEGI MIGRASI ESP32 WI-FI (MIGRATION PLAN)
**Proyek:** VERNOVA — R-LAB Smart Sorting Factory  
**Target:** Transisi penuh dari micro:bit Web Bluetooth ke ESP32 Wi-Fi LAN  
**Versi:** 2.1.0  

---

## 1. TUJUAN & LATAR BELAKANG

Sistem lama menggunakan Web Bluetooth Low Energy (Nordic UART Service) yang menghubungkan browser ke BBC micro:bit. Walaupun fungsional, arsitektur lama memiliki keterbatasan:
1. **Ketergantungan Ketat Browser:** W3C Web Bluetooth hanya didukung oleh Google Chrome/Edge di desktop dan memerlukan konteks HTTPS/localhost.
2. **Buffer Stream Karakter:** Karakter tunggal (`'K'`, `'B'`, `'M'`) rawan mengalami *packet fragmentation* pada buffer serial tanpa integritas checksum.
3. **Keterbatasan Fleksibilitas Jaringan:** Tidak dapat diakses dari perangkat tablet/smartphone tanpa Web Bluetooth aktif.

Migrasi ke **ESP32 Wi-Fi HTTP REST API** memberikan stabilitas jaringan nirkabel standar industri, dukungan JSON terstruktur, dan kemudahan pengujian simulasi tanpa alat fisik.

---

## 2. FASE EKSEKUSI MIGRASI (PHASE BREAKDOWN)

### Fase A: Audit & Desain Protokol (SELESAI)
- Mengaudit pemanggilan `navigator.bluetooth` dan `sendToMicrobit` pada `index.html`.
- Menetapkan protokol HTTP REST API dengan format pesan JSON.
- Menyusun dokumen spesifikasi arsitektur dan protokol.

### Fase B: Pembuatan Modul Komunikasi (SELESAI)
- Mengembangkan kelas adapter `Esp32Client` di `assets/js/esp32-client.js`.
- Mengimplementasikan mode simulasi mock bawaan (*zero-dependency*).
- Menambahkan proxy perantara `/api/esp32` pada `server.ps1`.

### Fase C: Integrasi Sistem & UI Dashboard (SELESAI)
- Mengganti tombol koneksi Bluetooth dan status pill dengan `#status-esp32`.
- Menambahkan Modal Konfigurasi Wi-Fi ESP32 (`#esp32-modal`) dengan telemetri live.
- Menghubungkan loop inferensi AI Vision Teachable Machine ke `window.esp32Client.sendSortingCommand`.
- Memperbarui skema penulisan log Firebase RTDB dengan field `esp32DeviceId`, `commandId`, dan `executionStatus`.

### Fase D: Pengujian Software & Mutu (SELESAI)
- Menyusun 8 kasus pengujian otomatis baru di `tests/esp32_client.test.js`.
- Memvalidasi sanitasi input, toleransi error jaringan, penolakan warna liar, dan watchdog timeout.
- Menjalankan seluruh 28 pengujian unit (100% Lulus).

### Fase E: Penyediaan Firmware Referensi & Panduan Lapangan (SELESAI)
- Membuat source code Arduino C++ di `firmware/esp32_vernova_sorting/esp32_vernova_sorting.ino`.
- Menyusun panduan perakitan dan konfigurasi di `docs/ESP32_SETUP_GUIDE.md`.

---

## 3. RENCANA PEMULIHAN (ROLLBACK PLAN)

Repositori dikelola dengan Git secara ketat. Jika terjadi anomali atau kebutuhan demonstrasi darurat menggunakan BBC micro:bit lama:
1. Komit baseline Bluetooth tersimpan aman di riwayat Git pada komit `1ae5ff0`.
2. Proyek dapat dikembalikan kapan saja dengan perintah:
   ```powershell
   git checkout 1ae5ff0 -- index.html
   ```
3. Namun, dengan adanya **Mode Simulasi** pada `esp32-client.js`, sistem baru dapat berjalan 100% mandiri tanpa hardware fisik, mengeliminasi kebutuhan untuk rollback.
