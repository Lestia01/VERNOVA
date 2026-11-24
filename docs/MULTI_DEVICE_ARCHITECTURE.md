# VERNOVA — Arsitektur Sistem Multi-Device & Dual-Connection

Dokumen ini mendokumentasikan spesifikasi teknis arsitektur komunikasi perangkat keras terpadu pada sistem **VERNOVA (R-LAB Smart Sorting Factory)**. Sistem ini memungkinkan pemilihan mikrokontroler (**ESP32 DevKit V1** dan **BBC micro:bit**) serta metode koneksi (**Wi-Fi Lokal** dan **Bluetooth Low Energy - BLE**) secara modular dan dinamis melalui Web Dashboard Admin.

---

## 1. Diagram Arsitektur Sistem

```
┌────────────────────────────────────────────────────────────────────────┐
│                   VERNOVA Web Dashboard & AI Vision                    │
│    (Google Teachable Machine · Real-time Operator UI · LocalStorage)   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                Unified DeviceConnectionManager                         │
│  - Debounce Duplicate Suppression (500ms Cooldown)                     │
│  - Dynamic Adapter Switching & Configuration Persistence               │
│  - Browser Web Bluetooth API Guard & Telemetry Pipeline                │
│  - Legacy esp32Client Backward-Compatibility Proxy                    │
└───────┬───────────────────────────┼────────────────────────────┬───────┘
        │                           │                            │
        ▼                           ▼                            ▼
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│ ESP32WiFiAdapter │      │  ESP32BLEAdapter │      │MicrobitBLEAdapter│
│  HTTP REST API   │      │ BLE Nordic UART  │      │ MakeCode UART    │
│  (GET / POST)    │      │  (JSON Packets)  │      │ (ASCII Strings)  │
└─────────┬────────┘      └─────────┬────────┘      └─────────┬────────┘
          │ (Wi-Fi/LAN)             │ (BLE 2.4GHz)            │ (BLE 2.4GHz)
          ▼                         ▼                         ▼
┌────────────────────────────────────────────┐      ┌──────────────────┐
│              ESP32 DevKit V1               │      │  BBC micro:bit   │
│ - SoftAP (192.168.4.1) / STA Router        │      │ - nRF52833       │
│ - Dual-core PWM Servos (GPIO 18 / 19)      │      │ - MakeCode UART  │
└────────────────────────────────────────────┘      └──────────────────┘
```

---

## 2. Matriks Kompatibilitas Perangkat & Protokol

| Mikrokontroler | Wi-Fi (HTTP REST) | Bluetooth Low Energy (BLE) | Status Dukungan |
| :--- | :--- | :--- | :--- |
| **ESP32 DevKit V1** | **Didukung Penuh** (SoftAP 192.168.4.1 atau router sekolah) | **Didukung Penuh** (Nordic UART Service GATT) | Produksi & Simulasi |
| **BBC micro:bit (V1/V2)** | *Tidak Didukung* (tidak ada chip Wi-Fi onboard) | **Didukung Penuh** (MakeCode Bluetooth UART extension) | Produksi & Simulasi |

> **Catatan Pengamanan UI:** Pada modal konfigurasi admin, apabila BBC micro:bit dipilih, opsi Wi-Fi otomatis dinonaktifkan dan dikunci pada koneksi BLE dengan notifikasi visual yang jelas.

---

## 3. Kompatibilitas Browser (Web Bluetooth API)

Web Bluetooth API (`navigator.bluetooth`) memiliki batasan implementasi platform:

| Browser / Platform | Web Bluetooth API | Catatan Operasional |
| :--- | :--- | :--- |
| **Google Chrome (Desktop)** | **Didukung** | Wajib menggunakan konteks aman (`HTTPS` atau `localhost`). |
| **Microsoft Edge (Desktop)** | **Didukung** | Wajib menggunakan konteks aman (`HTTPS` atau `localhost`). |
| **Opera (Desktop)** | **Didukung** | Mengikuti engine Chromium. |
| **Mozilla Firefox** | *Tidak Didukung* | Web Bluetooth sengaja dinonaktifkan oleh Mozilla karena kebijakan privasi/keamanan. |
| **Apple Safari (macOS/iOS)** | *Tidak Didukung* | WebKit tidak mengimplementasikan Web Bluetooth API. |
| **Mode Simulasi Virtual** | **Didukung di Seluruh Browser** | Berfungsi 100% pada semua browser untuk pengujian fungsional tanpa hardware fisik. |

