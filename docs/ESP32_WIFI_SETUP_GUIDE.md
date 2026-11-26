# Panduan Integrasi ESP32 Wi-Fi & Multi-Device
## VERNOVA — R-LAB Smart Sorting Factory

Dokumen ini menjelaskan arsitektur, konfigurasi firmware, protokol komunikasi, serta langkah operasional integrasi mikrokontroler ganda (**BBC micro:bit** dan **ESP32 DevKit V1**) pada platform Smart Factory.

---

## 1. Diagram Arsitektur Koneksi

Sistem dirancang dengan pola **Adapter Pattern** yang modular dan terisolasi. Lapisan website dan sistem AI Vision (Google Teachable Machine & YOLO Studio) tidak terikat pada hardware fisik tertentu, melainkan berkomunikasi melalui kontrak terstandarisasi `DeviceConnectionManager`.

```
                    ┌──────────────────────────────────────────────┐
                    │               AI VISION ENGINE               │
                    │   [ Teachable Machine ]  │  [ YOLO Studio ]  │
                    └──────────────────────┬───────────────────────┘
                                           │ dispatchSortingCommand({ color, mode })
                                           ▼
                    ┌──────────────────────────────────────────────┐
                    │          DeviceConnectionManager             │
                    │     (Debounce, AUTO/MANUAL, Switcher)        │
                    └──────────────┬───────────────────────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              │ [Aktif Berdasarkan Pilihan User]        │
              ▼                                         ▼
┌───────────────────────────┐             ┌───────────────────────────┐
│    MicrobitBLEAdapter     │             │      ESP32WiFiAdapter     │
│   (Web Bluetooth GATT)    │             │   (HTTP REST API + JSON)  │
└─────────────┬─────────────┘             └─────────────┬─────────────┘
              │ BLE Radio (Nordic UART)                 │ Wi-Fi LAN / SoftAP
              ▼                                         ▼
┌───────────────────────────┐             ┌───────────────────────────┐
│      BBC micro:bit        │             │      ESP32 DevKit V1      │
│  (MakeCode: kuning\n ...) │             │   (C++ WebServer: /sort)  │
└───────────────────────────┘             └───────────────────────────┘
```

---

## 2. Cara Memilih micro:bit atau ESP32 di Website

1. Klik tombol **Hardware Controller** (ikon chip mikrokontroler `<i class="fas fa-microchip"></i>`) atau pill status **ROBOT** di topbar website.
2. Modal **Hardware Controller (Robot Sortir)** akan terbuka.
3. Klik salah satu kartu pilihan:
   - **BBC micro:bit:** Menggunakan Bluetooth Low Energy (BLE).
   - **ESP32 DevKit V1:** Menggunakan Wi-Fi Local Network (HTTP REST API).
4. Pengaturan perangkat aktif akan disimpan ke browser (`localStorage: rlab_device_type`) sehingga tetap tersimpan saat halaman dimuat ulang.

---

## 3. Konfigurasi Jaringan Wi-Fi ESP32

Firmware ESP32 (`firmware/esp32_wifi_sorting/esp32_wifi_sorting.ino`) mendukung dua mode jaringan:

### A. Mode SoftAP (Hotspot Mandiri ESP32 — Default)
- ESP32 memancarkan jaringan Wi-Fi sendiri:
  - **SSID:** `VERNOVA-ROBOT`
  - **Password:** `vernova123`
  - **Alamat IP Default:** `http://192.168.4.1`
- Cara menghubungkan laptop/PC:
  1. Sambungkan Wi-Fi laptop/PC Anda ke hotspot `VERNOVA-ROBOT`.
  2. Buka website Smart Factory di browser.
  3. Masukkan `http://192.168.4.1` pada input Host ESP32, lalu klik **Hubungkan Perangkat**.

