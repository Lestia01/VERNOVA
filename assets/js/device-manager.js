/**
 * VERNOVA — Modular Multi-Device & Dual-Connection Manager
 * Mendukung mikrokontroler ESP32 DevKit V1 (Wi-Fi REST & BLE UART)
 * dan BBC micro:bit (MakeCode BLE UART Service).
 * 
 * Memiliki layer adapter terpadu, pencegahan duplikasi perintah (debounce),
 * deteksi kompatibilitas Web Bluetooth API, dan mode simulasi terintegrasi.
 * 
 * Kompatibel dengan Browser (ES6+) dan Node.js (Automated Unit Testing).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const mod = factory();
    root.DeviceConnectionManager = mod.DeviceConnectionManager;
    root.BaseDeviceAdapter = mod.BaseDeviceAdapter;
    root.ESP32WiFiAdapter = mod.ESP32WiFiAdapter;
    root.ESP32BLEAdapter = mod.ESP32BLEAdapter;
    root.MicrobitBLEAdapter = mod.MicrobitBLEAdapter;
    root.DEVICE_TYPES = mod.DEVICE_TYPES;
    root.CONNECTION_TYPES = mod.CONNECTION_TYPES;
    root.CONNECTION_STATES = mod.CONNECTION_STATES;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // =========================================================================
  // KONSTANTA SISTEM & UUID BLUETOOTH
  // =========================================================================
  const DEVICE_TYPES = {
    ESP32: 'ESP32',
    MICROBIT: 'MICROBIT'
  };

  const CONNECTION_TYPES = {
    WIFI: 'WIFI',
    BLE: 'BLE'
  };

  const CONNECTION_STATES = {
    DISCONNECTED: 'DISCONNECTED',
    CONNECTING: 'CONNECTING',
    CONNECTED: 'CONNECTED',
    BUSY: 'BUSY',
    SIMULATED: 'SIMULATED',
    ERROR: 'ERROR'
  };

  // Nordic UART Service (Standar BLE untuk micro:bit MakeCode & ESP32 BLE UART)
  const NORDIC_UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  const NORDIC_UART_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Web menulis ke Perangkat
  const NORDIC_UART_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Perangkat mengirim notifikasi ke Web

  const VALID_COLORS = ['kuning', 'biru', 'merah'];
  const VALID_MODES = ['Servo', 'Arm'];

  /**
   * Helper: Periksa apakah Web Bluetooth didukung di browser saat ini.
   */
  function isWebBluetoothSupported() {
    return typeof navigator !== 'undefined' && Boolean(navigator && navigator.bluetooth);
  }

  // =========================================================================
  // 1. BASE DEVICE ADAPTER (Unified Interface)
  // =========================================================================
  class BaseDeviceAdapter {
    constructor(deviceType, connectionType, config = {}) {
      this.deviceType = deviceType;
      this.connectionType = connectionType;
      this.config = Object.assign({}, config);
      this.status = config.simulationMode ? CONNECTION_STATES.SIMULATED : CONNECTION_STATES.DISCONNECTED;
      this.simulationMode = Boolean(config.simulationMode);
      this.lastError = null;
      this.lastAck = null;
      this.lastTelemetry = null;
      this._listeners = new Set();
    }

    onStatusChange(fn) {
      if (typeof fn === 'function') this._listeners.add(fn);
      return () => this._listeners.delete(fn);
    }

    _notify(state, detail = null) {
      this.status = state;
      const payload = {
        deviceType: this.deviceType,
        connectionType: this.connectionType,
        status: this.status,
        simulation: this.simulationMode,
        detail,
        telemetry: this.lastTelemetry,
        timestamp: new Date().toISOString()
      };
      this._listeners.forEach(fn => {
        try { fn(payload); } catch (e) { console.error(`[${this.deviceType}Adapter] Listener error:`, e); }
      });
    }

    setSimulation(enabled) {
      this.simulationMode = Boolean(enabled);
      if (this.simulationMode) {
        this.status = CONNECTION_STATES.SIMULATED;
        this._notify(CONNECTION_STATES.SIMULATED, 'Mode simulasi aktif.');
      } else {
        this.status = CONNECTION_STATES.DISCONNECTED;
        this._notify(CONNECTION_STATES.DISCONNECTED, 'Mode simulasi dinonaktifkan.');
      }
      return this;
    }

    isSimulated() {
      return this.simulationMode;
    }

    getStatus() {
      const isOnline = (
        this.simulationMode ||
        this.status === CONNECTION_STATES.CONNECTED ||
        this.status === CONNECTION_STATES.READY ||
        this.status === CONNECTION_STATES.BUSY ||
        this.status === CONNECTION_STATES.SIMULATED
      );
      return {
        online: isOnline,
        state: this.status,
        deviceType: this.deviceType,
        connectionType: this.connectionType,
        isSimulated: this.simulationMode,
        lastError: this.lastError,
        telemetry: this.lastTelemetry,
        lastAck: this.lastAck
      };
    }

    /* Abstract methods to be implemented by adapters */
    async connect() { throw new Error('connect() harus diimplementasikan oleh subclass adapter.'); }
    async disconnect() { throw new Error('disconnect() harus diimplementasikan oleh subclass adapter.'); }
    async sendSortingCommand(params) { throw new Error('sendSortingCommand() harus diimplementasikan.'); }
    async sendModeCommand(mode) { throw new Error('sendModeCommand() harus diimplementasikan.'); }
    async sendEmergencyStop() { throw new Error('sendEmergencyStop() harus diimplementasikan.'); }
    async sendTestPulse() { throw new Error('sendTestPulse() harus diimplementasikan.'); }

    dispose() {
      this._listeners.clear();
    }
  }

  // =========================================================================
  // 2. ESP32 WI-FI ADAPTER (HTTP REST API)
  // =========================================================================
  class ESP32WiFiAdapter extends BaseDeviceAdapter {
    constructor(config = {}) {
      super(DEVICE_TYPES.ESP32, CONNECTION_TYPES.WIFI, config);
      this.host = this._sanitizeHost(config.host || 'http://192.168.4.1');
      this.timeoutMs = Math.max(1000, Number(config.timeoutMs) || 5000);
      if (this.simulationMode) {
        this._initSimulatedTelemetry();
      }
    }

    _sanitizeHost(host) {
      let h = String(host || '').trim();
      if (!h) return 'http://192.168.4.1';
      if (!/^https?:\/\//i.test(h)) h = 'http://' + h;
      return h.replace(/\/+$/, '');
    }

    _initSimulatedTelemetry() {
      this.lastTelemetry = {
        deviceId: 'VERNOVA-ESP32-SIMULATOR',
        firmwareVersion: '2.1.0-sim',
        state: 'READY',
        wifiRssi: -42,
        freeHeap: 218400,
        uptimeSec: 360,
        lastSeen: new Date().toISOString()
      };
    }

    async _fetchWithTimeout(url, fetchOpts = {}) {
      const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
      const opts = {
        ...fetchOpts,
        signal: controller ? controller.signal : undefined,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          ...(fetchOpts.headers || {})
        }
      };

      try {
        const resp = await fetch(url, opts);
        if (timer) clearTimeout(timer);
        return resp;
      } catch (err) {
        if (timer) clearTimeout(timer);
        if (err.name === 'AbortError') {
          throw new Error(`Timeout menghubungi ESP32 Wi-Fi setelah ${this.timeoutMs}ms`);
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

      this._notify(CONNECTION_STATES.CONNECTING, `Menghubungi ${this.host}...`);
      try {
        const resp = await this._fetchWithTimeout(`${this.host}/api/status`, { method: 'GET' });
        if (!resp.ok) throw new Error(`ESP32 merespons dengan HTTP ${resp.status}`);
        const json = await resp.json();
        this.lastTelemetry = {
          deviceId: json.deviceId || 'ESP32-VERNOVA',
          firmwareVersion: json.firmwareVersion || '2.1.0',
          state: json.state || 'READY',
          wifiRssi: Number(json.wifiRssi) || -60,
          freeHeap: Number(json.freeHeap) || 0,
          uptimeSec: Number(json.uptimeSec) || 0,
          lastSeen: new Date().toISOString()
        };
        this.lastError = null;
        this._notify(CONNECTION_STATES.CONNECTED, 'Koneksi ESP32 Wi-Fi aktif.');
        return { ok: true, telemetry: this.lastTelemetry };
      } catch (err) {
        this.lastError = err.message;
        this._notify(CONNECTION_STATES.ERROR, `Gagal konek Wi-Fi: ${err.message}`);
        return { ok: false, error: err.message };
      }
    }

    async disconnect() {
      this._notify(CONNECTION_STATES.DISCONNECTED, 'Koneksi ESP32 Wi-Fi diputuskan.');
      return { ok: true };
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
      const commandId = params.commandId || `CMD_WIFI_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const startTime = Date.now();

      if (this.simulationMode) {
        this._notify(CONNECTION_STATES.BUSY, `[Simulasi] Menyortir warna ${color}`);
        await new Promise(r => setTimeout(r, 250));
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
          message: `Simulasi pemilahan ${color} sukses.`
        };
        this.lastAck = result;
        this._notify(CONNECTION_STATES.SIMULATED, `[Simulasi] Sortir ${color} selesai`);
        return result;
      }

      this._notify(CONNECTION_STATES.BUSY, `Mengirim sortir ${color} (${commandId})...`);
      try {
        const resp = await this._fetchWithTimeout(`${this.host}/api/sort`, {
          method: 'POST',
          body: JSON.stringify({
            commandId,
            color,
            mode,
            objectType: params.objectType || 'CYLINDER_CAP',
            timestamp: new Date().toISOString()
          })
        });

        if (!resp.ok) throw new Error(`ESP32 menolak sortir (HTTP ${resp.status})`);
        const json = await resp.json();
        const durationMs = Date.now() - startTime;
        const result = {
          ok: true,
          commandId: json.commandId || commandId,
          color,
          mode,
          status: json.status || 'COMMAND_RECEIVED',
          executionStatus: json.executionStatus || 'confirmed_esp32_wifi',
          durationMs,
          rawResponse: json
        };
        this.lastAck = result;
        this._notify(CONNECTION_STATES.CONNECTED, `Sortir ${color} sukses (${durationMs}ms)`);
        return result;
      } catch (err) {
        const durationMs = Date.now() - startTime;
        this.lastError = err.message;
        this._notify(CONNECTION_STATES.ERROR, `Gagal kirim perintah: ${err.message}`);
        return {
          ok: false,
          commandId,
          color,
          mode,
          status: 'FAILED',
          errorCode: 'ERR_ESP32_WIFI_DISCONNECTED',
          durationMs,
          error: err.message
        };
      }
    }

    async sendModeCommand(modeName) {
      const mode = VALID_MODES.includes(modeName) ? modeName : 'Servo';
      if (this.simulationMode) {
        return { ok: true, simulated: true, mode, message: `Mode diubah ke ${mode}` };
      }
      try {
        const resp = await this._fetchWithTimeout(`${this.host}/api/mode`, {
          method: 'POST',
          body: JSON.stringify({ mode, timestamp: new Date().toISOString() })
        });
        const json = await resp.json();
        return { ok: true, mode, response: json };
      } catch (err) {
        return { ok: false, mode, error: err.message };
      }
    }

    async sendEmergencyStop() {
      if (this.simulationMode) {
        this._notify(CONNECTION_STATES.SIMULATED, 'Emergency stop (Simulasi)');
        return { ok: true, simulated: true, status: 'STOPPED' };
      }
      try {
        const resp = await this._fetchWithTimeout(`${this.host}/api/stop`, {
          method: 'POST',
          body: JSON.stringify({ timestamp: new Date().toISOString() })
        });
        const json = await resp.json();
        this._notify(CONNECTION_STATES.CONNECTED, 'Emergency stop dieksekusi.');
        return { ok: true, response: json };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    async sendTestPulse() {
      // Uji koneksi cepat tanpa menggerakkan seluruh siklus sortir
      return await this.connect();
    }
  }

  // =========================================================================
  // 3. ESP32 BLE ADAPTER (Bluetooth Low Energy GATT UART)
  // =========================================================================
  class ESP32BLEAdapter extends BaseDeviceAdapter {
    constructor(config = {}) {
      super(DEVICE_TYPES.ESP32, CONNECTION_TYPES.BLE, config);
      this.device = null;
      this.server = null;
      this.rxCharacteristic = null;
      this.txCharacteristic = null;
      this.targetDeviceName = config.deviceName || 'VERNOVA-ESP32';
      if (this.simulationMode) {
        this._initSimulatedTelemetry();
      }
    }

    _initSimulatedTelemetry() {
      this.lastTelemetry = {
        deviceId: 'VERNOVA-ESP32-BLE-SIM',
        firmwareVersion: '2.1.0-ble-sim',
        state: 'READY',
        rssi: -55,
        protocol: 'BLE-GATT-UART',
        lastSeen: new Date().toISOString()
      };
    }

    isSupported() {
      return isWebBluetoothSupported();
    }

    async connect() {
      if (this.simulationMode) {
        this._initSimulatedTelemetry();
        this._notify(CONNECTION_STATES.SIMULATED, 'Tersambung ke ESP32 BLE (Simulasi Virtual).');
        return { ok: true, simulated: true, telemetry: this.lastTelemetry };
      }

      if (!this.isSupported()) {
        const errMsg = 'Web Bluetooth API tidak didukung di browser ini. Gunakan Google Chrome atau Microsoft Edge desktop melalui HTTPS atau localhost.';
        this.lastError = errMsg;
        this._notify(CONNECTION_STATES.ERROR, errMsg);
        return { ok: false, error: errMsg, unsupported: true };
      }

      try {
        this._notify(CONNECTION_STATES.CONNECTING, 'Memindai perangkat ESP32 BLE...');
        
        // Buka pemindai dialog Web Bluetooth
        this.device = await navigator.bluetooth.requestDevice({
          filters: [
            { namePrefix: 'VERNOVA' },
            { namePrefix: 'ESP32' },
            { services: [NORDIC_UART_SERVICE_UUID] }
          ],
          optionalServices: [NORDIC_UART_SERVICE_UUID]
        });

        this.device.addEventListener('gattserverdisconnected', () => {
          this._notify(CONNECTION_STATES.DISCONNECTED, 'Koneksi ESP32 BLE terputus.');
        });

        this._notify(CONNECTION_STATES.CONNECTING, `Menghubungkan ke ${this.device.name || 'ESP32 BLE'}...`);
        this.server = await this.device.gatt.connect();

        const service = await this.server.getPrimaryService(NORDIC_UART_SERVICE_UUID);
        
        // Ambil karakteristik RX (tulis dari Web ke ESP32) dan TX (notifikasi ke Web)
        try {
          this.rxCharacteristic = await service.getCharacteristic(NORDIC_UART_RX_UUID);
        } catch (e) {
          console.warn('Fallback mencari karakteristik write pada service:', e);
          const chars = await service.getCharacteristics();
          this.rxCharacteristic = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
        }

        try {
          this.txCharacteristic = await service.getCharacteristic(NORDIC_UART_TX_UUID);
          await this.txCharacteristic.startNotifications();
          this.txCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
            const val = new TextDecoder().decode(event.target.value);
            this._handleIncomingData(val);
          });
        } catch (e) {
          console.warn('TX Characteristic notification tidak tersedia:', e);
        }

        this.lastTelemetry = {
          deviceId: this.device.name || 'ESP32-BLE',
          firmwareVersion: '2.1.0-ble',
          state: 'READY',
          protocol: 'BLE-GATT-UART',
          lastSeen: new Date().toISOString()
        };

        this._notify(CONNECTION_STATES.CONNECTED, `Terhubung ke ESP32 BLE (${this.device.name || 'Device'}).`);
        return { ok: true, deviceName: this.device.name, telemetry: this.lastTelemetry };
      } catch (err) {
        this.lastError = err.message;
        this._notify(CONNECTION_STATES.ERROR, `Gagal koneksi BLE: ${err.message}`);
        return { ok: false, error: err.message };
      }
    }

    _handleIncomingData(text) {
      try {
        const json = JSON.parse(text);
        if (json && json.status) {
          this.lastAck = json;
        }
      } catch (e) {
        // Teks biasa
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
      this._notify(CONNECTION_STATES.DISCONNECTED, 'Koneksi ESP32 BLE diputuskan.');
      return { ok: true };
    }

    async _writeBLE(payloadString) {
      if (this.simulationMode) return true;
      if (!this.rxCharacteristic) throw new Error('Karakteristik BLE RX tidak siap.');
      const encoder = new TextEncoder();
      const data = encoder.encode(payloadString + '\n');
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
      const commandId = params.commandId || `CMD_BLE_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const startTime = Date.now();

      if (this.simulationMode) {
        this._notify(CONNECTION_STATES.BUSY, `[Simulasi BLE] Sortir ${color}`);
        await new Promise(r => setTimeout(r, 260));
        const durationMs = Date.now() - startTime;
        const result = {
          ok: true,
          simulated: true,
          commandId,
          color,
          mode,
          status: 'COMPLETED',
          executionStatus: 'simulated_esp32_ble',
          durationMs,
          message: `Simulasi BLE ${color} selesai.`
        };
        this.lastAck = result;
        this._notify(CONNECTION_STATES.SIMULATED, `[Simulasi BLE] Selesai ${color}`);
        return result;
      }

      this._notify(CONNECTION_STATES.BUSY, `Mengirim sortir BLE ${color}...`);
      try {
        const payload = JSON.stringify({ cmd: 'sort', color, mode, id: commandId });
        await this._writeBLE(payload);
        const durationMs = Date.now() - startTime;
        const result = {
          ok: true,
          commandId,
          color,
          mode,
          status: 'COMMAND_RECEIVED',
          executionStatus: 'confirmed_esp32_ble',
          durationMs
        };
        this.lastAck = result;
        this._notify(CONNECTION_STATES.CONNECTED, `Sortir BLE ${color} terkirim (${durationMs}ms)`);
        return result;
      } catch (err) {
        const durationMs = Date.now() - startTime;
        this.lastError = err.message;
        this._notify(CONNECTION_STATES.ERROR, `Gagal kirim BLE: ${err.message}`);
        return {
          ok: false,
          commandId,
          color,
          mode,
          status: 'FAILED',
          errorCode: 'ERR_ESP32_BLE_WRITE_FAILED',
          durationMs,
          error: err.message
        };
      }
    }

    async sendModeCommand(modeName) {
      const mode = VALID_MODES.includes(modeName) ? modeName : 'Servo';
      if (this.simulationMode) return { ok: true, simulated: true, mode };
      try {
        await this._writeBLE(JSON.stringify({ cmd: 'mode', mode }));
        return { ok: true, mode };
      } catch (err) {
        return { ok: false, mode, error: err.message };
      }
    }

    async sendEmergencyStop() {
      if (this.simulationMode) return { ok: true, simulated: true, status: 'STOPPED' };
      try {
        await this._writeBLE(JSON.stringify({ cmd: 'stop' }));
        return { ok: true, status: 'STOPPED' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    async sendTestPulse() {
      if (this.simulationMode) return { ok: true, simulated: true, message: 'Pulse test OK' };
      try {
        await this._writeBLE(JSON.stringify({ cmd: 'pulse' }));
        return { ok: true, message: 'Pulse test sent' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  }

  // =========================================================================
  // 4. BBC MICRO:BIT BLE ADAPTER (MakeCode Bluetooth UART Service)
  // =========================================================================
  class MicrobitBLEAdapter extends BaseDeviceAdapter {
    constructor(config = {}) {
      super(DEVICE_TYPES.MICROBIT, CONNECTION_TYPES.BLE, config);
      this.device = null;
      this.server = null;
      this.rxCharacteristic = null;
      this.txCharacteristic = null;
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

    isSupported() {
      return isWebBluetoothSupported();
    }

    async connect() {
      if (this.simulationMode) {
        this._initSimulatedTelemetry();
        this._notify(CONNECTION_STATES.SIMULATED, 'Tersambung ke BBC micro:bit (Simulasi Virtual).');
        return { ok: true, simulated: true, telemetry: this.lastTelemetry };
      }

      if (!this.isSupported()) {
        const errMsg = 'Web Bluetooth API tidak didukung di browser ini. Gunakan Google Chrome atau Microsoft Edge desktop melalui HTTPS atau localhost.';
        this.lastError = errMsg;
        this._notify(CONNECTION_STATES.ERROR, errMsg);
        return { ok: false, error: errMsg, unsupported: true };
      }

      try {
        this._notify(CONNECTION_STATES.CONNECTING, 'Memindai perangkat BBC micro:bit...');
        this.device = await navigator.bluetooth.requestDevice({
          filters: [
            { namePrefix: 'BBC micro:bit' },
            { services: [NORDIC_UART_SERVICE_UUID] }
          ],
          optionalServices: [NORDIC_UART_SERVICE_UUID]
        });

        this.device.addEventListener('gattserverdisconnected', () => {
          this._notify(CONNECTION_STATES.DISCONNECTED, 'Koneksi BBC micro:bit terputus.');
        });

        this._notify(CONNECTION_STATES.CONNECTING, `Menghubungkan ke ${this.device.name || 'micro:bit'}...`);
        this.server = await this.device.gatt.connect();

        const service = await this.server.getPrimaryService(NORDIC_UART_SERVICE_UUID);

        // Pada micro:bit MakeCode BLE UART:
        // RX Char (Web -> micro:bit) biasanya 6e400003 atau 6e400002 bergantung versi
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

    /**
     * Mengirim string ASCII berakhiran newline (\n) yang dipahami oleh MakeCode UART
     */
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

      // Kasus A: Simulasi
      if (this.simulationMode) {
        this._notify(CONNECTION_STATES.BUSY, `[micro:bit Simulasi] Sortir ${color}`);
        await new Promise(r => setTimeout(r, 270));
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

      // Kasus B: Hardware Nyata
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
      const cmdStr = mode.toLowerCase(); // 'servo' atau 'arm'
      if (this.simulationMode) return { ok: true, simulated: true, mode };
      try {
        await this._writeMakeCodeCommand(cmdStr);
        return { ok: true, mode };
      } catch (err) {
        return { ok: false, mode, error: err.message };
      }
    }

    async sendEmergencyStop() {
      if (this.simulationMode) return { ok: true, simulated: true, status: 'STOPPED' };
      try {
        await this._writeMakeCodeCommand('stop');
        return { ok: true, status: 'STOPPED' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    async sendTestPulse() {
      if (this.simulationMode) return { ok: true, simulated: true, message: 'Pulse test OK' };
      try {
        await this._writeMakeCodeCommand('test');
        return { ok: true, message: 'Pulse test sent' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  }

  // =========================================================================
  // 5. UNIFIED DEVICE CONNECTION MANAGER (Orchestrator)
  // =========================================================================
  class DeviceConnectionManager {
    constructor(options = {}) {
      this.STORAGE_KEY = 'vernova_device_config';
      this.config = this._loadSavedConfig(options);
      
      this.activeAdapter = null;
      this._managerListeners = new Set();
      this._adapterUnsubscribe = null;

      // Debounce & Duplicate Suppression Guard
      this.lastDispatchedCommand = null;
      this.lastDispatchedTime = 0;
      this.debounceMs = 500; // 500ms cooldown window untuk mencegah double-trigger

      // Inisialisasi adapter berdasarkan konfigurasi aktif
      this._initAdapter();
    }

    _loadSavedConfig(overrides = {}) {
      const defaults = {
        deviceType: DEVICE_TYPES.ESP32,
        connectionType: CONNECTION_TYPES.WIFI,
        host: 'http://192.168.4.1',
        deviceName: '',
        simulationMode: false,
        autoReconnect: false
      };

      if (typeof localStorage !== 'undefined') {
        try {
          const raw = localStorage.getItem(this.STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            return Object.assign({}, defaults, parsed, overrides);
          }
          // Fallback legacy migrasi dari esp32_host / esp32_sim
          const legacyHost = localStorage.getItem('esp32_host');
          const legacySim = localStorage.getItem('esp32_sim') === 'true';
          if (legacyHost || legacySim) {
            defaults.host = legacyHost || defaults.host;
            defaults.simulationMode = legacySim;
          }
        } catch (e) {
          console.warn('Gagal membaca saved device config:', e);
        }
      }
      return Object.assign({}, defaults, overrides);
    }

    saveConfig(newConfig = {}) {
      this.config = Object.assign({}, this.config, newConfig);
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.config));
          // Sinkronisasi legacy keys agar kompatibel
          if (this.config.host) localStorage.setItem('esp32_host', this.config.host);
          localStorage.setItem('esp32_sim', this.config.simulationMode ? 'true' : 'false');
        } catch (e) {
          console.warn('Gagal menyimpan device config:', e);
        }
      }
      return this;
    }

    _initAdapter() {
      if (this._adapterUnsubscribe) {
        this._adapterUnsubscribe();
        this._adapterUnsubscribe = null;
      }
      if (this.activeAdapter && typeof this.activeAdapter.dispose === 'function') {
        this.activeAdapter.dispose();
      }

      const { deviceType, connectionType, host, deviceName, simulationMode } = this.config;

      if (deviceType === DEVICE_TYPES.ESP32) {
        if (connectionType === CONNECTION_TYPES.BLE) {
          this.activeAdapter = new ESP32BLEAdapter({ deviceName, simulationMode });
        } else {
          this.activeAdapter = new ESP32WiFiAdapter({ host, simulationMode });
        }
      } else if (deviceType === DEVICE_TYPES.MICROBIT) {
        // micro:bit selalu menggunakan BLE UART (tidak punya Wi-Fi onboard)
        this.activeAdapter = new MicrobitBLEAdapter({ deviceName, simulationMode });
      } else {
        // Fallback default ESP32 Wi-Fi
        this.activeAdapter = new ESP32WiFiAdapter({ host, simulationMode });
      }

      this._adapterUnsubscribe = this.activeAdapter.onStatusChange((event) => {
        this._notifyManagerListeners(event);
      });
    }

    onStatusChange(fn) {
      if (typeof fn === 'function') this._managerListeners.add(fn);
      return () => this._managerListeners.delete(fn);
    }

    _notifyManagerListeners(event) {
      const enrichedEvent = Object.assign({}, event, {
        managerDeviceType: this.config.deviceType,
        managerConnectionType: this.config.connectionType
      });
      this._managerListeners.forEach(fn => {
        try { fn(enrichedEvent); } catch (e) { console.error('Manager listener error:', e); }
      });
    }

    async switchDevice(deviceType, connectionType, extraConfig = {}) {
      // Validasi kombinasi perangkat & metode koneksi
      if (deviceType === DEVICE_TYPES.MICROBIT && connectionType === CONNECTION_TYPES.WIFI) {
        throw new Error('BBC micro:bit tidak mendukung Wi-Fi. Pilih koneksi Bluetooth Low Energy (BLE).');
      }

      const newConfig = Object.assign({}, this.config, extraConfig, {
        deviceType,
        connectionType
      });

      // Putuskan koneksi adapter saat ini bila sedang tersambung
      if (this.activeAdapter) {
        try { await this.activeAdapter.disconnect(); } catch (e) { /* ignore */ }
      }

      this.saveConfig(newConfig);
      this._initAdapter();
      return this.activeAdapter;
    }

    setSimulation(enabled) {
      this.config.simulationMode = Boolean(enabled);
      this.saveConfig({ simulationMode: this.config.simulationMode });
      if (this.activeAdapter) {
        this.activeAdapter.setSimulation(this.config.simulationMode);
      }
      return this;
    }

    isSimulated() {
      return Boolean(this.config.simulationMode);
    }

    getActiveAdapter() {
      return this.activeAdapter;
    }

    getStatus() {
      const adapterStatus = this.activeAdapter ? this.activeAdapter.getStatus() : {
        online: false,
        state: CONNECTION_STATES.DISCONNECTED
      };
      return Object.assign({}, adapterStatus, {
        deviceType: this.config.deviceType,
        connectionType: this.config.connectionType,
        host: this.config.host,
        deviceName: this.config.deviceName,
        simulationMode: this.config.simulationMode
      });
    }

    async connect() {
      if (!this.activeAdapter) this._initAdapter();
      return await this.activeAdapter.connect();
    }

    async disconnect() {
      if (this.activeAdapter) {
        return await this.activeAdapter.disconnect();
      }
      return { ok: true };
    }

    async sendTestPulse() {
      if (!this.activeAdapter) this._initAdapter();
      return await this.activeAdapter.sendTestPulse();
    }

    async dispatchModeCommand(newMode) {
      if (!this.activeAdapter) this._initAdapter();
      return await this.activeAdapter.sendModeCommand(newMode);
    }

    async dispatchEmergencyStop() {
      if (!this.activeAdapter) this._initAdapter();
      return await this.activeAdapter.sendEmergencyStop();
    }

    /**
     * Dispatcher terpadu untuk perintah pemilahan warna dari AI Vision / input manual.
     * Dilengkapi fitur debounce duplicate suppression (500ms cooldown) untuk mencegah
     * pengiriman berulang kali saat objek yang sama berada di area kamera.
     */
    async dispatchSortingCommand(params = {}) {
      if (!this.activeAdapter) this._initAdapter();

      const rawColor = String(params.color || params || '').toLowerCase().trim();
      let color = null;
      if (rawColor.includes('kuning') || rawColor.includes('yellow')) color = 'kuning';
      else if (rawColor.includes('biru') || rawColor.includes('blue')) color = 'biru';
      else if (rawColor.includes('merah') || rawColor.includes('red')) color = 'merah';

      if (!color) {
        throw new Error(`Warna tidak dikenali: "${params.color}". Warna wajib salah satu dari: kuning, biru, merah.`);
      }

      // Periksa cooldown debounce jika bukan paksaan (force)
      const now = Date.now();
      if (!params.force && this.lastDispatchedCommand === color && (now - this.lastDispatchedTime) < this.debounceMs) {
        return {
          ok: false,
          suppressed: true,
          color,
          reason: `Perintah duplikat untuk "${color}" diabaikan dalam rentang debounce ${this.debounceMs}ms.`
        };
      }

      this.lastDispatchedCommand = color;
      this.lastDispatchedTime = now;

      return await this.activeAdapter.sendSortingCommand({
        ...params,
        color
      });
    }

    /**
     * Proxy backward-compatibility untuk objek legacy window.esp32Client.
     * Mengarahkan pemanggilan kode lama (misal Teachable Machine atau manualAdd)
     * ke DeviceConnectionManager terpadu secara transparan tanpa merusak flow.
     */
    createLegacyEsp32ClientProxy() {
      const self = this;
      return {
        get host() { return self.config.host; },
        set host(v) { self.config.host = v; self.saveConfig({ host: v }); },
        get simulationMode() { return self.config.simulationMode; },
        set simulationMode(v) { self.setSimulation(v); },
        get lastTelemetry() { return self.activeAdapter ? self.activeAdapter.lastTelemetry : null; },
        get lastAck() { return self.activeAdapter ? self.activeAdapter.lastAck : null; },
        get connectionStatus() { return self.activeAdapter ? self.activeAdapter.status : 'OFFLINE'; },
        
        configure: (opts) => {
          if (opts.host) self.config.host = opts.host;
          if (opts.simulationMode !== undefined) self.setSimulation(opts.simulationMode);
          self.saveConfig();
          return this;
        },
        setSimulation: (en) => self.setSimulation(en),
        isSimulated: () => self.isSimulated(),
        getStatus: () => {
          const st = self.getStatus();
          return {
            online: st.online,
            state: st.state,
            host: self.config.host,
            isSimulated: self.config.simulationMode,
            deviceType: st.deviceType,
            connectionType: st.connectionType,
            rssi: (st.telemetry && (st.telemetry.wifiRssi || st.telemetry.rssi)) || (self.config.simulationMode ? -42 : null),
            freeHeap: (st.telemetry && st.telemetry.freeHeap) || (self.config.simulationMode ? 218400 : null),
            uptimeMs: (st.telemetry && st.telemetry.uptimeSec) ? (st.telemetry.uptimeSec * 1000) : 0,
            currentMode: (st.telemetry && st.telemetry.mode) || 'Servo'
          };
        },
        checkHealth: async () => {
          return await self.connect();
        },
        sendSortingCommand: async (params) => {
          return await self.dispatchSortingCommand(params);
        },
        sendModeCommand: async (mode) => {
          return await self.dispatchModeCommand(mode);
        },
        sendEmergencyStop: async () => {
          return await self.dispatchEmergencyStop();
        },
        onStatusChange: (fn) => self.onStatusChange(fn)
      };
    }
  }

  // Export module untuk Browser & Node.js
  return {
    DEVICE_TYPES,
    CONNECTION_TYPES,
    CONNECTION_STATES,
    NORDIC_UART_SERVICE_UUID,
    NORDIC_UART_RX_UUID,
    NORDIC_UART_TX_UUID,
    BaseDeviceAdapter,
    ESP32WiFiAdapter,
    ESP32BLEAdapter,
    MicrobitBLEAdapter,
    DeviceConnectionManager
  };
});
