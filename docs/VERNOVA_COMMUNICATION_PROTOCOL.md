# VERNOVA — Protocol Komunikasi & Spesifikasi Antarmuka Perangkat

Dokumen ini mendefinisikan spesifikasi teknis protokol komunikasi antara **VERNOVA Web Application** dengan perangkat keras pengendali (**ESP32 DevKit V1** dan **BBC micro:bit**) untuk sistem sortasi cerdas berbasis AI.

---

## 1. Arsitektur Komunikasi Tingkat Tinggi

```
+-------------------------------------------------------------------------+
|                         VERNOVA Web Application                         |
|  [AI Vision (TM / YOLO)]   [Auto / Manual Switch]   [Device Manager]    |
+------------------------------------+------------------------------------+
                                     |
           +-------------------------+-------------------------+
           | (Wi-Fi HTTP / BLE NUS)                            | (BLE UART)
           v                                                   v
+-----------------------+                           +---------------------+
|   ESP32 DevKit V1     |                           |    BBC micro:bit    |
| - Web Server (HTTP)   |                           | - MakeCode BLE UART |
| - BLE GATT Server     |                           | - Micro:bit GPIO    |
| - Actuator Controllers|                           | - Servos / Arm      |
+-----------------------+                           +---------------------+
```

Sistem mengadopsi **Two-Stage Execution Cycle**:
1. **Stage 1 (Mekanisme):** Website mengirimkan konfigurasi mekanisme target (`ARM` / `SERVO`). Aktuator memvalidasi kesiapan mekanis dan membalas dengan status `READY`.
2. **Stage 2 (Sortasi):** Website mengirimkan target warna (`MERAH` / `KUNING` / `BIRU`). Aktuator mengeksekusi gerakan mekanis dan membalas konfirmasi eksekusi fisik.
3. **Stage 3 (Verifikasi Sensor):** Sensor deteksi fisik (IR / proximity switch) memvalidasi objek benar-benar masuk wadah sortasi yang sesuai.

---

## 2. Status Kategori & Siklus Transaksi (State Machine)

### 2.1 Definisi Kategori Status (Status Categories)

Untuk menjaga integritas data dan analitik industri, VERNOVA memisahkan prediksi AI dari hasil fisik perangkat secara ketat:

| Status Category | Kode Internal | Penjelasan Operasional |
| :--- | :--- | :--- |
| `detected` | `DETECTED` | Objek terdeteksi oleh kamera (Teachable Machine / YOLO) dengan confidence di atas ambang batas. Belum ada perintah yang dikirim. |
| `command_sent` | `COMMAND_SENT` | Perintah telah ditransmisikan dari website via HTTP REST atau BLE GATT/UART. |
| `command_acknowledged` | `COMMAND_ACKNOWLEDGED` | Mikrokontroler telah menerima payload perintah dan mengirimkan sinyal ACK awal. **Bukan verifikasi fisik.** |
| `sorting` | `SORTING` | Mikrokontroler sedang menggerakkan motor servo / lengan robot. |
| `completed_unverified` | `COMPLETED_UNVERIFIED` | Gerakan motor/arm selesai dilaporkan perangkat, namun tidak ada sensor konfirmasi fisik yang terpasang atau sensor belum terpicu. |
| `verified` | `VERIFIED` | Sortasi selesai dan terkonfirmasi valid oleh sensor fisik (IR / Limit Switch) di jalur pembuangan. |
| `failed` | `FAILED` | Perangkat mengembalikan status error, format perintah salah, atau gerakan motor gagal. |
| `timeout` | `TIMEOUT` | Perangkat tidak membalas dalam batas waktu toleransi (`ACK Timeout` = 3000ms, `Execution Timeout` = 8000ms). |
| `unknown` | `UNKNOWN` | Respon perangkat tidak dapat di-parse atau koneksi putus mendadak di tengah transaksi. |

### 2.2 Diagram Alur Siklus Transaksi

```
[ IDLE ]
   │  (AI Detection / Tombol Manual)
   ▼
[ COMMAND_QUEUED ] (Generate UUID `txn_...`)
   │  (Stage 1: Kirim Mekanisme)
   ▼
[ AWAITING_MECHANISM_ACK ] ──(Timeout / Error)──► [ TIMEOUT / FAILED ]
   │  (ACK Diterima: { ready: true })
   ▼
[ AWAITING_CLASS_ACK ]     ──(Timeout / Error)──► [ TIMEOUT / FAILED ]
   │  (ACK Diterima: { status: "SORTING" })
   ▼
[ SORTING ]
   │  (Gerakan Motor Selesai)
   ▼
[ VERIFYING ]
   ├──(Sensor IR Terpicu)───────► [ VERIFIED ]
   └──(Tanpa Sensor Terpasang)──► [ COMPLETED_UNVERIFIED ]
```

