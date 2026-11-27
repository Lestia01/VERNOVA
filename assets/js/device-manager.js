/**
 * ==============================================================================
 * VERNOVA / R-LAB — Multi-Device Connection Manager
 * Arsitektur Sederhana, Stabil & Modular untuk Komunikasi Robotik:
 * 1. BBC micro:bit — Bluetooth Low Energy (MakeCode Nordic UART)
 * 2. ESP32 DevKit V1 — Wi-Fi Local Network (HTTP REST API + JSON)
 * 
 * Mendukung:
 * - Web Bluetooth API (Nordic UART Service: 6e400001-b5a3-f393-e0a9-e50e24dcca9e)
 * - ESP32 Wi-Fi HTTP REST Client (Full CORS, Endpoint /api/health, /api/sort, /api/mode, /api/stop)
 * - Transmisi Perintah Sortir Warna (kuning, biru, merah) dan Mode Aktuator (servo, arm)
 * - Pemilihan Perangkat Dinamis (micro:bit BLE vs ESP32 Wi-Fi) dengan Workflow Identik
 * - Mode Simulasi Virtual (Offline / Fallback tanpa hardware fisik)
 * - Debounce & Perlindungan Pengiriman Duplikat
 * - Tanpa Ketergantungan Pin GPIO Tertentu pada Lapisan Website
 * ==============================================================================
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const mod = factory();
    root.DEVICE_TYPES = mod.DEVICE_TYPES;
    root.CONNECTION_TYPES = mod.CONNECTION_TYPES;
    root.CONNECTION_STATES = mod.CONNECTION_STATES;
    root.VALID_COLORS = mod.VALID_COLORS;
    root.VALID_MODES = mod.VALID_MODES;
    root.OPERATING_MODES = mod.OPERATING_MODES;
    root.NORDIC_UART_SERVICE_UUID = mod.NORDIC_UART_SERVICE_UUID;
    root.MicrobitBLEAdapter = mod.MicrobitBLEAdapter;
    root.ESP32WiFiAdapter = mod.ESP32WiFiAdapter;
    root.ESP32BLEAdapter = mod.ESP32BLEAdapter;
    root.DeviceConnectionManager = mod.DeviceConnectionManager;
    root.aggregateSortingDistribution = mod.aggregateSortingDistribution;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // =========================================================================
  // 1. KONSTANTA & PROTOKOL SISTEM
  // =========================================================================
  const DEVICE_TYPES = {
    MICROBIT: 'MICROBIT',
    ESP32: 'ESP32',
    ESP32_BLE: 'ESP32_BLE'
  };

  const CONNECTION_TYPES = {
    BLE: 'BLE',
    WIFI: 'WIFI'
  };

  const CONNECTION_STATES = {
    DISCONNECTED: 'DISCONNECTED',
    CONNECTING: 'CONNECTING',
    CONNECTED: 'CONNECTED',
    READY: 'READY',
    BUSY: 'BUSY',
    ERROR: 'ERROR',
    SIMULATED: 'SIMULATED'
  };

  const OPERATING_MODES = {
    AUTO: 'AUTO',
    MANUAL: 'MANUAL'
  };

  const VALID_COLORS = ['kuning', 'biru', 'merah'];
  const VALID_MODES = ['Servo', 'Arm'];

  // UUID Standar Nordic Semiconductor UART Service (BBC micro:bit MakeCode BLE)
  const NORDIC_UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  const NORDIC_UART_TX_CHARACTERISTIC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // micro:bit -> Web (Notify)
  const NORDIC_UART_RX_CHARACTERISTIC_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Web -> micro:bit (Write)

  function isWebBluetoothSupported() {
    return typeof navigator !== 'undefined' && Boolean(navigator.bluetooth);
  }

  // =========================================================================
  // 2. AGREGASI STATISTIK SORTIR
  // =========================================================================
  function aggregateSortingDistribution(entries = []) {
    const list = Array.isArray(entries) ? entries : Object.values(entries || {});
    const summary = {
      kuning: 0,
      biru: 0,
      merah: 0,
      total: 0,
      gagal: 0,
      successRate: 0.0,
      successRateString: '0.0%'
    };

    list.forEach(entry => {
      if (!entry) return;
      const status = String(entry.status || '').toUpperCase();
      const color = String(entry.warna || entry.color || '').toLowerCase();

      if (status === 'COMPLETED' || status === 'CONFIRMED' || status === 'SUCCESS' || status === 'VERIFIED') {
        if (summary[color] !== undefined) {
          summary[color]++;
        }
        summary.total++;
      } else if (status === 'FAILED' || status === 'ERROR' || status === 'TIMEOUT' || status === 'MISSORT') {
        summary.gagal++;
      }
    });

    const attempts = summary.total + summary.gagal;
    if (attempts > 0) {
      summary.successRate = Number(((summary.total / attempts) * 100).toFixed(1));
      summary.successRateString = `${summary.successRate}%`;
    }

    return summary;
  }

  // =========================================================================
  // 3A. ADAPTER BLE BBC MICRO:BIT (MakeCode Bluetooth UART)
  // =========================================================================
  class MicrobitBLEAdapter {
    constructor(config = {}) {
      this.deviceType = DEVICE_TYPES.MICROBIT;
      this.connectionType = CONNECTION_TYPES.BLE;
      this.simulationMode = Boolean(config.simulationMode);
      this.targetDeviceName = config.deviceName || 'BBC micro:bit';
      this.device = null;
      this.server = null;
      this.rxCharacteristic = null;
      this.txCharacteristic = null;
      this.status = this.simulationMode ? CONNECTION_STATES.SIMULATED : CONNECTION_STATES.DISCONNECTED;
      this.lastError = null;
      this.lastAck = null;
      this.lastTelemetry = null;
      this._listeners = new Set();

      if (this.simulationMode) {
        this._initSimulatedTelemetry();
      }
    }

    _initSimulatedTelemetry() {
      this.lastTelemetry = {
        deviceId: 'BBC-micro:bit-SIM',
        firmwareVersion: 'MakeCode-BLE-UART-v2',
        state: 'READY',
        protocol: 'MAKECODE-UART-STRING',
        lastSeen: new Date().toISOString()
      };
    }

    addListener(fn) {
      if (typeof fn === 'function') this._listeners.add(fn);
      return () => this._listeners.delete(fn);
    }

    onStatusChange(fn) {
      return this.addListener(fn);
    }

    _notify(status, message = '', extra = {}) {
      this.status = status;
      const ev = {
        deviceType: this.deviceType,
        connectionType: this.connectionType,
        status,
        message,
        timestamp: new Date().toISOString(),
        ...extra
      };
      this._listeners.forEach(fn => {
        try { fn(ev); } catch (e) { console.warn('Listener error:', e); }
      });
    }

    isSupported() {
      return isWebBluetoothSupported();
    }

    getStatus() {
      return {
        deviceType: this.deviceType,
        connectionType: this.connectionType,
        state: this.status,
        simulationMode: this.simulationMode,
        lastError: this.lastError,
        telemetry: this.lastTelemetry
      };
    }

    setSimulation(isSim) {
      this.simulationMode = Boolean(isSim);
      if (this.simulationMode) {
        this._initSimulatedTelemetry();
        this._notify(CONNECTION_STATES.SIMULATED, 'Mode simulasi micro:bit aktif.');
      } else {
        this.status = this.device && this.device.gatt?.connected ? CONNECTION_STATES.CONNECTED : CONNECTION_STATES.DISCONNECTED;
        this._notify(this.status, 'Mode perangkat fisik aktif.');
      }
      return this.simulationMode;
    }

    async connect() {
      if (this.simulationMode) {
        this._initSimulatedTelemetry();
        this._notify(CONNECTION_STATES.SIMULATED, 'Tersambung ke BBC micro:bit (Simulasi Virtual).');
        return { ok: true, simulated: true, telemetry: this.lastTelemetry };
      }

      if (!this.isSupported()) {
        const errMsg = 'Web Bluetooth API tidak didukung di browser ini. Gunakan Google Chrome atau Microsoft Edge melalui HTTPS atau localhost.';
        this.lastError = errMsg;
        this._notify(CONNECTION_STATES.ERROR, errMsg);
        return { ok: false, error: errMsg, unsupported: true };
      }

      try {
        this._notify(CONNECTION_STATES.CONNECTING, 'Memindai BBC micro:bit...');
        this.device = await navigator.bluetooth.requestDevice({
          filters: [
            { namePrefix: 'BBC micro:bit' }
          ],
          optionalServices: [NORDIC_UART_SERVICE_UUID]
        });

        this.device.addEventListener('gattserverdisconnected', () => {
          this._notify(CONNECTION_STATES.DISCONNECTED, 'Koneksi BBC micro:bit terputus.');
        });

        this._notify(CONNECTION_STATES.CONNECTING, `Menghubungkan ke ${this.device.name || 'micro:bit'}...`);
        this.server = await this.device.gatt.connect();

        const service = await this.server.getPrimaryService(NORDIC_UART_SERVICE_UUID);

        // Ambil characteristics RX (write) dan TX (notify)
        const chars = await service.getCharacteristics();
        this.rxCharacteristic = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
        this.txCharacteristic = chars.find(c => c.properties.notify || c.properties.indicate);

        if (this.txCharacteristic) {
          try {
            await this.txCharacteristic.startNotifications();
            this.txCharacteristic.addEventListener('characteristicvaluechanged', (ev) => {
              const text = new TextDecoder().decode(ev.target.value);
              this._handleIncomingText(text);
            });
          } catch (e) {
            console.warn('micro:bit notification start warning:', e);
          }
        }

        this.lastTelemetry = {
          deviceId: this.device.name || 'BBC micro:bit',
          firmwareVersion: 'MakeCode-BLE-UART',
          state: 'READY',
          protocol: 'MAKECODE-UART-STRING',
          lastSeen: new Date().toISOString()
        };

        this._notify(CONNECTION_STATES.CONNECTED, `Terhubung ke BBC micro:bit (${this.device.name || 'Device'}).`);
        return { ok: true, deviceName: this.device.name, telemetry: this.lastTelemetry };
      } catch (err) {
        this.lastError = err.message;
        this._notify(CONNECTION_STATES.ERROR, `Gagal koneksi micro:bit: ${err.message}`);
        return { ok: false, error: err.message };
      }
    }

    _handleIncomingText(text) {
      const clean = String(text || '').trim();
      if (clean) {
        this.lastAck = { raw: clean, timestamp: new Date().toISOString() };
        this._notify(this.status, `[micro:bit RX] ${clean}`, { rawText: clean });
      }
    }

    async disconnect() {
      if (this.device && this.device.gatt && this.device.gatt.connected) {
        this.device.gatt.disconnect();
      }
      this.device = null;
      this.server = null;
      this.rxCharacteristic = null;
      this.txCharacteristic = null;
      this._notify(CONNECTION_STATES.DISCONNECTED, 'Koneksi BBC micro:bit diputuskan.');
      return { ok: true };
    }

    async reconnect() {
      await this.disconnect();
      return await this.connect();
    }

    async _writeMakeCodeCommand(str) {
      if (this.simulationMode) return true;
      if (!this.rxCharacteristic) throw new Error('Karakteristik micro:bit UART tidak siap.');
      const data = new TextEncoder().encode(str + '\n');
      if (this.rxCharacteristic.writeValueWithResponse) {
        await this.rxCharacteristic.writeValueWithResponse(data);
      } else {
        await this.rxCharacteristic.writeValue(data);
      }
      return true;
    }

    async sendSortingCommand(params = {}) {
      const rawColor = String(params.color || params || '').toLowerCase().trim();
      let color = null;
      if (rawColor.includes('kuning') || rawColor.includes('yellow')) color = 'kuning';
      else if (rawColor.includes('biru') || rawColor.includes('blue')) color = 'biru';
      else if (rawColor.includes('merah') || rawColor.includes('red')) color = 'merah';

      if (!VALID_COLORS.includes(color)) {
        throw new Error(`Warna tidak valid: "${params.color}". Harus salah satu dari: ${VALID_COLORS.join(', ')}`);
      }

      const mode = params.mode && VALID_MODES.includes(params.mode) ? params.mode : 'Servo';
      const commandId = params.commandId || `CMD_MBIT_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const startTime = Date.now();

      // Kasus A: Simulasi Virtual
      if (this.simulationMode) {
        this._notify(CONNECTION_STATES.BUSY, `[micro:bit Simulasi] Sortir ${color}`);
        await new Promise(r => setTimeout(r, 200));
        const durationMs = Date.now() - startTime;
        const result = {
          ok: true,
          simulated: true,
          commandId,
          color,
          mode,
          status: 'COMPLETED',
          executionStatus: 'simulated_microbit_ble',
          durationMs,
          message: `Simulasi micro:bit ${color} sukses.`
        };
        this.lastAck = result;
        this._notify(CONNECTION_STATES.SIMULATED, `[micro:bit Simulasi] Selesai ${color}`);
        return result;
      }

      // Kasus B: Hardware Nyata via BLE
      this._notify(CONNECTION_STATES.BUSY, `Mengirim ke micro:bit: "${color}"...`);
      try {
        await this._writeMakeCodeCommand(color);
        const durationMs = Date.now() - startTime;
        const result = {
          ok: true,
          commandId,
          color,
          mode,
          status: 'COMMAND_RECEIVED',
          executionStatus: 'confirmed_microbit_ble',
          durationMs
        };
        this.lastAck = result;
        this._notify(CONNECTION_STATES.CONNECTED, `micro:bit sortir ${color} terkirim (${durationMs}ms)`);
        return result;
      } catch (err) {
        const durationMs = Date.now() - startTime;
        this.lastError = err.message;
        this._notify(CONNECTION_STATES.ERROR, `Gagal kirim ke micro:bit: ${err.message}`);
        return {
          ok: false,
          commandId,
          color,
          mode,
          status: 'FAILED',
          errorCode: 'ERR_MICROBIT_UART_FAILED',
          durationMs,
          error: err.message
        };
      }
    }

    async sendModeCommand(modeName) {
      const mode = VALID_MODES.includes(modeName) ? modeName : 'Servo';
      const cmdStr = mode.toLowerCase();
      if (this.simulationMode) return { ok: true, simulated: true, mode };
      try {
        await this._writeMakeCodeCommand(cmdStr);
        return { ok: true, mode };
      } catch (err) {
        this.lastError = err.message;
        return { ok: false, mode, error: err.message };
      }
    }

    async sendEmergencyStop() {
      if (this.simulationMode) return { ok: true, simulated: true, status: 'STOPPED' };
      try {
        await this._writeMakeCodeCommand('stop');
        return { ok: true, status: 'STOPPED' };
      } catch (err) {
        this.lastError = err.message;
        return { ok: false, error: err.message, status: 'STOP_UNCONFIRMED' };
      }
    }

    async sendTestPulse() {
      if (this.simulationMode) return { ok: true, simulated: true, status: 'PULSE_ACK' };
      try {
        await this._writeMakeCodeCommand('test');
        return { ok: true, message: 'Pulse test OK' };
      } catch (err) {
        this.lastError = err.message;
        return { ok: false, error: err.message };
      }
    }
  }

  // =========================================================================
  // 3B. ADAPTER WI-FI ESP32 (HTTP REST API + JSON)
  // =========================================================================
  class ESP32WiFiAdapter {
    constructor(config = {}) {
      this.deviceType = DEVICE_TYPES.ESP32;
      this.connectionType = CONNECTION_TYPES.WIFI;
      this.host = this._sanitizeHost(config.host);
      this.simulationMode = Boolean(config.simulationMode);
      this.status = this.simulationMode ? CONNECTION_STATES.SIMULATED : CONNECTION_STATES.DISCONNECTED;
      this.timeoutMs = config.timeoutMs || 6000;
      this.lastError = null;
      this.lastAck = null;
      this.lastTelemetry = null;
      this._listeners = new Set();

      if (this.simulationMode) {
        this._initSimulatedTelemetry();
      }
    }

    _sanitizeHost(rawHost) {
      let h = String(rawHost || '').trim();
      if (!h) {
        if (typeof localStorage !== 'undefined') {
          const stored = localStorage.getItem('rlab_esp32_host');
          if (stored) return this._sanitizeHost(stored);
        }
        return 'http://172.25.15.108';
      }
      if (!/^https?:\/\//i.test(h)) h = 'http://' + h;
      // Hapus jika user menyertakan path /api atau /api/test atau trailing slash
      h = h.replace(/\/api(?:\/.*)?$/i, '');
      return h.replace(/\/+$/, '');
    }

    _buildUrl(endpoint) {
      const cleanEndpoint = '/' + String(endpoint || '').replace(/^\/+/, '');
      return `${this.host}${cleanEndpoint}`;
    }

    setHost(newHost) {
      this.host = this._sanitizeHost(newHost);
      return this.host;
    }

    _initSimulatedTelemetry() {
      this.lastTelemetry = {
        deviceId: 'VERNOVA-ESP32-SIM',
        firmwareVersion: 'ESP32-WiFi-v2.1',
        state: 'READY',
        protocol: 'HTTP-JSON',
        host: this.host,
        wifiRssi: -50,
        freeHeap: 245760,
        uptimeSec: 120,
        lastSeen: new Date().toISOString()
      };
    }

    addListener(fn) {
      if (typeof fn === 'function') this._listeners.add(fn);
      return () => this._listeners.delete(fn);
    }

    onStatusChange(fn) {
      return this.addListener(fn);
    }

    _notify(status, message = '', extra = {}) {
      this.status = status;
      const ev = {
        deviceType: this.deviceType,
        connectionType: this.connectionType,
        status,
        message,
        host: this.host,
        timestamp: new Date().toISOString(),
        ...extra
      };
      this._listeners.forEach(fn => {
        try { fn(ev); } catch (e) { console.warn('Listener error:', e); }
      });
    }

    getStatus() {
      return {
        deviceType: this.deviceType,
        connectionType: this.connectionType,
        state: this.status,
        host: this.host,
        simulationMode: this.simulationMode,
        lastError: this.lastError,
        telemetry: this.lastTelemetry
      };
    }

    setSimulation(isSim) {
      this.simulationMode = Boolean(isSim);
      if (this.simulationMode) {
        this._initSimulatedTelemetry();
        this._notify(CONNECTION_STATES.SIMULATED, 'Mode simulasi ESP32 Wi-Fi aktif.');
      } else {
        this.status = CONNECTION_STATES.DISCONNECTED;
        this._notify(CONNECTION_STATES.DISCONNECTED, 'Mode perangkat fisik aktif.');
      }
      return this.simulationMode;
    }

    async _fetchWithTimeout(url, options = {}) {
      const ctrl = new AbortController();
      const timeoutMs = options.timeoutMs || this.timeoutMs;
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const resp = await fetch(url, {
          ...options,
          signal: ctrl.signal,
          headers: {
            'Accept': 'application/json',
            ...(options.headers || {})
          }
        });
        clearTimeout(timer);
        return resp;
      } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          const timeoutErr = new Error(`Timeout menghubungi ESP32 (${timeoutMs}ms) di ${url}. Pastikan ESP32 aktif & satu Wi-Fi (atau gunakan SoftAP http://192.168.4.1).`);
          timeoutErr.code = 'ERR_ESP32_TIMEOUT';
          timeoutErr.url = url;
          throw timeoutErr;
        }
        // Bedakan Network/CORS/Client Isolation
        const isNetworkErr = err.name === 'TypeError' || (err.message && (
          err.message.includes('Failed to fetch') ||
          err.message.includes('NetworkError') ||
          err.message.includes('fetch failed')
        ));
        if (isNetworkErr) {
          const netErr = new Error(`Gagal menghubungi ${url} (Network/CORS/Client Isolation). Pastikan ESP32 aktif, IP benar, dan AP Client Isolation tidak aktif pada router.`);
          netErr.code = 'ERR_ESP32_NETWORK';
          netErr.url = url;
          throw netErr;
        }
        err.url = url;
        throw err;
      }
    }

    async connect() {
      if (this.simulationMode) {
        this._initSimulatedTelemetry();
        this._notify(CONNECTION_STATES.SIMULATED, 'Tersambung ke ESP32 Wi-Fi (Simulasi Virtual).');
        return { ok: true, simulated: true, telemetry: this.lastTelemetry, host: this.host };
      }

      const healthUrl = this._buildUrl('/api/health');
      const statusUrl = this._buildUrl('/api/status');
      this._notify(CONNECTION_STATES.CONNECTING, `Menghubungi ESP32 di ${this.host}...`);
      try {
        let resp = null;
        try {
          resp = await this._fetchWithTimeout(healthUrl, { method: 'GET' });
        } catch (e1) {
          // Fallback ke /api/status jika firmware menggunakan /api/status
          resp = await this._fetchWithTimeout(statusUrl, { method: 'GET' });
        }

        if (!resp || !resp.ok) {
          throw new Error(`ESP32 merespons dengan HTTP ${resp ? resp.status : 'ERR'} di ${this.host}`);
        }

        let data = {};
        try {
          data = await resp.json();
        } catch (je) {
          data = { ok: true, state: 'READY' };
        }

        this.lastTelemetry = {
          deviceId: data.deviceId || 'ESP32-Device',
          firmwareVersion: data.firmwareVersion || 'ESP32-WiFi',
          state: data.state || 'READY',
          protocol: 'HTTP-JSON',
          host: this.host,
          wifiRssi: data.wifiRssi || data.rssi || null,
          freeHeap: data.freeHeap || null,
          uptimeSec: data.uptimeSec || data.uptime || null,
          lastSeen: new Date().toISOString()
        };

        this.lastError = null;
        this._notify(CONNECTION_STATES.CONNECTED, `Terhubung ke ESP32 Wi-Fi (${this.host}).`, { telemetry: this.lastTelemetry });
        return { ok: true, telemetry: this.lastTelemetry, host: this.host };
      } catch (err) {
        this.lastError = err.message;
        this._notify(CONNECTION_STATES.ERROR, `Gagal koneksi ESP32 Wi-Fi: ${err.message}`);
        return { ok: false, error: err.message, host: this.host, targetUrl: healthUrl };
      }
    }

    async disconnect() {
      this._notify(CONNECTION_STATES.DISCONNECTED, 'Koneksi ESP32 Wi-Fi diputuskan.');
      return { ok: true };
    }

    async reconnect() {
      await this.disconnect();
      return await this.connect();
    }

    async sendSortingCommand(params = {}) {
      const rawColor = String(params.color || params || '').toLowerCase().trim();
      let color = null;
      if (rawColor.includes('kuning') || rawColor.includes('yellow')) color = 'kuning';
      else if (rawColor.includes('biru') || rawColor.includes('blue')) color = 'biru';
      else if (rawColor.includes('merah') || rawColor.includes('red')) color = 'merah';

      if (!VALID_COLORS.includes(color)) {
        throw new Error(`Warna tidak valid: "${params.color}". Harus salah satu dari: ${VALID_COLORS.join(', ')}`);
      }

      const rawMode = params.mode || params.mechanism || 'Servo';
      const mode = String(rawMode).toLowerCase().includes('arm') ? 'Arm' : 'Servo';
      const modeStr = mode.toLowerCase();
      const commandId = params.commandId || `CMD_ESP_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const startTime = Date.now();
      const fullCmd = `${color} ${modeStr}`;

      // Kasus A: Simulasi Virtual
      if (this.simulationMode) {
        this._notify(CONNECTION_STATES.BUSY, `[ESP32 Simulasi] Sortir ${fullCmd}`);
        await new Promise(r => setTimeout(r, 200));
        const durationMs = Date.now() - startTime;
        const result = {
          ok: true,
          simulated: true,
          commandId,
          color,
          mode,
          command: fullCmd,
          status: 'COMPLETED',
          executionStatus: 'simulated_esp32_wifi',
          durationMs,
          message: `Simulasi ESP32 ${fullCmd} sukses.`
        };
        this.lastAck = result;
        this._notify(CONNECTION_STATES.SIMULATED, `[ESP32 Simulasi] Selesai ${fullCmd}`);
        return result;
      }

      // Kasus B: Hardware Nyata via HTTP POST
      const sortUrl = this._buildUrl('/api/sort');
      this._notify(CONNECTION_STATES.BUSY, `Mengirim ke ESP32: "${fullCmd}"...`);
      try {
        const payload = {
          type: 'sort',
          color,
          mode: modeStr,
          command: fullCmd,
          objectType: params.objectType || 'CYLINDER_CAP',
          commandId
        };

        const resp = await this._fetchWithTimeout(sortUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (!resp.ok) {
          throw new Error(`ESP32 menolak sortir (HTTP ${resp.status}) di ${sortUrl}`);
        }

        let resJson = {};
        try {
          resJson = await resp.json();
        } catch (e) {
          resJson = { ok: true };
        }

        const durationMs = Date.now() - startTime;
        const result = {
          ok: resJson.ok !== false,
          commandId,
          color,
          mode,
          status: resJson.status || 'COMPLETED',
          executionStatus: 'confirmed_esp32_wifi',
          durationMs,
          host: this.host,
          targetUrl: sortUrl,
          ...resJson
        };

        this.lastAck = result;
        this._notify(CONNECTION_STATES.CONNECTED, `ESP32 sortir ${color} selesai (${durationMs}ms)`);
        return result;
      } catch (err) {
        const durationMs = Date.now() - startTime;
        this.lastError = err.message;
        this._notify(CONNECTION_STATES.ERROR, `Gagal kirim ke ESP32: ${err.message}`);
        return {
          ok: false,
          commandId,
          color,
          mode,
          status: 'FAILED',
          errorCode: 'ERR_ESP32_WIFI_FAILED',
          durationMs,
          host: this.host,
          targetUrl: sortUrl,
          error: err.message
        };
      }
    }

    async sendModeCommand(modeName) {
      const mode = VALID_MODES.includes(modeName) ? modeName : 'Servo';
      if (this.simulationMode) return { ok: true, simulated: true, mode, host: this.host };
      const modeUrl = this._buildUrl('/api/mode');
      try {
        const resp = await this._fetchWithTimeout(modeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'mode', mode: mode.toLowerCase() })
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} di ${modeUrl}`);
        return { ok: true, mode, host: this.host, targetUrl: modeUrl };
      } catch (err) {
        this.lastError = err.message;
        return { ok: false, mode, error: err.message, host: this.host, targetUrl: modeUrl };
      }
    }

    async sendEmergencyStop() {
      if (this.simulationMode) return { ok: true, simulated: true, status: 'STOPPED', host: this.host };
      const stopUrl = this._buildUrl('/api/stop');
      try {
        const resp = await this._fetchWithTimeout(stopUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'stop' })
        });
        return { ok: resp.ok, status: 'STOPPED', host: this.host, targetUrl: stopUrl };
      } catch (err) {
        this.lastError = err.message;
        return { ok: false, error: err.message, status: 'STOP_UNCONFIRMED', host: this.host, targetUrl: stopUrl };
      }
    }

    async sendTestPulse(options = {}) {
      if (this.simulationMode) {
        return {
          ok: true,
          simulated: true,
          status: 'PULSE_ACK',
          message: 'Test pulse simulasi OK',
          host: this.host,
          targetUrl: this._buildUrl('/api/test')
        };
      }
      const timeoutMs = options.timeoutMs || this.timeoutMs;
      const testUrl = this._buildUrl('/api/test');
      const statusUrl = this._buildUrl('/api/status');
      const healthUrl = this._buildUrl('/api/health');
      let lastErr = null;

      // 1. Coba POST /api/test
      try {
        const resp = await this._fetchWithTimeout(testUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'test' }),
          timeoutMs
        });
        if (resp.ok) {
          return { ok: true, message: 'Test pulse acknowledged', host: this.host, targetUrl: testUrl };
        }
        lastErr = new Error(`HTTP ${resp.status} di ${testUrl}`);
      } catch (err1) {
        lastErr = err1;
      }

      // 2. Fallback: Coba GET /api/status jika firmware versi sebelumnya digunakan
      try {
        const respStatus = await this._fetchWithTimeout(statusUrl, {
          method: 'GET',
          timeoutMs: Math.min(timeoutMs, 4000)
        });
        if (respStatus.ok) {
          const stJson = await respStatus.json().catch(() => ({}));
          return { ok: true, message: 'ESP32 merespons status OK (/api/status)', host: this.host, targetUrl: statusUrl, telemetry: stJson };
        }
        if (!lastErr) lastErr = new Error(`HTTP ${respStatus.status} di ${statusUrl}`);
      } catch (err2) {
        if (!lastErr) lastErr = err2;
      }

      // 3. Fallback: Coba GET /api/health
      try {
        const respHealth = await this._fetchWithTimeout(healthUrl, {
          method: 'GET',
          timeoutMs: Math.min(timeoutMs, 4000)
        });
        if (respHealth.ok) {
          const hlJson = await respHealth.json().catch(() => ({}));
          return { ok: true, message: 'ESP32 merespons health OK (/api/health)', host: this.host, targetUrl: healthUrl, telemetry: hlJson };
        }
        if (!lastErr) lastErr = new Error(`HTTP ${respHealth.status} di ${healthUrl}`);
      } catch (err3) {
        if (!lastErr) lastErr = err3;
      }

      this.lastError = lastErr ? lastErr.message : `ESP32 tidak merespons di ${testUrl}`;
      return { ok: false, error: this.lastError, host: this.host, targetUrl: testUrl };
    }
  }

  // =========================================================================
  // 3C. ADAPTER BLUETOOTH BLE ESP32 (Nordic UART Service GATT)
  // =========================================================================
  class ESP32BLEAdapter {
    constructor(config = {}) {
      this.deviceType = DEVICE_TYPES.ESP32_BLE;
      this.connectionType = CONNECTION_TYPES.BLE;
      this.simulationMode = Boolean(config.simulationMode);
      this.targetDeviceName = config.deviceName || 'VERNOVA-ESP32';
      this.device = null;
      this.server = null;
      this.rxCharacteristic = null;
      this.txCharacteristic = null;
      this.status = this.simulationMode ? CONNECTION_STATES.SIMULATED : CONNECTION_STATES.DISCONNECTED;
      this.lastError = null;
      this.lastAck = null;
      this.lastTelemetry = null;
      this.sensorState = {
        state: 'OBJECT_ABSENT',
        objectPresent: false,
        lastUpdate: null,
        channels: {}
      };
      this._listeners = new Set();

      if (this.simulationMode) {
        this._initSimulatedTelemetry();
      }
    }

    _initSimulatedTelemetry() {
      this.lastTelemetry = {
        deviceId: 'VERNOVA-ESP32-BLE-SIM',
        firmwareVersion: 'ESP32-BLE-v2.2',
        state: 'READY',
        protocol: 'NORDIC-UART-STRING',
        lastSeen: new Date().toISOString()
      };
    }

    addListener(fn) {
      if (typeof fn === 'function') this._listeners.add(fn);
      return () => this._listeners.delete(fn);
    }

    onStatusChange(fn) {
      return this.addListener(fn);
    }

    _notify(status, message = '', extra = {}) {
      this.status = status;
      const ev = {
        deviceType: this.deviceType,
        connectionType: this.connectionType,
        status,
        message,
        timestamp: new Date().toISOString(),
        ...extra
      };
      this._listeners.forEach(fn => {
        try { fn(ev); } catch (e) { console.warn('Listener error:', e); }
      });
    }

    isSupported() {
      return isWebBluetoothSupported();
    }

    getStatus() {
      return {
        deviceType: this.deviceType,
        connectionType: this.connectionType,
        state: this.status,
        simulationMode: this.simulationMode,
        lastError: this.lastError,
        telemetry: this.lastTelemetry,
        sensorState: this.sensorState
      };
    }

    getSensorState() {
      return this.sensorState;
    }

    setSimulation(isSim) {
      this.simulationMode = Boolean(isSim);
      if (this.simulationMode) {
        this._initSimulatedTelemetry();
        this._notify(CONNECTION_STATES.SIMULATED, 'Mode simulasi ESP32 BLE aktif.');
      } else {
        this.status = this.device && this.device.gatt?.connected ? CONNECTION_STATES.CONNECTED : CONNECTION_STATES.DISCONNECTED;
        this._notify(this.status, 'Mode perangkat fisik aktif.');
      }
      return this.simulationMode;
    }

    async connect() {
      if (this.simulationMode) {
        this._initSimulatedTelemetry();
        this._notify(CONNECTION_STATES.SIMULATED, 'Tersambung ke ESP32 Bluetooth BLE (Simulasi Virtual).');
        return { ok: true, simulated: true, telemetry: this.lastTelemetry };
      }

      if (!this.isSupported()) {
        const isFile = typeof window !== 'undefined' && window.location && window.location.protocol === 'file:';
        const errMsg = isFile
          ? 'Web Bluetooth API tidak dapat berjalan pada file:/// lokal. Buka website via http://localhost atau aktifkan Mode Simulasi Virtual.'
          : 'Web Bluetooth API tidak didukung di browser ini. Gunakan Google Chrome atau Microsoft Edge melalui HTTPS atau localhost.';
        this.lastError = errMsg;
        this._notify(CONNECTION_STATES.ERROR, errMsg);
        return { ok: false, error: errMsg, unsupported: true };
      }

      try {
        this._notify(CONNECTION_STATES.CONNECTING, 'Memindai perangkat ESP32 Bluetooth BLE...');
        try {
          this.device = await navigator.bluetooth.requestDevice({
            filters: [
              { services: [NORDIC_UART_SERVICE_UUID] },
              { namePrefix: 'VERNOVA' },
              { namePrefix: 'ESP32' },
              { namePrefix: 'VERNOVA-ESP32' }
            ],
            optionalServices: [NORDIC_UART_SERVICE_UUID]
          });
        } catch (scanErr) {
          if (scanErr.name === 'NotFoundError') {
            throw scanErr;
          }
          this.device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [NORDIC_UART_SERVICE_UUID]
          });
        }

        this.device.addEventListener('gattserverdisconnected', () => {
          this._notify(CONNECTION_STATES.DISCONNECTED, 'Koneksi ESP32 Bluetooth BLE terputus.');
        });

        this._notify(CONNECTION_STATES.CONNECTING, `Menghubungkan ke ${this.device.name || 'ESP32 BLE'}...`);
        this.server = await this.device.gatt.connect();

        const service = await this.server.getPrimaryService(NORDIC_UART_SERVICE_UUID);

        // Ambil characteristics RX (write) dan TX (notify)
        const chars = await service.getCharacteristics();
        this.rxCharacteristic = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
        this.txCharacteristic = chars.find(c => c.properties.notify || c.properties.indicate);

        if (this.txCharacteristic) {
          try {
            await this.txCharacteristic.startNotifications();
            this.txCharacteristic.addEventListener('characteristicvaluechanged', (ev) => {
              const text = new TextDecoder().decode(ev.target.value);
              this._handleIncomingText(text);
            });
          } catch (e) {
            console.warn('ESP32 BLE notification start warning:', e);
          }
        }

        this.lastTelemetry = {
          deviceId: this.device.name || 'VERNOVA-ESP32-BLE',
          firmwareVersion: 'ESP32-BLE-UART-v2.2',
          state: 'READY',
          protocol: 'NORDIC-UART-STRING',
          lastSeen: new Date().toISOString()
        };

        this._notify(CONNECTION_STATES.CONNECTED, `Terhubung ke ESP32 Bluetooth BLE (${this.device.name || 'Device'}).`);
        return { ok: true, deviceName: this.device.name, telemetry: this.lastTelemetry };
      } catch (err) {
        this.lastError = err.message;
        this._notify(CONNECTION_STATES.ERROR, `Gagal koneksi ESP32 BLE: ${err.message}`);
        return { ok: false, error: err.message };
      }
    }

    _handleIncomingText(text) {
      const raw = String(text || '');
      console.log(`[BLE RX] ${raw.trim()}`);
      const lines = raw.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);

      lines.forEach(line => {
        this.lastAck = { raw: line, timestamp: new Date().toISOString() };

        // 1. Parsing Telemetri Sensor
        if (line.includes('SENSOR:OBJECT_PRESENT')) {
          this.sensorState.objectPresent = true;
          this.sensorState.state = 'OBJECT_PRESENT';
          this.sensorState.lastUpdate = new Date().toISOString();
          this._notify(this.status, `[ESP32 BLE RX] ${line}`, {
            type: 'sensor_telemetry',
            sensorState: { ...this.sensorState },
            rawText: line
          });
        } else if (line.includes('SENSOR:OBJECT_ABSENT')) {
          this.sensorState.objectPresent = false;
          this.sensorState.state = 'OBJECT_ABSENT';
          this.sensorState.lastUpdate = new Date().toISOString();
          this._notify(this.status, `[ESP32 BLE RX] ${line}`, {
            type: 'sensor_telemetry',
            sensorState: { ...this.sensorState },
            rawText: line
          });
        } else if (line.startsWith('SENSOR:')) {
          // Format spesifik: SENSOR:MERAH:OBJECT_PRESENT dsb.
          const parts = line.split(':');
          if (parts.length >= 3) {
            const channel = parts[1].toUpperCase();
            const state = parts[2].toUpperCase();
            this.sensorState.channels[channel] = state;
            if (state === 'OBJECT_PRESENT') {
              this.sensorState.objectPresent = true;
              this.sensorState.state = 'OBJECT_PRESENT';
            }
            this.sensorState.lastUpdate = new Date().toISOString();
            this._notify(this.status, `[ESP32 BLE RX] ${line}`, {
              type: 'sensor_telemetry',
              channel,
              sensorState: { ...this.sensorState },
              rawText: line
            });
          }
        }

        // 2. Parsing Stage Updates
        if (line.startsWith('STATUS:')) {
          const stage = line.replace(/^STATUS:/, '').trim();
          this._notify(this.status, `[ESP32 BLE Status] ${stage}`, {
            type: 'stage_update',
            stage,
            rawText: line
          });
        }

        // 3. Notifikasi umum
        this._notify(this.status, `[ESP32 BLE RX] ${line}`, { rawText: line });
      });
    }

    receiveMockData(text) {
      this._handleIncomingText(text);
    }

    async disconnect() {
      if (this.device && this.device.gatt && this.device.gatt.connected) {
        this.device.gatt.disconnect();
      }
      this.device = null;
      this.server = null;
      this.rxCharacteristic = null;
      this.txCharacteristic = null;
      this._notify(CONNECTION_STATES.DISCONNECTED, 'Koneksi ESP32 Bluetooth BLE diputuskan.');
      return { ok: true };
    }

    async reconnect() {
      await this.disconnect();
      return await this.connect();
    }

    async _writeBLECommand(str) {
      console.log(`[BLE TX] ${str}`);
      if (this.simulationMode) return true;
      if (!this.rxCharacteristic) throw new Error('Karakteristik ESP32 BLE UART tidak siap.');
      const data = new TextEncoder().encode(str + '\n');
      if (this.rxCharacteristic.writeValueWithResponse) {
        await this.rxCharacteristic.writeValueWithResponse(data);
      } else {
        await this.rxCharacteristic.writeValue(data);
      }
      return true;
    }

    // Alias kompatibilitas
    async _writeBLE(str) {
      return await this._writeBLECommand(str);
    }

    async sendSortingCommand(params = {}) {
      const rawColor = String(params.color || params || '').toLowerCase().trim();
      let color = null;
      if (rawColor.includes('kuning') || rawColor.includes('yellow')) color = 'kuning';
      else if (rawColor.includes('biru') || rawColor.includes('blue')) color = 'biru';
      else if (rawColor.includes('merah') || rawColor.includes('red')) color = 'merah';

      if (!VALID_COLORS.includes(color)) {
        throw new Error(`Warna tidak valid: "${params.color}". Harus salah satu dari: ${VALID_COLORS.join(', ')}`);
      }

      const rawMode = params.mode || params.mechanism || 'Servo';
      const mode = String(rawMode).toLowerCase().includes('arm') ? 'Arm' : 'Servo';
      const modeStr = mode.toLowerCase();
      const commandId = params.commandId || `CMD_ESP_BLE_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const startTime = Date.now();
      const fullCmd = `${color} ${modeStr}`;

      // Kasus A: Simulasi Virtual
      if (this.simulationMode) {
        this._notify(CONNECTION_STATES.BUSY, `[ESP32 BLE Simulasi] Sortir ${fullCmd}`);
        await new Promise(r => setTimeout(r, 200));
        const durationMs = Date.now() - startTime;
        const result = {
          ok: true,
          simulated: true,
          commandId,
          color,
          mode,
          command: fullCmd,
          status: 'COMPLETED',
          executionStatus: 'simulated_esp32_ble',
          durationMs,
          message: `Simulasi ESP32 BLE ${fullCmd} sukses.`
        };
        this.lastAck = result;
        this._notify(CONNECTION_STATES.SIMULATED, `[ESP32 BLE Simulasi] Selesai ${fullCmd}`);
        return result;
      }

      // Kasus B: Hardware Nyata via BLE GATT UART (Mengirim data warna dan mekanisme: misal "merah servo" / "merah arm")
      this._notify(CONNECTION_STATES.BUSY, `Mengirim ke ESP32 BLE: "${fullCmd}"...`);
      try {
        await this._writeBLECommand(fullCmd);
        const durationMs = Date.now() - startTime;
        const result = {
          ok: true,
          commandId,
          color,
          mode,
          command: fullCmd,
          status: 'COMMAND_RECEIVED',
          executionStatus: 'confirmed_esp32_ble',
          durationMs
        };
        this.lastAck = result;
        this._notify(CONNECTION_STATES.CONNECTED, `ESP32 BLE sortir ${fullCmd} terkirim (${durationMs}ms)`);
        return result;
      } catch (err) {
        const durationMs = Date.now() - startTime;
        this.lastError = err.message;
        this._notify(CONNECTION_STATES.ERROR, `Gagal kirim ke ESP32 BLE: ${err.message}`);
        return {
          ok: false,
          commandId,
          color,
          mode,
          status: 'FAILED',
          errorCode: 'ERR_ESP32_BLE_FAILED',
          durationMs,
          error: err.message
        };
      }
    }

    async sendModeCommand(modeName) {
      const mode = VALID_MODES.includes(modeName) ? modeName : 'Servo';
      const cmdStr = mode.toLowerCase();
      if (this.simulationMode) return { ok: true, simulated: true, mode };
      try {
        await this._writeBLECommand(cmdStr);
        return { ok: true, mode };
      } catch (err) {
        this.lastError = err.message;
        return { ok: false, mode, error: err.message };
      }
    }

    async sendEmergencyStop() {
      if (this.simulationMode) return { ok: true, simulated: true, status: 'STOPPED' };
      try {
        await this._writeBLECommand('stop');
        return { ok: true, status: 'STOPPED' };
      } catch (err) {
        this.lastError = err.message;
        return { ok: false, error: err.message, status: 'STOP_UNCONFIRMED' };
      }
    }

    async sendTestPulse() {
      if (this.simulationMode) return { ok: true, simulated: true, status: 'PULSE_ACK', message: 'Test pulse ESP32 BLE OK' };
      try {
        await this._writeBLECommand('test');
        return { ok: true, message: 'Test pulse acknowledged' };
      } catch (err) {
        this.lastError = err.message;
        return { ok: false, error: err.message };
      }
    }
  }

  // =========================================================================
  // 4. DEVICE CONNECTION MANAGER (Pengelola Komunikasi Terpadu & Debounce)
  // =========================================================================
  class DeviceConnectionManager {
    constructor(config = {}) {
      const savedDeviceType = (typeof localStorage !== 'undefined' && localStorage.getItem('rlab_device_type')) || DEVICE_TYPES.MICROBIT;
      const savedHost = (typeof localStorage !== 'undefined' && localStorage.getItem('rlab_esp32_host')) || 'http://172.25.15.108';
      const savedConnType = (typeof localStorage !== 'undefined' && localStorage.getItem('rlab_connection_type')) ||
        (savedDeviceType === DEVICE_TYPES.ESP32 ? CONNECTION_TYPES.WIFI : CONNECTION_TYPES.BLE);

      const resolvedDevType = config.deviceType || savedDeviceType;
      const resolvedConnType = config.connectionType ||
        (resolvedDevType === DEVICE_TYPES.ESP32_BLE ? CONNECTION_TYPES.BLE :
          (resolvedDevType === DEVICE_TYPES.ESP32 ? savedConnType : CONNECTION_TYPES.BLE));

      this.config = {
        deviceType: resolvedDevType,
        connectionType: resolvedConnType,
        debounceMs: config.debounceMs || 1200,
        simulationMode: Boolean(config.simulationMode),
        operatingMode: config.operatingMode || OPERATING_MODES.AUTO,
        host: config.host || savedHost,
        deviceName: config.deviceName || 'BBC micro:bit',
        esp32DeviceName: config.esp32DeviceName || 'VERNOVA-ESP32',
        ...config
      };

      this.operatingMode = this.config.operatingMode;
      this.listeners = new Set();
      this.lastDispatchedColor = null;
      this.lastDispatchedTime = 0;

      // Inisialisasi adapter
      this._initAdapters();
    }

    _initAdapters() {
      this.microbitAdapter = new MicrobitBLEAdapter({
        simulationMode: this.config.simulationMode,
        deviceName: this.config.deviceName
      });

      this.esp32Adapter = new ESP32WiFiAdapter({
        simulationMode: this.config.simulationMode,
        host: this.config.host
      });

      this.esp32BleAdapter = new ESP32BLEAdapter({
        simulationMode: this.config.simulationMode,
        deviceName: this.config.esp32DeviceName
      });

      this._setupAdapterListeners(this.microbitAdapter);
      this._setupAdapterListeners(this.esp32Adapter);
      this._setupAdapterListeners(this.esp32BleAdapter);

      this._resolveActiveAdapter();
    }

    _resolveActiveAdapter() {
      const dev = this.config.deviceType;
      const conn = this.config.connectionType;

      if (dev === DEVICE_TYPES.ESP32_BLE || (dev === DEVICE_TYPES.ESP32 && conn === CONNECTION_TYPES.BLE)) {
        this.adapter = this.esp32BleAdapter;
      } else if (dev === DEVICE_TYPES.ESP32 || dev === 'ESP32_WIFI') {
        this.adapter = this.esp32Adapter;
      } else {
        this.adapter = this.microbitAdapter;
      }
    }

    _setupAdapterListeners(adapter) {
      adapter.onStatusChange(ev => {
        // Teruskan event hanya jika berasal dari adapter aktif
        if (adapter === this.adapter) {
          this.listeners.forEach(fn => {
            try { fn(ev); } catch (e) { console.warn('Manager listener error:', e); }
          });
        }
      });
    }

    switchDevice(deviceType, options = {}) {
      const rawTarget = String(deviceType || '').toUpperCase().trim();
      let targetType = rawTarget;
      let targetConn = options.connectionType;

      if (rawTarget === 'ESP32_BLE') {
        targetType = DEVICE_TYPES.ESP32_BLE;
        targetConn = CONNECTION_TYPES.BLE;
      } else if (rawTarget === 'ESP32_WIFI') {
        targetType = DEVICE_TYPES.ESP32;
        targetConn = CONNECTION_TYPES.WIFI;
      } else if (rawTarget === DEVICE_TYPES.ESP32) {
        targetType = DEVICE_TYPES.ESP32;
        targetConn = options.connectionType || CONNECTION_TYPES.WIFI;
      } else if (rawTarget === DEVICE_TYPES.MICROBIT) {
        targetType = DEVICE_TYPES.MICROBIT;
        targetConn = CONNECTION_TYPES.BLE;
      } else {
        throw new Error(`Device type tidak valid: "${deviceType}". Harus MICROBIT, ESP32, ESP32_WIFI, atau ESP32_BLE.`);
      }

      // Putuskan koneksi adapter lama bila aktif secara tertib
      if (this.adapter && typeof this.adapter.disconnect === 'function') {
        this.adapter.disconnect().catch(() => {});
      }

      this.config.deviceType = targetType;
      this.config.connectionType = targetConn;

      if (options.host) {
        const sanitized = this.esp32Adapter.setHost(options.host);
        this.config.host = sanitized;
      } else if (this.config.host) {
        this.esp32Adapter.setHost(this.config.host);
      }
      if (options.simulationMode !== undefined) {
        this.setSimulation(options.simulationMode);
      }

      this._resolveActiveAdapter();

      // Simpan preferensi ke localStorage
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('rlab_device_type', targetType);
        localStorage.setItem('rlab_connection_type', targetConn);
        if (this.config.host) localStorage.setItem('rlab_esp32_host', this.config.host);
      }

      // Beri tahu listener
      const currentStatus = this.adapter.getStatus();
      const ev = {
        type: 'device_switched',
        deviceType: targetType,
        connectionType: targetConn,
        status: currentStatus.state,
        host: this.config.host,
        timestamp: new Date().toISOString()
      };
      this.listeners.forEach(fn => {
        try { fn(ev); } catch (e) {}
      });

      return { ok: true, deviceType: targetType, connectionType: targetConn };
    }

    setHost(host) {
      if (!host) return this.config.host;
      const sanitized = this.esp32Adapter ? this.esp32Adapter.setHost(host) : host;
      this.config.host = sanitized;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('rlab_esp32_host', sanitized);
      }
      return this.config.host;
    }

    getSensorState() {
      if (this.adapter && typeof this.adapter.getSensorState === 'function') {
        return this.adapter.getSensorState();
      }
      return { state: 'OBJECT_ABSENT', objectPresent: false, channels: {} };
    }

    addListener(fn) {
      if (typeof fn === 'function') this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    onStatusChange(fn) {
      return this.addListener(fn);
    }

    getActiveAdapter() {
      return this.adapter;
    }

    getStatus() {
      const s = this.adapter.getStatus();
      return {
        ...s,
        deviceType: this.config.deviceType,
        connectionType: this.config.connectionType,
        operatingMode: this.operatingMode,
        isEsp32: this.config.deviceType === DEVICE_TYPES.ESP32 || this.config.deviceType === DEVICE_TYPES.ESP32_BLE,
        isMicrobit: this.config.deviceType === DEVICE_TYPES.MICROBIT
      };
    }

    isSimulated() {
      return this.adapter.simulationMode;
    }

    setSimulation(isSim) {
      const simVal = Boolean(isSim);
      this.config.simulationMode = simVal;
      this.microbitAdapter.setSimulation(simVal);
      this.esp32Adapter.setSimulation(simVal);
      if (this.esp32BleAdapter) this.esp32BleAdapter.setSimulation(simVal);
      return simVal;
    }

    getOperatingMode() {
      return this.operatingMode;
    }

    setOperatingMode(mode) {
      const m = String(mode || '').toUpperCase().trim();
      if (m !== OPERATING_MODES.AUTO && m !== OPERATING_MODES.MANUAL) {
        return { ok: false, error: 'INVALID_MODE', message: 'Mode harus AUTO atau MANUAL.' };
      }
      this.operatingMode = m;
      this.listeners.forEach(fn => {
        try { fn({ type: 'operating_mode_changed', operatingMode: m }); } catch (e) {}
      });
      return { ok: true, operatingMode: m };
    }

    async connect() {
      return await this.adapter.connect();
    }

    async disconnect() {
      return await this.adapter.disconnect();
    }

    async reconnect() {
      if (typeof this.adapter.reconnect === 'function') {
        return await this.adapter.reconnect();
      }
      await this.disconnect();
      return await this.connect();
    }

    async sendTestPulse() {
      return await this.adapter.sendTestPulse();
    }

    async dispatchEmergencyStop() {
      return await this.adapter.sendEmergencyStop();
    }

    async dispatchModeCommand(modeName) {
      return await this.adapter.sendModeCommand(modeName);
    }

    async sendManualSort(params = {}) {
      return await this.dispatchSortingCommand({ ...params, force: true });
    }

    /**
     * Dispatch Perintah Sortir dengan Perlindungan Debounce
     */
    async dispatchSortingCommand(params = {}) {
      const color = String(params.color || params || '').toLowerCase().trim();
      const rawMode = params.mode || params.mechanism || 'Servo';
      const mode = String(rawMode).toLowerCase().includes('arm') ? 'Arm' : 'Servo';
      const now = Date.now();

      // Debounce: jika warna sama terdeteksi kembali dalam window debounceMs tanpa flag force
      if (!params.force && color === this.lastDispatchedColor && (now - this.lastDispatchedTime) < this.config.debounceMs) {
        return {
          ok: false,
          suppressed: true,
          reason: `Debounce aktif: deteksi "${color}" ditekan (${now - this.lastDispatchedTime}ms < ${this.config.debounceMs}ms)`
        };
      }

      this.lastDispatchedColor = color;
      this.lastDispatchedTime = now;

      return await this.adapter.sendSortingCommand({
        color,
        mode,
        objectType: params.objectType || 'CYLINDER_CAP',
        commandId: params.commandId
      });
    }

    // Proxy kompatibilitas agar pemanggilan lama tetap aman tanpa error
    createLegacyEsp32ClientProxy() {
      return {
        getStatus: () => ({ status: this.adapter.status, simulationMode: this.adapter.simulationMode }),
        connect: () => this.connect(),
        disconnect: () => this.disconnect(),
        sendSortingCommand: (p) => this.dispatchSortingCommand(p),
        sendEmergencyStop: () => this.dispatchEmergencyStop()
      };
    }
  }

  // =========================================================================
  // 5. EKSPOR MODUL
  // =========================================================================
  return {
    DEVICE_TYPES,
    CONNECTION_TYPES,
    CONNECTION_STATES,
    OPERATING_MODES,
    VALID_COLORS,
    VALID_MODES,
    NORDIC_UART_SERVICE_UUID,
    NORDIC_UART_TX_CHARACTERISTIC_UUID,
    NORDIC_UART_RX_CHARACTERISTIC_UUID,
    MicrobitBLEAdapter,
    ESP32WiFiAdapter,
    ESP32BLEAdapter,
    DeviceConnectionManager,
    aggregateSortingDistribution
  };
});
