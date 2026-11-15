# Dokumentasi Arsitektur & Spesifikasi: VERNOVA Smart Data Assistant

## 1. Ringkasan Eksekutif & Prinsip Desain

**VERNOVA Smart Data Assistant** adalah modul asisten analitik cerdas deterministik yang menggantikan dependensi model AI/LLM eksternal (Groq, Gemini, Claude, Pollinations AI) dengan mesin logika berbasis aturan (*rule-based*), pencocokan *intent*, normalisasi teks bahasa Indonesia, dan agregasi data aktual dari **Firebase Realtime Database** serta log lokal browser.

### Prinsip Utama Sistem:
1. **Zero-LLM / Zero-AI Dependency:** 100% bebas biaya token API, tidak memerlukan API key pihak ketiga untuk kueri data, dan tidak menghasilkan halusinasi data (*zero hallucination*).
2. **Data-Grounded & Deterministic:** Seluruh angka, statistik, dan rasio dihitung langsung dari basis data aktual (`smart_factory/sorting_line`). Jika data kosong, asisten menyajikan status faktual secara transparan.
3. **Transparansi Perhitungan:** Setiap jawaban menyertakan catatan basis perhitungan (*basis of calculation*) yang mencantumkan jumlah sampel data dan rentang waktu evaluasi.
4. **Pemisahan Korelasi vs Kausalitas:** Evaluasi kegagalan pada mode kerja (Servo vs Arm) menyertakan *disclaimer* bahwa korelasi frekuensi kegagalan dalam log tidak serta merta membuktikan kausalitas kerusakan mekanis hardware.
5. **Standarisasi Zona Waktu WIB (UTC+7):** Evaluasi batas waktu (*hari ini*, *kemarin*, *jam tersibuk*) dikonversi secara presisi ke zona waktu `Asia/Jakarta`.

---

## 2. Diagram Alur Pipeline Smart Data Assistant

```
+-----------------------------------------------------------------------------------+
|                         Input Pengguna (Teks / Web Speech STT)                    |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|               1. Normalisasi Teks & Ekspansi Typo / Slang Indonesia               |
|    (Pembersihan simbol, lowercase, kamus singkatan: 'brp'->'berapa', 'kmrn', dll) |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|               2. Ekstraksi Entitas & Rentang Waktu WIB (Asia/Jakarta)             |
|    - Warna: kuning / biru / merah                                                 |
|    - Mode: Servo / Arm                                                            |
|    - Boundary: Hari ini (00:00-23:59 WIB), Kemarin, 7 hari, 30 hari              |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|               3. Pengklasifikasi Intent Deterministik (Prioritas Regex)           |
|    Kategori A: Statistik Sorting Produk (Total, per warna, terbanyak, tersedikit) |
|    Kategori B: Analisis Error & Kegagalan (Error rate, error terakhir, per mode)  |
|    Kategori C: Pola Operasional & Mode Kerja (Frekuensi mode, error rate mode)    |
|    Kategori D: Analisis Waktu & Tren (Hari ini vs kemarin, jam paling sibuk)     |
|    Kategori E: Status Sistem & Hardware (ESP32 online, IP, RSSI, heap, kamera)   |
|    Kategori F: Ringkasan Eksekutif & SOP Masalah                                  |
|    Fallback: Out-of-Scope Domain Guidance                                         |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|               4. Agregasi Data Realtime (Firebase RTDB / Cache Memori)            |
|    - Filter rentang waktu epoch (WIB)                                             |
|    - Perhitungan metrik: Count, Sum, GroupBy, Min/Max                             |
|    - Formula Error Rate = (Jumlah Error / Total Percobaan) * 100%                 |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|               5. Formatter Jawaban Markdown + Suggestion Chips Dinamis            |
|    - Bullet point rapi dengan angka konkret                                       |
|    - Catatan basis perhitungan: "Dihitung dari N data riwayat sortir..."          |
|    - 2-4 Chips saran pertanyaan lanjutan untuk operator                           |
+-----------------------------------------------------------------------------------+
```

---

## 3. Taksonomi Intent Lengkap

### Kategori A: Statistik Sorting Produk
| Intent ID | Pola Pertanyaan Contoh | Output Analitik |
| :--- | :--- | :--- |
| `TOTAL_SORTING` | *"Berapa total produk yang sudah disortir?"*, *"Jumlah semua sortir"* | Total percobaan, total sukses, total gagal, rincian 3 warna, dan penggunaan mode. |
| `SORTING_BY_COLOR` | *"Berapa produk warna kuning yang disortir?"*, *"Jumlah warna merah"* | Volume warna spesifik, persentase dari total sukses, dan peringkat warna. |
| `MOST_SORTED_COLOR` | *"Warna apa yang paling banyak disortir?"*, *"Warna terbanyak"* | Warna dengan hitungan tertinggi, volume item, dan persentase dominasi. |
| `LEAST_SORTED_COLOR` | *"Warna apa paling sedikit disortir?"*, *"Warna tersedikit"* | Warna dengan hitungan terendah beserta perbandingannya. |

