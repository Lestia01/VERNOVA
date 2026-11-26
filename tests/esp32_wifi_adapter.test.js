const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ESP32WiFiAdapter, CONNECTION_STATES } = require('../assets/js/device-manager.js');

test('ESP32 Wi-Fi Adapter Real HTTP Mock Tests (esp32_wifi_adapter.test.js)', async (t) => {
  let server;
  let port;
  let baseUrl;
  let lastReceivedBody = null;
  let serverStatusCode = 200;
  let simulateDelayMs = 0;

  // Set up mock HTTP server
  await new Promise((resolve) => {
    server = http.createServer((req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        lastReceivedBody = body;
        setTimeout(() => {
          res.writeHead(serverStatusCode, { 'Content-Type': 'application/json' });
          if (req.url === '/api/health' || req.url === '/api/status') {
            res.end(JSON.stringify({
              ok: true,
              deviceId: 'MOCK-ESP32',
              state: 'READY',
              wifiRssi: -55,
              freeHeap: 200000,
              uptimeSec: 360
            }));
          } else if (req.url === '/api/sort') {
            if (serverStatusCode === 200) {
              res.end(JSON.stringify({
                ok: true,
                status: 'COMPLETED',
                message: 'Object sorted'
              }));
            } else {
              res.end(JSON.stringify({
                ok: false,
                error: 'Hardware jammed'
              }));
            }
          } else if (req.url === '/api/mode') {
            res.end(JSON.stringify({ ok: true, mode: 'arm' }));
          } else if (req.url === '/api/stop') {
            res.end(JSON.stringify({ ok: true, status: 'STOPPED' }));
          } else if (req.url === '/api/test') {
            res.end(JSON.stringify({ ok: true, status: 'PULSE_ACK' }));
          } else {
            res.writeHead(404);
            res.end(JSON.stringify({ ok: false, error: 'Not found' }));
          }
        }, simulateDelayMs);
      });
    });

    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  t.after(() => {
    server.close();
  });

  await t.test('1. Connect sukses ke HTTP Server ESP32 & menerima telemetri', async () => {
    const adapter = new ESP32WiFiAdapter({ host: baseUrl, simulationMode: false, timeoutMs: 2000 });
    assert.equal(adapter.status, CONNECTION_STATES.DISCONNECTED);

    const res = await adapter.connect();
    assert.equal(res.ok, true);
    assert.equal(adapter.status, CONNECTION_STATES.CONNECTED);
    assert.equal(adapter.lastTelemetry.deviceId, 'MOCK-ESP32');
    assert.equal(adapter.lastTelemetry.state, 'READY');
    assert.equal(adapter.lastTelemetry.wifiRssi, -55);
  });

  await t.test('2. Mengirim perintah sortir JSON dan menerima konfirmasi', async () => {
    const adapter = new ESP32WiFiAdapter({ host: baseUrl, simulationMode: false, timeoutMs: 2000 });
    await adapter.connect();

    const sortRes = await adapter.sendSortingCommand({
      color: 'merah',
      mode: 'Arm',
      objectType: 'CYLINDER_CAP',
      commandId: 'cmd-test-123'
    });

    assert.equal(sortRes.ok, true);
    assert.equal(sortRes.color, 'merah');
    assert.equal(sortRes.mode, 'Arm');
    assert.equal(sortRes.commandId, 'cmd-test-123');
    assert.equal(sortRes.executionStatus, 'confirmed_esp32_wifi');

    // Verifikasi body yang diterima server
    const parsed = JSON.parse(lastReceivedBody);
    assert.equal(parsed.color, 'merah');
    assert.equal(parsed.mode, 'arm');
    assert.equal(parsed.commandId, 'cmd-test-123');
  });

  await t.test('3. Menangani penolakan server (HTTP 500)', async () => {
    serverStatusCode = 500;
    const adapter = new ESP32WiFiAdapter({ host: baseUrl, simulationMode: false, timeoutMs: 2000 });

    const sortRes = await adapter.sendSortingCommand({ color: 'kuning' });
    assert.equal(sortRes.ok, false);
    assert.equal(sortRes.status, 'FAILED');
    assert.match(sortRes.error, /HTTP 500/);
    serverStatusCode = 200; // restore
  });

  await t.test('4. Menangani Timeout koneksi saat ESP32 tidak merespons', async () => {
    simulateDelayMs = 500;
    const adapter = new ESP32WiFiAdapter({ host: baseUrl, simulationMode: false, timeoutMs: 150 });

    const sortRes = await adapter.sendSortingCommand({ color: 'biru' });
    assert.equal(sortRes.ok, false);
    assert.match(sortRes.error, /Timeout menghubungi ESP32/);
    simulateDelayMs = 0; // restore
  });

  await t.test('5. Mode, Emergency Stop, dan Test Pulse via HTTP', async () => {
    const adapter = new ESP32WiFiAdapter({ host: baseUrl, simulationMode: false, timeoutMs: 2000 });
    await adapter.connect();

    const modeRes = await adapter.sendModeCommand('Arm');
    assert.equal(modeRes.ok, true);

    const stopRes = await adapter.sendEmergencyStop();
    assert.equal(stopRes.ok, true);
    assert.equal(stopRes.status, 'STOPPED');

    const testRes = await adapter.sendTestPulse();
    assert.equal(testRes.ok, true);
    assert.equal(testRes.message, 'Test pulse acknowledged');
  });

  await t.test('6. Disconnect dan Reconnect', async () => {
    const adapter = new ESP32WiFiAdapter({ host: baseUrl, simulationMode: false, timeoutMs: 2000 });
    await adapter.connect();
    assert.equal(adapter.status, CONNECTION_STATES.CONNECTED);

    await adapter.disconnect();
    assert.equal(adapter.status, CONNECTION_STATES.DISCONNECTED);

    const reRes = await adapter.reconnect();
    assert.equal(reRes.ok, true);
    assert.equal(adapter.status, CONNECTION_STATES.CONNECTED);
  });
});
