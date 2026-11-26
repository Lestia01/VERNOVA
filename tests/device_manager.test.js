const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEVICE_TYPES,
  CONNECTION_TYPES,
  CONNECTION_STATES,
  OPERATING_MODES,
  VALID_COLORS,
  VALID_MODES,
  NORDIC_UART_SERVICE_UUID,
  MicrobitBLEAdapter,
  ESP32WiFiAdapter,
  DeviceConnectionManager,
  aggregateSortingDistribution
} = require('../assets/js/device-manager.js');

test('VERNOVA / Smart Factory Multi-Device Manager (device-manager.js)', async (t) => {

  await t.test('1. Validasi Konstanta Sistem & UUID Nordic UART', () => {
    assert.equal(DEVICE_TYPES.MICROBIT, 'MICROBIT');
    assert.equal(DEVICE_TYPES.ESP32, 'ESP32');
    assert.equal(CONNECTION_TYPES.BLE, 'BLE');
    assert.equal(CONNECTION_TYPES.WIFI, 'WIFI');
    assert.equal(NORDIC_UART_SERVICE_UUID, '6e400001-b5a3-f393-e0a9-e50e24dcca9e');
    assert.deepEqual(VALID_COLORS, ['kuning', 'biru', 'merah']);
    assert.deepEqual(VALID_MODES, ['Servo', 'Arm']);
  });

  await t.test('2. MicrobitBLEAdapter: Inisialisasi & Mode Simulasi', async () => {
    const adapter = new MicrobitBLEAdapter({ simulationMode: true });
    assert.equal(adapter.deviceType, DEVICE_TYPES.MICROBIT);
    assert.equal(adapter.connectionType, CONNECTION_TYPES.BLE);
    assert.equal(adapter.status, CONNECTION_STATES.SIMULATED);

    const conn = await adapter.connect();
    assert.equal(conn.ok, true);
    assert.equal(conn.simulated, true);
    assert.equal(conn.telemetry.deviceId, 'BBC-micro:bit-SIM');

    const status = adapter.getStatus();
    assert.equal(status.state, CONNECTION_STATES.SIMULATED);
    assert.equal(status.simulationMode, true);
  });

  await t.test('3. MicrobitBLEAdapter: Validasi Perintah Sortir Warna (Kuning, Biru, Merah)', async () => {
    const adapter = new MicrobitBLEAdapter({ simulationMode: true });

    // Kuning
    const resKuning = await adapter.sendSortingCommand({ color: 'kuning', mode: 'Servo' });
    assert.equal(resKuning.ok, true);
    assert.equal(resKuning.color, 'kuning');
    assert.equal(resKuning.status, 'COMPLETED');
    assert.equal(resKuning.executionStatus, 'simulated_microbit_ble');

    // Biru (alias Blue)
    const resBiru = await adapter.sendSortingCommand({ color: 'blue', mode: 'Arm' });
    assert.equal(resBiru.ok, true);
    assert.equal(resBiru.color, 'biru');
    assert.equal(resBiru.mode, 'Arm');

    // Merah (alias Red)
    const resMerah = await adapter.sendSortingCommand('Red');
    assert.equal(resMerah.ok, true);
    assert.equal(resMerah.color, 'merah');

    // Penolakan warna tidak sah
    await assert.rejects(async () => {
      await adapter.sendSortingCommand({ color: 'hijau' });
    }, /Warna tidak valid/);
  });

  await t.test('4. MicrobitBLEAdapter: Mode Aktuator, Emergency Stop & Test Pulse', async () => {
    const adapter = new MicrobitBLEAdapter({ simulationMode: true });

    const modeRes = await adapter.sendModeCommand('Arm');
    assert.equal(modeRes.ok, true);
    assert.equal(modeRes.mode, 'Arm');

    const stopRes = await adapter.sendEmergencyStop();
    assert.equal(stopRes.ok, true);
    assert.equal(stopRes.status, 'STOPPED');

    const pulseRes = await adapter.sendTestPulse();
    assert.equal(pulseRes.ok, true);
    assert.equal(pulseRes.status, 'PULSE_ACK');
  });

  await t.test('5. ESP32WiFiAdapter: Inisialisasi, Host Sanitization & Mode Simulasi', async () => {
    // Sanitasi URL Host
    const adapter1 = new ESP32WiFiAdapter({ host: '192.168.4.1', simulationMode: true });
    assert.equal(adapter1.host, 'http://192.168.4.1');
    assert.equal(adapter1.deviceType, DEVICE_TYPES.ESP32);
    assert.equal(adapter1.connectionType, CONNECTION_TYPES.WIFI);
    assert.equal(adapter1.status, CONNECTION_STATES.SIMULATED);

    const adapter2 = new ESP32WiFiAdapter({ host: 'http://192.168.1.100///', simulationMode: true });
    assert.equal(adapter2.host, 'http://192.168.1.100');

    // Connect Simulasi
    const conn = await adapter1.connect();
    assert.equal(conn.ok, true);
    assert.equal(conn.simulated, true);
    assert.equal(conn.telemetry.deviceId, 'VERNOVA-ESP32-SIM');

    const status = adapter1.getStatus();
    assert.equal(status.state, CONNECTION_STATES.SIMULATED);
    assert.equal(status.host, 'http://192.168.4.1');
  });

  await t.test('6. ESP32WiFiAdapter: Sortir, Mode, Stop & Test Pulse (Simulasi)', async () => {
    const adapter = new ESP32WiFiAdapter({ simulationMode: true });

    // Sortir Kuning
    const resKuning = await adapter.sendSortingCommand({ color: 'kuning', mode: 'Servo' });
    assert.equal(resKuning.ok, true);
    assert.equal(resKuning.color, 'kuning');
    assert.equal(resKuning.executionStatus, 'simulated_esp32_wifi');

    // Sortir Biru (Mode Arm)
    const resBiru = await adapter.sendSortingCommand({ color: 'biru', mode: 'Arm' });
    assert.equal(resBiru.ok, true);
    assert.equal(resBiru.color, 'biru');
    assert.equal(resBiru.mode, 'Arm');

    // Sortir Merah
    const resMerah = await adapter.sendSortingCommand({ color: 'merah' });
    assert.equal(resMerah.ok, true);
    assert.equal(resMerah.color, 'merah');

    // Mode Command
    const resMode = await adapter.sendModeCommand('Arm');
    assert.equal(resMode.ok, true);
    assert.equal(resMode.mode, 'Arm');

    // Emergency Stop
    const resStop = await adapter.sendEmergencyStop();
    assert.equal(resStop.ok, true);
    assert.equal(resStop.status, 'STOPPED');

    // Test Pulse
    const resPulse = await adapter.sendTestPulse();
    assert.equal(resPulse.ok, true);
    assert.equal(resPulse.status, 'PULSE_ACK');

    // Penolakan warna tidak valid
    await assert.rejects(async () => {
      await adapter.sendSortingCommand({ color: 'ungu' });
    }, /Warna tidak valid/);
  });

  await t.test('7. DeviceConnectionManager: Dynamic Device Switching & Active Routing', async () => {
    const manager = new DeviceConnectionManager({
      deviceType: DEVICE_TYPES.MICROBIT,
      simulationMode: true
    });

    assert.equal(manager.config.deviceType, DEVICE_TYPES.MICROBIT);
    assert.equal(manager.config.connectionType, CONNECTION_TYPES.BLE);
    assert.equal(manager.getActiveAdapter().deviceType, DEVICE_TYPES.MICROBIT);

    // Ganti perangkat ke ESP32
    const switchRes = manager.switchDevice('ESP32', { host: 'http://192.168.4.1' });
    assert.equal(switchRes.ok, true);
    assert.equal(manager.config.deviceType, DEVICE_TYPES.ESP32);
    assert.equal(manager.config.connectionType, CONNECTION_TYPES.WIFI);
    assert.equal(manager.getActiveAdapter().deviceType, DEVICE_TYPES.ESP32);
    assert.equal(manager.getActiveAdapter().host, 'http://192.168.4.1');

    // Kirim perintah sortir -> Terkirim ke adapter aktif (ESP32)
    const sortRes = await manager.dispatchSortingCommand({ color: 'kuning' });
    assert.equal(sortRes.ok, true);
    assert.equal(sortRes.executionStatus, 'simulated_esp32_wifi');

    // Kembalikan ke micro:bit
    manager.switchDevice('MICROBIT');
    assert.equal(manager.config.deviceType, DEVICE_TYPES.MICROBIT);
    assert.equal(manager.getActiveAdapter().deviceType, DEVICE_TYPES.MICROBIT);

    const sortMbit = await manager.dispatchSortingCommand({ color: 'biru' });
    assert.equal(sortMbit.ok, true);
    assert.equal(sortMbit.executionStatus, 'simulated_microbit_ble');

    // Penolakan tipe perangkat tidak dikenal
    assert.throws(() => {
      manager.switchDevice('ARDUINO_UNO');
    }, /Device type tidak valid/);
  });

  await t.test('8. DeviceConnectionManager: Operating Mode & Listener Propagation', async () => {
    const manager = new DeviceConnectionManager({ simulationMode: true });

    let lastEvent = null;
    manager.onStatusChange(ev => { lastEvent = ev; });

    // Set operating mode
    const modeRes = manager.setOperatingMode('MANUAL');
    assert.equal(modeRes.ok, true);
    assert.equal(manager.getOperatingMode(), 'MANUAL');
    assert.equal(lastEvent.type, 'operating_mode_changed');

    // Connect
    const conn = await manager.connect();
    assert.equal(conn.ok, true);
    assert.equal(conn.simulated, true);
  });

  await t.test('9. DeviceConnectionManager: Debounce & Duplicate Suppression', async () => {
    const manager = new DeviceConnectionManager({
      simulationMode: true,
      debounceMs: 500
    });

    // Panggilan pertama
    const firstCall = await manager.dispatchSortingCommand({ color: 'kuning' });
    assert.equal(firstCall.ok, true);
    assert.equal(firstCall.color, 'kuning');

    // Panggilan kedua cepat dengan warna sama tanpa force -> ditekan oleh debounce
    const suppressedCall = await manager.dispatchSortingCommand({ color: 'kuning' });
    assert.equal(suppressedCall.ok, false);
    assert.equal(suppressedCall.suppressed, true);
    assert.match(suppressedCall.reason, /Debounce aktif/);

    // Panggilan dengan force: true -> lolos
    const forceCall = await manager.dispatchSortingCommand({ color: 'kuning', force: true });
    assert.equal(forceCall.ok, true);
    assert.equal(forceCall.color, 'kuning');

    // Panggilan warna berbeda -> lolos
    const diffColorCall = await manager.dispatchSortingCommand({ color: 'biru' });
    assert.equal(diffColorCall.ok, true);
    assert.equal(diffColorCall.color, 'biru');
  });

  await t.test('10. Agregasi Statistik Distribusi Penyortiran (aggregateSortingDistribution)', () => {
    const sampleEntries = [
      { warna: 'kuning', status: 'COMPLETED' },
      { warna: 'kuning', status: 'VERIFIED' },
      { warna: 'biru', status: 'SUCCESS' },
      { warna: 'merah', status: 'CONFIRMED' },
      { warna: 'merah', status: 'FAILED' }
    ];

    const stats = aggregateSortingDistribution(sampleEntries);
    assert.equal(stats.kuning, 2);
    assert.equal(stats.biru, 1);
    assert.equal(stats.merah, 1);
    assert.equal(stats.total, 4);
    assert.equal(stats.gagal, 1);
    assert.equal(stats.successRate, 80.0);
    assert.equal(stats.successRateString, '80%');
  });

  await t.test('11. Legacy Client Proxy Compatibility', async () => {
    const manager = new DeviceConnectionManager({ simulationMode: true });
    const proxy = manager.createLegacyEsp32ClientProxy();

    assert.equal(typeof proxy.getStatus, 'function');
    assert.equal(typeof proxy.connect, 'function');
    assert.equal(typeof proxy.disconnect, 'function');
    assert.equal(typeof proxy.sendSortingCommand, 'function');
    assert.equal(typeof proxy.sendEmergencyStop, 'function');

    const res = await proxy.sendSortingCommand({ color: 'merah' });
    assert.equal(res.ok, true);
    assert.equal(res.color, 'merah');
  });

  await t.test('12. ESP32 Host Selection & Persistence (172.25.15.108 vs 192.168.4.1)', async () => {
    // 12.1 Host Sanitization & Endpoint Normalization
    const espAdapter = new ESP32WiFiAdapter({ host: '172.25.15.108', simulationMode: true });
    assert.equal(espAdapter.host, 'http://172.25.15.108');
    assert.equal(espAdapter._buildUrl('/api/test'), 'http://172.25.15.108/api/test');
    assert.equal(espAdapter._buildUrl('api/sort'), 'http://172.25.15.108/api/sort');

    // Stripping accidental /api or trailing slash
    espAdapter.setHost('http://172.25.15.108/api/');
    assert.equal(espAdapter.host, 'http://172.25.15.108');

    espAdapter.setHost('172.25.15.108/api/test');
    assert.equal(espAdapter.host, 'http://172.25.15.108');

    // 12.2 Manager Persistence & Switch Device Without Reverting
    const manager = new DeviceConnectionManager({
      deviceType: DEVICE_TYPES.MICROBIT,
      simulationMode: true,
      host: 'http://172.25.15.108'
    });

    assert.equal(manager.config.host, 'http://172.25.15.108');

    // Ganti ke ESP32 tanpa menyertakan options.host -> Host 172.25.15.108 tetap bertahan
    manager.switchDevice('ESP32');
    assert.equal(manager.config.host, 'http://172.25.15.108');
    assert.equal(manager.getActiveAdapter().host, 'http://172.25.15.108');

    // Panggil sendTestPulse -> targetUrl & host mengarah ke 172.25.15.108
    const pulseRes = await manager.sendTestPulse();
    assert.equal(pulseRes.ok, true);
    assert.equal(pulseRes.host, 'http://172.25.15.108');
    assert.equal(pulseRes.targetUrl, 'http://172.25.15.108/api/test');

    // Set host manual dengan IP baru
    manager.setHost('172.25.15.200');
    assert.equal(manager.config.host, 'http://172.25.15.200');
    assert.equal(manager.getActiveAdapter().host, 'http://172.25.15.200');

    // Ganti ke MICROBIT lalu kembali ke ESP32 -> Host 172.25.15.200 TIDAK hilang / tertimpa 192.168.4.1
    manager.switchDevice('MICROBIT');
    manager.switchDevice('ESP32');
    assert.equal(manager.config.host, 'http://172.25.15.200');
    assert.equal(manager.getActiveAdapter().host, 'http://172.25.15.200');

    // SoftAP 192.168.4.1 hanya aktif jika pengguna secara eksplisit memilih preset SoftAP
    manager.setHost('http://192.168.4.1');
    assert.equal(manager.config.host, 'http://192.168.4.1');
    assert.equal(manager.getActiveAdapter().host, 'http://192.168.4.1');
  });

});