---

## 3. Protokol ESP32 — Wi-Fi HTTP REST API

ESP32 beroperasi sebagai HTTP Server lokal (Port default: `80`).

### 3.1 Endpoint Referensi

#### `GET /api/status`
Digunakan untuk heartbeat polling dan pengecekan kesehatan perangkat.

- **Request:** `GET http://<esp32-ip>/api/status`
- **Response (200 OK):**
```json
{
  "status": "ONLINE",
  "device": "ESP32_VERNOVA_ROBOT",
  "firmware": "2.6.0-wifi",
  "ip": "192.168.1.150",
  "rssi": -58,
  "uptimeSeconds": 1420,
  "activeMechanism": "arm",
  "mode": "AUTO",
  "busy": false
}
```

#### `POST /api/mechanism` (Stage 1)
Mengatur kesiapan mekanisme aktif sebelum instruksi warna diberikan.

- **Request:**
  - Header: `Content-Type: application/json`
  - Body:
```json
{
  "mechanism": "arm",
  "mode": "AUTO",
  "transactionId": "txn_1732520000000_abc1"
}
```
- **Response Sukses (200 OK):**
```json
{
  "ok": true,
  "transactionId": "txn_1732520000000_abc1",
  "mechanism": "arm",
  "mode": "AUTO",
  "status": "READY",
  "ready": true
}
```
- **Response Gagal (400 Bad Request):**
```json
{
  "ok": false,
  "error": "INVALID_MECHANISM",
  "message": "Mekanisme harus 'arm' atau 'servo'"
}
```

#### `POST /api/sort` (Stage 2)
Menginstruksikan aktuator melakukan pemilahan berdasarkan warna.

- **Request:**
  - Header: `Content-Type: application/json`
  - Body:
```json
{
  "color": "kuning",
  "mechanism": "arm",
  "transactionId": "txn_1732520000000_abc1",
  "timestamp": 1732520000100
}
```
- **Response Selesai (200 OK):**
```json
{
  "ok": true,
  "transactionId": "txn_1732520000000_abc1",
  "color": "kuning",
  "mechanism": "arm",
  "status": "COMPLETED",
  "sensorVerified": false,
  "executionDurationMs": 1450
}
```

#### `POST /api/mode`
Mengubah status mode kerja di tingkat mikrokontroler.

- **Request:** `{"mode": "MANUAL"}`
- **Response:** `{"ok": true, "mode": "MANUAL"}`

#### `POST /api/stop`
Menghentikan seluruh motor dan conveyor secara darurat (*Emergency Stop*).

- **Request:** `POST http://<esp32-ip>/api/stop`
- **Response:** `{"ok": true, "status": "EMERGENCY_STOPPED"}`

---

## 4. Protokol ESP32 — Bluetooth BLE GATT (Nordic UART Service)

ESP32 mengiklankan layanan GATT standar BLE NUS untuk komunikasi latensi rendah nirkabel tanpa koneksi router Wi-Fi.

- **Service UUID:** `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- **RX Characteristic UUID (Write Without Response / Write):** `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`
- **TX Characteristic UUID (Notify):** `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`

### 4.1 Format Payload Website → ESP32 (RX Write)

Format payload selalu berupa JSON string berujung `\n`:

1. **Stage 1 — Mekanisme:**
```json
{"cmd":"mechanism","mechanism":"servo","transactionId":"txn_173252001"}
```

2. **Stage 2 — Sortasi:**
```json
{"cmd":"sort","color":"merah","mechanism":"servo","transactionId":"txn_173252001"}
```

3. **Emergency Stop:**
```json
{"cmd":"stop"}
```

### 4.2 Format Telemetri ESP32 → Website (TX Notify)

ESP32 mengirimkan notifikasi balik berupa JSON string:

1. **Ack Mekanisme:**
```json
{"type":"ack","stage":"mechanism","transactionId":"txn_173252001","status":"READY","ready":true}
```

2. **Ack & Hasil Sortasi:**
```json
{"type":"ack","stage":"sort","transactionId":"txn_173252001","status":"COMPLETED","sensorVerified":false}
```

3. **Status Heartbeat:**
```json
{"type":"telemetry","status":"ONLINE","busy":false,"uptime":580}
```

---

## 5. Protokol BBC micro:bit — MakeCode BLE UART

BBC micro:bit berkomunikasi melalui Bluetooth Low Energy menggunakan MakeCode Nordic UART Service dengan pesan teks ASCII ringkas.

- **UART Service UUID:** `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- **UART RX Characteristic:** `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`
- **UART TX Characteristic:** `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`

