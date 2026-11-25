# Panduan Setup BBC micro:bit Bluetooth Low Energy (MakeCode UART)

Panduan ini menjelaskan cara memprogram papan **BBC micro:bit (V1 atau V2)** agar dapat berkomunikasi langsung dengan Website VERNOVA melalui Web Bluetooth API.

---

## 1. Persiapan Proyek MakeCode

1. Buka editor resmi: [https://makecode.microbit.org/](https://makecode.microbit.org/)
2. Buat proyek baru dengan nama: `VERNOVA-Microbit-Sorting`
3. Tambahkan ekstensi Bluetooth:
   - Klik ikon **Roda Gigi (Settings)** di kanan atas -> Pilih **Extensions**.
   - Cari dan pilih **bluetooth**.
   - *Catatan:* MakeCode akan meminta untuk menonaktifkan fitur Radio karena Bluetooth dan Radio berbagi modul hardware yang sama pada nRF52. Pilih **Remove extension(s) and add bluetooth**.

---

## 2. Pengaturan Pairing (Project Settings)

Untuk memastikan browser Chrome/Edge dapat terhubung tanpa meminta passcode numerik:
1. Klik **Project Settings** (ikon roda gigi).
2. Temukan opsi **No Password Run - Just connect (pairing not required)**.
3. Geser toggle ke posisi **ON** (Aktif).

---

## 3. Logika Program MakeCode (JavaScript / Blocks)

### Representasi Blok (MakeCode Blocks)
- **pada saat mulai (on start):**
  - Tampilkan icon check atau tulisan "VERNOVA"
  - Jalankan blok `bluetooth uart service` (memulai Nordic UART service pada UUID `6e400001-...`)
- **pada saat bluetooth terhubung (on bluetooth connected):**
  - Tampilkan icon senyum (happy face) pada layar LED 5x5
- **pada saat bluetooth terputus (on bluetooth disconnected):**
  - Tampilkan icon sedih (sad face)
- **pada saat data uart diterima (on bluetooth uart received until delimiter "\n"):**
  - Simpan teks ke variabel `perintah`
  - Jika `perintah == "kuning"`: gerakkan servo sortir ke 40°
  - Jika `perintah == "biru"`: gerakkan servo sortir ke 90°
  - Jika `perintah == "merah"`: gerakkan servo sortir ke 140°
  - Jika `perintah == "servo"`: set mode kerja ke Servo
  - Jika `perintah == "arm"`: set mode kerja ke Arm
  - Jika `perintah == "stop"`: kembalikan servo ke posisi netral (90°)
  - Jika `perintah == "test"`: berikan kedipan LED / getaran pulse

---

### Kode MakeCode JavaScript (`main.ts`)

```typescript
let modeAktif = "servo"
let perintah = ""

// Inisialisasi Service Bluetooth UART
bluetooth.startUartService()
basic.showString("V")

bluetooth.onBluetoothConnected(function () {
    basic.showIcon(IconNames.Yes)
})

bluetooth.onBluetoothDisconnected(function () {
    basic.showIcon(IconNames.No)
})

// Menerima perintah string dari Website VERNOVA (Mendukung 2-Stage Sequence)
bluetooth.onUartDataReceived(serial.delimiters(Delimiters.NewLine), function () {
    perintah = bluetooth.uartReadUntil(serial.delimiters(Delimiters.NewLine))
    perintah = perintah.trim().toLowerCase()

    // 1. Tahap Konfirmasi Kesiapan Mekanisme
    if (perintah == "arm" || perintah == "mech:arm") {
        modeAktif = "arm"
        basic.showString("A")
        bluetooth.uartWriteString("ACK:ARM:READY\n")
    } else if (perintah == "servo" || perintah == "mech:servo") {
        modeAktif = "servo"
        basic.showString("S")
        bluetooth.uartWriteString("ACK:SERVO:READY\n")
    } 
    // 2. Tahap Eksekusi Sortir Kelas Warna
    else if (perintah == "kuning" || perintah == "sort:kuning") {
        basic.showString("K")
        pins.servoWritePin(AnalogPin.P1, 40)
        basic.pause(300)
        bluetooth.uartWriteString("DONE:KUNING\n")
    } else if (perintah == "biru" || perintah == "sort:biru") {
        basic.showString("B")
        pins.servoWritePin(AnalogPin.P1, 90)
        basic.pause(300)
        bluetooth.uartWriteString("DONE:BIRU\n")
    } else if (perintah == "merah" || perintah == "sort:merah") {
        basic.showString("M")
        pins.servoWritePin(AnalogPin.P1, 140)
        basic.pause(300)
        bluetooth.uartWriteString("DONE:MERAH\n")
    } else if (perintah == "stop") {
        pins.servoWritePin(AnalogPin.P1, 90)
        pins.servoWritePin(AnalogPin.P2, 20)
        basic.showIcon(IconNames.Square)
        bluetooth.uartWriteString("ACK:STOPPED\n")
    } else if (perintah == "test") {
        basic.showIcon(IconNames.Target)
        basic.pause(200)
        basic.clearScreen()
        bluetooth.uartWriteString("ACK:TEST:OK\n")
    }
})
```

---

## 4. Diagram Pengkabelan Servo ke micro:bit

Gunakan modul Shield atau breakout board ekspansi micro:bit (misal Sensor:bit):
- **Pin P1:** Signal Servo Flap Pemilah Jalur
- **Pin P2:** Signal Servo Arm Pengangkat / Penolak
- **3V/5V & GND:** Sumber daya servo eksternal *(jangan mengambil daya 5V langsung dari pin USB micro:bit untuk menggerakkan servo berbeban tinggi)*.