### Kategori B: Analisis Error dan Kegagalan
| Intent ID | Pola Pertanyaan Contoh | Output Analitik |
| :--- | :--- | :--- |
| `ERROR_LATEST` | *"Kapan error terakhir terjadi?"*, *"Error terakhir"* | Waktu kejadian (format WIB), mode, warna, kode error (`ERR_WATCHDOG_12S`), dan status. |
| `ERROR_LIST` | *"Tampilkan daftar error terbaru"*, *"Log error"* | Daftar 5 error terbaru (kronologis mundur) dengan timestamp WIB dan kode error. |
| `ERROR_TODAY` | *"Berapa error terjadi hari ini?"*, *"Kegagalan hari ini"* | Jumlah error hari ini (00:00 - 23:59 WIB), error rate hari ini, dan distribusi mode. |
| `ERROR_RATE` | *"Berapa error rate sistem?"*, *"Tingkat kegagalan"* | Persentase error keseluruhan dan rincian error rate mode Servo vs mode Arm. |
| `ERROR_MOST_BY_MODE` | *"Mode apa yang paling sering error?"* | Perbandingan error mode Servo vs Arm + Catatan disclaimer korelasi vs kausalitas. |
| `ERROR_MODE_COMPARISON`| *"Bandingkan error mode servo vs arm"* | Metrik komparasi kegagalan antar mode kerja robot. |
| `ERROR_BY_TYPE` | *"Jenis error apa yang sering muncul?"*, *"Kode error"* | Rincian breakdown per kode error (`ERR_WATCHDOG_12S`, `ERR_TIMEOUT`, dll). |
| `ERROR_BY_COLOR` | *"Warna apa paling sering gagal?"* | Frekuensi kegagalan sortir berdasarkan warna objek terdeteksi. |
| `ERROR_TREND` | *"Apakah error meningkat atau menurun?"*, *"Tren error"* | Evaluasi komparatif separuh data awal vs data terbaru sistem. |

### Kategori C: Pola Operasional dan Mode Kerja
| Intent ID | Pola Pertanyaan Contoh | Output Analitik |
| :--- | :--- | :--- |
| `MOST_USED_MODE` | *"Mode apa yang paling sering digunakan?"* | Identifikasi mode dominan (Servo vs Arm) beserta persentase penggunaan. |
| `MODE_USAGE_COUNT` | *"Berapa kali mode servo dan arm digunakan?"* | Rincian frekuensi pemrosesan dan rasio sukses tiap mode. |
| `MODE_ERROR_RATE` | *"Berapa error rate untuk mode arm?"* | Formula spesifik: `errorArm / totalArm * 100%`. |

### Kategori D: Analisis Waktu dan Tren (WIB)
| Intent ID | Pola Pertanyaan Contoh | Output Analitik |
| :--- | :--- | :--- |
| `ACTIVITY_TODAY` | *"Bagaimana aktivitas sortir hari ini?"* | Ringkasan sortir hari ini, sukses/gagal, warna, dan jam teraktif. |
| `ACTIVITY_YESTERDAY` | *"Aktivitas sortir kemarin"* | Ringkasan data sortir tanggal kemarin dalam WIB. |
| `ACTIVITY_RECENT` | *"Sortir beberapa menit terakhir"*, *"Baru saja"* | 3 aktivitas penyortiran paling akhir dengan timestamp. |
| `BUSIEST_HOURS` | *"Jam berapa sistem paling sibuk?"*, *"Puncak aktivitas"* | Jam puncak (00-23 WIB) dengan volume penyortiran tertinggi. |
| `COMPARE_DAYS` | *"Bandingkan sortir hari ini dengan kemarin"* | Selisih total item (+/- delta) dan perbandingan error rate harian. |
| `COMPARE_WEEKS` | *"Bandingkan minggu ini dengan minggu lalu"* | Perbandingan 7 hari terakhir vs 7 hari sebelumnya. |

### Kategori E: Status Sistem dan Hardware
| Intent ID | Pola Pertanyaan Contoh | Output Analitik |
| :--- | :--- | :--- |
| `HARDWARE_ESP32` | *"Bagaimana status ESP32?"*, *"Apakah ESP32 online?"* | Status koneksi Wi-Fi, IP Host, RSSI sinyal, sisa heap RAM, dan mode aktif. |
| `CAMERA_STATUS` | *"Apakah kamera aktif?"*, *"Status webcam AI"* | Status kamera, model deteksi warna, FPS, dan ambang probabilitas (85%). |
| `SYSTEM_STATUS` | *"Bagaimana status sistem saat ini?"* | Matriks kesehatan keseluruhan: ESP32, Kamera, Firebase, total item, error rate. |

