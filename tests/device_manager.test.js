const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEVICE_TYPES,
  CONNECTION_TYPES,
  CONNECTION_STATES,
  NORDIC_UART_SERVICE_UUID,
  BaseDeviceAdapter,
  ESP32WiFiAdapter,
  ESP32BLEAdapter,
  MicrobitBLEAdapter,
  DeviceConnectionManager
} = require('../assets/js/device-manager.js');

test('VERNOVA Multi-Device & Dual-Connection Manager (device-manager.js)', async (t) => {

  await t.test('1. Validasi Konstanta Sistem & UUID Nordic UART', () => {
    assert.equal(DEVICE_TYPES.ESP32, 'ESP32');
    assert.equal(DEVICE_TYPES.MICROBIT, 'MICROBIT');
    assert.equal(CONNECTION_TYPES.WIFI, 'WIFI');
    assert.equal(CONNECTION_TYPES.BLE, 'BLE');
    assert.equal(NORDIC_UART_SERVICE_UUID, '6e400001-b5a3-f393-e0a9-e50e24dcca9e');
  });

  await t.test('2. BaseDeviceAdapter Interface & Abstract Contract', async () => {
    class DummyAdapter extends BaseDeviceAdapter {
      constructor() {
        super('DUMMY', 'TEST', { simulationMode: true });
      }
    }
    const dummy = new DummyAdapter();
    assert.equal(dummy.deviceType, 'DUMMY');
    assert.equal(dummy.connectionType, 'TEST');
    assert.equal(dummy.status, CONNECTION_STATES.SIMULATED);

    // Memastikan abstract methods melempar exception bila tidak di-override
    await assert.rejects(async () => dummy.connect(), /connect\(\)/);
    await assert.rejects(async () => dummy.disconnect(), /disconnect\(\)/);
    await assert.rejects(async () => dummy.sendSortingCommand({}), /sendSortingCommand\(\)/);
    await assert.rejects(async () => dummy.sendModeCommand('Servo'), /sendModeCommand\(\)/);
  });

  await t.test('3. ESP32 Wi-Fi Adapter (HTTP REST Simulation & Validation)', async () => {
    const wifi = new ESP32WiFiAdapter({
      host: '192.168.4.1',
      simulationMode: true
    });

    assert.equal(wifi.host, 'http://192.168.4.1');
    assert.equal(wifi.deviceType, DEVICE_TYPES.ESP32);
    assert.equal(wifi.connectionType, CONNECTION_TYPES.WIFI);

    // Connect / Health Check
    const conn = await wifi.connect();
    assert.equal(conn.ok, true);
    assert.equal(conn.simulated, true);
    assert.equal(conn.telemetry.deviceId, 'VERNOVA-ESP32-SIMULATOR');

    // Validasi Sortir Kuning, Biru, Merah
    const resKuning = await wifi.sendSortingCommand({ color: 'kuning', mode: 'Servo' });
    assert.equal(resKuning.ok, true);
    assert.equal(resKuning.color, 'kuning');
    assert.equal(resKuning.status, 'COMPLETED');

    const resBiru = await wifi.sendSortingCommand({ color: 'Blue', mode: 'Arm' });
    assert.equal(resBiru.ok, true);
    assert.equal(resBiru.color, 'biru');
    assert.equal(resBiru.mode, 'Arm');

    const resMerah = await wifi.sendSortingCommand('red');
    assert.equal(resMerah.ok, true);
    assert.equal(resMerah.color, 'merah');

    // Penolakan warna invalid
    await assert.rejects(async () => {
      await wifi.sendSortingCommand({ color: 'ungu' });
    }, /Warna tidak valid/);

    // Pengubahan mode & Emergency Stop
    const resMode = await wifi.sendModeCommand('Arm');
    assert.equal(resMode.ok, true);
    assert.equal(resMode.mode, 'Arm');

    const resStop = await wifi.sendEmergencyStop();
    assert.equal(resStop.ok, true);
    assert.equal(resStop.status, 'STOPPED');
  });

  await t.test('4. ESP32 BLE Adapter (Web Bluetooth Guard & Simulation Mode)', async () => {
    const ble = new ESP32BLEAdapter({
      deviceName: 'VERNOVA-ESP32',
      simulationMode: true
    });

    assert.equal(ble.deviceType, DEVICE_TYPES.ESP32);
    assert.equal(ble.connectionType, CONNECTION_TYPES.BLE);
    assert.equal(ble.isSimulated(), true);

    // Connect BLE
    const conn = await ble.connect();
    assert.equal(conn.ok, true);
    assert.equal(conn.simulated, true);
    assert.equal(conn.telemetry.protocol, 'BLE-GATT-UART');

    // Sortir via BLE
    const resSort = await ble.sendSortingCommand({ color: 'biru', mode: 'Servo' });
    assert.equal(resSort.ok, true);
    assert.equal(resSort.executionStatus, 'simulated_esp32_ble');

    // Test Pulse
    const resPulse = await ble.sendTestPulse();
    assert.equal(resPulse.ok, true);

    // Matikan mode simulasi di Node.js (lingkungan tanpa Web Bluetooth)
    ble.setSimulation(false);
    const nonSimConn = await ble.connect();
    assert.equal(nonSimConn.ok, false);
    assert.equal(nonSimConn.unsupported, true);
    assert.ok(nonSimConn.error.includes('Web Bluetooth API tidak didukung'));
  });

  await t.test('5. BBC micro:bit BLE Adapter (MakeCode UART Protocol)', async () => {
    const mbit = new MicrobitBLEAdapter({
      simulationMode: true
    });

    assert.equal(mbit.deviceType, DEVICE_TYPES.MICROBIT);
    assert.equal(mbit.connectionType, CONNECTION_TYPES.BLE);

    // Connect
    const conn = await mbit.connect();
    assert.equal(conn.ok, true);
    assert.equal(conn.telemetry.deviceId, 'BBC-micro:bit-SIM');
    assert.equal(conn.telemetry.protocol, 'MAKECODE-UART-STRING');

    // Perintah sortir diterjemahkan ke MakeCode format
    const resSort = await mbit.sendSortingCommand({ color: 'merah', mode: 'Arm' });
    assert.equal(resSort.ok, true);
    assert.equal(resSort.executionStatus, 'simulated_microbit_ble');

    // Mode command
    const resMode = await mbit.sendModeCommand('Arm');
    assert.equal(resMode.ok, true);
    assert.equal(resMode.mode, 'Arm');

    // Emergency stop
    const resStop = await mbit.sendEmergencyStop();
    assert.equal(resStop.ok, true);
    assert.equal(resStop.status, 'STOPPED');

    // Disconnect
    const resDisc = await mbit.disconnect();
    assert.equal(resDisc.ok, true);
  });

  await t.test('6. DeviceConnectionManager: Dynamic Switching & Config Persistence', async () => {
    const manager = new DeviceConnectionManager({
      deviceType: DEVICE_TYPES.ESP32,
      connectionType: CONNECTION_TYPES.WIFI,
      simulationMode: true
    });

    assert.equal(manager.getStatus().deviceType, DEVICE_TYPES.ESP32);
    assert.equal(manager.getStatus().connectionType, CONNECTION_TYPES.WIFI);
    assert.equal(manager.getActiveAdapter() instanceof ESP32WiFiAdapter, true);

    // Ganti ke ESP32 BLE
    await manager.switchDevice(DEVICE_TYPES.ESP32, CONNECTION_TYPES.BLE);
    assert.equal(manager.getStatus().deviceType, DEVICE_TYPES.ESP32);
    assert.equal(manager.getStatus().connectionType, CONNECTION_TYPES.BLE);
    assert.equal(manager.getActiveAdapter() instanceof ESP32BLEAdapter, true);

    // Ganti ke micro:bit BLE
    await manager.switchDevice(DEVICE_TYPES.MICROBIT, CONNECTION_TYPES.BLE);
    assert.equal(manager.getStatus().deviceType, DEVICE_TYPES.MICROBIT);
    assert.equal(manager.getStatus().connectionType, CONNECTION_TYPES.BLE);
    assert.equal(manager.getActiveAdapter() instanceof MicrobitBLEAdapter, true);

    // Validasi pencegahan error: micro:bit TIDAK mendukung Wi-Fi
    await assert.rejects(async () => {
      await manager.switchDevice(DEVICE_TYPES.MICROBIT, CONNECTION_TYPES.WIFI);
    }, /BBC micro:bit tidak mendukung Wi-Fi/);
  });

  await t.test('7. DeviceConnectionManager: Debounce & Duplicate Suppression', async () => {
    const manager = new DeviceConnectionManager({
      deviceType: DEVICE_TYPES.ESP32,
      connectionType: CONNECTION_TYPES.WIFI,
      simulationMode: true
    });

    // Perintah 1: Berhasil
    const res1 = await manager.dispatchSortingCommand({ color: 'kuning', mode: 'Servo' });
    assert.equal(res1.ok, true);
    assert.equal(res1.color, 'kuning');

    // Perintah 2: Warna sama dalam cooldown (< 500ms) harus disupresi
    const res2 = await manager.dispatchSortingCommand({ color: 'kuning', mode: 'Servo' });
    assert.equal(res2.ok, false);
    assert.equal(res2.suppressed, true);
    assert.ok(res2.reason.includes('debounce'));

    // Perintah 3: Warna berbeda langsung lolos
    const res3 = await manager.dispatchSortingCommand({ color: 'biru', mode: 'Servo' });
    assert.equal(res3.ok, true);
    assert.equal(res3.color, 'biru');

    // Perintah 4: Paksaan (force: true) harus melewati batas debounce
    const res4 = await manager.dispatchSortingCommand({ color: 'biru', mode: 'Servo', force: true });
    assert.equal(res4.ok, true);
    assert.equal(res4.color, 'biru');
  });

  await t.test('8. Legacy esp32Client Proxy Compatibility', async () => {
    const manager = new DeviceConnectionManager({
      deviceType: DEVICE_TYPES.ESP32,
      connectionType: CONNECTION_TYPES.WIFI,
      host: 'http://192.168.4.1',
      simulationMode: true
    });

    const legacyProxy = manager.createLegacyEsp32ClientProxy();
    assert.equal(legacyProxy.host, 'http://192.168.4.1');
    assert.equal(legacyProxy.isSimulated(), true);

    // Status check
    const status = legacyProxy.getStatus();
    assert.equal(status.online, true);
    assert.equal(status.isSimulated, true);

    // Health check
    const health = await legacyProxy.checkHealth();
    assert.equal(health.ok, true);

    // Sorting command via proxy
    const sortRes = await legacyProxy.sendSortingCommand({ color: 'merah' });
    assert.equal(sortRes.ok, true);
    assert.equal(sortRes.color, 'merah');

    // Mode command via proxy
    const modeRes = await legacyProxy.sendModeCommand('Arm');
    assert.equal(modeRes.ok, true);

    // Emergency stop via proxy
    const stopRes = await legacyProxy.sendEmergencyStop();
    assert.equal(stopRes.ok, true);
  });
});
