/**
 * ==============================================================================
 * VERNOVA — Test Suite: 6-Class Color Sensor Verification & Yellow Sensor Integrity
 * 
 * Pengujian komprehensif untuk verifikasi sensor warna fisik end-to-end:
 * 1. Seluruh 6 kombinasi perintah sortir warna & mekanisme:
 *    - merah_arm    -> Target: Sensor Merah (GPIO 14)
 *    - merah_servo  -> Target: Sensor Merah (GPIO 14)
 *    - biru_arm     -> Target: Sensor Biru (GPIO 13)
 *    - biru_servo   -> Target: Sensor Biru (GPIO 13)
 *    - kuning_arm   -> Target: Sensor Kuning (GPIO 35)
 *    - kuning_servo -> Target: Sensor Kuning (GPIO 35)
 * 2. Integritas sensor kuning (GPIO 35):
 *    - Notifikasi SENSOR:KUNING:OBJECT_PRESENT diterima & dicatat di sensorState.sensors.kuning
 *    - Sinyal sensor kuning memverifikasi transaksi kuning_arm dan kuning_servo
 * 3. Penolakan sensor tidak cocok (Sensor Mismatch Rejection):
 *    - Sinyal sensor warna lain (misal Biru) TIDAK memverifikasi transaksi Kuning
 *    - Sensor ARM (GPIO 34) hanya menandai objek di pickup ARM, BUKAN wadah sortir
 * 4. Telemetri terpilah (Disaggregated Sensor Telemetry):
 *    - SENSOR:<WARNA>:OBJECT_PRESENT & OBJECT_ABSENT
 *    - Batch JSON {"telemetry":"sensors", ...}
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

test('VERNOVA 6-Class Color Sensor Verification & Yellow Sensor Integrity', async (t) => {

  await t.test('1. Pemetaan 4 Kanal Sensor Fisik & Inisialisasi Pin GPIO', async () => {
    const adapter = new ESP32BLEAdapter({ simulationMode: true });
    const sState = adapter.getSensorState();

    assert.ok(sState.sensors, 'sensorState harus memiliki kanal per sensor');
    assert.equal(sState.sensors.merah.pin, 14, 'Sensor Merah harus GPIO 14');
    assert.equal(sState.sensors.biru.pin, 13, 'Sensor Biru harus GPIO 13');
    assert.equal(sState.sensors.kuning.pin, 35, 'Sensor Kuning harus GPIO 35');
    assert.equal(sState.sensors.arm.pin, 34, 'Sensor ARM harus GPIO 34');

    // Default status awal: absent
    assert.equal(sState.sensors.kuning.objectPresent, false);
    assert.equal(sState.sensors.merah.objectPresent, false);
    assert.equal(sState.sensors.biru.objectPresent, false);
    assert.equal(sState.sensors.arm.objectPresent, false);
  });

  await t.test('2. Parsing Telemetri Terpilah SENSOR:KUNING:OBJECT_PRESENT & Integritas Sensor Kuning', async () => {
    const adapter = new ESP32BLEAdapter({ simulationMode: true });
    const events = [];
    adapter.onStatusChange(ev => events.push(ev));

    // Kirim telemetri sensor kuning mendeteksi objek
    adapter.receiveMockData('SENSOR:KUNING:OBJECT_PRESENT');

    const sState = adapter.getSensorState();
    assert.equal(sState.sensors.kuning.objectPresent, true, 'Sensor kuning harus terdeteksi (true)');
    assert.equal(sState.sensors.kuning.pin, 35);
    assert.equal(sState.sensors.merah.objectPresent, false, 'Sensor lain tidak boleh ikut aktif');
    assert.equal(sState.sensors.biru.objectPresent, false);

    // Event telemetri harus membawa detail kanal sensor
    const telemEv = events.find(e => e.type === 'sensor_telemetry' && e.sensorName === 'kuning');
    assert.ok(telemEv, 'Harus memancarkan event sensor_telemetry dengan sensorName=kuning');
    assert.equal(telemEv.pin, 35, 'Event harus memuat pin=35');
    assert.equal(telemEv.objectPresent, true);

    // Kirim telemetri sensor kuning objek keluar
    adapter.receiveMockData('SENSOR:KUNING:OBJECT_ABSENT');
    assert.equal(adapter.getSensorState().sensors.kuning.objectPresent, false);
  });

  await t.test('3. Batch JSON Telemetri Sinkronisasi (sendAllSensorStates)', async () => {
    const adapter = new ESP32BLEAdapter({ simulationMode: true });

    adapter.receiveMockData(JSON.stringify({
      telemetry: 'sensors',
      merah: false,
      biru: false,
      kuning: true,
      arm: false
    }));

    const sState = adapter.getSensorState();
    assert.equal(sState.sensors.kuning.objectPresent, true);
    assert.equal(sState.sensors.merah.objectPresent, false);
    assert.equal(sState.sensors.biru.objectPresent, false);
    assert.equal(sState.sensors.arm.objectPresent, false);
  });

  await t.test('4. Skenario kuning_servo: Selesai dengan Konfirmasi Sensor Kuning (GPIO 35) -> VERIFIED', async () => {
    const adapter = new ESP32BLEAdapter({ simulationMode: false });
    adapter.rxCharacteristic = { writeValue: async () => true, writeValueWithResponse: async () => true };
    adapter.status = 'READY';

    const sortPromise = adapter.sendSortingCommand({
      color: 'kuning',
      mode: 'Servo',
      commandId: 'TX_KUNING_SERVO_001',
      timeoutMs: 1500
    });

    // ESP32 mengirim konfirmasi servo selesai lalu sensor kuning mendeteksi
    adapter.receiveMockData('STATUS:SERVO_DONE\n');
    adapter.receiveMockData('SENSOR:KUNING:OBJECT_PRESENT\n');

    const result = await sortPromise;
    assert.equal(result.ok, true);
    assert.equal(result.status, 'VERIFIED');
    assert.equal(result.sensorVerified, true);
    assert.equal(result.color, 'kuning');
    assert.equal(result.mode, 'Servo');
  });

  await t.test('5. Skenario kuning_arm: Siklus Konveyor & Konfirmasi Sensor Kuning (GPIO 35) -> VERIFIED', async () => {
    const adapter = new ESP32BLEAdapter({ simulationMode: false });
    adapter.rxCharacteristic = { writeValue: async () => true, writeValueWithResponse: async () => true };
    adapter.status = 'READY';

    const sortPromise = adapter.sendSortingCommand({
      color: 'kuning',
      mode: 'Arm',
      commandId: 'TX_KUNING_ARM_002',
      timeoutMs: 1500
    });

    // Alur konveyor ARM:
    adapter.receiveMockData('STATUS:OBJECT_DETECTED\n'); // GPIO 34 ARM
    adapter.receiveMockData('STATUS:BELT_STOPPED\n');
    adapter.receiveMockData('STATUS:ARM_WORKING\n');
    adapter.receiveMockData('SENSOR:KUNING:OBJECT_PRESENT\n'); // GPIO 35 Kuning
    adapter.receiveMockData('STATUS:TARGET_DETECTED\n');
    adapter.receiveMockData('STATUS:BELT_RESUMED\n');

    const result = await sortPromise;
    assert.equal(result.ok, true);
    assert.equal(result.status, 'VERIFIED');
    assert.equal(result.sensorVerified, true);
    assert.equal(result.color, 'kuning');
    assert.equal(result.mode, 'Arm');
  });

  await t.test('6. Skenario merah_servo & merah_arm: Target Sensor Merah (GPIO 14) -> VERIFIED', async () => {
    const adapter = new ESP32BLEAdapter({ simulationMode: false });
    adapter.rxCharacteristic = { writeValue: async () => true, writeValueWithResponse: async () => true };
    adapter.status = 'READY';

    // 6a. merah_servo
    const sortServo = adapter.sendSortingCommand({
      color: 'merah',
      mode: 'Servo',
      commandId: 'TX_MERAH_SERVO_003',
      timeoutMs: 1500
    });
    adapter.receiveMockData('STATUS:SERVO_DONE\n');
    adapter.receiveMockData('SENSOR:MERAH:OBJECT_PRESENT\n');
    const resServo = await sortServo;
    assert.equal(resServo.status, 'VERIFIED');
    assert.equal(resServo.sensorVerified, true);

    // 6b. merah_arm
    const sortArm = adapter.sendSortingCommand({
      color: 'merah',
      mode: 'Arm',
      commandId: 'TX_MERAH_ARM_004',
      timeoutMs: 1500
    });
    adapter.receiveMockData('STATUS:OBJECT_DETECTED\n');
    adapter.receiveMockData('STATUS:BELT_STOPPED\n');
    adapter.receiveMockData('STATUS:ARM_WORKING\n');
    adapter.receiveMockData('SENSOR:MERAH:OBJECT_PRESENT\n');
    adapter.receiveMockData('STATUS:BELT_RESUMED\n');
    const resArm = await sortArm;
    assert.equal(resArm.status, 'VERIFIED');
    assert.equal(resArm.sensorVerified, true);
  });

  await t.test('7. Skenario biru_servo & biru_arm: Target Sensor Biru (GPIO 13) -> VERIFIED', async () => {
    const adapter = new ESP32BLEAdapter({ simulationMode: false });
    adapter.rxCharacteristic = { writeValue: async () => true, writeValueWithResponse: async () => true };
    adapter.status = 'READY';

    // 7a. biru_servo
    const sortServo = adapter.sendSortingCommand({
      color: 'biru',
      mode: 'Servo',
      commandId: 'TX_BIRU_SERVO_005',
      timeoutMs: 1500
    });
    adapter.receiveMockData('STATUS:SERVO_DONE\n');
    adapter.receiveMockData('SENSOR:BIRU:OBJECT_PRESENT\n');
    const resServo = await sortServo;
    assert.equal(resServo.status, 'VERIFIED');
    assert.equal(resServo.sensorVerified, true);

    // 7b. biru_arm
    const sortArm = adapter.sendSortingCommand({
      color: 'biru',
      mode: 'Arm',
      commandId: 'TX_BIRU_ARM_006',
      timeoutMs: 1500
    });
    adapter.receiveMockData('STATUS:OBJECT_DETECTED\n');
    adapter.receiveMockData('STATUS:BELT_STOPPED\n');
    adapter.receiveMockData('STATUS:ARM_WORKING\n');
    adapter.receiveMockData('SENSOR:BIRU:OBJECT_PRESENT\n');
    adapter.receiveMockData('STATUS:BELT_RESUMED\n');
    const resArm = await sortArm;
    assert.equal(resArm.status, 'VERIFIED');
    assert.equal(resArm.sensorVerified, true);
  });

  await t.test('8. Penolakan Sensor Tidak Cocok: Sensor Biru TIDAK memverifikasi sortir Kuning', async () => {
    const adapter = new ESP32BLEAdapter({ simulationMode: false });
    adapter.rxCharacteristic = { writeValue: async () => true, writeValueWithResponse: async () => true };
    adapter.status = 'READY';

    const sortPromise = adapter.sendSortingCommand({
      color: 'kuning',
      mode: 'Servo',
      commandId: 'TX_MISMATCH_007',
      timeoutMs: 1500
    });

    // Servo selesai tetapi sensor yang aktif adalah sensor biru (bukan kuning)
    adapter.receiveMockData('STATUS:SERVO_DONE\n');
    adapter.receiveMockData('SENSOR:BIRU:OBJECT_PRESENT\n');

    // Menunggu grace period (400ms) tanpa ada sensor kuning
    const result = await sortPromise;
    assert.equal(result.status, 'COMPLETED_UNVERIFIED', 'Sortir Kuning tidak boleh diverifikasi oleh sensor Biru');
    assert.equal(result.sensorVerified, false);
  });

  await t.test('9. Sensor ARM (GPIO 34) Hanya Mengonfirmasi Penjemputan, Bukan Verifikasi Wadah Tujuan', async () => {
    const adapter = new ESP32BLEAdapter({ simulationMode: false });
    adapter.rxCharacteristic = { writeValue: async () => true, writeValueWithResponse: async () => true };
    adapter.status = 'READY';

    const sortPromise = adapter.sendSortingCommand({
      color: 'kuning',
      mode: 'Arm',
      commandId: 'TX_ARM_ONLY_008',
      timeoutMs: 1500
    });

    // Sensor ARM aktif, belt stop, arm kerja, belt resume, TETAPI sensor kuning tidak pernah aktif
    adapter.receiveMockData('SENSOR:ARM:OBJECT_PRESENT\n');
    adapter.receiveMockData('STATUS:OBJECT_DETECTED\n');
    adapter.receiveMockData('STATUS:BELT_STOPPED\n');
    adapter.receiveMockData('STATUS:ARM_WORKING\n');
    adapter.receiveMockData('SENSOR:ARM:OBJECT_ABSENT\n');
    adapter.receiveMockData('STATUS:BELT_RESUMED\n');

    const result = await sortPromise;
    assert.equal(result.status, 'COMPLETED_UNVERIFIED', 'Sensor ARM saja tidak boleh memverifikasi sortir wadah tujuan');
    assert.equal(result.sensorVerified, false);
  });

  await t.test('10. Siklus Penuh DeviceConnectionManager executeTwoStageSort untuk Kuning', async () => {
    const manager = new DeviceConnectionManager({
      deviceType: DEVICE_TYPES.ESP32,
      connectionType: CONNECTION_TYPES.BLE
    });
    const adapter = manager.getActiveAdapter();
    adapter.connected = true;
    adapter._writeBLE = async () => {};

    // Set adapter agar membalas mechanism ack dan sensor kuning
    const sortTask = manager.executeTwoStageSort('kuning', 'servo', {
      transactionId: 'TX_MGR_KUNING_009'
    });

    // Balas kesiapan mekanisme
    adapter.receiveMockData('{"ack":"mechanism","mechanism":"servo","ok":true}\n');

    // Beri sedikit jeda mikro untuk transisi tahap 2
    await new Promise(r => setTimeout(r, 20));

    // Balas servo selesai dan sensor kuning terdeteksi
    adapter.receiveMockData('STATUS:SERVO_DONE\n');
    adapter.receiveMockData('SENSOR:KUNING:OBJECT_PRESENT\n');

    const result = await sortTask;
    assert.equal(result.ok, true);
    assert.equal(result.verified, true);
    assert.equal(result.statusCategory, STATUS_CATEGORIES.VERIFIED);
    assert.equal(result.color, 'kuning');
    assert.equal(result.mode, 'servo');
  });

});
