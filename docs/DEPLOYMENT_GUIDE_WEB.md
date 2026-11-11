# PANDUAN DEPLOYMENT & SETUP OPERASIONAL (DEPLOYMENT GUIDE)
**Proyek:** VERNOVA — R-LAB Smart Sorting Factory  
**Versi:** 2.0  
**Lingkungan:** Local Factory Server & Cloud Serverless Deployment (Vercel)  

---

## 1. PERSYARATAN SISTEM (SYSTEM PREREQUISITES)

### 1.1 Persyaratan Perangkat Keras & Lunak
- **Sistem Operasi:** Windows 10/11 x64 (untuk eksekusi lokal pabrik).
- **PowerShell:** PowerShell 5.1 atau PowerShell 7+ (bawaan Windows).
- **Browser:** Google Chrome v90+, Microsoft Edge v90+, atau Opera (wajib Chromium-based untuk dukungan penuh W3C Web Bluetooth API).
- **Node.js (Opsional untuk pengujian):** Node.js v18+ (direkomendasikan v20+ atau v24+) untuk menjalankan automated test suite.
- **Kamera:** Webcam USB terpasang atau kamera laptop terintegrasi.
- **Bluetooth:** Adaptor Bluetooth 4.0 / BLE aktif pada komputer.

---

## 2. DEPLOYMENT LOKAL (LOCAL FACTORY SETUP)

Metode ini direkomendasikan untuk operasional di lini perakitan pabrik fisik, laboratorium sekolah/kampus, atau demonstrasi offline.

### Langkah 1: Kloning / Unduh Repositori
Pastikan folder proyek berada di direktori lokal Anda (contoh: `D:\website R-Lab\R-lab_Smart-Factory-AI-main`).

### Langkah 2: Konfigurasi Kunci API (Opsional)
Jika Anda ingin mengaktifkan layanan LLM AI Tier 1 (Google Gemini atau Groq):
1. Buat folder bernama `_secrets` di root proyek jika belum ada.
2. Salin template konfigurasi:
   ```powershell
   Copy-Item keys.example.json _secrets\keys.json
   ```
3. Buka `_secrets\keys.json` menggunakan editor teks dan masukkan API key Anda:
   ```json
   {
     "gemini": "AIzaSyYourGeminiApiKey...",
     "groq": "gsk_YourGroqApiKey..."
   }
   ```
> **Catatan:** Jika langkah ini dilewati, server tetap dapat berjalan normal. Sistem R-AI akan otomatis menggunakan Tier 2 (Pollinations Cloud) atau Tier 3 (Kamus Pengetahuan Lokal).

### Langkah 3: Menjalankan Server Lokal
Cukup klik dua kali berkas **`MULAI-RLAB.bat`**, atau jalankan melalui terminal PowerShell:
```powershell
powershell -ExecutionPolicy Bypass -File server.ps1 -Port 8000
```
- Server web lokal akan aktif di `http://localhost:8000`.
- Browser default Anda akan otomatis membuka halaman dasbor utama.
- Untuk mengakses portal tamu pada layar monitor terpisah, buka `http://localhost:8000/guest.html`.

---

## 3. DEPLOYMENT KE CLOUD SERVERLESS (VERCEL)

Metode ini direkomendasikan untuk menyajikan dashboard monitoring dan demo interaktif secara global kepada publik, juri, atau manajemen.

### Mengapa Vercel?
1. **HTTPS Otomatis:** Fitur W3C Web Bluetooth dan WebRTC Camera API **wajib** berjalan di atas origin aman (*Secure Context*). Vercel menyediakan sertifikat SSL/TLS otomatis gratis.
2. **Global CDN:** Performa loading cepat di seluruh dunia.
3. **Konfigurasi Deklaratif:** Berkas `vercel.json` telah disiapkan di root proyek dengan konfigurasi security headers yang ketat.

### Langkah-Langkah Deploy via Vercel CLI:
1. Pastikan Anda telah menginstal Vercel CLI:
   ```powershell
   npm i -g vercel
   ```
2. Jalankan perintah deploy di folder proyek:
   ```powershell
   vercel
   ```
3. Ikuti panduan interaktif di terminal:
   - *Set up and deploy?* -> `Y`
   - *Which scope?* -> Pilih akun Vercel Anda
   - *Link to existing project?* -> `N`
   - *Project name?* -> `vernova-smart-factory`
   - *Directory?* -> `./`
4. Untuk mendeploy ke domain produksi publik:
   ```powershell
   vercel --prod
   ```

### Langkah-Langkah Deploy via GitHub / GitLab:
1. Dorong repositori lokal ke akun GitHub Anda.
2. Masuk ke dashboard [vercel.com](https://vercel.com).
3. Klik tombol **"Add New Project"** dan pilih repositori GitHub Anda.
4. Framework Preset: Pilih **"Other"**.
5. Klik tombol **"Deploy"**. Proyek Anda akan aktif dalam hitungan detik.

---

## 4. SETUP DATABASE CLOUD (FIREBASE REALTIME DATABASE)

1. Buka konsol [Firebase](https://console.firebase.google.com/) dan buat project baru.
2. Pilih menu **Build > Realtime Database**, lalu klik **Create Database**.
3. Pilih lokasi server (disarankan `Singapore - asia-southeast1` untuk latensi terendah dari Indonesia).
4. Masuk ke tab **Rules**, lalu tempelkan aturan keamanan dari [docs/DATABASE_SCHEMA.md](file:///d:/website%20R-Lab/R-lab_Smart-Factory-AI-main/docs/DATABASE_SCHEMA.md).
5. Pada menu **Project Settings**, salin objek konfigurasi `firebaseConfig`:
   ```javascript
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "your-project.firebaseapp.com",
     databaseURL: "https://your-project-rtdb.asia-southeast1.firebasedatabase.app",
     projectId: "your-project",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "...",
     appId: "..."
   };
   ```
6. Pastikan konfigurasi tersebut sesuai dengan yang tercantum di bagian inisialisasi Firebase pada `index.html` dan `guest.html`.

---

## 5. PEMECAHAN MASALAH UMUM (TROUBLESHOOTING)

| Gejala Masalah | Penyebab Utama | Solusi Perbaikan |
| :--- | :--- | :--- |
| **Port 8000 sudah digunakan** | Aplikasi lain (seperti dev server atau web server lain) sedang menduduki port 8000. | Jalankan script dengan parameter port lain: `powershell -File server.ps1 -Port 8080`. |
| **Web Bluetooth tidak muncul** | Browser tidak didukung (seperti Firefox/Safari) atau konteks tidak aman (HTTP non-localhost). | Gunakan Google Chrome atau Edge. Pastikan mengakses via `http://localhost:8000` atau URL `https://` resmi. |
| **Pesan "Execution Policy" di PowerShell** | Kebijakan eksekusi skrip PowerShell dibatasi oleh OS Windows. | Buka PowerShell dan jalankan: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`. |
| **Kamera blank / gelap** | Izin kamera diblokir oleh browser atau sedang dipakai aplikasi Zoom/Teams. | Tutup aplikasi lain yang mengakses webcam, klik ikon gembok di address bar browser, lalu izinkan akses Kamera. |
| **Error CORS pada panggilan AI** | Melakukan fetch langsung dari browser ke API Groq/Gemini tanpa melalui proxy server. | Gunakan proxy bawaan `server.ps1` atau biarkan sistem menggunakan fallback Tier 2/Tier 3 secara otomatis. |
