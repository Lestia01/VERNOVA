# PANDUAN SETUP & PENGOPERASIAN ESP32 WI-FI (SETUP GUIDE)
**Proyek:** VERNOVA — R-LAB Smart Sorting Factory  
**Target Pengguna:** Operator Pabrik, Guru Pembimbing, & Siswa/Mahasiswa  
**Versi:** 2.1.0  

---

## 1. KEBUTUHAN PERANGKAT KERAS (HARDWARE REQUIREMENTS)

- 1x Board Mikrokontroler **ESP32** (ESP32 Dev Module / NodeMCU-32S / ESP32-WROOM-32).
- 2x Motor Servo (SG90 Micro Servo atau MG996R Metal Gear Servo).
  - Servo 1 (Pin GPIO 18): Flap Pengarah Jalur (Bin 1 / 2 / 3).
  - Servo 2 (Pin GPIO 19): Lengan Dorong Robotik (Arm).
- 1x Catu Daya Mandiri 5V 2A-3A untuk Servo (jangan mengambil daya motor langsung dari pin 5V USB ESP32 untuk menghindari brownout/reset).
- Kabel Micro USB / Type-C untuk flashing dan komunikasi serial.

---

## 2. SKEMA PENYAMBUNGAN KABEL (WIRING DIAGRAM)

```
[ESP32 Board]
  - GPIO 18 --------> Kabel Sinyal (Oranye/Kuning) Servo Flap
  - GPIO 19 --------> Kabel Sinyal (Oranye/Kuning) Servo Arm
  - GND ------------> GND Catu Daya 5V Eksternal (COMMON GROUND Wajib!)

[Catu Daya Eksternal 5V]
  - (+) 5V ---------> Kabel Daya (Merah) Servo Flap & Servo Arm
  - (-) GND --------> Kabel Ground (Cokelat/Hitam) Servo & Pin GND ESP32
```

> [!CAUTION]
> **Common Ground Wajib:** Pastikan pin GND dari ESP32 terhubung dengan GND dari catu daya servo eksternal agar sinyal PWM dapat dibaca secara presisi.

---

## 3. LANGKAH FLASHING FIRMWARE ESP32

1. Buka software **Arduino IDE** (versi 2.0+ direkomendasikan).
2. Pasang paket board ESP32:
   - Masuk ke menu **File > Preferences**.
   - Tambahkan URL: `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json` ke *Additional Boards Manager URLs*.
   - Buka **Tools > Board > Boards Manager**, cari `esp32` oleh Espressif Systems, lalu klik **Install**.
3. Pasang pustaka Servo ESP32:
   - Masuk ke **Tools > Manage Libraries**, cari `ESP32Servo` oleh Kevin Harrington, lalu klik **Install**.
4. Buka berkas sketch firmware:
   - Buka file [firmware/esp32_vernova_sorting/esp32_vernova_sorting.ino](file:///d:/website%20R-Lab/R-lab_Smart-Factory-AI-main/firmware/esp32_vernova_sorting/esp32_vernova_sorting.ino).
5. Pilih Board & Port:
   - **Tools > Board:** Pilih `ESP32 Dev Module`.
   - **Tools > Port:** Pilih port COM yang sesuai (contoh: `COM3`).
6. Klik tombol **Upload** (tanda panah kanan). Tunggu hingga proses kompilasi dan upload selesai (*Done uploading*).

---

## 4. CARA MENGHUBUNGKAN KE WEB DASHBOARD VERNOVA

### Opsi A: Mode Hotspot Mandiri / SoftAP (Paling Mudah, Tanpa Router)
1. Setelah ESP32 menyala, ESP32 akan memancarkan hotspot Wi-Fi bernama **`VERNOVA-ROBOT`**.
2. Sambungkan laptop/komputer Anda ke Wi-Fi `VERNOVA-ROBOT` (password: `vernova123`).
3. Jalankan server lokal dengan mengklik [MULAI-RLAB.bat](file:///d:/website%20R-Lab/R-lab_Smart-Factory-AI-main/MULAI-RLAB.bat) atau buka `http://localhost:8080/index.html`.
4. Klik tombol **"ESP32 WI-FI"** pada bilah navigasi atas dasbor.
5. Pastikan alamat IP tertulis `http://192.168.4.1`, lalu klik tombol **"Test Ping"**.
6. Status akan berubah menjadi **ESP32: READY** berwarna biru/hijau, menampilkan sinyal RSSI dan sisa memori heap. Klik **"Simpan & Hubungkan"**.

### Opsi B: Mode Simulasi / Virtual Hardware (Tanpa Perangkat Fisik)
Jika Anda belum memiliki board ESP32 fisik atau sedang melakukan demonstrasi jarak jauh di kelas:
1. Buka dasbor `index.html`.
2. Klik tombol **"ESP32 WI-FI"**.
3. Aktifkan centang **"Mode Simulasi (Virtual Hardware)"**.
4. Status akan seketika berubah menjadi **ESP32: SIMULATED**.
5. Deteksi AI Vision, pencatatan log Firebase, dan perhitungan dasbor akan langsung berjalan dengan latensi virtual realistis 280ms tanpa perlu alat fisik apapun.