### B. Mode Station (Sambung ke Router / Wi-Fi Sekolah / Hotspot HP)
- Jika laptop dan ESP32 ingin sama-sama terhubung ke router internet lab/sekolah:
  1. Buka file firmware `firmware/esp32_wifi_sorting/esp32_wifi_sorting.ino`.
  2. Isi variabel `STA_SSID` dan `STA_PASS`:
     ```cpp
     const char* STA_SSID = "Wi-Fi-Lab-Sekolah";
     const char* STA_PASS = "passwordWifiLab";
     ```
  3. Flash ulang firmware ke ESP32.

---

## 4. Cara Mengetahui Alamat IP ESP32

1. Buka **Serial Monitor** di Arduino IDE pada baud rate **115200**.
2. Tekan tombol **EN / RST** pada board ESP32.
3. Serial Monitor akan mencetak alamat IP:
   - Jika mode SoftAP: `[Wi-Fi AP] Alamat IP: http://192.168.4.1`
   - Jika mode Station: `[Wi-Fi STA] Terhubung! IP: http://192.168.1.105`

---

## 5. Cara Mengisi Alamat IP di Website

1. Buka modal Hardware Controller di website.
2. Pilih kartu **ESP32 DevKit V1**.
3. Pada kolom **Alamat IP / Host ESP32**, ketik URL IP yang tertera pada Serial Monitor (misal: `http://192.168.4.1` atau `http://192.168.1.105`).
4. Klik tombol **Ping** untuk menguji respon singkat.
5. Klik **Hubungkan Perangkat** untuk mengaktifkan koneksi.

---

## 6. Protokol Komunikasi HTTP REST API (JSON)

Komunikasi antara Website dan ESP32 menggunakan format JSON murni melalui metode HTTP standar:

### A. Health & Telemetri
- **Endpoint:** `GET /api/health` (atau `GET /api/status`)
- **Headers:** `Accept: application/json`
- **Contoh Respon ESP32:**
  ```json
  {
    "ok": true,
    "deviceId": "VERNOVA-ESP32-WIFI",
    "deviceType": "ESP32",
    "firmwareVersion": "2.2.0",
    "state": "READY",
    "mode": "servo",
    "wifiRssi": -55,
    "freeHeap": 245760,
    "uptimeSec": 120,
    "ip": "192.168.4.1"
  }
  ```

### B. Perintah Sortir (Sort Command)
- **Endpoint:** `POST /api/sort`
- **Request Body (JSON):**
  ```json
  {
    "type": "sort",
    "color": "kuning",
    "mode": "servo",
    "objectType": "CYLINDER_CAP",
    "commandId": "CMD_ESP_1795681023_a1b2"
  }
  ```
- **Respon Berhasil (JSON):**
  ```json
  {
    "ok": true,
    "commandId": "CMD_ESP_1795681023_a1b2",
    "color": "kuning",
    "mode": "servo",
    "status": "COMPLETED",
    "executionStatus": "confirmed_esp32_wifi",
    "durationMs": 350
  }
  ```

### C. Pengaturan Mode (Servo / Arm)
- **Endpoint:** `POST /api/mode`
- **Request Body (JSON):**
  ```json
  {
    "type": "mode",
    "mode": "arm"
  }
  ```
- **Respon (JSON):**
  ```json
  {
    "ok": true,
    "mode": "arm"
  }
  ```

### D. Emergency Stop
- **Endpoint:** `POST /api/stop`
- **Request Body (JSON):**
  ```json
  {
    "type": "stop"
  }
  ```
- **Respon (JSON):**
  ```json
  {
    "ok": true,
    "status": "STOPPED",
    "message": "Aktuator dikembalikan ke posisi netral"
  }
  ```

### E. Safe Test Pulse (Ping)
- **Endpoint:** `POST /api/test`
- **Respon (JSON):**
  ```json
  {
    "ok": true,
    "status": "PULSE_ACK",
    "message": "Test pulse sukses"
  }
  ```

---

## 7. Pemisahan Total Konfigurasi Pin Hardware

Website Smart Factory **sama sekali tidak menetapkan pin GPIO khusus**. Anda bebas memetakan aktuator motor servo atau relay ke pin mana pun yang sesuai dengan board Anda.

