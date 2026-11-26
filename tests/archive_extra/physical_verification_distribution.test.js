/**
 * VERNOVA — Physical Verification Sorting Distribution Test Suite
 * 
 * Memverifikasi revisi Distribusi Penyortiran agar hanya transaksi
 * yang telah terverifikasi secara fisik oleh sensor (VERIFIED) yang dihitung
 * sebagai keberhasilan pada grafik 6-kategori (Warna — Mekanisme).
 * 
 * Pengujian Wajib Skenario A s.d. H sesuai spesifikasi master prompt.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert');

const {
  classifyTransaction,
  aggregateSortingDistribution,
  STATUS_CATEGORIES,
  OPERATING_MODES,
  DeviceConnectionManager
} = require('../assets/js/device-manager.js');

describe('VERNOVA — Revisi Distribusi Penyortiran Berdasarkan Verifikasi Fisik', () => {

  test('Skenario A: 10 transaksi unik VERIFIED menambah nilai distribusi 10', () => {
    const transactions = [];
    // 5 Arm (2 merah, 2 kuning, 1 biru), 5 Servo (1 merah, 2 kuning, 2 biru)
    const specs = [
      { color: 'merah', mech: 'arm' },
      { color: 'merah', mech: 'arm' },
      { color: 'kuning', mech: 'arm' },
      { color: 'kuning', mech: 'arm' },
      { color: 'biru', mech: 'arm' },
      { color: 'merah', mech: 'servo' },
      { color: 'kuning', mech: 'servo' },
      { color: 'kuning', mech: 'servo' },
      { color: 'biru', mech: 'servo' },
      { color: 'biru', mech: 'servo' }
    ];

    specs.forEach((s, i) => {
      transactions.push({
        transactionId: `txn_scen_a_${i}`,
        warna: s.color,
        mechanism: s.mech,
        status: 'Berhasil (Terverifikasi)',
        statusCategory: 'verified',
        verificationStatus: 'verified',
        verified: true,
        sensorVerified: true,
        nilai: 1
      });
    });

    const result = aggregateSortingDistribution(transactions);

    assert.strictEqual(result.totalVerified, 10, 'Total verified harus 10');
    assert.strictEqual(result.total, 10, 'Total keberhasilan harus 10');
    assert.strictEqual(result.unverifiedTotal, 0, 'Total unverified harus 0');
    assert.strictEqual(result.gagal, 0, 'Total error harus 0');
    assert.strictEqual(result.merah_arm, 2);
    assert.strictEqual(result.kuning_arm, 2);
    assert.strictEqual(result.biru_arm, 1);
    assert.strictEqual(result.merah_servo, 1);
    assert.strictEqual(result.kuning_servo, 2);
    assert.strictEqual(result.biru_servo, 2);
    assert.strictEqual(result.armTotal, 5);
    assert.strictEqual(result.servoTotal, 5);
    assert.strictEqual(result.totalAttempts, 10);
    assert.strictEqual(result.verifiedSuccessRate, 100.0);
  });

  test('Skenario B: 3 transaksi COMPLETED_UNVERIFIED tidak menambah distribusi keberhasilan dan tidak menjadi error', () => {
    const transactions = [
      {
        transactionId: 'txn_unver_1',
        warna: 'merah',
        mechanism: 'arm',
        status: 'Berhasil (Belum Terverifikasi Fisik)',
        statusCategory: 'completed_unverified',
        verificationStatus: 'completed_unverified',
        verified: false,
        nilai: 0
      },
      {
        transactionId: 'txn_unver_2',
        warna: 'kuning',
        mechanism: 'servo',
        status: 'Berhasil (Belum Terverifikasi Fisik)',
        statusCategory: 'completed_unverified',
        verificationStatus: 'completed_unverified',
        verified: false,
        nilai: 0
      },
      {
        transactionId: 'txn_unver_3',
        warna: 'biru',
        mechanism: 'arm',
        status: 'Berhasil (Belum Terverifikasi Fisik)',
        statusCategory: 'completed_unverified',
        verificationStatus: 'completed_unverified',
        verified: false,
        nilai: 0
      }
    ];

    const result = aggregateSortingDistribution(transactions);

    // Distribusi keberhasilan HARUS 0
    assert.strictEqual(result.totalVerified, 0, 'Total verified tidak boleh bertambah');
    assert.strictEqual(result.total, 0, 'Total keberhasilan tidak boleh bertambah');
    assert.strictEqual(result.merah_arm, 0);
    assert.strictEqual(result.kuning_servo, 0);
    assert.strictEqual(result.biru_arm, 0);
    assert.strictEqual(result.merah, 0);
    assert.strictEqual(result.kuning, 0);
    assert.strictEqual(result.biru, 0);

    // Unverified bertambah 3
    assert.strictEqual(result.unverifiedTotal, 3, 'Total unverified harus 3');
    assert.strictEqual(result.unverified.merah, 1);
    assert.strictEqual(result.unverified.kuning, 1);
    assert.strictEqual(result.unverified.biru, 1);

    // TIDAK otomatis menjadi error
    assert.strictEqual(result.gagal, 0, 'Unverified tidak boleh otomatis dianggap error');
    assert.strictEqual(result.totalAttempts, 3, 'Total percobaan yang relevan harus 3');
    assert.strictEqual(result.verifiedSuccessRate, 0.0);
  });

  test('Skenario C: 2 transaksi gagal dengan penyebab terkonfirmasi menambah analitik error', () => {
    const transactions = [
      {
        transactionId: 'txn_err_1',
        warna: 'merah',
        mechanism: 'arm',
        sortResult: 'error',
        executionStatus: 'failed',
        status: 'Timeout/Error',
        errorCode: 'ERR_WATCHDOG_12S',
        nilai: 0
      },
      {
        transactionId: 'txn_err_2',
        warna: 'kuning',
        mechanism: 'servo',
        sortResult: 'error',
        commandStatus: 'force_timeout',
        status: 'Force Timeout',
        errorCode: 'ERR_FORCE_TIMEOUT',
        nilai: 0
      }
    ];

    const result = aggregateSortingDistribution(transactions);

    assert.strictEqual(result.totalVerified, 0, 'Error tidak boleh menambah distribusi');
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.unverifiedTotal, 0);
    assert.strictEqual(result.gagal, 2, 'Error terkonfirmasi harus berjumlah 2');
    assert.strictEqual(result.totalAttempts, 2);
    assert.strictEqual(result.verifiedSuccessRate, 0.0);
  });

  test('Skenario D: Transaksi yang sama diproses berulang tidak mengalami double-counting', () => {
    const singleTx = {
      transactionId: 'txn_unique_duplicate_test',
      warna: 'biru',
      mechanism: 'arm',
      status: 'Berhasil (Terverifikasi)',
      statusCategory: 'verified',
      verified: true,
      nilai: 1
    };

    // Dikirim 5 kali (misal multiple snapshots atau repeat push)
    const duplicateList = [singleTx, singleTx, singleTx, singleTx, singleTx];

    const result = aggregateSortingDistribution(duplicateList);

    assert.strictEqual(result.totalVerified, 1, 'Hanya boleh dihitung 1 kali');
    assert.strictEqual(result.biru_arm, 1, 'Kategori biru_arm hanya boleh bertambah 1');
    assert.strictEqual(result.totalAttempts, 1, 'Percobaan unik hanya 1');
  });

  test('Skenario E: Objek terdeteksi Merah tanpa konfirmasi sensor fisik TIDAK masuk distribusi keberhasilan', () => {
    const cameraDetectedItem = {
      transactionId: 'txn_ai_det_red',
      detectedColor: 'Merah',
      warna: 'Merah',
      predictedClass: 'merah_arm',
      confidence: 0.98,
      mechanism: 'arm',
      status: 'Berhasil (Belum Terverifikasi Fisik)',
      statusCategory: 'completed_unverified',
      verified: false,
      sensorVerified: false,
      nilai: 0
    };

    const result = aggregateSortingDistribution([cameraDetectedItem]);

    assert.strictEqual(result.merah_arm, 0, 'Deteksi AI tanpa sensor fisik tidak boleh masuk merah_arm');
    assert.strictEqual(result.merah, 0, 'Deteksi AI tanpa sensor fisik tidak boleh menambah subtotal merah');
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.unverifiedTotal, 1);
  });

  test('Skenario F: Sensor mengonfirmasi objek masuk wadah tujuan yang benar masuk distribusi sesuai warna dan mekanisme aktual', () => {
    const verifiedItem = {
      transactionId: 'txn_physical_sensor_confirm_1',
      warna: 'kuning',
      mechanism: 'servo',
      status: 'Berhasil (Terverifikasi)',
      statusCategory: 'verified',
      verificationStatus: 'verified',
      verified: true,
      sensorVerified: true,
      nilai: 1
    };

    const result = aggregateSortingDistribution([verifiedItem]);

    assert.strictEqual(result.kuning_servo, 1, 'Harus masuk kategori kuning_servo');
    assert.strictEqual(result.kuning, 1);
    assert.strictEqual(result.servoTotal, 1);
    assert.strictEqual(result.totalVerified, 1);
    assert.strictEqual(result.unverifiedTotal, 0);
  });

  test('Skenario G: Perangkat tanpa sensor verifikasi fisik tetap berstatus COMPLETED_UNVERIFIED', async () => {
    const mgr = new DeviceConnectionManager({ simulationMode: true });
    
    // Kirim perintah sortir melalui adapter
    const sortRes = await mgr.sendManualSort({ color: 'merah', mechanism: 'arm' });

    assert.strictEqual(sortRes.ok, true);
    // Karena mode simulasi atau firmware standar belum memiliki sensor fisik nyata terpicu:
    assert.strictEqual(sortRes.verified, false, 'Tanpa sensor fisik, verified harus false');
    assert.strictEqual(sortRes.statusCategory, 'completed_unverified', 'Status category harus completed_unverified');

    const classified = classifyTransaction(sortRes);
    assert.strictEqual(classified.status, 'COMPLETED_UNVERIFIED');
  });

  test('Skenario H: Data lama Firebase tanpa bukti verifikasi eksplisit ditangani kompatibel sebagai belum terverifikasi', () => {
    // Data warisan era v2.0 / v2.4 sebelum ada protokol verifikasi sensor
    const legacyFirebaseItems = [
      {
        // Format kuno: hanya ada timestamp, warna, status 'Berhasil', tanpa field verified
        timestamp: 1730000000000,
        warna: 'Biru',
        mode: 'Arm',
        status: 'Berhasil',
        duration: 1200
      },
      {
        // Format legacy 3 warna
        timestamp: 1730000001000,
        warna: 'Kuning',
        mode: 'Servo',
        status: 'Berhasil',
        duration: 900
      },
      {
        // Record error lama
        timestamp: 1730000002000,
        warna: 'Merah',
        status: 'Timeout/Error',
        errorCode: 'ERR_TIMEOUT'
      }
    ];

    const result = aggregateSortingDistribution(legacyFirebaseItems);

    // Transaksi lama TIDAK BOLEH diasumsikan terverifikasi tanpa bukti
    assert.strictEqual(result.totalVerified, 0, 'Transaksi legacy tanpa field sensor tidak boleh dianggap terverifikasi');
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.biru_arm, 0);
    assert.strictEqual(result.kuning_servo, 0);

    // Tetapi tetap tercatat sebagai unverified untuk integritas audit
    assert.strictEqual(result.unverifiedTotal, 2, '2 record berhasil legacy dicatat unverified');
    assert.strictEqual(result.gagal, 1, '1 record error dicatat gagal');
    assert.strictEqual(result.totalAttempts, 3);
  });

});