### 5.1 Tabel Protokol Perintah (Website → micro:bit)

| Perintah | Karakter / String | Keterangan |
| :--- | :--- | :--- |
| `STAGE 1: SET ARM` | `SET:ARM#` | Menyiapkan motor stepper / servo base pada konfigurasi Arm |
| `STAGE 1: SET SERVO` | `SET:SERVO#` | Menyiapkan flap diverter servo |
| `SORT MERAH (LEGACY)` | `R` atau `CMD:SORT:MERAH#` | Menyortir objek merah ke bin 1 |
| `SORT KUNING (LEGACY)`| `Y` atau `CMD:SORT:KUNING#` | Menyortir objek kuning ke bin 2 |
| `SORT BIRU (LEGACY)`  | `B` atau `CMD:SORT:BIRU#` | Menyortir objek biru ke bin 3 |
| `EMERGENCY STOP`      | `S` atau `CMD:STOP#` | Menghentikan seluruh pergerakan motor |

### 5.2 Tabel Respon / Umpan Balik (micro:bit → Website)

| String Notifikasi | Arti Operasional | Status Transaksi Web |
| :--- | :--- | :--- |
| `ACK:ARM:READY` | Stage 1 Sukses: Lengan robot siap | `AWAITING_CLASS_ACK` |
| `ACK:SERVO:READY` | Stage 1 Sukses: Servo flap siap | `AWAITING_CLASS_ACK` |
| `ACK:SORT:MERAH` | Stage 2 ACK: Perintah diterima, mulai gerak | `SORTING` |
| `DONE:MERAH` | Gerakan fisik selesai (unverified) | `COMPLETED_UNVERIFIED` |
| `DONE:KUNING` | Gerakan fisik selesai (unverified) | `COMPLETED_UNVERIFIED` |
| `DONE:BIRU` | Gerakan fisik selesai (unverified) | `COMPLETED_UNVERIFIED` |
| `VERIFIED:MERAH` | Sensor IR membaca objek merah jatuh di bin | `VERIFIED` |
| `ERR:TIMEOUT` | Motor gagal mencapai posisi limit switch | `FAILED` |

---

## 6. Tabel Pemetaan Kelas AI & Mekanisme (Mapping Table)

Sistem mendukung 2 mode model AI:

### 6.1 Model 6-Kelas Mekanis (Model Phase 2)
Model yang dilatih langsung dengan anotasi bagian aktuator:
- `merah_arm` → Warna: Merah, Mekanisme: Robotic Arm
- `kuning_arm` → Warna: Kuning, Mekanisme: Robotic Arm
- `biru_arm` → Warna: Biru, Mekanisme: Robotic Arm
- `merah_servo` → Warna: Merah, Mekanisme: Servo Flap
- `kuning_servo` → Warna: Kuning, Mekanisme: Servo Flap
- `biru_servo` → Warna: Biru, Mekanisme: Servo Flap

*Aturan Penanganan:* Kelas 6-mekanis langsung mengekstrak mekanisme dan warna tanpa memerlukan konfigurasi pemetaan.

### 6.2 Model 3-Kelas Warna (Model Legacy / Teachable Machine Default)
- `merah`
- `kuning`
- `biru`

*Aturan Penanganan:* Sistem membaca konfigurasi `legacyMechanismMap` dari `localStorage` atau dialog konfigurasi operator:
```json
{
  "merah": "servo",
  "kuning": "arm",
  "biru": "servo"
}
```
> **Aturan Keamanan:** Jika kelas tidak memiliki pemetaan dan mekanisme tidak dipilih eksplisit oleh operator, sistem menolak eksekusi dengan status `MECHANISM_UNDEFINED` untuk menghindari tabrakan fisik aktuator.

---

## 7. Batas Waktu & Toleransi Kegagalan (Timeouts & Retries)

- **Connection Heartbeat Interval:** 5000 ms
- **Stage 1 (Set Mechanism) Timeout:** 3000 ms (Jika tidak ada respon, transaksi dibatalkan dengan status `TIMEOUT`).
- **Stage 2 (Sort Object) Timeout:** 8000 ms.
- **Sensor Verification Timeout:** 5000 ms setelah gerakan aktuator selesai.
- **Maximum Transaction History:** 50 transaksi aktif disimpan di memori browser untuk inspeksi operator secara langsung.
