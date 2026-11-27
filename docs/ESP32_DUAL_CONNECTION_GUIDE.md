# Panduan Setup ESP32 Dual Connection (Wi-Fi + Bluetooth BLE)
## VERNOVA Smart Factory — Kompatibilitas Protokol micro:bit

Dokumen ini menjelaskan implementasi koneksi ganda (**Wi-Fi** dan **Bluetooth Low Energy / BLE**) pada mikrokontroler **ESP32 DevKit V1 / WROOM-32**, yang dirancang 100% kompatibel dengan kontrak protokol BBC micro:bit MakeCode BLE UART yang sudah ada pada website VERNOVA Smart Factory.

---

## 1. Arsitektur Komunikasi

Sistem VERNOVA Smart Factory kini mendukung 3 opsi perangkat fisik dan 1 mode simulasi:
1. **BBC micro:bit (Bluetooth BLE)**: Berkomunikasi via Nordic UART Service (NUS).
2. **ESP32 DevKit V1 (Wi-Fi)**: Berkomunikasi via HTTP REST API pada jaringan lokal / Hotspot SoftAP.
3. **ESP32 DevKit V1 (Bluetooth BLE)**: Berkomunikasi via Nordic UART Service (NUS GATT) dengan format pesan teks identik micro:bit.
4. **Virtual Hardware**: Mode simulasi software tanpa perangkat fisik aktif untuk demonstrasi.

```
                    +------------------------------------+
                    | Website VERNOVA Dashboard & AI     |
                    | (TM / YOLO / Kontrol Manual)      |
                    +------------------------------------+
                                      |
                      dispatchSortingCommand({color, mode})
                                      |
                         +------------+------------+
                         |  DeviceConnectionManager|
                         +------------+------------+
                                      |
             +------------------------+------------------------+
             |                        |                        |
             v                        v                        v
    +-----------------+      +-----------------+      +-----------------+
    |MicrobitBLEAdapter|     | ESP32WiFiAdapter|      | ESP32BLEAdapter |
    +-----------------+      +-----------------+      +-----------------+
             |                        |                        |
       Web Bluetooth            HTTP REST API            Web Bluetooth
        (Nordic UART)            (Port 80)               (Nordic UART)
             |                        |                        |
             v                        v                        v
      BBC micro:bit             ESP32 (Wi-Fi)            ESP32 (BLE)
    (MakeCode NUS)           (HTTP WebServer)         (NUS GATT Server)
             |                        |                        |
             +------------------------+------------------------+
                                      |
                       [ Eksekusi Sortir & Motor ]
```

---

## 2. Kontrak Protokol & Format Pesan (Identik micro:bit)

ESP32 Bluetooth BLE menggunakan UUID standar Nordic UART Service (NUS) yang sama persis dengan BBC micro:bit:
- **Service UUID:** `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- **Characteristic RX (Web -> ESP32 Write):** `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
- **Characteristic TX (ESP32 -> Web Notify):** `6e400003-b5a3-f393-e0a9-e50e24dcca9e`

### Format Perintah Masuk (Web -> Robot):
Seluruh perintah dikirim dalam bentuk string teks berakhiran karakter newline delimiter `\n`:

| Perintah | Deskripsi | Aksi Perangkat Keras |
| :--- | :--- | :--- |
| `kuning\n` | Sortir objek warna kuning | Servo 1 Flap bergerak ke 40°, motor conveyor aktif |
| `biru\n` | Sortir objek warna biru | Servo 1 Flap bergerak ke 90°, motor conveyor aktif |
| `merah\n` | Sortir objek warna merah | Servo 1 Flap bergerak ke 140°, motor conveyor aktif |
| `servo\n` | Ganti mode aktuator ke Servo | Aktuator pemilah jalur (Gate/Flap) |
| `arm\n` | Ganti mode aktuator ke Arm | Aktuator dorong lengan robot (Servo 2) |
| `stop\n` | Emergency Stop | Motor ENA/IN LOW, kedua servo kembali ke posisi aman |
| `test\n` | Test Pulse Ping | LED indikator GPIO 2 berkedip |

