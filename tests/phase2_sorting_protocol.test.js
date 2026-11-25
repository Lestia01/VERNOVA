/**
 * VERNOVA Phase 2 — Comprehensive Test Suite
 * Pengujian Two-Stage Execution, Mechanism-Aware Class Mapping,
 * Auto/Manual Mode Handshake, Transaction State Machine & Sensor Verification.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  DeviceConnectionManager,
  BaseDeviceAdapter,
  ESP32WiFiAdapter,
  ESP32BLEAdapter,
  MicrobitBLEAdapter,
  DEVICE_TYPES,
  CONNECTION_TYPES,
  CONNECTION_STATES,
  OPERATING_MODES,
  TRANSACTION_STATES,
  STATUS_CATEGORIES,
  MECHANISM_TYPES,
  CANONICAL_CLASSES,
  CLASS_REGISTRY,
  resolveClassAndMechanism
} = require('../assets/js/device-manager.js');

const { YoloStudioClient, AI_ENGINES } = require('../assets/js/yolo-client.js');

describe('VERNOVA Phase 2: Mechanism-Aware AI Detection & Protocol', () => {

  test('1. Validasi Konstanta Sistem & 6 Kelas Berorientasi Mekanisme', () => {
    assert.equal(OPERATING_MODES.AUTO, 'AUTO');
    assert.equal(OPERATING_MODES.MANUAL, 'MANUAL');

    assert.equal(TRANSACTION_STATES.AWAITING_MECHANISM_ACK, 'AWAITING_MECHANISM_ACK');
    assert.equal(TRANSACTION_STATES.AWAITING_CLASS_ACK, 'AWAITING_CLASS_ACK');
    assert.equal(TRANSACTION_STATES.SORTING, 'SORTING');
    assert.equal(TRANSACTION_STATES.VERIFYING, 'VERIFYING');
    assert.equal(TRANSACTION_STATES.COMPLETED, 'COMPLETED');

    assert.equal(STATUS_CATEGORIES.COMPLETED_UNVERIFIED, 'completed_unverified');
    assert.equal(STATUS_CATEGORIES.VERIFIED, 'verified');
    assert.equal(STATUS_CATEGORIES.TIMEOUT, 'timeout');
    assert.equal(STATUS_CATEGORIES.FAILED, 'failed');

    const expectedClasses = [
      'merah_arm', 'kuning_arm', 'biru_arm',
      'merah_servo', 'kuning_servo', 'biru_servo'
    ];

    expectedClasses.forEach(cls => {
      assert.ok(CLASS_REGISTRY[cls], `Kelas ${cls} harus terdaftar di CLASS_REGISTRY`);
      assert.ok(CLASS_REGISTRY[cls].color, `Warna pada ${cls} harus valid`);
      assert.ok(CLASS_REGISTRY[cls].mechanism, `Mekanisme pada ${cls} harus valid`);
    });
  });

  test('2. Fungsi Pemetaan Kelas Deterministik (resolveClassAndMechanism)', () => {
    // 2.1 Enam kelas berorientasi mekanisme
    const r1 = resolveClassAndMechanism('merah_arm');
    assert.equal(r1.valid, true);
    assert.equal(r1.color, 'merah');
    assert.equal(r1.mechanism, 'arm');
    assert.equal(r1.isMechanismAware, true);

    const r2 = resolveClassAndMechanism('kuning_servo');
    assert.equal(r2.valid, true);
    assert.equal(r2.color, 'kuning');
    assert.equal(r2.mechanism, 'servo');
    assert.equal(r2.isMechanismAware, true);

    const r3 = resolveClassAndMechanism('biru_arm');
    assert.equal(r3.valid, true);
    assert.equal(r3.color, 'biru');
    assert.equal(r3.mechanism, 'arm');

    // 2.2 Model warisan 3 warna dengan pemetaan eksplisit
    const legacyMap = { merah: 'servo', kuning: 'servo', biru: 'arm' };
    const rLegacyMerah = resolveClassAndMechanism('merah', legacyMap);
    assert.equal(rLegacyMerah.valid, true);
    assert.equal(rLegacyMerah.color, 'merah');
    assert.equal(rLegacyMerah.mechanism, 'servo');
    assert.equal(rLegacyMerah.mappedFromLegacy, true);

    const rLegacyBiru = resolveClassAndMechanism('biru', legacyMap);
    assert.equal(rLegacyBiru.valid, true);
    assert.equal(rLegacyBiru.color, 'biru');
    assert.equal(rLegacyBiru.mechanism, 'arm');

    // 2.3 Model warisan tanpa konfigurasi mekanisme tidak boleh menebak secara diam-diam
    const rUndefined = resolveClassAndMechanism('merah', {}, null);
    assert.equal(rUndefined.valid, false);
    assert.equal(rUndefined.error, 'MECHANISM_UNDEFINED');

    // 2.4 Kelas tidak valid
    const rInvalid = resolveClassAndMechanism('hijau_motor');
    assert.equal(rInvalid.valid, false);
    assert.equal(rInvalid.error, 'INVALID_COLOR');
  });

  test('3. Siklus Transaksi 2-Tahap (Two-Stage Sorting Cycle): ESP32 Wi-Fi Simulasi', async () => {
    const manager = new DeviceConnectionManager({
      deviceType: DEVICE_TYPES.ESP32,
      connectionType: CONNECTION_TYPES.WIFI,
      simulationMode: true
    });

    const events = [];
    manager.onStatusChange(e => {
      if (e.type === 'transaction_update') events.push(e.transaction.state);
    });

    const res = await manager.executeTwoStageSort('merah', 'arm', { source: 'AUTO' });
    assert.equal(res.ok, true);
    assert.equal(res.mode, 'arm');
    assert.equal(res.color, 'merah');
    assert.equal(res.status, TRANSACTION_STATES.COMPLETED);
    assert.equal(res.statusCategory, STATUS_CATEGORIES.COMPLETED_UNVERIFIED);
    assert.equal(res.verified, false);

    // Verifikasi urutan status state machine
    assert.ok(events.includes(TRANSACTION_STATES.AWAITING_MECHANISM_ACK), 'Harus melalui tahap AWAITING_MECHANISM_ACK');
    assert.ok(events.includes(TRANSACTION_STATES.AWAITING_CLASS_ACK), 'Harus melalui tahap AWAITING_CLASS_ACK');
    assert.ok(events.includes(TRANSACTION_STATES.SORTING), 'Harus melalui tahap SORTING');
    assert.ok(events.includes(TRANSACTION_STATES.COMPLETED), 'Harus mencapai tahap COMPLETED');
  });

  test('4. Siklus Transaksi 2-Tahap: ESP32 BLE & micro:bit BLE Simulasi', async () => {
    // 4.1 ESP32 BLE
    const bleManager = new DeviceConnectionManager({
      deviceType: DEVICE_TYPES.ESP32,
      connectionType: CONNECTION_TYPES.BLE,
      simulationMode: true
    });
    const bleRes = await bleManager.executeTwoStageSort('kuning', 'servo');
    assert.equal(bleRes.ok, true);
    assert.equal(bleRes.mode, 'servo');
    assert.equal(bleRes.status, TRANSACTION_STATES.COMPLETED);

    // 4.2 micro:bit BLE
    const mbitManager = new DeviceConnectionManager({
      deviceType: DEVICE_TYPES.MICROBIT,
      connectionType: CONNECTION_TYPES.BLE,
      simulationMode: true
    });
    const mbitRes = await mbitManager.executeTwoStageSort('biru', 'arm');
    assert.equal(mbitRes.ok, true);
    assert.equal(mbitRes.mode, 'arm');
    assert.equal(mbitRes.status, TRANSACTION_STATES.COMPLETED);
  });

  test('5. Mode Pengoperasian (AUTO vs MANUAL) & Mutual Exclusion', async () => {
    const manager = new DeviceConnectionManager({
      simulationMode: true
    });

    // Default adalah AUTO
    assert.equal(manager.getOperatingMode(), OPERATING_MODES.AUTO);

    // Pindah ke mode MANUAL
    const switchRes = manager.setOperatingMode(OPERATING_MODES.MANUAL);
    assert.equal(switchRes.ok, true);
    assert.equal(manager.getOperatingMode(), OPERATING_MODES.MANUAL);

    // Dalam mode MANUAL: pemicuan otomatis dari AI Vision wajib diabaikan
    const autoTrigger = await manager.dispatchSortingCommand({
      color: 'merah',
      class_name: 'merah_arm',
      manualOverride: false
    });
    assert.equal(autoTrigger.ok, false);
    assert.equal(autoTrigger.suppressed, true);
    assert.equal(autoTrigger.reason, 'MANUAL_MODE_ACTIVE');

    // Namun perintah Manual dari dashboard harus dapat dieksekusi
    const manualOrder = await manager.sendManualSort({
      color: 'merah',
      mechanism: 'arm'
    });
    assert.equal(manualOrder.ok, true);
    assert.equal(manualOrder.transaction.source, OPERATING_MODES.MANUAL);
    assert.equal(manualOrder.transaction.color, 'merah');
    assert.equal(manualOrder.transaction.mechanism, 'arm');

    // Kembalikan ke AUTO
    manager.setOperatingMode(OPERATING_MODES.AUTO);
    assert.equal(manager.getOperatingMode(), OPERATING_MODES.AUTO);
  });

  test('6. Pembedaan Status Selesai Belum Terverifikasi vs Terverifikasi Sensor', async () => {
    const manager = new DeviceConnectionManager({ simulationMode: true });

    // Mock sortObject tanpa sensor
    manager.getActiveAdapter().sortObject = async (color, mech, opts) => {
      return { ok: true, sensorVerified: false };
    };
    const resUnverified = await manager.executeTwoStageSort('kuning', 'servo');
    assert.equal(resUnverified.statusCategory, STATUS_CATEGORIES.COMPLETED_UNVERIFIED);
    assert.equal(resUnverified.verified, false);

    // Mock sortObject DENGAN konfirmasi sensor fisik
    manager.getActiveAdapter().sortObject = async (color, mech, opts) => {
      return { ok: true, sensorVerified: true };
    };
    const resVerified = await manager.executeTwoStageSort('kuning', 'servo');
    assert.equal(resVerified.statusCategory, STATUS_CATEGORIES.VERIFIED);
    assert.equal(resVerified.verified, true);
  });

  test('7. Ekstraksi Kelas Berorientasi Mekanisme pada YOLO Client', () => {
    const client = new YoloStudioClient();

    // 7.1 Deteksi kelas mekanisme-aware
    const samplePrediction = {
      model_id: 'model_phase2_v1',
      timestamp: Date.now(),
      detections: [
        {
          class_name: 'merah_arm',
          confidence: 0.92,
          bbox: [50, 60, 200, 220]
        },
        {
          class_name: 'biru_servo',
          confidence: 0.74,
          bbox: [300, 310, 400, 420]
        }
      ]
    };

    const top = client.extractTopColorDetection(samplePrediction, 0.70);
    assert.ok(top);
    assert.equal(top.color, 'merah');
    assert.equal(top.mechanism, 'arm');
    assert.equal(top.class_name, 'merah_arm');
    assert.equal(top.confidence, 0.92);

    // 7.2 Seleksi objek konsisten: confidence tertinggi dipilih
    const multiPrediction = {
      model_id: 'model_phase2_v1',
      detections: [
        { class_name: 'biru_servo', confidence: 0.72, bbox: [10, 10, 50, 50] },
        { class_name: 'kuning_arm', confidence: 0.88, bbox: [20, 20, 70, 70] }
      ]
    };
    const selected = client.extractTopColorDetection(multiPrediction, 0.60);
    assert.equal(selected.color, 'kuning');
    assert.equal(selected.mechanism, 'arm');
  });

  test('8. Emergency Stop & Penolakan Perintah saat Perangkat Sibuk', async () => {
    const manager = new DeviceConnectionManager({ simulationMode: true });

    // Uji Emergency Stop
    const stopRes = await manager.dispatchEmergencyStop();
    assert.equal(stopRes.ok, true);
    assert.equal(stopRes.status, 'STOPPED');

    // Uji penolakan jika transaksi sedang aktif
    manager.currentTransaction = {
      id: 'TX_TEST_ACTIVE',
      state: TRANSACTION_STATES.SORTING,
      startTime: Date.now()
    };

    assert.equal(manager.isTransactionActive(), true);

    const busyRes = await manager.dispatchSortingCommand({
      color: 'merah',
      mode: 'arm'
    });
    assert.equal(busyRes.ok, false);
    assert.equal(busyRes.busy, true);
    assert.equal(busyRes.reason, 'DEVICE_BUSY');

    // Bersihkan
    manager.currentTransaction = null;
    assert.equal(manager.isTransactionActive(), false);
  });
});
