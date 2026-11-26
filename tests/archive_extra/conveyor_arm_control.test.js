/**
 * ==============================================================================
 * VERNOVA — Test Suite: Conveyor Belt & Robotic ARM State Machine Protocol
 * 
 * Pengujian logika kontrol conveyor dan ARM berbasis alur multi-sensor:
 * - PIN_SENSOR_MERAH  = 14
 * - PIN_SENSOR_BIRU   = 13
 * - PIN_SENSOR_KUNING = 35
 * - PIN_SENSOR_ARM    = 34
 * 
 * Skenario Pengujian:
 * 1. merah_arm: GPIO 34 deteksi objek -> belt berhenti -> ARM bekerja ->
 *    GPIO 14 deteksi objek -> GPIO 34 clear -> belt jalan kembali (VERIFIED).
 * 2. kuning_arm: GPIO 35 sebagai sensor tujuan terkonfirmasi (VERIFIED).
 * 3. biru_arm: GPIO 13 sebagai sensor tujuan terkonfirmasi (VERIFIED).
 * 4. Aturan Belt: Jika sensor tujuan terdeteksi lebih dulu tetapi GPIO 34 masih aktif,
 *    belt harus tetap berhenti.
 * 5. Aturan Verifikasi: Jika GPIO 34 clear tetapi sensor tujuan belum terdeteksi,
 *    transaksi TIDAK boleh ditandai VERIFIED (harus COMPLETED_UNVERIFIED).
 * 6. Emisi tahapan proses BLE ke website: OBJECT_DETECTED, BELT_STOPPED,
 *    ARM_WORKING, TARGET_DETECTED, BELT_RESUMED.
 * 7. Mode Simulasi ARM Cycle.
 * ==============================================================================
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEVICE_TYPES,
  CONNECTION_TYPES,
  TRANSACTION_STATES,
  STATUS_CATEGORIES,
  ESP32BLEAdapter,
  DeviceConnectionManager
} = require('../assets/js/device-manager.js');

test('VERNOVA Conveyor & ARM State Machine Control Protocol', async (t) => {

  await t.test('1. Skenario merah_arm: GPIO 34 -> Belt Stop -> ARM Work -> GPIO 14 (Merah) -> GPIO 34 Clear -> Belt Resume (VERIFIED)', async () => {
    const adapter = new ESP32BLEAdapter({ simulationMode: false });
    adapter.rxCharacteristic = {
      writeValue: async () => true,
      writeValueWithResponse: async () => true
    };
    adapter.status = 'READY';

    const stageEvents = [];
    adapter.onStatusChange((ev) => {
      if (ev.type === 'stage_update') stageEvents.push(ev.stage);
    });

    const sortPromise = adapter.sendSortingCommand({
      color: 'merah',
      mode: 'Arm',
      canonicalClass: 'merah_arm',
      commandId: 'TX_ARM_MERAH_001',
      timeoutMs: 4000
    });

    // Simulasikan urutan pesan dari firmware ESP32 BLE state machine
    setTimeout(() => {
      // Step 1: Objek tiba di area ARM (GPIO 34 aktif)
      adapter.receiveMockData('STATUS:OBJECT_DETECTED\n');
      adapter.receiveMockData('STATUS:BELT_STOPPED\n');

      // Step 2: ARM memindahkan objek
      adapter.receiveMockData('STATUS:ARM_WORKING\n');

      // Step 3: Sensor merah GPIO 14 mendeteksi objek sampai di wadah merah
      adapter.receiveMockData('STATUS:TARGET_DETECTED\n');

      // Step 4: Objek sudah lepas dari GPIO 34, belt berjalan kembali
      adapter.receiveMockData('STATUS:BELT_RESUMED\n');
    }, 40);

    const result = await sortPromise;
    assert.equal(result.ok, true);
    assert.equal(result.color, 'merah');
    assert.equal(result.mode, 'Arm');
    assert.equal(result.status, 'VERIFIED');
    assert.equal(result.sensorVerified, true);
    assert.equal(result.verified, true);

    // Pastikan urutan tahapan tepat
    assert.deepEqual(stageEvents, [
      'OBJECT_DETECTED',
      'BELT_STOPPED',
      'ARM_WORKING',
      'TARGET_DETECTED',
      'BELT_RESUMED'
    ]);
  });

  await t.test('2. Skenario kuning_arm: Menggunakan GPIO 35 sebagai Sensor Tujuan', async () => {
    const adapter = new ESP32BLEAdapter({ simulationMode: false });
    adapter.rxCharacteristic = {
      writeValue: async () => true,
      writeValueWithResponse: async () => true
    };
    adapter.status = 'READY';

    const sortPromise = adapter.sendSortingCommand({
      color: 'kuning',
      mode: 'Arm',
      canonicalClass: 'kuning_arm',
      commandId: 'TX_ARM_KUNING_002',
      timeoutMs: 4000
    });

    setTimeout(() => {
      adapter.receiveMockData('STATUS:OBJECT_DETECTED\nSTATUS:BELT_STOPPED\n');
      adapter.receiveMockData('STATUS:ARM_WORKING\n');
      // Konfirmasi GPIO 35 (Kuning)
      adapter.receiveMockData('STATUS:TARGET_DETECTED\n');
      adapter.receiveMockData('STATUS:BELT_RESUMED\n');
    }, 40);

    const result = await sortPromise;
    assert.equal(result.ok, true);
    assert.equal(result.color, 'kuning');
    assert.equal(result.mode, 'Arm');
    assert.equal(result.status, 'VERIFIED');
    assert.equal(result.sensorVerified, true);
  });

  await t.test('3. Skenario biru_arm: Menggunakan GPIO 13 sebagai Sensor Tujuan', async () => {
    const adapter = new ESP32BLEAdapter({ simulationMode: false });
    adapter.rxCharacteristic = {
      writeValue: async () => true,
      writeValueWithResponse: async () => true
    };
    adapter.status = 'READY';

    const sortPromise = adapter.sendSortingCommand({
      color: 'biru',
      mode: 'Arm',
      canonicalClass: 'biru_arm',
      commandId: 'TX_ARM_BIRU_003',
      timeoutMs: 4000
    });

    setTimeout(() => {
      adapter.receiveMockData('STATUS:OBJECT_DETECTED\nSTATUS:BELT_STOPPED\n');
      adapter.receiveMockData('STATUS:ARM_WORKING\n');
      // Konfirmasi GPIO 13 (Biru)
      adapter.receiveMockData('STATUS:TARGET_DETECTED\n');
      adapter.receiveMockData('STATUS:BELT_RESUMED\n');
    }, 40);

    const result = await sortPromise;
    assert.equal(result.ok, true);
    assert.equal(result.color, 'biru');
    assert.equal(result.mode, 'Arm');
    assert.equal(result.status, 'VERIFIED');
    assert.equal(result.sensorVerified, true);
  });

  await t.test('4. Aturan Belt: Jika Target Terdeteksi lebih dahulu tapi GPIO 34 masih aktif, Belt Tetap Berhenti', async () => {
    const adapter = new ESP32BLEAdapter({ simulationMode: false });
    adapter.rxCharacteristic = {
      writeValue: async () => true,
      writeValueWithResponse: async () => true
    };
    adapter.status = 'READY';

    let isBeltStopped = false;
    let isBeltResumedBeforeClear = false;

    adapter.onStatusChange((ev) => {
      if (ev.stage === 'BELT_STOPPED') isBeltStopped = true;
      if (ev.stage === 'BELT_RESUMED' && !adapter.armClearConfirmed) {
        isBeltResumedBeforeClear = true;
      }
    });

    const sortPromise = adapter.sendSortingCommand({
      color: 'merah',
      mode: 'Arm',
      commandId: 'TX_BELT_RULE_004',
      timeoutMs: 4000
    });

    // Step 1: Objek di GPIO 34, belt stop, ARM work
    adapter.receiveMockData('STATUS:OBJECT_DETECTED\nSTATUS:BELT_STOPPED\n');
    assert.equal(isBeltStopped, true, 'Belt harus berhenti saat objek di GPIO 34');

    // Step 2: Sensor tujuan mendeteksi objek terlebih dahulu
    adapter.receiveMockData('STATUS:TARGET_DETECTED\n');

    // Pada titik ini, BELT_RESUMED belum boleh dipancarkan karena GPIO 34 masih memegang objek
    assert.equal(adapter.beltRunning, false, 'Belt harus tetap berhenti meskipun sensor tujuan sudah mendeteksi');

    // Step 3: Sekarang GPIO 34 clear, belt baru berjalan kembali
    adapter.armClearConfirmed = true;
    adapter.receiveMockData('STATUS:BELT_RESUMED\n');

    const result = await sortPromise;
    assert.equal(result.ok, true);
    assert.equal(result.status, 'VERIFIED');
    assert.equal(adapter.beltRunning, true);
  });

  await t.test('5. Aturan Verifikasi: GPIO 34 Clear tetapi Sensor Tujuan Belum Terdeteksi -> COMPLETED_UNVERIFIED', async () => {
    const adapter = new ESP32BLEAdapter({ simulationMode: false });
    adapter.rxCharacteristic = {
      writeValue: async () => true,
      writeValueWithResponse: async () => true
    };
    adapter.status = 'READY';

    const sortPromise = adapter.sendSortingCommand({
      color: 'merah',
      mode: 'Arm',
      commandId: 'TX_UNVERIF_RULE_005',
      timeoutMs: 4000
    });

    setTimeout(() => {
      // Objek lewat GPIO 34, ARM bekerja
      adapter.receiveMockData('STATUS:OBJECT_DETECTED\nSTATUS:BELT_STOPPED\n');
      adapter.receiveMockData('STATUS:ARM_WORKING\n');
      
      // SENSOR TUJUAN GAGAL/TIDAK DETEKSI (misal objek jatuh keluar lintasan)
      // Namun GPIO 34 sudah tidak mendeteksi objek lagi
      adapter.receiveMockData('STATUS:BELT_RESUMED\n');
    }, 40);

    const result = await sortPromise;
    assert.equal(result.ok, true);
    assert.equal(result.sensorVerified, false, 'Tidak boleh diverifikasi jika sensor tujuan tidak mendeteksi');
    assert.equal(result.verified, false);
    assert.equal(result.status, 'COMPLETED_UNVERIFIED');
  });

  await t.test('6. Siklus End-to-End DeviceConnectionManager executeTwoStageSort dengan Tahapan ARM', async () => {
    const manager = new DeviceConnectionManager({
      deviceType: DEVICE_TYPES.ESP32,
      connectionType: CONNECTION_TYPES.BLE,
      simulationMode: false
    });

    const ble = manager.getActiveAdapter();
    ble.rxCharacteristic = {
      writeValue: async () => true,
      writeValueWithResponse: async () => true
    };
    ble.status = 'READY';

    const sortPromise = manager.executeTwoStageSort('merah', 'arm', { sortTimeoutMs: 3000 });

    setTimeout(() => {
      ble.receiveMockData('STATUS:OBJECT_DETECTED\n');
      ble.receiveMockData('STATUS:BELT_STOPPED\n');
      ble.receiveMockData('STATUS:ARM_WORKING\n');
      ble.receiveMockData('STATUS:TARGET_DETECTED\n');
      ble.receiveMockData('STATUS:BELT_RESUMED\n');
    }, 50);

    const res = await sortPromise;
    assert.equal(res.ok, true);
    assert.equal(res.mode, 'arm');
    assert.equal(res.color, 'merah');
    assert.equal(res.verified, true);
    assert.equal(res.statusCategory, STATUS_CATEGORIES.VERIFIED);
    assert.equal(res.status, TRANSACTION_STATES.COMPLETED);
  });

  await t.test('7. Mode Simulasi ARM Cycle (Virtual Hardware)', async () => {
    const adapter = new ESP32BLEAdapter({ simulationMode: true });
    const stages = [];
    adapter.onStatusChange((ev) => {
      if (ev.type === 'stage_update') stages.push(ev.stage);
    });

    // Simulasi dengan target terverifikasi
    const resVerified = await adapter.sendSortingCommand({
      color: 'biru',
      mode: 'Arm',
      simulateSensorVerification: true
    });

    assert.equal(resVerified.ok, true);
    assert.equal(resVerified.status, 'VERIFIED');
    assert.equal(resVerified.verified, true);
    assert.deepEqual(stages, [
      'OBJECT_DETECTED',
      'BELT_STOPPED',
      'ARM_WORKING',
      'TARGET_DETECTED',
      'BELT_RESUMED'
    ]);

    // Simulasi tanpa target terverifikasi
    const resUnverified = await adapter.sendSortingCommand({
      color: 'kuning',
      mode: 'Arm',
      simulateSensorVerification: false,
      simulateTargetDetected: false
    });

    assert.equal(resUnverified.ok, true);
    assert.equal(resUnverified.status, 'COMPLETED_UNVERIFIED');
    assert.equal(resUnverified.verified, false);
  });

});
