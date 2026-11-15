const test = require('node:test');
const assert = require('node:assert/strict');
const Esp32Client = require('../assets/js/esp32-client.js');

test('ESP32 Wi-Fi Client Adapter (esp32-client.js)', async (t) => {
  await t.test('Inisialisasi & Sanitasi Host URL', () => {
    const c1 = new Esp32Client({ host: '192.168.4.1' });
    assert.equal(c1.host, 'http://192.168.4.1');

    const c2 = new Esp32Client({ host: 'http://192.168.1.150:80/' });
    assert.equal(c2.host, 'http://192.168.1.150:80');

    const c3 = new Esp32Client();
    assert.equal(c3.host, 'http://192.168.4.1');
    assert.equal(c3.timeoutMs, 5000);
  });

  await t.test('Mode Simulasi: Health Check & Telemetri', async () => {
    const client = new Esp32Client({ simulationMode: true });
    assert.equal(client.isSimulated(), true);
    assert.equal(client.connectionStatus, 'SIMULATED');

    const res = await client.checkHealth();
    assert.equal(res.ok, true);
    assert.equal(res.simulated, true);
    assert.ok(res.telemetry);
    assert.equal(res.telemetry.deviceId, 'VERNOVA-ESP32-SIMULATOR');
    assert.equal(res.telemetry.state, 'READY');
    assert.ok(res.telemetry.wifiRssi < 0);

    const statusObj = client.getStatus();
    assert.equal(typeof statusObj, 'object');
    assert.equal(statusObj.online, true);
    assert.equal(statusObj.isSimulated, true);
    assert.ok(statusObj.freeHeap > 0);
  });

  await t.test('Mode Simulasi: Perintah Sortir Warna Valid (Kuning, Biru, Merah)', async () => {
    const client = new Esp32Client({ simulationMode: true });

    // 1. Kuning
    const resKuning = await client.sendSortingCommand({ color: 'kuning', mode: 'Servo' });
    assert.equal(resKuning.ok, true);
    assert.equal(resKuning.color, 'kuning');
    assert.equal(resKuning.status, 'COMPLETED');
    assert.equal(resKuning.executionStatus, 'simulated_esp32');
    assert.ok(resKuning.commandId.startsWith('CMD_'));
    assert.ok(resKuning.durationMs >= 200);

    // 2. Biru (alias Blue)
    const resBiru = await client.sendSortingCommand({ color: 'Blue', mode: 'Arm' });
    assert.equal(resBiru.ok, true);
    assert.equal(resBiru.color, 'biru');
    assert.equal(resBiru.mode, 'Arm');

    // 3. Merah (alias Red)
    const resMerah = await client.sendSortingCommand('red');
    assert.equal(resMerah.ok, true);
    assert.equal(resMerah.color, 'merah');
  });

  await t.test('Validasi Warna: Penolakan Warna Tidak Sah', async () => {
    const client = new Esp32Client({ simulationMode: true });

    await assert.rejects(async () => {
      await client.sendSortingCommand({ color: 'hijau' });
    }, /Kategori warna tidak valid/);

    await assert.rejects(async () => {
      await client.sendSortingCommand({ color: '' });
    }, /Kategori warna tidak valid/);
  });

  await t.test('Mode Simulasi: Pengubahan Mode Kerja & Emergency Stop', async () => {
    const client = new Esp32Client({ simulationMode: true });

    const modeRes = await client.sendModeCommand('Arm');
    assert.equal(modeRes.ok, true);
    assert.equal(modeRes.mode, 'Arm');

    const stopRes = await client.sendEmergencyStop();
    assert.equal(stopRes.ok, true);
    assert.equal(stopRes.status, 'STOPPED');
  });

  await t.test('Listener Perubahan Status (onStatusChange)', async () => {
    const client = new Esp32Client({ simulationMode: false });
    const events = [];

    const unsubscribe = client.onStatusChange(ev => events.push(ev.status));
    client.setSimulation(true);
    await client.checkHealth();
    client.setSimulation(false);

    unsubscribe();
    client.setSimulation(true); // Tidak boleh tercatat setelah unsubscribe

    assert.ok(events.includes('SIMULATED'));
    assert.ok(events.includes('OFFLINE'));
    assert.equal(events.length, 3);
  });

  await t.test('Penanganan Kegagalan Jaringan ESP32 Offline (Tanpa Crash)', async () => {
    // Port dummy yang tidak aktif untuk menguji error handling
    const client = new Esp32Client({ host: 'http://127.0.0.1:54321', timeoutMs: 1500, simulationMode: false });
    
    const health = await client.checkHealth();
    assert.equal(health.ok, false);
    assert.ok(health.error);
    assert.equal(client.connectionStatus, 'OFFLINE');

    const sortRes = await client.sendSortingCommand({ color: 'kuning' });
    assert.equal(sortRes.ok, false);
    assert.equal(sortRes.status, 'FAILED');
    assert.equal(sortRes.executionStatus, 'failed_communication');
    assert.equal(sortRes.errorCode, 'ERR_ESP32_HTTP_DISCONNECTED');
  });
});
