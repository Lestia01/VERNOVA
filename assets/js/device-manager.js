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

  // UUID Standar Nordic Semiconductor UART Service (NUS)
  const NORDIC_UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  const NORDIC_UART_RX_CHARACTERISTIC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Web -> Device (Write)
  const NORDIC_UART_TX_CHARACTERISTIC_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Device -> Web (Notify)

  function isWebBluetoothSupported() {
    return typeof navigator !== 'undefined' && Boolean(navigator.bluetooth);
  }

  // =========================================================================
  // 2. AGREGASI STATISTIK SORTIR
  // =========================================================================
  function aggregateSortingDistribution(entries = []) {
    const list = Array.isArray(entries) ? entries : Object.values(entries || {});
    const summary = {
      merah_arm: 0,
      kuning_arm: 0,
      biru_arm: 0,
      merah_servo: 0,
      kuning_servo: 0,
      biru_servo: 0,
      kuning: 0,
      biru: 0,
      merah: 0,
      armTotal: 0,
      servoTotal: 0,
      total: 0,
      totalVerified: 0,
      unverifiedTotal: 0,
      unverified: { merah: 0, kuning: 0, biru: 0, arm: 0, servo: 0 },
      gagal: 0,
      totalAttempts: 0,
      successRate: 0.0,
      verifiedSuccessRate: 0.0,
      successRateString: '0.0%'
    };

    list.forEach(entry => {
      if (!entry) return;
      const status = String(entry.status || '').toUpperCase();
      const statusCat = String(entry.statusCategory || entry.verificationStatus || '').toLowerCase();
      const rawColor = String(entry.warna || entry.detectedColor || entry.color || '').toLowerCase().trim();
      let color = null;
      if (rawColor.includes('kuning') || rawColor.includes('yellow')) color = 'kuning';
      else if (rawColor.includes('biru') || rawColor.includes('blue')) color = 'biru';
      else if (rawColor.includes('merah') || rawColor.includes('red')) color = 'merah';

      const rawMech = String(entry.mechanism || entry.mode || (rawColor.includes('arm') ? 'arm' : 'servo')).toLowerCase();
      const mech = rawMech.includes('arm') ? 'arm' : 'servo';

      const isLegacyVerified = (status === 'COMPLETED' || status === 'CONFIRMED' || status === 'SUCCESS' || status === 'VERIFIED');
      const isExplicitVerified = Boolean(
        entry.verified === true ||
        entry.sensorVerified === true ||
        statusCat === 'verified' ||
        (status.includes('TERVERIFIKASI') && !status.includes('BELUM'))
      );
      const isVerified = isExplicitVerified || isLegacyVerified;

      const isFailed = status.includes('FAIL') || status.includes('ERROR') || status.includes('TIMEOUT') || status.includes('MISSORT');

      if (isFailed) {
        summary.gagal++;
      } else if (color) {
        if (isVerified) {
          if (summary[color] !== undefined) summary[color]++;
          const classKey = `${color}_${mech}`;
          if (summary[classKey] !== undefined) summary[classKey]++;
          if (mech === 'arm') summary.armTotal++; else summary.servoTotal++;
          summary.totalVerified++;
          summary.total++;
        } else {
          summary.unverifiedTotal++;
          if (summary.unverified[color] !== undefined) summary.unverified[color]++;
          if (summary.unverified[mech] !== undefined) summary.unverified[mech]++;
        }
      }
    });

    const attempts = summary.total + (summary.unverifiedTotal || 0) + summary.gagal;
    summary.totalAttempts = attempts;
    if (attempts > 0) {
      summary.successRate = Number(((summary.total / attempts) * 100).toFixed(1));
      summary.verifiedSuccessRate = summary.successRate;
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
      this.hasReceivedPhysicalData = false;
      this.sensorState = {
        state: 'OBJECT_ABSENT',
        objectPresent: false,
        mode: 'servo',
        lastUpdate: null,
        channels: {},
        sensors: { merah: false, biru: false, kuning: false, arm: false },
        rawValues: { merah: null, biru: null, kuning: null, arm: null }
      };
      this._rxBuffer = '';
      this._rxFlushTimer = null;
      this._boundNotificationHandler = null;
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
        sensorState: this.sensorState,
        hasReceivedPhysicalData: this.hasReceivedPhysicalData
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

        // Ambil characteristics RX (write) dan TX (notify) dengan pencocokan UUID eksplisit & fallback properti
        const chars = await service.getCharacteristics();
        this.rxCharacteristic = chars.find(c => c.uuid.toLowerCase() === NORDIC_UART_RX_CHARACTERISTIC_UUID) ||
                               chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
        this.txCharacteristic = chars.find(c => c.uuid.toLowerCase() === NORDIC_UART_TX_CHARACTERISTIC_UUID) ||
                               chars.find(c => c.properties.notify || c.properties.indicate);

        console.log('[ESP32 BLE] Karakteristik GATT ditemukan:', {
          service: service.uuid,
          rxWrite: this.rxCharacteristic ? this.rxCharacteristic.uuid : 'TIDAK_DITEMUKAN',
          txNotify: this.txCharacteristic ? this.txCharacteristic.uuid : 'TIDAK_DITEMUKAN'
        });

        if (this.txCharacteristic) {
          try {
            await this.txCharacteristic.startNotifications();
            console.log('[ESP32 BLE] startNotifications BERHASIL pada karakteristik TX:', this.txCharacteristic.uuid);

            this._boundNotificationHandler = (ev) => {
              const text = new TextDecoder().decode(ev.target.value);
              this._handleIncomingChunk(text);
            };
            this.txCharacteristic.addEventListener('characteristicvaluechanged', this._boundNotificationHandler);

            // Minta snapshot sensor awal secara proaktif agar ESP32 langsung membalas
            setTimeout(async () => {
              try {
                if (this.rxCharacteristic && this.device && this.device.gatt && this.device.gatt.connected) {
                  console.log('[ESP32 BLE] Mengirim kueri awal: get_sensors');
                  await this._writeBLECommand('get_sensors');
                }
              } catch (qe) {
                console.warn('[ESP32 BLE] Kueri get_sensors pasca-koneksi dilewati:', qe.message);
              }
            }, 300);
          } catch (e) {
            console.warn('[ESP32 BLE] Gagal startNotifications pada TX characteristic:', e);
          }
        } else {
          console.error('[ESP32 BLE] Karakteristik TX (Notify) tidak ditemukan pada service Nordic UART!');
        }

        this.lastTelemetry = {
          deviceId: this.device.name || 'VERNOVA-ESP32-BLE',
          firmwareVersion: 'ESP32-BLE-UART-v2.4.1',
          state: 'READY',
          protocol: 'NORDIC-UART-JSON',
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

    _handleIncomingChunk(chunk) {
      const raw = String(chunk || '');
      if (!raw) return;
      console.log(`[ESP32 BLE RAW CHUNK] ${raw}`);
      this._rxBuffer += raw;

      if (this._rxFlushTimer) {
        clearTimeout(this._rxFlushTimer);
        this._rxFlushTimer = null;
      }

      // 1. Ekstrak baris-baris lengkap yang diakhiri newline \n
      let newlineIdx;
      while ((newlineIdx = this._rxBuffer.indexOf('\n')) !== -1) {
        const line = this._rxBuffer.slice(0, newlineIdx).replace(/\r$/, '').trim();
        this._rxBuffer = this._rxBuffer.slice(newlineIdx + 1);
        if (line.length > 0) {
          this._processIncomingLine(line);
        }
      }

      // 2. Cegah buffer menunggu newline selamanya jika firmware mengirim data tanpa \n
      if (this._rxBuffer.length > 0) {
        const trimmed = this._rxBuffer.trim();
        const isCompleteJson = trimmed.startsWith('{') && trimmed.endsWith('}');
        const isColorWord = ['merah', 'kuning', 'biru', 'arm', 'kosong', 'none', 'clear'].includes(trimmed.toLowerCase());
        const isCompactComplete = /^(SENSOR:(merah|kuning|biru|kosong)|ARM:(WAIT|SENSE):(merah|kuning|biru)|DONE:(servo|arm):(merah|kuning|biru)|ACK:[a-zA-Z0-9_:]+|ERR:[a-zA-Z0-9_]+|PONG)$/i.test(trimmed);

        if (isCompleteJson || isColorWord || isCompactComplete || this._rxBuffer.length >= 256) {
          this._rxBuffer = '';
          this._processIncomingLine(trimmed);
        } else {
          // Auto-flush jika tidak ada potongan lanjutan dalam 150ms
          this._rxFlushTimer = setTimeout(() => {
            if (this._rxBuffer.length > 0) {
              const pending = this._rxBuffer.replace(/[\r\n]+$/, '').trim();
              this._rxBuffer = '';
              if (pending.length > 0) {
                console.log(`[ESP32 BLE Auto-Flush] Memproses sisa buffer tanpa newline: "${pending}"`);
                this._processIncomingLine(pending);
              }
            }
          }, 150);
        }
      }
    }

    _processIncomingLine(line) {
      if (!line) return;
      console.log(`[ESP32 BLE LINE] ${line}`);
      this.lastAck = { raw: line, timestamp: new Date().toISOString() };

      // 1. Parsing JSON (Format Telemetri Sensor ESP32 Berdasarkan MakeCode & ADC)
      let parsedJson = null;
      if (line.startsWith('{') && line.endsWith('}')) {
        try {
          parsedJson = JSON.parse(line);
        } catch (e) {
          // Bukan JSON valid, lanjut ke parser teks
        }
      }

      if (parsedJson && parsedJson.type) {
        if (parsedJson.type === 'sensor_update') {
          this.hasReceivedPhysicalData = true;
          const sName = String(parsedJson.sensor || '').toLowerCase().trim();
          const isDetected = Boolean(parsedJson.detected);
          const rawVal = parsedJson.value !== undefined ? parsedJson.value : null;

          if (sName) {
            this.sensorState.sensors[sName] = isDetected;
            this.sensorState.rawValues[sName] = rawVal;
            this.sensorState.channels[sName.toUpperCase()] = isDetected ? 'OBJECT_PRESENT' : 'OBJECT_ABSENT';
          }
          const anyDetected = Object.values(this.sensorState.sensors).some(Boolean);
          this.sensorState.objectPresent = anyDetected;
          this.sensorState.state = anyDetected ? 'OBJECT_PRESENT' : 'OBJECT_ABSENT';
          this.sensorState.lastUpdate = new Date().toISOString();

          this._notify(this.status, `[ESP32 BLE] Sensor ${sName}: ${isDetected ? 'TERDETEKSI' : 'KOSONG'} (raw: ${rawVal})`, {
            type: 'sensor_telemetry',
            sensor: sName,
            detected: isDetected,
            value: rawVal,
            timestamp: parsedJson.timestamp || Date.now(),
            sensorState: { ...this.sensorState },
            rawText: line,
            jsonData: parsedJson
          });
          return;
        }

        if (parsedJson.type === 'sensor_state') {
          this.hasReceivedPhysicalData = true;
          if (parsedJson.sensors && typeof parsedJson.sensors === 'object') {
            Object.entries(parsedJson.sensors).forEach(([k, v]) => {
              const sName = k.toLowerCase().trim();
              const isDetected = Boolean(v);
              this.sensorState.sensors[sName] = isDetected;
              this.sensorState.channels[sName.toUpperCase()] = isDetected ? 'OBJECT_PRESENT' : 'OBJECT_ABSENT';
            });
          }
          if (parsedJson.rawValues && typeof parsedJson.rawValues === 'object') {
            Object.entries(parsedJson.rawValues).forEach(([k, v]) => {
              const sName = k.toLowerCase().trim();
              this.sensorState.rawValues[sName] = v;
            });
          }
          if (parsedJson.mode) {
            this.sensorState.mode = parsedJson.mode;
          }
          const anyDetected = Object.values(this.sensorState.sensors).some(Boolean);
          this.sensorState.objectPresent = anyDetected;
          this.sensorState.state = anyDetected ? 'OBJECT_PRESENT' : 'OBJECT_ABSENT';
          this.sensorState.lastUpdate = new Date().toISOString();

          this._notify(this.status, `[ESP32 BLE] Sensor State Terpadu (mode: ${this.sensorState.mode})`, {
            type: 'sensor_state',
            mode: this.sensorState.mode,
            sensorState: { ...this.sensorState },
            rawText: line,
            jsonData: parsedJson
          });
          return;
        }

        if (parsedJson.type === 'status_update') {
          const stage = parsedJson.stage || '';
          this._notify(this.status, `[ESP32 BLE Status] ${stage}`, {
            type: 'stage_update',
            stage,
            sensor: parsedJson.sensor || null,
            rawText: line,
            jsonData: parsedJson
          });
          return;
        }
      }

      // 2. Fallback Parsing Warna Sederhana (Jika Firmware Mengirim TextLine Warna Sederhana: merah, kuning, biru, arm, kosong)
      const cleanLower = line.toLowerCase().trim();
      if (['merah', 'kuning', 'biru', 'arm', 'kosong', 'none', 'clear'].includes(cleanLower)) {
        this.hasReceivedPhysicalData = true;
        console.log(`[ESP32 BLE TextLine Sensor] Terdeteksi token warna sensor: "${cleanLower}"`);

        if (cleanLower === 'kosong' || cleanLower === 'none' || cleanLower === 'clear') {
          this.sensorState.sensors = { merah: false, biru: false, kuning: false, arm: false };
          this.sensorState.channels = { MERAH: 'OBJECT_ABSENT', BIRU: 'OBJECT_ABSENT', KUNING: 'OBJECT_ABSENT', ARM: 'OBJECT_ABSENT' };
          this.sensorState.objectPresent = false;
          this.sensorState.state = 'OBJECT_ABSENT';
          this.sensorState.lastUpdate = new Date().toISOString();

          this._notify(this.status, `[ESP32 BLE] Sensor Kosong (Standby)`, {
            type: 'sensor_telemetry',
            sensor: 'all',
            detected: false,
            sensorState: { ...this.sensorState },
            rawText: line
          });
          return;
        } else {
          this.sensorState.sensors[cleanLower] = true;
          this.sensorState.channels[cleanLower.toUpperCase()] = 'OBJECT_PRESENT';
          ['merah', 'kuning', 'biru'].forEach(c => {
            if (c !== cleanLower) {
              this.sensorState.sensors[c] = false;
              this.sensorState.channels[c.toUpperCase()] = 'OBJECT_ABSENT';
            }
          });
          this.sensorState.objectPresent = true;
          this.sensorState.state = 'OBJECT_PRESENT';
          this.sensorState.lastUpdate = new Date().toISOString();

          this._notify(this.status, `[ESP32 BLE] Sensor ${cleanLower.toUpperCase()} Terdeteksi`, {
            type: 'sensor_telemetry',
            sensor: cleanLower,
            detected: true,
            sensorState: { ...this.sensorState },
            rawText: line
          });
          return;
        }
      }

      // 3. Parsing Format Teks & Compact Sensor (ESP32 BLE & MakeCode)
      if (line.startsWith('ARM:WAIT:')) {
        const col = line.replace(/^ARM:WAIT:/i, '').trim().toLowerCase();
        this.hasReceivedPhysicalData = true;
        this.sensorState.mode = 'arm';
        this.lastArmColor = col;
        this.lastPendingColor = col;
        this._notify(this.status, `[ESP32 BLE Arm] Menunggu objek di sensor ARM (${col.toUpperCase()})`, {
          type: 'stage_update',
          stage: `arm_waiting_for_sensor_${col}`,
          sensor: 'arm',
          color: col,
          mode: 'arm',
          rawText: line
        });
        return;
      }

      if (line.startsWith('ARM:SENSE:')) {
        const col = line.replace(/^ARM:SENSE:/i, '').trim().toLowerCase();
        this.hasReceivedPhysicalData = true;
        this.sensorState.mode = 'arm';
        this.lastArmColor = col;
        this.lastPendingColor = col;
        this.sensorState.sensors.arm = true;
        this.sensorState.channels.ARM = 'OBJECT_PRESENT';
        this.sensorState.objectPresent = true;
        this.sensorState.state = 'OBJECT_PRESENT';
        this.sensorState.lastUpdate = new Date().toISOString();

        // Sensor Arm adalah tahapan perantara (pick point), BUKAN bukti selesai masuk ke wadah/bin
        this._notify(this.status, `[ESP32 BLE Arm] Objek ${col.toUpperCase()} terdeteksi di sensor ARM (menuju bin)`, {
          type: 'stage_update',
          stage: `arm_sense_${col}`,
          sensor: 'arm',
          color: col,
          detected: true,
          verified: false,
          mode: 'arm',
          rawText: line
        });
        return;
      }

      if (line.includes('SENSOR:OBJECT_PRESENT')) {
        this.hasReceivedPhysicalData = true;
        this.sensorState.objectPresent = true;
        this.sensorState.state = 'OBJECT_PRESENT';
        this.sensorState.lastUpdate = new Date().toISOString();
        this._notify(this.status, `[ESP32 BLE RX] ${line}`, {
          type: 'sensor_telemetry',
          sensorState: { ...this.sensorState },
          rawText: line
        });
        return;
      }

      if (line.includes('SENSOR:OBJECT_ABSENT')) {
        this.hasReceivedPhysicalData = true;
        this.sensorState.objectPresent = false;
        this.sensorState.state = 'OBJECT_ABSENT';
        this.sensorState.lastUpdate = new Date().toISOString();
        this._notify(this.status, `[ESP32 BLE RX] ${line}`, {
          type: 'sensor_telemetry',
          sensorState: { ...this.sensorState },
          rawText: line
        });
        return;
      }

      if (line.startsWith('SENSOR:')) {
        this.hasReceivedPhysicalData = true;
        const parts = line.split(':');
        
        // A. Format Ringkas ESP32: SENSOR:merah, SENSOR:kuning, SENSOR:biru, SENSOR:kosong
        if (parts.length === 2) {
          const val = parts[1].toLowerCase().trim();
          this.sensorState.lastUpdate = new Date().toISOString();

          if (val === 'kosong' || val === 'none' || val === 'clear') {
            this.sensorState.sensors.merah = false;
            this.sensorState.sensors.biru = false;
            this.sensorState.sensors.kuning = false;
            this.sensorState.channels.MERAH = 'OBJECT_ABSENT';
            this.sensorState.channels.BIRU = 'OBJECT_ABSENT';
            this.sensorState.channels.KUNING = 'OBJECT_ABSENT';
            const anyArm = Boolean(this.sensorState.sensors.arm);
            this.sensorState.objectPresent = anyArm;
            this.sensorState.state = anyArm ? 'OBJECT_PRESENT' : 'OBJECT_ABSENT';

            this._notify(this.status, `[ESP32 BLE Sensor] Sensor Kosong (Standby)`, {
              type: 'sensor_telemetry',
              sensor: 'all',
              detected: false,
              sensorState: { ...this.sensorState },
              rawText: line
            });
            return;
          } else if (['merah', 'kuning', 'biru', 'arm'].includes(val)) {
            this.sensorState.sensors[val] = true;
            this.sensorState.channels[val.toUpperCase()] = 'OBJECT_PRESENT';
            if (val !== 'arm') {
              ['merah', 'kuning', 'biru'].forEach(c => {
                if (c !== val) {
                  this.sensorState.sensors[c] = false;
                  this.sensorState.channels[c.toUpperCase()] = 'OBJECT_ABSENT';
                }
              });
            }
            this.sensorState.objectPresent = true;
            this.sensorState.state = 'OBJECT_PRESENT';

            this._notify(this.status, `[ESP32 BLE Sensor] Terdeteksi sensor ${val.toUpperCase()}`, {
              type: 'sensor_telemetry',
              sensor: val,
              detected: true,
              sensorState: { ...this.sensorState },
              rawText: line
            });
            return;
          }
        }

        // B. Format Lengkap micro:bit MakeCode: SENSOR:<CHANNEL>:<STATE>
        if (parts.length >= 3) {
          const channel = parts[1].toUpperCase().trim();
          const channelLower = parts[1].toLowerCase().trim();
          const state = parts[2].toUpperCase().trim();
          const isPresent = (state === 'OBJECT_PRESENT');
          this.sensorState.channels[channel] = state;
          if (this.sensorState.sensors[channelLower] !== undefined) {
            this.sensorState.sensors[channelLower] = isPresent;
          }
          if (isPresent) {
            this.sensorState.objectPresent = true;
            this.sensorState.state = 'OBJECT_PRESENT';
          } else {
            const any = Object.values(this.sensorState.channels).some(s => s === 'OBJECT_PRESENT');
            this.sensorState.objectPresent = any;
            this.sensorState.state = any ? 'OBJECT_PRESENT' : 'OBJECT_ABSENT';
          }
          this.sensorState.lastUpdate = new Date().toISOString();
          this._notify(this.status, `[ESP32 BLE RX] ${line}`, {
            type: 'sensor_telemetry',
            channel,
            sensor: channelLower,
            detected: isPresent,
            sensorState: { ...this.sensorState },
            rawText: line
          });
          return;
        }
      }

      // 4. Parsing Stage & Completion Updates (Mendukung STATUS:, STATUS mode=... message=..., dan DONE:)
      if (line.startsWith('STATUS:') || line.startsWith('STATUS ') || line === 'STATUS') {
        let stage = '';
        let messageParam = '';
        let modeParam = '';
        let motorParam = '';

        if (line.startsWith('STATUS:')) {
          stage = line.replace(/^STATUS:/, '').trim();
        } else {
          // Format MakeCode Port: STATUS mode=servo motor=on message=sort_servo_kuning_done
          const msgMatch = line.match(/message=([^\s]+)/i);
          const modeMatch = line.match(/mode=([^\s]+)/i);
          const motorMatch = line.match(/motor=([^\s]+)/i);
          if (msgMatch) messageParam = msgMatch[1].trim();
          if (modeMatch) modeParam = modeMatch[1].trim();
          if (motorMatch) motorParam = motorMatch[1].trim();
          stage = messageParam || line.replace(/^STATUS\s*/i, '').trim();
        }

        // Deteksi apakah pesan status ini mengindikasikan penyortiran selesai
        // PENTING: Sinyal arm_sensor_* dan arm_waiting_* adalah tahapan perantara robot arm, BUKAN bukti selesai masuk ke wadah/bin
        const isArmIntermediate = stage.includes('arm_sensor_') || stage.includes('arm_waiting') || stage.includes('arm_object_');
        const isSortCompleted = !isArmIntermediate && (stage.includes('_done') || stage.includes('SERVO_DONE') || stage.includes('ARM_DONE'));
        let finishedColor = null;
        if (stage.includes('kuning')) finishedColor = 'kuning';
        else if (stage.includes('biru')) finishedColor = 'biru';
        else if (stage.includes('merah')) finishedColor = 'merah';
        else if (isSortCompleted && (this.lastArmColor || this.lastPendingColor)) {
          finishedColor = this.lastArmColor || this.lastPendingColor;
        }

        if (modeParam) this.sensorState.mode = modeParam.toLowerCase();

        // Update status fisik sensor arm dari pesan motor/sensor
        if (stage.includes('detected_motor_stopped') || stage.includes('arm_sensor_detected') || stage.includes('arm_sensor_biru_pass_through') || stage.includes('arm_sense')) {
          this.sensorState.sensors.arm = true;
          this.sensorState.channels.ARM = 'OBJECT_PRESENT';
          this.sensorState.objectPresent = true;
          this.sensorState.state = 'OBJECT_PRESENT';
          this.hasReceivedPhysicalData = true;
          this.sensorState.lastUpdate = new Date().toISOString();
        } else if (stage.includes('arm_sensor_cleared')) {
          this.sensorState.sensors.arm = false;
          this.sensorState.channels.ARM = 'OBJECT_ABSENT';
          const any = Object.entries(this.sensorState.sensors).some(([k, v]) => k !== 'arm' && Boolean(v));
          this.sensorState.objectPresent = any;
          this.sensorState.state = any ? 'OBJECT_PRESENT' : 'OBJECT_ABSENT';
          this.sensorState.lastUpdate = new Date().toISOString();
        }

        this._notify(this.status, `[ESP32 BLE Status] ${stage}`, {
          type: isSortCompleted ? 'sort_completed' : 'stage_update',
          stage,
          message: stage,
          color: finishedColor,
          verified: isSortCompleted,
          mode: modeParam || this.sensorState.mode,
          motor: motorParam,
          rawText: line
        });
        return;
      }

      if (line.startsWith('DONE:') || line.startsWith('DONE ') || line === 'DONE') {
        let rawDone = line.replace(/^DONE[:\s]*/i, '').trim().toLowerCase();
        let doneMode = null;
        let col = rawDone;
        if (rawDone.includes('servo:')) {
          doneMode = 'servo';
          col = rawDone.replace('servo:', '').trim();
        } else if (rawDone.includes('arm:')) {
          doneMode = 'arm';
          col = rawDone.replace('arm:', '').trim();
        }
        if (!['merah', 'kuning', 'biru'].includes(col)) {
          col = this.lastArmColor || this.lastPendingColor || null;
        }
        this._notify(this.status, `[ESP32 BLE Done] Sortir ${col || 'selesai'} (${doneMode || this.sensorState.mode})`, {
          type: 'sort_completed',
          color: col || null,
          mode: doneMode || this.sensorState.mode,
          stage: `sort_${doneMode || 'servo'}_${col || 'selesai'}_done`,
          verified: true,
          rawText: line
        });
        return;
      }

      // 5. Notifikasi ACK dan Error
      if (line.startsWith('ACK:') || line.startsWith('ACK ')) {
        const ackVal = line.replace(/^ACK[:\s]*/i, '').trim();
        this.lastAck = { raw: line, value: ackVal, timestamp: new Date().toISOString() };
        this._notify(this.status, `[ESP32 BLE ACK] ${ackVal}`, {
          type: 'ack',
          ack: ackVal,
          rawText: line
        });
        return;
      }

      if (line.startsWith('ERR:') || line.startsWith('ERR ')) {
        const errVal = line.replace(/^ERR[:\s]*/i, '').trim();
        this.lastError = errVal;
        this._notify(this.status, `[ESP32 BLE Error] ${errVal}`, {
          type: 'error',
          error: errVal,
          rawText: line
        });
        return;
      }

      // 6. Notifikasi umum lainnya
      this._notify(this.status, `[ESP32 BLE RX] ${line}`, { rawText: line });
    }

    _handleIncomingText(text) {
      this._handleIncomingChunk(text);
    }

    receiveMockData(text) {
      this._handleIncomingChunk(text);
    }

    async disconnect() {
      if (this._rxFlushTimer) {
        clearTimeout(this._rxFlushTimer);
        this._rxFlushTimer = null;
      }
      if (this.txCharacteristic && this._boundNotificationHandler) {
        try {
          this.txCharacteristic.removeEventListener('characteristicvaluechanged', this._boundNotificationHandler);
        } catch (e) {
          console.warn('[ESP32 BLE] Error unbinding notification listener:', e);
        }
      }
      this._boundNotificationHandler = null;
      if (this.device && this.device.gatt && this.device.gatt.connected) {
        this.device.gatt.disconnect();
      }
      this.device = null;
      this.server = null;
      this.rxCharacteristic = null;
      this.txCharacteristic = null;
      this._rxBuffer = '';
      this.hasReceivedPhysicalData = false;
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

      let rawMode = params.mode || params.mechanism || '';
      if (!rawMode && rawColor.includes('arm')) rawMode = 'Arm';
      if (!rawMode && rawColor.includes('servo')) rawMode = 'Servo';
      if (!rawMode) rawMode = 'Servo';
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
      this.lastPendingColor = color;
      if (modeStr === 'arm') this.lastArmColor = color;
      this._notify(CONNECTION_STATES.BUSY, `Mengirim ke ESP32 BLE: "${fullCmd}"...`);
      try {
        let isPhysicallyVerified = false;
        let completionDetail = null;

        // Pasang listener verifikasi sebelum mengirim perintah
        const unsubscribe = this.addListener((ev) => {
          if (!ev) return;
          // 1. Konfirmasi dari telemetri sensor fisik bin warna (merah, kuning, biru)
          // PENTING: Baik mode servo maupun mode arm, bukti fisik objek telah tersortir HANYA berasal dari sensor warna di bin (merah, kuning, biru), BUKAN sensor arm!
          if (ev.type === 'sensor_telemetry') {
            if ((ev.sensor === color || ev.channel === color.toUpperCase() || ev.sensorState?.sensors?.[color]) && ev.detected && ['merah', 'kuning', 'biru'].includes(color)) {
              isPhysicallyVerified = true;
              completionDetail = `Sensor bin ${color.toUpperCase()} terdeteksi`;
            }
          }
          // 2. Konfirmasi mode servo (flap) jika sinyal selesai aktuator diterima
          if (modeStr !== 'arm') {
            if (ev.type === 'sort_completed') {
              if (!ev.color || ev.color === color) {
                isPhysicallyVerified = true;
                completionDetail = ev.stage || 'Sortir servo selesai';
              }
            } else if (ev.stage && (
              (ev.stage.includes(color) && (ev.stage.includes('sort_servo_') || ev.stage.includes('done'))) ||
              ev.stage.includes('SERVO_DONE')
            )) {
              isPhysicallyVerified = true;
              completionDetail = ev.stage || 'Sortir servo selesai';
            }
          }
        });

        await this._writeBLECommand(fullCmd);

        // Tunggu respons/konfirmasi sensor fisik atau status selesai dari ESP32
        // Mode servo merah membutuhkan delay(3000ms) di firmware, mode arm membutuhkan waktu perjalanan belt
        const maxWaitMs = params.waitForConfirmation === false ? 0 : (modeStr === 'arm' ? 8000 : 4500);
        const checkInterval = 50;
        let waitedMs = 0;

        while (waitedMs < maxWaitMs) {
          if (isPhysicallyVerified) break;
          await new Promise(r => setTimeout(r, checkInterval));
          waitedMs += checkInterval;
        }

        unsubscribe();

        const durationMs = Date.now() - startTime;
        const result = {
          ok: true,
          commandId,
          color,
          mode,
          command: fullCmd,
          status: isPhysicallyVerified ? 'COMPLETED' : 'COMMAND_RECEIVED',
          verified: isPhysicallyVerified,
          sensorVerified: isPhysicallyVerified,
          statusCategory: isPhysicallyVerified ? 'verified' : 'completed_unverified',
          executionStatus: isPhysicallyVerified ? 'confirmed_esp32_ble' : 'sent_esp32_ble',
          durationMs,
          message: isPhysicallyVerified
            ? `ESP32 BLE sortir ${fullCmd} selesai & terverifikasi fisik (${durationMs}ms)`
            : `ESP32 BLE sortir ${fullCmd} terkirim (${durationMs}ms)`
        };
        this.lastAck = result;
        this._notify(CONNECTION_STATES.CONNECTED, `ESP32 BLE sortir ${fullCmd} ${isPhysicallyVerified ? 'terverifikasi fisik' : 'terkirim'} (${durationMs}ms)`, {
          transaction: result
        });
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
      const rawColor = String(params.color || params || '').toLowerCase().trim();
      let color = null;
      if (rawColor.includes('kuning') || rawColor.includes('yellow')) color = 'kuning';
      else if (rawColor.includes('biru') || rawColor.includes('blue')) color = 'biru';
      else if (rawColor.includes('merah') || rawColor.includes('red')) color = 'merah';
      else color = rawColor;

      let rawMode = params.mode || params.mechanism || '';
      if (!rawMode && (rawColor.includes('arm') || rawColor.includes('lengan'))) rawMode = 'Arm';
      if (!rawMode && (rawColor.includes('servo') || rawColor.includes('flap'))) rawMode = 'Servo';
      if (!rawMode) rawMode = 'Servo';
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
        mechanism: mode,
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