### Format Respons & Telemetri Balik (Robot -> Web):
ESP32 memancarkan notifikasi BLE berakhiran `\n` yang diparse langsung oleh website:
- `DONE:KUNING\n`, `DONE:BIRU\n`, `DONE:MERAH\n` -> Konfirmasi penyelesaian sortir.
- `ACK:ARM:READY\n`, `ACK:SERVO:READY\n` -> Konfirmasi pergantian mode kerja.
- `ACK:STOPPED\n` -> Konfirmasi emergency stop.
- `ACK:TEST:OK\n` -> Konfirmasi test pulse ACK.
- `STATUS:BELT_MOVING\n`, `STATUS:ARM_WORKING\n`, `STATUS:SERVO_DONE\n`, `STATUS:READY\n` -> Pembaruan status stage.
- `SENSOR:MERAH:OBJECT_PRESENT\n`, `SENSOR:OBJECT_ABSENT\n` -> Telemetri sensor optik.

---

## 3. Pemetaan Pin Perangkat Keras (GPIO Pinout)

Firmware ESP32 (`firmware/esp32_wifi_sorting/esp32_wifi_sorting.ino`) telah dipetakan secara terstandarisasi:

| Nama Komponen | Pin ESP32 | Mode GPIO | Keterangan |
| :--- | :--- | :--- | :--- |
| **Sensor Warna Merah** | **GPIO 14** | `INPUT_PULLUP` | Sensor optik/proximity jalur merah |
| **Sensor Warna Biru** | **GPIO 13** | `INPUT_PULLUP` | Sensor optik/proximity jalur biru |
| **Sensor Warna Kuning** | **GPIO 35** | `INPUT` | Sensor jalur kuning (Input-only pada ESP32) |
| **Sensor Objek ARM** | **GPIO 34** | `INPUT` | Sensor deteksi objek sebelum ARM (Input-only) |
| **Motor Conveyor ENA** | **GPIO 25** | `OUTPUT` | Enable / PWM kecepatan motor |
| **Motor Conveyor IN** | **GPIO 26** | `OUTPUT` | Arah / kendali motor conveyor belt |
| **Servo 1 (Flap Jalur)** | **GPIO 18** | `PWM (ESP32Servo)` | Sudut: 40° (Kuning), 90° (Biru), 140° (Merah) |
| **Servo 2 (Lengan ARM)** | **GPIO 19** | `PWM (ESP32Servo)` | Sudut: 20° (Standby/Aman), 120° (Mendorong) |
| **LED Indikator Onboard**| **GPIO 2** | `OUTPUT` | Menyala saat BUSY / terhubung BLE |

---

## 4. Cara Penggunaan di Website

1. Buka website VERNOVA Smart Factory di Google Chrome atau Microsoft Edge.
2. Klik tombol **HUBUNGKAN** di navbar atas:
   - Pilih **BBC micro:bit (Bluetooth)** untuk menghubungkan micro:bit BLE.
   - Pilih **ESP32 DevKit (Wi-Fi)** untuk koneksi via IP lokal (misal `http://172.25.15.108`).
   - Pilih **ESP32 DevKit (Bluetooth BLE)** untuk koneksi nirkabel Bluetooth langsung ke ESP32 tanpa router.
3. Dialog pop-up browser akan muncul untuk memindai perangkat BLE (`VERNOVA-ESP32`).
4. Setelah terhubung, status badge di header akan berubah menjadi **ESP32 (BLE): ON** atau **ESP32 (Wi-Fi): ON**.
5. Sistem AI (Teachable Machine dan YOLO Studio) serta stasiun kontrol sortir manual akan langsung beroperasi melalui koneksi aktif tanpa perlu konfigurasi tambahan.
