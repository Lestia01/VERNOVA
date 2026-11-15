/**
 * VERNOVA — ESP32 Wi-Fi Client Adapter
 * Modul komunikasi terpadu untuk konektivitas HTTP REST API antara Web Dashboard dan ESP32.
 * Mendukung mode jaringan lokal (Direct LAN/SoftAP), proxy backend, dan mode simulasi offline.
 * 
 * Kompatibel dengan Browser (ES6+) dan Node.js (untuk Automated Unit Testing).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Esp32Client = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Validasi warna kanonik sistem VERNOVA
  const VALID_COLORS = ['kuning', 'biru', 'merah'];
  const VALID_MODES = ['Servo', 'Arm'];

  class Esp32Client {
    constructor(options = {}) {
      this.host = this._sanitizeHost(options.host || 'http://192.168.4.1');
      this.timeoutMs = options.timeoutMs || 5000;
      this.simulationMode = Boolean(options.simulationMode);
      
      this.connectionStatus = this.simulationMode ? 'SIMULATED' : 'OFFLINE';
      this.lastError = null;
      this.lastAck = null;
      this.lastTelemetry = null;
      this.activeCommand = null;
      
      this._listeners = new Set();
      this._watchdogTimer = null;
    }

    /**
     * Sanitasi format alamat IP / Host ESP32
     */
    _sanitizeHost(host) {
      let h = String(host || '').trim();
      if (!h) return 'http://192.168.4.1';
      if (!/^https?:\/\//i.test(h)) {
        h = 'http://' + h;
      }
      return h.replace(/\/+$/, '');
    }

    /**
     * Mengatur konfigurasi klien
     */
    configure(options = {}) {
      if (options.host !== undefined) {
        this.host = this._sanitizeHost(options.host);
      }
      if (options.timeoutMs !== undefined) {
        this.timeoutMs = Math.max(1000, Number(options.timeoutMs) || 5000);
      }
      if (options.simulationMode !== undefined) {
        this.setSimulation(Boolean(options.simulationMode));
      }
      return this;
    }

    /**
     * Daftarkan listener perubahan status
     */
    onStatusChange(fn) {
      if (typeof fn === 'function') this._listeners.add(fn);
      return () => this._listeners.delete(fn);
    }

    _notify(state, detail = null) {
      this.connectionStatus = state;
      const payload = {
        status: this.connectionStatus,
        host: this.host,
        simulation: this.simulationMode,
        detail,
        timestamp: new Date().toISOString()
      };
      this._listeners.forEach(fn => {
        try { fn(payload); } catch (e) { console.error('Esp32Client listener error:', e); }
      });
    }

    setSimulation(enabled) {
      this.simulationMode = Boolean(enabled);
      if (this.simulationMode) {
        this.lastTelemetry = {
          deviceId: 'VERNOVA-ESP32-SIMULATOR',
          firmwareVersion: '2.1.0-sim',
          state: 'READY',
          wifiRssi: -42,
          freeHeap: 218400,
          uptimeSec: Math.floor(performance.now() / 1000) + 120,
          lastSeen: new Date().toISOString()
        };
        this._notify('SIMULATED', 'Mode simulasi aktif (virtual hardware).');
      } else {
        this._notify('OFFLINE', 'Mode simulasi dinonaktifkan.');
      }
      return this;
    }

    isSimulated() {
      return this.simulationMode;
    }

    /**
     * Lakukan fetch dengan pembatasan waktu timeout
     */
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
          throw new Error(`Timeout menghubungi ESP32 setelah ${this.timeoutMs}ms`);
        }
        throw err;
      }
    }

    /**
     * Memeriksa kesehatan & koneksi ESP32 (GET /api/status)
     */
    async checkHealth() {
      if (this.simulationMode) {
        this.lastTelemetry = {
          deviceId: 'VERNOVA-ESP32-SIMULATOR',
          firmwareVersion: '2.1.0-sim',
          state: 'READY',
          wifiRssi: -40 - Math.floor(Math.random() * 10),
          freeHeap: 215000 + Math.floor(Math.random() * 5000),
          uptimeSec: Math.floor(performance.now() / 1000) + 300,
          lastSeen: new Date().toISOString()
        };
        this._notify('SIMULATED', 'Health check simulasi OK');
        return { ok: true, simulated: true, telemetry: this.lastTelemetry };
      }

      this._notify('CONNECTING', `Menghubungi ${this.host}...`);
      const url = `${this.host}/api/status`;

      try {
        const resp = await this._fetchWithTimeout(url, { method: 'GET' });
        if (!resp.ok) {
          throw new Error(`ESP32 merespons dengan HTTP ${resp.status}`);
        }
        const json = await resp.json();
        this.lastTelemetry = {
          deviceId: json.deviceId || 'ESP32-UNKNOWN',
          firmwareVersion: json.firmwareVersion || '1.0.0',
          state: json.state || 'READY',
          wifiRssi: Number(json.wifiRssi) || -60,
          freeHeap: Number(json.freeHeap) || 0,
          uptimeSec: Number(json.uptimeSec) || 0,
          lastSeen: new Date().toISOString()
        };
        this.lastError = null;
        this._notify(this.lastTelemetry.state === 'BUSY' ? 'BUSY' : 'READY', 'Koneksi aktif');
        return { ok: true, telemetry: this.lastTelemetry };
      } catch (err) {
        this.lastError = err.message;
        this._notify('OFFLINE', `Gagal konek: ${err.message}`);
        return { ok: false, error: err.message };
      }
    }

    /**
     * Mengirimkan perintah penyortiran objek berdasarkan hasil AI Vision
     * POST /api/sort
     */
    async sendSortingCommand(params = {}) {
      const rawColor = String(params.color || params || '').toLowerCase().trim();
      let color = null;
      if (rawColor.includes('kuning') || rawColor.includes('yellow')) color = 'kuning';
      else if (rawColor.includes('biru') || rawColor.includes('blue')) color = 'biru';
      else if (rawColor.includes('merah') || rawColor.includes('red')) color = 'merah';

      if (!VALID_COLORS.includes(color)) {
        throw new Error(`Kategori warna tidak valid: "${params.color}". Warna wajib salah satu dari: ${VALID_COLORS.join(', ')}`);
      }

      const mode = params.mode && VALID_MODES.includes(params.mode) ? params.mode : 'Servo';
      const objectType = params.objectType || 'CYLINDER_CAP';
      const commandId = params.commandId || `CMD_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const timestamp = new Date().toISOString();

      const commandPayload = {
        type: 'sorting_command',
        protocolVersion: '2.0',
        commandId,
        color,
        mode,
        objectType,
        timestamp
      };

      this.activeCommand = commandPayload;
      const startTime = Date.now();

      // Kasus A: Mode Simulasi (Virtual Hardware)
      if (this.simulationMode) {
        this._notify('BUSY', `[Simulasi] Menyortir objek warna ${color}`);
        // Simulasi latensi transmisi jaringan + pergerakan aktuator servo (~300ms)
        await new Promise(r => setTimeout(r, 280));
        
        const durationMs = Date.now() - startTime;
        const result = {
          ok: true,
          simulated: true,
          commandId,
          color,
          mode,
          status: 'COMPLETED',
          executionStatus: 'simulated_esp32',
          durationMs,
          message: `Simulasi pemilahan ${color} sukses.`
        };
        this.lastAck = result;
        this.activeCommand = null;
        this._notify('SIMULATED', `[Simulasi] Pemilahan ${color} selesai`);
        return result;
      }

      // Kasus B: Komunikasi Nyata ke ESP32 (HTTP REST API)
      this._notify('BUSY', `Mengirim perintah ${color} (${commandId})...`);
      const url = `${this.host}/api/sort`;

      try {
        const resp = await this._fetchWithTimeout(url, {
          method: 'POST',
          body: JSON.stringify(commandPayload)
        });

        if (!resp.ok) {
          throw new Error(`ESP32 menolak perintah (HTTP ${resp.status})`);
        }

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
          esp32DeviceId: (this.lastTelemetry && this.lastTelemetry.deviceId) || json.deviceId || 'ESP32-ROBOT',
          rawResponse: json
        };

        this.lastAck = result;
        this.activeCommand = null;
        this._notify('READY', `Perintah ${color} terkonfirmasi ESP32 (${durationMs}ms)`);
        return result;
      } catch (err) {
        const durationMs = Date.now() - startTime;
        this.lastError = err.message;
        this.activeCommand = null;
        this._notify('ERROR', `Gagal kirim perintah: ${err.message}`);
        
        return {
          ok: false,
          commandId,
          color,
          mode,
          status: 'FAILED',
          executionStatus: 'failed_communication',
          errorCode: 'ERR_ESP32_HTTP_DISCONNECTED',
          durationMs,
          error: err.message
        };
      }
    }

    /**
     * Mengubah mode kerja lengan/servo pada ESP32 (POST /api/mode)
     */
    async sendModeCommand(modeName) {
      const mode = VALID_MODES.includes(modeName) ? modeName : 'Servo';
      const commandId = `MODE_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      
      if (this.simulationMode) {
        return { ok: true, simulated: true, mode, message: `Mode diubah ke ${mode}` };
      }

      const url = `${this.host}/api/mode`;
      try {
        const resp = await this._fetchWithTimeout(url, {
          method: 'POST',
          body: JSON.stringify({ commandId, mode, timestamp: new Date().toISOString() })
        });
        const json = await resp.json();
        return { ok: true, mode, response: json };
      } catch (err) {
        return { ok: false, mode, error: err.message };
      }
    }

    /**
     * Mengirim perintah Emergency Stop / Reset Servo ke ESP32 (POST /api/stop)
     */
    async sendEmergencyStop() {
      if (this.simulationMode) {
        this._notify('SIMULATED', 'Emergency stop simulasi');
        return { ok: true, simulated: true, status: 'STOPPED' };
      }

      const url = `${this.host}/api/stop`;
      try {
        const resp = await this._fetchWithTimeout(url, {
          method: 'POST',
          body: JSON.stringify({ timestamp: new Date().toISOString() })
        });
        const json = await resp.json();
        this._notify('READY', 'Perangkat dihentikan (Emergency Stop).');
        return { ok: true, response: json };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  }

  return Esp32Client;
});
