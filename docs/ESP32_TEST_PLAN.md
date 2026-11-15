# RENCANA PENGUJIAN KOMUNIKASI ESP32 WI-FI (TEST PLAN)
**Proyek:** VERNOVA — R-LAB Smart Sorting Factory  
**Target:** Modul Komunikasi ESP32 Wi-Fi & Integrasi End-to-End  
**Versi:** 2.1.0  

---

## 1. STRATEGI PENGUJIAN

Pengujian dibagi ke dalam 4 tingkatan (*testing tiers*):
1. **Tier 1 — Automated Unit Tests (`node:test`):** Memverifikasi logika klien `Esp32Client`, sanitasi URL, validasi warna, timeout abort controller, dan mekanisme virtual mock.
2. **Tier 2 — Web UI & State Machine Verification:** Memverifikasi sinkronisasi pill status `#status-esp32`, dialog modal, dan reaktivitas log feed.
3. **Tier 3 — AI Vision to ESP32 Dispatch Integration:** Memverifikasi pengiriman otomatis saat tingkat keyakinan AI melampaui 85%.
4. **Tier 4 — Physical Hardware & Servo Actuation (Manual Field Test):** Memverifikasi konektivitas nyata dengan board ESP32 fisik dan aktuasi mekanis servo.

---

## 2. MATRIKS SKENARIO PENGUJIAN OTOMATIS

| ID Pengujian | Skenario Uji | Input | Ekspektasi Hasil |
| :--- | :--- | :--- | :--- |
| **TEST-ESP-01** | Inisialisasi & Sanitasi Host URL | `"192.168.4.1"` | Host dinormalisasi menjadi `"http://192.168.4.1"`. |
| **TEST-ESP-02** | Telemetri Health Check Simulasi | `checkHealth()` (Sim Mode) | Mengembalikan `ok: true`, `deviceId`, status `READY`, dan RSSI valid. |
| **TEST-ESP-03** | Perintah Sortir Warna Valid (Kuning) | `{ color: 'kuning' }` | Mengembalikan status `COMPLETED`, `commandId` unik, dan durasi > 200ms. |
| **TEST-ESP-04** | Perintah Sortir Alias Bahasa Inggris | `{ color: 'Blue' }` | Warna dinormalisasi ke `"biru"` secara otomatis. |
| **TEST-ESP-05** | Penolakan Kategori Warna Tidak Sah | `{ color: 'hijau' }` | Melemparkan error `Kategori warna tidak valid`. |
| **TEST-ESP-06** | Pengubahan Mode Kerja & Emergency Stop | `sendEmergencyStop()` | Mengembalikan status `STOPPED`. |
| **TEST-ESP-07** | Listener Status Reaktif UI | `onStatusChange` callback | Menerima event transisi `SIMULATED`, `CONNECTING`, `BUSY`, dll. |
| **TEST-ESP-08** | Penanganan Jaringan Offline (Fault Tolerance)| Host port non-aktif | Mengembalikan `ok: false`, status `FAILED`, tanpa menyebabkan exception unhandled. |

---

## 3. PROSEDUR PENGUJIAN MANUAL DENGAN PERANGKAT FISIK

1. Hubungkan ESP32 ke sumber daya USB 5V.
2. Sambungkan laptop/komputer ke Wi-Fi hotspot `VERNOVA-ROBOT` (password default: `vernova123`).
3. Buka browser di `http://localhost:8080/index.html`.
4. Klik tombol **"ESP32 WI-FI"** pada topbar.
5. Klik **"Test Ping"**:
   - Pastikan status berubah menjadi hijau `READY` dan telemetri RSSI/Heap muncul.
6. Arahkan objek berwarna kuning ke webcam:
   - Pastikan servo bergerak ke sudut 40°, status proses tercatat di Live History feed, dan counter kuning bertambah.
