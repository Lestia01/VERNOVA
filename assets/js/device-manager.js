/**
 * ==============================================================================
 * VERNOVA / R-LAB — Micro:bit Robot Device Manager
 * Arsitektur Sederhana, Stabil & Modular untuk Komunikasi BBC micro:bit
 * 
 * Mendukung:
 * 1. Web Bluetooth API (Nordic UART Service: 6e400001-b5a3-f393-e0a9-e50e24dcca9e)
 * 2. Transmisi Perintah Sortir Warna (kuning, biru, merah) dan Mode Aktuator (servo, arm)
 * 3. Penerimaan Notifikasi Telemetri / Status dari micro:bit
 * 4. Mode Simulasi Virtual (Offline / Fallback tanpa hardware fisik)
 * 5. Debounce & Perlindungan Pengiriman Duplikat
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
    root.DeviceConnectionManager = mod.DeviceConnectionManager;
    root.aggregateSortingDistribution = mod.aggregateSortingDistribution;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // =========================================================================
  // 1. KONSTANTA & PROTOKOL NORDIC UART BBC MICRO:BIT
  // =========================================================================
  const DEVICE_TYPES = {
    MICROBIT: 'MICROBIT'
  };

  const CONNECTION_TYPES = {
    BLE: 'BLE'
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
  // 3. ADAPTER BLE BBC MICRO:BIT (MakeCode Bluetooth UART)
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
        return { ok: false, mode, error: err.message };
      }
    }

    async sendEmergencyStop() {
      if (this.simulationMode) {
        this._notify(CONNECTION_STATES.SIMULATED, 'Emergency stop (Simulasi micro:bit)');
        return { ok: true, simulated: true, status: 'STOPPED' };
      }
      try {
        await this._writeMakeCodeCommand('stop');
        this._notify(CONNECTION_STATES.CONNECTED, 'Emergency stop terkirim ke micro:bit.');
        return { ok: true, status: 'STOPPED' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    async sendTestPulse() {
      if (this.simulationMode) return { ok: true, simulated: true, status: 'PULSE_ACK' };
      try {
        await this._writeMakeCodeCommand('ping');
        return { ok: true, status: 'PULSE_ACK' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  }

  // =========================================================================
  // 4. DEVICE CONNECTION MANAGER (Pengelola Komunikasi micro:bit & Debounce)
  // =========================================================================
  class DeviceConnectionManager {
    constructor(config = {}) {
      this.config = {
        deviceType: DEVICE_TYPES.MICROBIT,
        connectionType: CONNECTION_TYPES.BLE,
        debounceMs: config.debounceMs || 1200,
        simulationMode: Boolean(config.simulationMode),
        operatingMode: config.operatingMode || OPERATING_MODES.AUTO,
        ...config
      };

      this.operatingMode = this.config.operatingMode;
      this.adapter = new MicrobitBLEAdapter({
        simulationMode: this.config.simulationMode,
        deviceName: config.deviceName
      });

      this.lastDispatchedColor = null;
      this.lastDispatchedTime = 0;
      this.listeners = new Set();

      // Teruskan notifikasi dari adapter ke manager listeners
      this.adapter.onStatusChange(ev => {
        this.listeners.forEach(fn => {
          try { fn(ev); } catch (e) { console.warn('Manager listener error:', e); }
        });
      });
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
      return this.adapter.getStatus();
    }

    isSimulated() {
      return this.adapter.simulationMode;
    }

    setSimulation(isSim) {
      const res = this.adapter.setSimulation(isSim);
      this.config.simulationMode = res;
      return res;
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
    DeviceConnectionManager,
    aggregateSortingDistribution
  };
});