Dashboard mendeteksi keberadaan `navigator.bluetooth` secara real-time dan menampilkan banner informatif bila pengguna membuka dari browser yang tidak kompatibel.

---

## 4. Spesifikasi Protokol Komunikasi

### A. ESP32 Wi-Fi (HTTP REST)
- **Base URL:** `http://192.168.4.1` (SoftAP default) atau IP jaringan LAN.
- **Endpoints:**
  - `GET /api/status`: Mengembalikan telemetri perangkat, RSSI sinyal, sisa memori heap, dan uptime.
  - `POST /api/sort`: Mengirimkan perintah sortir `{ "commandId": "...", "color": "kuning|biru|merah", "mode": "Servo|Arm" }`.
  - `POST /api/mode`: Mengubah mode kerja aktif (`Servo` atau `Arm`).
  - `POST /api/stop`: Emergency stop & reset aktuator ke posisi netral.

### B. ESP32 Bluetooth Low Energy (BLE)
- **GATT Service:** Nordic UART Service UUID: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- **RX Characteristic (Web -> ESP32 Write):** `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
- **TX Characteristic (ESP32 -> Web Notify):** `6e400003-b5a3-f393-e0a9-e50e24dcca9e`
- **Format Payload:** JSON string berakhiran newline (`\n`):
  - Sortir: `{"cmd":"sort","color":"kuning","mode":"Servo","id":"CMD_..."}\n`
  - Mode: `{"cmd":"mode","mode":"Arm"}\n`
  - Stop: `{"cmd":"stop"}\n`
  - Test Pulse: `{"cmd":"pulse"}\n`

### C. BBC micro:bit Bluetooth Low Energy (MakeCode UART)
- **GATT Service:** Nordic UART Service UUID: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- **Format Payload:** String ASCII sederhana berakhiran newline (`\n`):
  - Kuning: `kuning\n`
  - Biru: `biru\n`
  - Merah: `merah\n`
  - Mode Servo: `servo\n`
  - Mode Arm: `arm\n`
  - Stop: `stop\n`
  - Test: `test\n`

---

## 5. Fitur Keselamatan & Reliability

1. **Debounce Duplicate Suppression (500ms):**
   Mencegah AI Vision Teachable Machine memicu penembakan perintah ganda saat objek yang sama berada di area pandang kamera dalam durasi singkat. Perintah manual dapat melewati batas ini menggunakan flag `force: true`.
2. **Admin Security Guard:**
   Modal `Device & Connection Manager` dilindungi verifikasi otentikasi administrator (`sessionStorage.getItem('rlab_admin_auth') === '1'`). Pengguna publik / guest tidak dapat mengubah konfigurasi koneksi perangkat keras.
3. **Safe Test Pulse:**
   Fitur pengujian konektivitas cepat tanpa memicu pergerakan aktuator sortir penuh yang berisiko menabrak mekanik conveyor.
4. **Virtual Hardware Simulator:**
   Simulasi terintegrasi pada setiap adapter dengan latensi realistis (250–300ms) untuk pengujian otomatis, demonstrasi kelas, dan evaluasi logika.

---

## 6. Status Pengujian Fisik

- **Pengujian Software & Logika Adapter:** **LULUS 100% (62/62 Unit & Integration Tests)**.
- **Pengujian Hardware Fisik:** **BELUM DIUJI FISIK** *(memerlukan board fisik ESP32 DevKit V1 dan BBC micro:bit serta browser Chromium desktop dengan adaptor Bluetooth aktif)*.