Konfigurasi pin dilakukan murni di dalam firmware C++ (`firmware/esp32_wifi_sorting/esp32_wifi_sorting.ino`):

```cpp
// Sesuaikan nomor pin GPIO berikut sesuai rangkaian fisik Anda:
#define PIN_SERVO_FLAP    18  // Pin servo pemilah jalur
#define PIN_SERVO_ARM     19  // Pin servo lengan robot
#define PIN_LED_STATUS    2   // Pin LED indikator onboard (GPIO 2)
```

> [!NOTE]
> **Pedoman Pin ESP32:**
> - GPIO 34, 35, 36, dan 39 adalah pin *Input-Only* tanpa pull-up/down internal; jangan gunakan untuk output servo.
> - GPIO 6–11 terhubung ke flash SPI internal; jangan gunakan.
> - Pin GPIO 18, 19, 21, 22, 23, 25, 26, 27 aman digunakan untuk kontrol PWM motor servo.

---

## 8. Panduan Troubleshooting

| Masalah | Kemungkinan Penyebab | Solusi |
| :--- | :--- | :--- |
| **CORS Blocked (Preflight Error)** | Browser memblokir permintaan cross-origin karena header CORS tidak ada. | Firmware kami sudah menyertakan `setCorsHeaders()` dan menangani `OPTIONS` dengan HTTP 204. Pastikan firmware yang di-flash adalah versi terbaru di `firmware/esp32_wifi_sorting/`. |
| **Connection Timed Out** | Laptop tidak berada di satu jaringan dengan ESP32 atau IP salah. | Periksa Wi-Fi laptop. Pastikan terhubung ke `VERNOVA-ROBOT` (jika SoftAP) atau router yang sama. Cek IP di Serial Monitor Arduino IDE. |
| **Mixed Content Warning (HTTPS vs HTTP)** | Website dibuka melalui domain `https://...` di internet publik, sedangkan ESP32 menggunakan `http://192.168.x.x` lokal. | Buka website melalui `http://localhost` atau jalankan web server lokal. Chromium mengizinkan `http://localhost` menghubungi IP private jaringan lokal. |
| **Servo Bergetar Tanpa Bergerak** | Daya dari pin 5V USB ESP32 tidak cukup untuk menggerakkan motor servo. | Gunakan adaptor daya 5V 2A–3A eksternal khusus untuk daya servo. Hubungkan pin GND adaptor ke pin GND ESP32 (Common Ground). |

---

## 9. Langkah Pengujian

### Pengujian Menggunakan Mode Simulasi (Tanpa Hardware Fisik)
1. Buka website Smart Factory.
2. Buka modal Hardware Controller.
3. Centang opsi **Mode Simulasi Virtual Hardware**.
4. Pilih **ESP32 DevKit V1** atau **BBC micro:bit**.
5. Klik **Hubungkan Perangkat**. Status akan langsung berubah menjadi hijau: `ESP32 (Wi-Fi): SIMULASI`.
6. Klik tombol **Manual Sort** (Merah / Kuning / Biru) atau jalankan deteksi kamera; perintah sortir akan dieksekusi secara virtual dan dicatat di dashboard.

### Pengujian Menggunakan Hardware Fisik Nyata
1. Hubungkan ESP32 ke laptop via kabel USB.
2. Buka Arduino IDE, buka `firmware/esp32_wifi_sorting/esp32_wifi_sorting.ino`, lalu unggah (*Upload*).
3. Buka Serial Monitor (115200) dan pastikan hotspot `VERNOVA-ROBOT` aktif.
4. Hubungkan Wi-Fi laptop ke `VERNOVA-ROBOT`.
5. Buka website Smart Factory, pilih **ESP32 DevKit V1**, pastikan toggle simulasi dinonaktifkan.
6. Klik **Hubungkan Perangkat**. Indikator topbar akan berubah menjadi biru: `ESP32 (Wi-Fi): ON`.
7. Uji tombol **Ping** dan perintah manual sortir untuk melihat aktuator servo merespons secara fisik.
