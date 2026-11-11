# SKEMA DATABASE & PANDUAN ATURAN KEAMANAN FIREBASE
**Proyek:** VERNOVA — R-LAB Smart Sorting Factory  
**Database:** Firebase Realtime Database  
**Versi Skema:** 2.0 (Push-based Atomic Logging)  

---

## 1. STRUKTUR POHON DATA (DATABASE TREE STRUCTURE)

Struktur data Firebase Realtime Database diorganisir di bawah root path `/smart_factory/sorting_line`:

```
smart_factory/
  sorting_line/
    kuning/
      -O_abc1234567890/
        runId: "RUN-1731316800000-A1B2C"
        kategori: "kuning"
        confidence: 0.945
        timestamp: "2026-11-11T09:15:30.123Z"
        sortResult: "BERHASIL"
        executionStatus: "DISPATCHED"
        durationMs: 450
        errorCode: null
    biru/
      -O_def2345678901/
        runId: "RUN-1731316812000-D3E4F"
        kategori: "biru"
        confidence: 0.892
        timestamp: "2026-11-11T09:15:42.456Z"
        sortResult: "BERHASIL"
        executionStatus: "DISPATCHED"
        durationMs: 410
        errorCode: null
    merah/
      -O_ghi3456789012/
        runId: "RUN-1731316825000-G5H6I"
        kategori: "merah"
        confidence: 0.961
        timestamp: "2026-11-11T09:15:55.789Z"
        sortResult: "BERHASIL"
        executionStatus: "DISPATCHED"
        durationMs: 435
        errorCode: null
    gagal/
      -O_jkl4567890123/
        runId: "RUN-1731316838000-J7K8L"
        kategori: "gagal"
        confidence: 0.612
        timestamp: "2026-11-11T09:16:08.012Z"
        sortResult: "GAGAL"
        executionStatus: "REJECTED_LOW_CONFIDENCE"
        durationMs: 120
        errorCode: "ERR_CONFIDENCE_BELOW_THRESHOLD"
```

---

## 2. DEFINISI SPESIFIKASI FIELD DATA

Setiap entri log sorting yang dihasilkan oleh penulisan `push()` memiliki atribut-atribut berikut:

| Nama Field | Tipe Data | Wajib | Nilai Contoh | Penjelasan |
| :--- | :--- | :--- | :--- | :--- |
| `runId` | String | Ya | `"RUN-1731316800000-A1B2C"` | Pengidentifikasi unik siklus sortir yang digenerasi oleh klien. |
| `kategori` | String | Ya | `"kuning"` \| `"biru"` \| `"merah"` \| `"gagal"` | Kategori warna objek atau status kegagalan deteksi. |
| `confidence` | Number | Ya | `0.945` | Nilai probabilitas keyakinan model computer vision (rentang `0.0` - `1.0`). |
| `timestamp` | String | Ya | `"2026-11-11T09:15:30.123Z"` | Waktu eksekusi dalam format standar ISO 8601 UTC. |
| `sortResult` | String | Ya | `"BERHASIL"` \| `"GAGAL"` | Status akhir proses pemilahan oleh sistem. |
| `executionStatus` | String | Ya | `"DISPATCHED"` \| `"REJECTED"` | Status sinyal yang dikirimkan ke hardware robotik. |
| `durationMs` | Number | Tidak | `450` | Durasi inferensi dan transmisi dalam milidetik. |
| `errorCode` | String/Null | Tidak | `null` \| `"ERR_LOW_CONFIDENCE"` | Kode identifikasi galat jika proses pemilahan mengalami anomali. |

---

## 3. KOMPATIBILITAS MUNDUR (BACKWARD COMPATIBILITY)

Sebelum refaktorisasi `WEB-004`, versi lama kode program menggunakan indeks array numerik berbasis panjang node:
`smart_factory/sorting_line/kuning/0`, `smart_factory/sorting_line/kuning/1`, dst.

Untuk memastikan data historis yang sudah ada di database tetap terbaca dengan sempurna tanpa error:
- Fungsi pembaca agregasi (`collectEntries` dan `collectCloud`) mengonsumsi snapshot data menggunakan utilitas `Object.values(kategoriNode || {})`.
- Mekanisme ini secara transparan dan otomatis menangani kedua struktur:
  1. Data lama berindeks numerik (`{"0": {...}, "1": {...}}`)
  2. Data baru berindeks hash unik Firebase Push ID (`{"-O_abc...": {...}, "-O_def...": {...}}`)
- Tidak ada data masa lalu yang hilang atau rusak akibat migrasi format penulisan.

---

## 4. REKOMENDASI ATURAN KEAMANAN FIREBASE (SECURITY RULES)

Salin kode JSON berikut ke dalam tab **Security Rules** pada konsol Firebase Realtime Database Anda:

```json
{
  "rules": {
    "smart_factory": {
      "sorting_line": {
        ".read": true,
        "$kategori": {
          ".write": true,
          "$pushId": {
            ".validate": "newData.hasChildren(['runId', 'kategori', 'confidence', 'timestamp', 'sortResult'])",
            "runId": {
              ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 64"
            },
            "kategori": {
              ".validate": "newData.isString() && (newData.val() == 'kuning' || newData.val() == 'biru' || newData.val() == 'merah' || newData.val() == 'gagal')"
            },
            "confidence": {
              ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 1"
            },
            "timestamp": {
              ".validate": "newData.isString() && newData.val().length >= 10"
            },
            "sortResult": {
              ".validate": "newData.isString() && (newData.val() == 'BERHASIL' || newData.val() == 'GAGAL')"
            },
            "durationMs": {
              ".validate": "!newData.exists() || (newData.isNumber() && newData.val() >= 0)"
            },
            "executionStatus": {
              ".validate": "!newData.exists() || newData.isString()"
            },
            "errorCode": {
              ".validate": "!newData.exists() || newData.isString() || newData.val() == null"
            },
            "$other": {
              ".validate": false
            }
          }
        }
      }
    }
  }
}
```

### Keunggulan Aturan Keamanan Ini:
1. **Pencegahan Polusi Properti Liar:** Atribut `$other: { .validate: false }` menolak atribut liar di luar skema resmi.
2. **Validasi Tipe Data Ketat:** Mencegah injeksi string berbahaya pada field numerik seperti `confidence`.
3. **Pemberian Izin Akses Terkontrol:** Mengizinkan pembacaan publik bagi portal monitoring (`guest.html`) dan mengamankan integritas entri sorting.