### Kategori F: Ringkasan Umum & Rekomendasi
| Intent ID | Pola Pertanyaan Contoh | Output Analitik |
| :--- | :--- | :--- |
| `GENERAL_SUMMARY` | *"Berikan ringkasan data saat ini"*, *"Rekap sistem"* | 5 poin ringkasan eksekutif produksi, aktivitas hari ini, warna, mode, dan integritas. |
| `ISSUE_HIGHLIGHTS` | *"Apa masalah yang perlu diperhatikan operator?"* | Rekomendasi SOP terarah berdasarkan batas ambang metrik (error rate > 15%, ESP32 offline, dll). |

### Out-of-Scope (Fallback Terarah)
Jika pengguna menanyakan hal di luar topik operasional pabrik sortir (contoh: *"Siapakah presiden Indonesia?"*), asisten menjawab dengan ramah:
1. Menegaskan identitas sebagai VERNOVA Smart Data Assistant.
2. Memberikan daftar topik data yang didukung.
3. Menyediakan tombol *suggestion chips* untuk membantu mengarahkan operator kembali ke data pabrik.

---

## 4. Normalisasi Teks & Kamus Bahasa Indonesia

Modul `normalizeText()` membersihkan input teks operator:
- Mengubah seluruh karakter ke huruf kecil (*lowercase*).
- Menghapus tanda baca non-alfanumerik tanpa merusak angka dan spasi.
- Mengganti singkatan (*slang*), istilah santai, dan typo umum bahasa Indonesia:

```javascript
const SLANG_MAP = {
  'brp': 'berapa', 'brapa': 'berapa', 'berpa': 'berapa',
  'tdk': 'tidak', 'tak': 'tidak', 'gak': 'tidak', 'ga': 'tidak', 'ngga': 'tidak', 'nggak': 'tidak',
  'kmrn': 'kemarin', 'kemaren': 'kemarin', 'kmren': 'kemarin',
  'hr': 'hari', 'hri': 'hari', 'wrna': 'warna',
  'knp': 'kenapa', 'ngapa': 'kenapa',
  'bnyk': 'banyak', 'byk': 'banyak', 'sdkt': 'sedikit', 'dikit': 'sedikit',
  'eror': 'error', 'erorr': 'error', 'err': 'error', 'rusak': 'gagal', 'problem': 'masalah',
  'terbnyk': 'terbanyak', 'terbyk': 'terbanyak', 'trakhir': 'terakhir', 'trkhir': 'terakhir',
  'skrg': 'sekarang', 'skrang': 'sekarang',
  'kuningg': 'kuning', 'merahh': 'merah', 'blu': 'biru', 'red': 'merah', 'yellow': 'kuning', 'blue': 'biru'
};
```

---

## 5. Formula Perhitungan Statistik

### 1. Tingkat Kegagalan (Error Rate) Keseluruhan:
$$\text{Error Rate} = \frac{\text{Jumlah Error}}{\text{Total Percobaan}} \times 100\%$$
*(Di mana: $\text{Total Percobaan} = \text{Total Sukses} + \text{Jumlah Error}$)*

### 2. Error Rate per Mode Kerja:
$$\text{Error Rate Mode} = \frac{\text{Jumlah Error Mode}}{\text{Total Percobaan Mode}} \times 100\%$$

### 3. Persentase Warna Produk Berhasil:
$$\text{Persentase Warna} = \frac{\text{Jumlah Produk Warna Tersebut}}{\text{Total Produk Sukses}} \times 100\%$$

### 4. Penanganan Pembagian Nol (Zero-Division Safe):
Jika $\text{Total} = 0$, fungsi menghasilkan nilai `0%` secara deterministik tanpa melempar *NaN* atau *Infinity*.

---

## 6. Hasil Verifikasi Test Suite Otomatis

Seluruh modul Smart Data Assistant telah diuji menggunakan Node.js Test Runner bawaan (`node:test`).

```powershell
node --test tests/smart_data_assistant.test.js
```

### Rekapitulasi Hasil Pengujian (13/13 Lulus):
- ✔ 1. Normalisasi Teks dan Kamus Slang / Typo Bahasa Indonesia
- ✔ 2. Klasifikasi Intent Kategori A: Statistik Sorting Produk
- ✔ 3. Klasifikasi Intent Kategori B: Analisis Error dan Kegagalan
- ✔ 4. Klasifikasi Intent Kategori C: Pola Operasional dan Mode Kerja
- ✔ 5. Klasifikasi Intent Kategori D: Analisis Waktu dan Tren
- ✔ 6. Klasifikasi Intent Kategori E: Status Sistem & Hardware
- ✔ 7. Klasifikasi Intent Kategori F: Ringkasan Umum & Rekomendasi
- ✔ 8. Ekstraksi dan Normalisasi Record Firebase RTDB
- ✔ 9. Perhitungan Error Rate Mode & Disclaimer Kausalitas
- ✔ 10. Penanganan Database Kosong (Zero Data / Graceful Fallback)
- ✔ 11. Transparansi Waktu WIB (Asia/Jakarta)
- ✔ 12. Query di Luar Domain (Out-of-Scope Fallback)
- ✔ 13. Integrasi Runner Utuh (Total Suite Waktu: ~30ms)

**Total Test Suite Seluruh Proyek:** 41 pengujian lulus (100% Passing).
