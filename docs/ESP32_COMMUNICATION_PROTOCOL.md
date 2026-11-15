# SPESIFIKASI PROTOKOL KOMUNIKASI HTTP REST ESP32 VERNOVA
**Proyek:** VERNOVA — R-LAB Smart Sorting Factory  
**Versi Protokol:** 2.0 (JSON-REST)  
**Encoding:** UTF-8 / JSON  
**Transport:** HTTP/1.1 (TCP/IP Port 80 / Port 8080 Proxy)  

---

## 1. STATE MACHINE STATUS PROSES PENYORTIRAN

Untuk memastikan bahwa keberhasilan perintah software tidak disalahartikan sebagai keberhasilan aktuasi fisik tanpa konfirmasi, sistem menerapkan 7 tahapan status:

```
[1. DETECTED]
       |  (Confidence >= 85%)
       v
[2. COMMAND_SENT] --------(Timeout / Network Error)--------> [6. FAILED]
       |  (HTTP 200 JSON Response)
       v
[3. COMMAND_RECEIVED]
       |  (Servo Actuation Dispatched)
       v
[4. EXECUTING]
       |  (Servo Settling & Optical Gate Confirmation)
       v
[5. COMPLETED]

Catatan: [7. UNKNOWN] digunakan jika data lama diimpor tanpa verifikasi perangkat keras.
```

| Kode Status | Keterangan & Definisi |
| :--- | :--- |
| `DETECTED` | Objek visual berhasil diklasifikasikan oleh model Teachable Machine dengan probabilitas >= 85%. |
| `COMMAND_SENT` | Browser mengirimkan request HTTP POST JSON ke endpoint `/api/sort` ESP32. |
| `COMMAND_RECEIVED` | ESP32 menerima payload, memvalidasi parameter, dan mengembalikan HTTP 200 OK acknowledgment. |
| `EXECUTING` | Pin PWM servo sedang digerakkan ke sudut target (Kuning: 40°, Biru: 90°, Merah: 140°). |
| `COMPLETED` | Siklus pergerakan servo selesai dan sistem siap menerima objek berikutnya. |
| `FAILED` | Terjadi galat jaringan, timeout watchdog 12 detik, atau penolakan parameter oleh ESP32. |
| `UNKNOWN` | Status historis yang tidak memiliki metadata verifikasi sinyal perangkat keras. |

---

## 2. DAFTAR PARAMETER & ENUM VALID

- **Warna Valid (`color`):**
  - `"kuning"` (Yellow)
  - `"biru"` (Blue)
  - `"merah"` (Red)
- **Mode Kerja Valid (`mode`):**
  - `"Servo"` (Mode pemilah cepat berbasis flap)
  - `"Arm"` (Mode lengan dorong robotik)
- **Tipe Objek (`objectType`):**
  - `"CYLINDER_CAP"` (Tutup silinder standar kompetisi)
  - `"BOX_CUBE"` (Balok kubus)

---

## 3. SPESIFIKASI ENDPOINT REST API

### 3.1 `GET /api/status`
Digunakan oleh browser untuk memeriksa kesiapan perangkat, level sinyal Wi-Fi, dan telemetri memori.

**Request:**
- Metode: `GET`
- Header: `Accept: application/json`

**Response (HTTP 200 OK):**
```json
{
  "ok": true,
  "deviceId": "VERNOVA-ESP32-01",
  "firmwareVersion": "2.1.0",
  "state": "READY",
  "mode": "Servo",
  "wifiRssi": -48,
  "freeHeap": 224180,
  "uptimeSec": 1540
}
```

---

### 3.2 `POST /api/sort`
Digunakan untuk menginstruksikan ESP32 agar menyortir objek yang telah dideteksi AI ke wadah (bin) yang tepat.

**Request:**
- Metode: `POST`
- Header: `Content-Type: application/json`
- Body Payload:
```json
{
  "type": "sorting_command",
  "protocolVersion": "2.0",
  "commandId": "CMD_1731654000123_a8f9",
  "color": "kuning",
  "mode": "Servo",
  "objectType": "CYLINDER_CAP",
  "timestamp": "2026-11-15T07:20:00.123Z"
}
```

**Response Sukses (HTTP 200 OK):**
```json
{
  "ok": true,
  "commandId": "CMD_1731654000123_a8f9",
  "color": "kuning",
  "mode": "Servo",
  "status": "COMMAND_RECEIVED",
  "executionStatus": "confirmed_esp32_wifi",
  "deviceId": "VERNOVA-ESP32-01",
  "message": "Perintah sortir kuning selesai dieksekusi."
}
```

**Response Gagal Parameter (HTTP 400 Bad Request):**
```json
{
  "ok": false,
  "error": "Warna tidak valid. Wajib: kuning, biru, atau merah."
}
```

---

### 3.3 `POST /api/mode`
Mengubah mode operasional antara mode Servo dan mode Arm robotik.

**Request:**
- Metode: `POST`
- Body: `{"mode": "Arm"}`

**Response (HTTP 200 OK):**
```json
{
  "ok": true,
  "mode": "Arm"
}
```

---

### 3.4 `POST /api/stop`
Perintah penghentian darurat (*Emergency Stop*) untuk me-reset posisi seluruh servo ke sudut netral.

**Response (HTTP 200 OK):**
```json
{
  "ok": true,
  "status": "STOPPED",
  "message": "Emergency stop dieksekusi."
}
```

---

## 4. KODE ERROR (ERROR CODES)

| Kode Error | Keterangan |
| :--- | :--- |
| `ERR_ESP32_HTTP_DISCONNECTED` | Perangkat ESP32 tidak dapat dijangkau melalui jaringan Wi-Fi lokal. |
| `ERR_WATCHDOG_12S` | ESP32 tidak mengembalikan respons acknowledgment dalam batas waktu 12 detik. |
| `ERR_FORCE_TIMEOUT` | Operator secara manual memicu paksa timeout melalui tombol QC dasbor. |
| `ERR_COMM_EXCEPTION` | Terjadi exception pada browser saat melakukan fetch request HTTP. |
| `ERR_INVALID_COLOR` | Nilai warna yang dikirim tidak termasuk dalam daftar kategori resmi. |
