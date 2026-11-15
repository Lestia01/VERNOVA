# TINJAUAN KEAMANAN KOMUNIKASI WI-FI ESP32 (SECURITY REVIEW)
**Proyek:** VERNOVA — R-LAB Smart Sorting Factory  
**Fokus:** Keamanan Jaringan Wi-Fi, Otorisasi Kontrol Robotik, & Integritas Data  
**Status:** AUDITED & HARDENED  

---

## 1. EVALUASI RISIKO & MITIGASI KEAMANAN

### 1.1 Pencegahan Akses Kontrol Liar oleh Tamu (Guest Authorization)
- **Risiko:** Pengunjung yang membuka portal monitoring publik (`guest.html`) berpotensi mengirim perintah pergerakan aktuator ke ESP32.
- **Mitigasi:**
  - Halaman `guest.html` sama sekali tidak memuat pustaka `esp32-client.js` dan tidak memiliki tombol pengiriman perintah aktuasi.
  - Peran tamu hanya diizinkan membaca snapshot agregat melalui listener Firebase Realtime Database pasif.

### 1.2 Proteksi Kredensial & Sandi Wi-Fi (Credential Management)
- **Risiko:** Password Wi-Fi tertanam (*hardcoded*) di dalam JavaScript publik atau terunggah ke repositori GitHub.
- **Mitigasi:**
  - Web frontend tidak menyimpan SSID atau kata sandi Wi-Fi router. Pengguna hanya mengonfigurasi alamat IP/Host ESP32 (`http://192.168.4.1`).
  - Berkas firmware `esp32_vernova_sorting.ino` menggunakan placeholder kosong untuk kredensial jaringan sekolah (`STA_SSID = ""` dan `STA_PASS = ""`), menjamin tidak ada kredensial jaringan privat yang bocor.
  - Berkas rahasia tetap dikecualikan melalui `.gitignore`.

### 1.3 Penegakan CORS & Batasan Jaringan (Network & Cross-Origin Security)
- **Prinsip Penting:** CORS bukanlah mekanisme autentikasi. Header `Access-Control-Allow-Origin: *` pada ESP32 digunakan untuk mengizinkan browser lokal membaca respons JSON dari origin `http://localhost:8080`.
- **Mitigasi Serangan Luar:**
  - ESP32 beroperasi di jaringan lokal terisolasi (*air-gapped / local subnet*). Port 80 ESP32 **TIDAK PERNAH** diekspos melalui port forwarding router ke internet publik.
  - Akses kontrol robot hanya dapat dilakukan oleh perangkat yang terhubung ke hotspot Wi-Fi fisik `VERNOVA-ROBOT` atau berada dalam subnet LAN sekolah yang sama.

### 1.4 Pencegahan Banjir Perintah (Rate Limiting & Command Flooding)
- **Risiko:** Inferensi webcam berkecepatan 30 FPS berisiko memicu pengiriman ratusan perintah HTTP POST per detik ke ESP32, menyebabkan memory exhaustion (OOM) atau kerusakan mekanis pada motor servo.
- **Mitigasi:**
  - Implementasi **Cooldown Latch**: Variabel `state.isCoolingDown` diaktifkan seketika setelah deteksi valid diproses, mengunci inferensi berikutnya selama minimal 1000ms hingga pergerakan servo selesai.
  - Watchdog timer 12 detik mencegah kebuntuan (*deadlock*) jika terjadi anomali transmisi.

### 1.5 Validasi Payload di Sisi ESP32 (Server-Side Input Sanitization)
- **Mitigasi:**
  - Firmware ESP32 memvalidasi field `color` secara ketat. Perintah selain `"kuning"`, `"biru"`, dan `"merah"` langsung ditolak dengan status HTTP 400 Bad Request tanpa menggerakkan pin PWM servo.
