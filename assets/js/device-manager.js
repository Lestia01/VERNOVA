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
    ESP32: 'ESP32'
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
      this.host = this._sanitizeHost(config.host || 'http://192.168.4.1');
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
      if (!h) return 'http://192.168.4.1';
      if (!/^https?:\/\//i.test(h)) h = 'http://' + h;
      return h.replace(/\/+$/, '');
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
      const timer = setTimeout(() => ctrl.abort(), options.timeoutMs || this.timeoutMs);
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
          throw new Error(`Timeout menghubungi ESP32 (${options.timeoutMs || this.timeoutMs}ms) di ${this.host}. Pastikan ESP32 aktif & satu Wi-Fi (atau gunakan SoftAP http://192.168.4.1).`);
        }
        throw err;
      }
    }

    async connect() {
      if (this.simulationMode) {
        this._initSimulatedTelemetry();
        this._notify(CONNECTION_STATES.SIMULATED, 'Tersambung ke ESP32 Wi-Fi (Simulasi Virtual).');
        return { ok: true, simulated: true, telemetry: this.lastTelemetry };
      }

      this._notify(CONNECTION_STATES.CONNECTING, `Menghubungi ESP32 di ${this.host}...`);
      try {
        let resp = null;
        try {
          resp = await this._fetchWithTimeout(`${this.host}/api/health`, { method: 'GET' });
        } catch (e1) {
          // Fallback ke /api/status jika firmware menggunakan /api/status
          resp = await this._fetchWithTimeout(`${this.host}/api/status`, { method: 'GET' });
        }

        if (!resp || !resp.ok) {
          throw new Error(`ESP32 merespons dengan HTTP ${resp ? resp.status : 'ERR'}`);
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
        return { ok: true, telemetry: this.lastTelemetry };
      } catch (err) {
        this.lastError = err.message;
        this._notify(CONNECTION_STATES.ERROR, `Gagal koneksi ESP32 Wi-Fi: ${err.message}`);
        return { ok: false, error: err.message };
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

      const mode = params.mode && VALID_MODES.includes(params.mode) ? params.mode : 'Servo';
      const commandId = params.commandId || `CMD_ESP_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const startTime = Date.now();

      // Kasus A: Simulasi Virtual
      if (this.simulationMode) {
        this._notify(CONNECTION_STATES.BUSY, `[ESP32 Simulasi] Sortir ${color} (${mode})`);
        await new Promise(r => setTimeout(r, 200));
        const durationMs = Date.now() - startTime;
        const result = {
          ok: true,
          simulated: true,
          commandId,
          color,
          mode,
          status: 'COMPLETED',
          executionStatus: 'simulated_esp32_wifi',
          durationMs,
          message: `Simulasi ESP32 ${color} sukses.`
        };
        this.lastAck = result;
        this._notify(CONNECTION_STATES.SIMULATED, `[ESP32 Simulasi] Selesai ${color} (${mode})`);
        return result;
      }

      // Kasus B: Hardware Nyata via HTTP POST
      this._notify(CONNECTION_STATES.BUSY, `Mengirim ke ESP32: "${color}" (${mode})...`);
      try {
        const payload = {
          type: 'sort',
          color,
          mode: mode.toLowerCase(),
          objectType: params.objectType || 'CYLINDER_CAP',
          commandId
        };

        const resp = await this._fetchWithTimeout(`${this.host}/api/sort`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (!resp.ok) {
          throw new Error(`ESP32 menolak sortir (HTTP ${resp.status})`);
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
          error: err.message
        };
      }
    }

    async sendModeCommand(modeName) {
      const mode = VALID_MODES.includes(modeName) ? modeName : 'Servo';
      if (this.simulationMode) return { ok: true, simulated: true, mode };
      try {
        const resp = await this._fetchWithTimeout(`${this.host}/api/mode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'mode', mode: mode.toLowerCase() })
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return { ok: true, mode };
      } catch (err) {
        this.lastError = err.message;
        return { ok: false, mode, error: err.message };
      }
    }

    async sendEmergencyStop() {
      if (this.simulationMode) return { ok: true, simulated: true, status: 'STOPPED' };
      try {
        const resp = await this._fetchWithTimeout(`${this.host}/api/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'stop' })
        });
        return { ok: resp.ok, status: 'STOPPED' };
      } catch (err) {
        this.lastError = err.message;
        return { ok: false, error: err.message, status: 'STOP_UNCONFIRMED' };
      }
    }

    async sendTestPulse(options = {}) {
      if (this.simulationMode) return { ok: true, simulated: true, status: 'PULSE_ACK', message: 'Test pulse simulasi OK' };
      const timeoutMs = options.timeoutMs || this.timeoutMs;
      let lastErr = null;

      // 1. Coba POST /api/test
      try {
        const resp = await this._fetchWithTimeout(`${this.host}/api/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'test' }),
          timeoutMs
        });
        if (resp.ok) {
          return { ok: true, message: 'Test pulse acknowledged' };
        }
      } catch (err1) {
        lastErr = err1;
      }

      // 2. Fallback: Coba GET /api/status jika firmware versi sebelumnya digunakan
      try {
        const respStatus = await this._fetchWithTimeout(`${this.host}/api/status`, {
          method: 'GET',
          timeoutMs: Math.min(timeoutMs, 4000)
        });
        if (respStatus.ok) {
          const stJson = await respStatus.json().catch(() => ({}));
          return { ok: true, message: 'ESP32 merespons status OK (/api/status)', telemetry: stJson };
        }
      } catch (err2) {
        // Abaikan jika tetap gagal
      }

      // 3. Fallback: Coba GET /api/health
      try {
        const respHealth = await this._fetchWithTimeout(`${this.host}/api/health`, {
          method: 'GET',
          timeoutMs: Math.min(timeoutMs, 4000)
        });
        if (respHealth.ok) {
          const hlJson = await respHealth.json().catch(() => ({}));
          return { ok: true, message: 'ESP32 merespons health OK (/api/health)', telemetry: hlJson };
        }
      } catch (err3) {
        // Abaikan
      }

      this.lastError = lastErr ? lastErr.message : 'ESP32 tidak merespons';
      return { ok: false, error: this.lastError };
    }
  }

  // =========================================================================
  // 4. DEVICE CONNECTION MANAGER (Pengelola Komunikasi Terpadu & Debounce)
  // =========================================================================
  class DeviceConnectionManager {
    constructor(config = {}) {
      const savedDeviceType = (typeof localStorage !== 'undefined' && localStorage.getItem('rlab_device_type')) || DEVICE_TYPES.MICROBIT;
      const savedHost = (typeof localStorage !== 'undefined' && localStorage.getItem('rlab_esp32_host')) || 'http://192.168.4.1';

      this.config = {
        deviceType: config.deviceType || savedDeviceType,
        connectionType: (config.deviceType || savedDeviceType) === DEVICE_TYPES.ESP32 ? CONNECTION_TYPES.WIFI : CONNECTION_TYPES.BLE,
        debounceMs: config.debounceMs || 1200,
        simulationMode: Boolean(config.simulationMode),
        operatingMode: config.operatingMode || OPERATING_MODES.AUTO,
        host: config.host || savedHost,
        deviceName: config.deviceName || 'BBC micro:bit',
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

      this._setupAdapterListeners(this.microbitAdapter);
      this._setupAdapterListeners(this.esp32Adapter);

      this.adapter = this.config.deviceType === DEVICE_TYPES.ESP32 ? this.esp32Adapter : this.microbitAdapter;
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
      const targetType = String(deviceType || '').toUpperCase().trim();
      if (targetType !== DEVICE_TYPES.MICROBIT && targetType !== DEVICE_TYPES.ESP32) {
        throw new Error(`Device type tidak valid: "${deviceType}". Harus MICROBIT atau ESP32.`);
      }

      // Putuskan koneksi adapter lama bila aktif
      if (this.adapter && typeof this.adapter.disconnect === 'function') {
        this.adapter.disconnect().catch(() => {});
      }

      this.config.deviceType = targetType;
      this.config.connectionType = targetType === DEVICE_TYPES.ESP32 ? CONNECTION_TYPES.WIFI : CONNECTION_TYPES.BLE;

      if (options.host) {
        this.config.host = options.host;
        this.esp32Adapter.setHost(options.host);
      }
      if (options.simulationMode !== undefined) {
        this.setSimulation(options.simulationMode);
      }

      this.adapter = targetType === DEVICE_TYPES.ESP32 ? this.esp32Adapter : this.microbitAdapter;

      // Simpan preferensi ke localStorage
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('rlab_device_type', targetType);
        if (this.config.host) localStorage.setItem('rlab_esp32_host', this.config.host);
      }

      // Beri tahu listener
      const currentStatus = this.adapter.getStatus();
      const ev = {
        type: 'device_switched',
        deviceType: targetType,
        connectionType: this.config.connectionType,
        status: currentStatus.state,
        host: this.config.host,
        timestamp: new Date().toISOString()
      };
      this.listeners.forEach(fn => {
        try { fn(ev); } catch (e) {}
      });

      return { ok: true, deviceType: targetType, connectionType: this.config.connectionType };
    }

    setHost(host) {
      this.config.host = host;
      if (this.esp32Adapter) this.esp32Adapter.setHost(host);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('rlab_esp32_host', host);
      }
      return this.config.host;
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
        operatingMode: this.operatingMode
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
      const mode = params.mode || 'Servo';
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
    DeviceConnectionManager,
    aggregateSortingDistribution
  };
});
