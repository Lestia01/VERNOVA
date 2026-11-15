const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SmartDataAssistant,
  normalizeText,
  detectIntent,
  computeStats,
  extractAllRecords,
  getDayBoundsWIB,
  formatWIB
} = require('../assets/js/smart-data-assistant.js');

test('VERNOVA Smart Data Assistant - Zero AI Rule-Based Engine', async (t) => {
  const assistant = new SmartDataAssistant();

  // Mock Database Records
  const now = Date.now();
  const mockFirebaseData = {
    smart_factory: {
      sorting_line: {
        kuning: {
          'k1': { runId: 'r-01', color: 'kuning', mode: 'Servo', sortResult: 'success', timestamp: now - 3600000 },
          'k2': { runId: 'r-02', color: 'kuning', mode: 'Servo', sortResult: 'success', timestamp: now - 3500000 },
          'k3': { runId: 'r-03', color: 'kuning', mode: 'Arm', sortResult: 'success', timestamp: now - 1800000 }
        },
        biru: {
          'b1': { runId: 'r-04', color: 'biru', mode: 'Servo', sortResult: 'success', timestamp: now - 3000000 },
          'b2': { runId: 'r-05', color: 'biru', mode: 'Arm', sortResult: 'success', timestamp: now - 2000000 }
        },
        merah: {
          'm1': { runId: 'r-06', color: 'merah', mode: 'Arm', sortResult: 'success', timestamp: now - 1000000 }
        },
        gagal: {
          'g1': { runId: 'r-07', detectedColor: 'biru', mode: 'Arm', sortResult: 'error', errorCode: 'ERR_WATCHDOG_12S', timestamp: now - 900000 },
          'g2': { runId: 'r-08', detectedColor: 'merah', mode: 'Arm', sortResult: 'error', errorCode: 'ERR_WATCHDOG_12S', timestamp: now - 600000 }
        }
      }
    }
  };

  const mockEsp32 = {
    online: true,
    host: 'http://192.168.4.1',
    state: 'READY',
    rssi: -52,
    freeHeap: 184320,
    currentMode: 'Servo'
  };

  const mockCamera = {
    active: true,
    fps: 30
  };

  await t.test('1. Normalisasi Teks dan Kamus Slang / Typo Bahasa Indonesia', () => {
    assert.equal(normalizeText('BRP total produk yg disortir?'), 'berapa total produk yg disortir');
    assert.equal(normalizeText('Kmrn ada eror brp kali??'), 'kemarin ada error berapa kali');
    assert.equal(normalizeText('wrna apa yg paling byk gagal?'), 'warna apa yg paling banyak gagal');
    assert.equal(normalizeText('kenapa mode arm rusak'), 'kenapa mode arm gagal');
    assert.equal(normalizeText('status esp32 skrg gmn'), 'status esp32 sekarang gmn');
  });

  await t.test('2. Klasifikasi Intent Kategori A: Statistik Sorting Produk', () => {
    assert.equal(detectIntent(normalizeText('Berapa total produk yang sudah disortir?')), 'TOTAL_SORTING');
    assert.equal(detectIntent(normalizeText('Jumlah semua sortir')), 'TOTAL_SORTING');
    assert.equal(detectIntent(normalizeText('Berapa produk warna kuning yang disortir?')), 'SORTING_BY_COLOR');
    assert.equal(detectIntent(normalizeText('jumlah warna merah')), 'SORTING_BY_COLOR');
    assert.equal(detectIntent(normalizeText('Warna apa yang paling banyak disortir?')), 'MOST_SORTED_COLOR');
    assert.equal(detectIntent(normalizeText('Warna terbanyak')), 'MOST_SORTED_COLOR');
    assert.equal(detectIntent(normalizeText('Warna apa paling sedikit disortir?')), 'LEAST_SORTED_COLOR');
  });

  await t.test('3. Klasifikasi Intent Kategori B: Analisis Error dan Kegagalan', () => {
    assert.equal(detectIntent(normalizeText('Kapan error terakhir terjadi?')), 'ERROR_LATEST');
    assert.equal(detectIntent(normalizeText('Tampilkan daftar error terbaru')), 'ERROR_LIST');
    assert.equal(detectIntent(normalizeText('Berapa error terjadi hari ini?')), 'ERROR_TODAY');
    assert.equal(detectIntent(normalizeText('Berapa error rate sistem?')), 'ERROR_RATE');
    assert.equal(detectIntent(normalizeText('Mode apa yang paling sering error?')), 'ERROR_MOST_BY_MODE');
    assert.equal(detectIntent(normalizeText('Bandingkan error mode servo vs arm')), 'ERROR_MODE_COMPARISON');
    assert.equal(detectIntent(normalizeText('Jenis error apa yang sering muncul?')), 'ERROR_BY_TYPE');
    assert.equal(detectIntent(normalizeText('Warna apa paling sering gagal?')), 'ERROR_BY_COLOR');
    assert.equal(detectIntent(normalizeText('Apakah error meningkat atau menurun?')), 'ERROR_TREND');
  });

  await t.test('4. Klasifikasi Intent Kategori C: Pola Operasional dan Mode Kerja', () => {
    assert.equal(detectIntent(normalizeText('Mode apa yang paling sering digunakan?')), 'MOST_USED_MODE');
    assert.equal(detectIntent(normalizeText('Berapa kali mode servo dan arm digunakan?')), 'MODE_USAGE_COUNT');
    assert.equal(detectIntent(normalizeText('Berapa error rate untuk mode arm?')), 'MODE_ERROR_RATE');
  });

  await t.test('5. Klasifikasi Intent Kategori D: Analisis Waktu dan Tren', () => {
    assert.equal(detectIntent(normalizeText('Bagaimana aktivitas sortir hari ini?')), 'ACTIVITY_TODAY');
    assert.equal(detectIntent(normalizeText('Aktivitas kemarin')), 'ACTIVITY_YESTERDAY');
    assert.equal(detectIntent(normalizeText('Sortir beberapa menit terakhir')), 'ACTIVITY_RECENT');
    assert.equal(detectIntent(normalizeText('Jam berapa sistem paling sibuk?')), 'BUSIEST_HOURS');
    assert.equal(detectIntent(normalizeText('Bandingkan sortir hari ini dengan kemarin')), 'COMPARE_DAYS');
    assert.equal(detectIntent(normalizeText('Bandingkan minggu ini dengan minggu lalu')), 'COMPARE_WEEKS');
  });

  await t.test('6. Klasifikasi Intent Kategori E: Status Sistem & Hardware', () => {
    assert.equal(detectIntent(normalizeText('Bagaimana status ESP32?')), 'HARDWARE_ESP32');
    assert.equal(detectIntent(normalizeText('Apakah ESP32 online?')), 'HARDWARE_ESP32');
    assert.equal(detectIntent(normalizeText('Apakah kamera aktif?')), 'CAMERA_STATUS');
    assert.equal(detectIntent(normalizeText('Bagaimana status sistem saat ini?')), 'SYSTEM_STATUS');
  });

  await t.test('7. Klasifikasi Intent Kategori F: Ringkasan Umum & Rekomendasi', () => {
    assert.equal(detectIntent(normalizeText('Berikan ringkasan data saat ini')), 'GENERAL_SUMMARY');
    assert.equal(detectIntent(normalizeText('Rekap data sortir')), 'GENERAL_SUMMARY');
    assert.equal(detectIntent(normalizeText('Apa masalah yang perlu diperhatikan operator?')), 'ISSUE_HIGHLIGHTS');
    assert.equal(detectIntent(normalizeText('Rekomendasi untuk sistem')), 'ISSUE_HIGHLIGHTS');
  });

  await t.test('8. Ekstraksi dan Normalisasi Record Firebase RTDB', () => {
    const records = extractAllRecords(mockFirebaseData);
    assert.equal(records.length, 8); // 3 kuning + 2 biru + 1 merah + 2 gagal
    assert.equal(records[0].runId, 'r-01');

    const stats = computeStats(records);
    assert.equal(stats.total, 8);
    assert.equal(stats.successCount, 6);
    assert.equal(stats.errorCount, 2);
    // Error rate = 2 / 8 * 100 = 25.0%
    assert.equal(stats.errorRate, 25);
    assert.equal(stats.colors.kuning, 3);
    assert.equal(stats.colors.biru, 2);
    assert.equal(stats.colors.merah, 1);
    assert.equal(stats.mostColor.color, 'Kuning');
    assert.equal(stats.leastColor.color, 'Merah');
  });

  await t.test('9. Perhitungan Error Rate Mode & Disclaimer Kausalitas', () => {
    const records = extractAllRecords(mockFirebaseData);
    const stats = computeStats(records);

    // Servo: 3 attempts, 0 errors -> 0%
    // Arm: 5 attempts (1 kuning + 1 biru + 1 merah + 2 error), 2 errors -> 40%
    assert.equal(stats.modes.Servo, 3);
    assert.equal(stats.modeErrors.Servo, 0);
    assert.equal(stats.servoErrorRate, 0);

    assert.equal(stats.modes.Arm, 5);
    assert.equal(stats.modeErrors.Arm, 2);
    assert.equal(stats.armErrorRate, 40);

    // Query response verification
    const res = assistant.processQuery('Mode apa yang paling sering error?', {
      smart_factory: mockFirebaseData.smart_factory,
      esp32Status: mockEsp32
    });

    assert.equal(res.intent, 'ERROR_MOST_BY_MODE');
    assert.ok(res.answer.includes('Mode Arm'));
    assert.ok(res.answer.includes('40%'));
    // Must contain correlation vs causation disclaimer!
    assert.ok(res.answer.includes('Catatan Teknis Korelasi vs Kausalitas'));
    assert.ok(res.basis.includes('Basis Perhitungan:'));
    assert.ok(Array.isArray(res.suggestions) && res.suggestions.length > 0);
  });

  await t.test('10. Penanganan Database Kosong (Zero Data / Graceful Fallback)', () => {
    const emptyRes = assistant.processQuery('Berapa total produk?', { smart_factory: { sorting_line: {} } });
    assert.equal(emptyRes.intent, 'TOTAL_SORTING');
    assert.ok(emptyRes.answer.includes('Belum ada data'));
    assert.ok(emptyRes.basis.includes('0 data'));

    const emptyErr = assistant.processQuery('Kapan error terakhir?', { smart_factory: { sorting_line: {} } });
    assert.equal(emptyErr.intent, 'ERROR_LATEST');
    assert.ok(emptyErr.answer.includes('Kabar Baik') || emptyErr.answer.includes('Tidak ada riwayat error'));
  });

  await t.test('11. Transparansi Waktu WIB (Asia/Jakarta)', () => {
    const bounds = getDayBoundsWIB();
    assert.ok(bounds.startEpoch < bounds.endEpoch);
    assert.ok(bounds.label.includes('202')); // current or recent year

    const sampleDate = new Date('2026-11-15T00:00:00Z');
    const formatted = formatWIB(sampleDate, 'short');
    assert.ok(formatted.includes('WIB'));
  });

  await t.test('12. Query di Luar Domain (Out-of-Scope Fallback)', () => {
    const res = assistant.processQuery('Siapakah presiden Indonesia saat ini?');
    assert.equal(res.intent, 'UNKNOWN');
    assert.ok(res.answer.includes('VERNOVA Smart Data Assistant'));
    assert.ok(res.answer.toLowerCase().includes('pertanyaan yang dapat anda ajukan'));
    assert.ok(Array.isArray(res.suggestions));
  });

  await t.test('13. Intent Percakapan Ramah (Greeting, Identity, Help)', () => {
    const gRes = assistant.processQuery('Halo!');
    assert.equal(gRes.intent, 'GREETING');
    assert.ok(gRes.answer.includes('Halo!'));

    const idRes = assistant.processQuery('Kamu siapa?');
    assert.equal(idRes.intent, 'IDENTITY');
    assert.ok(idRes.answer.includes('VERNOVA Smart Data Assistant'));

    const hRes = assistant.processQuery('Bantuan');
    assert.equal(hRes.intent, 'HELP');
    assert.ok(hRes.answer.includes('Analitik Data yang Dapat Anda Tanyakan'));
  });
});
