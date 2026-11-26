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
  DeviceConnectionManager,
  aggregateSortingDistribution
} = require('../assets/js/device-manager.js');

test('R-LAB / Smart Factory Micro:bit Robot Device Manager (device-manager.js)', async (t) => {

  await t.test('1. Validasi Konstanta Sistem & UUID Nordic UART', () => {
    assert.equal(DEVICE_TYPES.MICROBIT, 'MICROBIT');
    assert.equal(CONNECTION_TYPES.BLE, 'BLE');
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

  await t.test('4. MicrobitBLEAdapter: Pengaturan Mode Aktuator & Emergency Stop', async () => {
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

  await t.test('5. DeviceConnectionManager: Status, Operasi & Event Listener', async () => {
    const manager = new DeviceConnectionManager({ simulationMode: true });
    assert.equal(manager.isSimulated(), true);
    assert.equal(manager.getOperatingMode(), OPERATING_MODES.AUTO);

    let eventReceived = null;
    manager.onStatusChange(ev => { eventReceived = ev; });

    // Ganti operating mode ke MANUAL
    const modeChange = manager.setOperatingMode('MANUAL');
    assert.equal(modeChange.ok, true);
    assert.equal(manager.getOperatingMode(), 'MANUAL');
    assert.equal(eventReceived.type, 'operating_mode_changed');

    // Connect
    const conn = await manager.connect();
    assert.equal(conn.ok, true);
    assert.equal(conn.simulated, true);
  });

  await t.test('6. DeviceConnectionManager: Debounce & Penekanan Duplikat Beruntun', async () => {
    const manager = new DeviceConnectionManager({
      simulationMode: true,
      debounceMs: 500
    });

    // Panggilan pertama untuk kuning
    const firstCall = await manager.dispatchSortingCommand({ color: 'kuning' });
    assert.equal(firstCall.ok, true);
    assert.equal(firstCall.color, 'kuning');

    // Panggilan kedua cepat dengan warna sama tanpa force -> ditekan oleh debounce
    const suppressedCall = await manager.dispatchSortingCommand({ color: 'kuning' });
    assert.equal(suppressedCall.ok, false);
    assert.equal(suppressedCall.suppressed, true);
    assert.match(suppressedCall.reason, /Debounce aktif/);

    // Panggilan dengan force: true -> bypass debounce
    const forceCall = await manager.dispatchSortingCommand({ color: 'kuning', force: true });
    assert.equal(forceCall.ok, true);
    assert.equal(forceCall.color, 'kuning');

    // Panggilan dengan warna berbeda -> diizinkan
    const diffColorCall = await manager.dispatchSortingCommand({ color: 'biru' });
    assert.equal(diffColorCall.ok, true);
    assert.equal(diffColorCall.color, 'biru');
  });

  await t.test('7. Agregasi Statistik Distribusi Penyortiran (aggregateSortingDistribution)', () => {
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

  await t.test('8. Legacy Client Proxy Compatibility', async () => {
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

});
