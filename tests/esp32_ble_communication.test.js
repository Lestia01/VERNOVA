/**
 * ==============================================================================
 * VERNOVA — Test Suite: ESP32 BLE Communication & Sensor Telemetry Protocol
 * 
 * Pengujian komprehensif untuk perbaikan sistem komunikasi BLE antara website
 * VERNOVA dan ESP32:
 * 1. Penerimaan & parsing pesan teks: SENSOR:OBJECT_PRESENT, SENSOR:OBJECT_ABSENT,
 *    STATUS:SERVO_DONE, STATUS:COMPLETED_UNVERIFIED, dan JSON.
 * 2. Integrasi data sensor ke telemetri real-time website & dashboard.
 * 3. Korelasi respons sensor dengan transaksi pemilahan 2-tahap yang sedang berjalan.
 * 4. Pembedaan tegas status VERIFIED vs COMPLETED_UNVERIFIED (hanya jika ada sensor fisik).
 * 5. Debugging log konsol [BLE TX] dan [BLE RX].
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

test('VERNOVA ESP32 BLE Communication & Sensor Telemetry Protocol', async (t) => {

  await t.test('1. Debugging Console Logs ([BLE TX] dan [BLE RX])', async () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(' '));
      origLog(...args);
    };

    try {
      const adapter = new ESP32BLEAdapter({ simulationMode: true });

      // Uji logging pengiriman pesan [BLE TX]
      await adapter._writeBLE('{"cmd":"test_pulse"}');
      assert.ok(logs.some(l => l.includes('[BLE TX] {"cmd":"test_pulse"}')), 'Harus mencatat log [BLE TX]');

      // Uji logging penerimaan pesan [BLE RX]
      adapter._handleIncomingData('SENSOR:OBJECT_PRESENT\n');
      assert.ok(logs.some(l => l.includes('[BLE RX] SENSOR:OBJECT_PRESENT')), 'Harus mencatat log [BLE RX]');
    } finally {
      console.log = origLog;
    }
  });

  await t.test('2. Parsing Pesan Teks Protokol Sensor ESP32 BLE', async () => {
    const adapter = new ESP32BLEAdapter({ simulationMode: true });

    // SENSOR:OBJECT_PRESENT
    adapter._handleIncomingData('SENSOR:OBJECT_PRESENT');
    let state = adapter.getSensorState();
    assert.equal(state.state, 'OBJECT_PRESENT');
    assert.equal(state.objectPresent, true);

    // SENSOR:OBJECT_ABSENT
    adapter._handleIncomingData('SENSOR:OBJECT_ABSENT');
    state = adapter.getSensorState();
    assert.equal(state.state, 'OBJECT_ABSENT');
    assert.equal(state.objectPresent, false);

    // Multiline pesan teks bercampur
    adapter._handleIncomingData("STATUS:SERVO_DONE\r\nSENSOR:OBJECT_PRESENT\r\n");
    state = adapter.getSensorState();
    assert.equal(state.objectPresent, true);
  });

  await t.test('3. Emisi Telemetri Sensor Real-Time ke Listener & DeviceConnectionManager', async () => {
    const manager = new DeviceConnectionManager({
      deviceType: DEVICE_TYPES.ESP32,
      connectionType: CONNECTION_TYPES.BLE,
      simulationMode: true
    });

    const receivedEvents = [];
    manager.onStatusChange((ev) => {
      if (ev.type === 'sensor_telemetry') {
        receivedEvents.push(ev);
      }
    });

    const bleAdapter = manager.getActiveAdapter();
    assert.ok(bleAdapter instanceof ESP32BLEAdapter);

    // Kirim notifikasi sensor objek terdeteksi
    bleAdapter.receiveMockData('SENSOR:OBJECT_PRESENT');
    assert.equal(receivedEvents.length, 1);
    assert.equal(receivedEvents[0].sensorState.objectPresent, true);
    assert.equal(receivedEvents[0].sensorState.state, 'OBJECT_PRESENT');
    assert.equal(manager.getSensorState().objectPresent, true);

    // Kirim notifikasi sensor objek tidak terdeteksi
    bleAdapter.receiveMockData('SENSOR:OBJECT_ABSENT');
    assert.equal(receivedEvents.length, 2);
    assert.equal(receivedEvents[1].sensorState.objectPresent, false);
    assert.equal(receivedEvents[1].sensorState.state, 'OBJECT_ABSENT');
    assert.equal(manager.getSensorState().objectPresent, false);
  });

  await t.test('4. Korelasi Transaksi Sortir dengan Verifikasi Sensor Fisik (VERIFIED)', async () => {
    const adapter = new ESP32BLEAdapter({ simulationMode: false });
    
    // Mock karakteristik RX dan TX
    adapter.rxCharacteristic = {
      writeValue: async () => true,
      writeValueWithResponse: async () => true
    };
    adapter.status = 'READY';

    // Jalankan perintah sortir di latar belakang
    const sortPromise = adapter.sendSortingCommand({
      color: 'biru',
      mode: 'Arm',
      commandId: 'TX_BLE_VERIF_001',
      timeoutMs: 3000
    });

    // Simulasikan respons ESP32: Servo selesai + Sensor konfirmasi objek hadir
    setTimeout(() => {
      adapter.receiveMockData('STATUS:SERVO_DONE');
      adapter.receiveMockData('SENSOR:OBJECT_PRESENT');
    }, 50);

    const result = await sortPromise;
    assert.equal(result.ok, true);
    assert.equal(result.sensorVerified, true);
    assert.equal(result.verified, true);
    assert.equal(result.status, 'VERIFIED');
    assert.equal(result.color, 'biru');
  });

  await t.test('5. Korelasi Transaksi Sortir Tanpa Bukti Sensor Fisik (COMPLETED_UNVERIFIED)', async () => {
    const adapter = new ESP32BLEAdapter({ simulationMode: false });
    
    adapter.rxCharacteristic = {
      writeValue: async () => true,
      writeValueWithResponse: async () => true
    };
    adapter.status = 'READY';

    const sortPromise = adapter.sendSortingCommand({
      color: 'kuning',
      mode: 'Servo',
      commandId: 'TX_BLE_UNVERIF_002',
      timeoutMs: 3000
    });

    // Simulasikan respons ESP32: Selesai unverified eksplisit
    setTimeout(() => {
      adapter.receiveMockData('STATUS:COMPLETED_UNVERIFIED');
    }, 50);

    const result = await sortPromise;
    assert.equal(result.ok, true);
    assert.equal(result.sensorVerified, false);
    assert.equal(result.verified, false);
    assert.equal(result.status, 'COMPLETED_UNVERIFIED');
  });

  await t.test('6. Siklus End-to-End executeTwoStageSort dengan Sensor Fisik Aktif', async () => {
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

    const sortPromise = manager.executeTwoStageSort('merah', 'servo', { sortTimeoutMs: 3000 });

    // ESP32 mengembalikan konfirmasi servo done dan sensor object present
    setTimeout(() => {
      ble.receiveMockData('STATUS:SERVO_DONE\nSENSOR:OBJECT_PRESENT\n');
    }, 60);

    const res = await sortPromise;
    assert.equal(res.ok, true);
    assert.equal(res.verified, true);
    assert.equal(res.statusCategory, STATUS_CATEGORIES.VERIFIED);
    assert.equal(res.status, TRANSACTION_STATES.COMPLETED);
    assert.equal(res.transaction.verified, true);
  });

  await t.test('7. Siklus End-to-End executeTwoStageSort Tanpa Sensor Fisik (COMPLETED_UNVERIFIED)', async () => {
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

    const sortPromise = manager.executeTwoStageSort('kuning', 'servo', { sortTimeoutMs: 3000 });

    // ESP32 mengembalikan respons servo done tetapi sensor tidak mendeteksi objek
    setTimeout(() => {
      ble.receiveMockData('STATUS:SERVO_DONE\nSENSOR:OBJECT_ABSENT\n');
    }, 60);

    const res = await sortPromise;
    assert.equal(res.ok, true);
    assert.equal(res.verified, false);
    assert.equal(res.statusCategory, STATUS_CATEGORIES.COMPLETED_UNVERIFIED);
    assert.equal(res.status, TRANSACTION_STATES.COMPLETED);
    assert.equal(res.transaction.verified, false);
  });

  await t.test('8. Parsing JSON Terintegrasi Sensor & Backward Compatibility', async () => {
    const adapter = new ESP32BLEAdapter({ simulationMode: false });
    adapter.rxCharacteristic = {
      writeValue: async () => true,
      writeValueWithResponse: async () => true
    };
    adapter.status = 'READY';

    const sortPromise = adapter.sendSortingCommand({
      color: 'biru',
      mode: 'Arm',
      commandId: 'TX_JSON_003',
      timeoutMs: 3000
    });

    // Simulasikan payload JSON dari firmware ESP32 versi 2.1.0-ble
    setTimeout(() => {
      adapter.receiveMockData('{"ok":true,"ack":"sort","color":"biru","status":"COMPLETED","sensorVerified":true,"id":"TX_JSON_003"}\n');
    }, 50);

    const res = await sortPromise;
    assert.equal(res.ok, true);
    assert.equal(res.sensorVerified, true);
    assert.equal(res.status, 'VERIFIED');
  });

});
