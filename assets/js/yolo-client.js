/**
 * VERNOVA — YOLO Training Studio Client & Dual-Engine Coordinator
 * Menghubungkan Dashboard Web dengan Backend Python YOLO Training Studio
 * untuk Computer Vision YOLO + OpenCV, Anotasi Bounding Box, Job Monitoring,
 * Model Registry, dan Inferensi Robot Sortir Real-Time.
 * 
 * Kompatibel dengan Browser (ES6+) dan Node.js (Automated Unit Testing).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const mod = factory();
    root.YoloStudioClient = mod.YoloStudioClient;
    root.AI_ENGINES = mod.AI_ENGINES;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const AI_ENGINES = {
    TEACHABLE_MACHINE: 'teachable_machine',
    YOLO: 'yolo'
  };

  class YoloStudioClient {
    constructor(options = {}) {
      this.baseUrl = this._sanitizeBaseUrl(options.baseUrl || 'http://127.0.0.1:8000');
      let savedEngine = null;
      if (typeof localStorage !== 'undefined') {
        try { savedEngine = localStorage.getItem('vernova_ai_engine'); } catch (e) {}
      }
      this.activeEngine = options.activeEngine || savedEngine || AI_ENGINES.TEACHABLE_MACHINE;
      this.timeoutMs = options.timeoutMs || 8000;
      this.statusListeners = new Set();
      this.activeJobId = null;
      this.isOnline = false;
      this.lastHealth = null;
    }

    _sanitizeBaseUrl(url) {
      let u = String(url || '').trim();
      if (!u) return 'http://127.0.0.1:8000';
      if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
      return u.replace(/\/+$/, '');
    }

    setEngine(engineName) {
      if (!Object.values(AI_ENGINES).includes(engineName)) {
        throw new Error(`Engine tidak valid: ${engineName}. Wajib: teachable_machine atau yolo.`);
      }
      this.activeEngine = engineName;
      if (typeof localStorage !== 'undefined') {
        try { localStorage.setItem('vernova_ai_engine', engineName); } catch (e) {}
      }
      this._notifyListeners({ type: 'engine_changed', engine: this.activeEngine });
      return this.activeEngine;
    }

    getEngine() {
      return this.activeEngine;
    }

    isYoloActive() {
      return this.activeEngine === AI_ENGINES.YOLO;
    }

    onStatusChange(fn) {
      if (typeof fn === 'function') this.statusListeners.add(fn);
      return () => this.statusListeners.delete(fn);
    }

    _notifyListeners(payload) {
      this.statusListeners.forEach(fn => {
        try { fn(payload); } catch (e) { console.error('YoloStudioClient listener error:', e); }
      });
    }

    async _fetch(endpoint, options = {}) {
      const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timeout = setTimeout(() => controller?.abort(), options.timeoutMs || this.timeoutMs);

      const url = `${this.baseUrl}${endpoint}`;
      const headers = Object.assign({
        'Accept': 'application/json'
      }, options.headers || {});

      try {
        const resp = await fetch(url, {
          ...options,
          signal: controller?.signal,
          headers
        });
        clearTimeout(timeout);
        if (!resp.ok) {
          let errText = `HTTP ${resp.status}`;
          try {
            const errJson = await resp.json();
            errText = errJson.detail || errText;
          } catch (_) {}
          throw new Error(errText);
        }
        return await resp.json();
      } catch (err) {
        clearTimeout(timeout);
        throw err;
      }
    }

    // =========================================================================
    // 1. HEALTH & ENGINE STATUS
    // =========================================================================
    async checkHealth() {
      try {
        const data = await this._fetch('/api/health', { timeoutMs: 3000 });
        this.isOnline = true;
        this.lastHealth = data;
        return { ok: true, data };
      } catch (err) {
        this.isOnline = false;
        return { ok: false, error: err.message };
      }
    }

    async getEngineStatus() {
      return await this._fetch('/api/engine/status');
    }

    // =========================================================================
    // 2. PROJECT MANAGEMENT
    // =========================================================================
    async listProjects() {
      return await this._fetch('/api/projects');
    }

    async createProject(name, description = '', classes = ['merah', 'kuning', 'biru']) {
      return await this._fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, classes })
      });
    }

    async getProject(projectId) {
      return await this._fetch(`/api/projects/${projectId}`);
    }

    async updateProject(projectId, updates = {}) {
      return await this._fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
    }

    async deleteProject(projectId) {
      return await this._fetch(`/api/projects/${projectId}`, {
        method: 'DELETE'
      });
    }

    // =========================================================================
    // 3. DATASET & IMAGES
    // =========================================================================
    async listImages(projectId) {
      return await this._fetch(`/api/projects/${projectId}/images`);
    }

    getImageUrl(projectId, filename) {
      return `${this.baseUrl}/api/projects/${projectId}/images/${filename}`;
    }

    async uploadImage(projectId, file) {
      const formData = new FormData();
      formData.append('file', file);
      return await this._fetch(`/api/projects/${projectId}/upload`, {
        method: 'POST',
        body: formData
      });
    }

    async captureCamera(projectId, imageBase64) {
      return await this._fetch(`/api/projects/${projectId}/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: imageBase64 })
      });
    }

    async deleteImage(projectId, imageId) {
      return await this._fetch(`/api/projects/${projectId}/images/${imageId}`, {
        method: 'DELETE'
      });
    }

    async uploadZip(projectId, zipFile) {
      const formData = new FormData();
      formData.append('file', zipFile);
      return await this._fetch(`/api/projects/${projectId}/upload-zip`, {
        method: 'POST',
        body: formData,
        timeoutMs: 30000
      });
    }

    async validateDataset(projectId) {
      return await this._fetch(`/api/projects/${projectId}/validate`);
    }

    // =========================================================================
    // 4. ANNOTATIONS
    // =========================================================================
    async getAnnotation(projectId, imageId) {
      return await this._fetch(`/api/projects/${projectId}/annotations/${imageId}`);
    }

    async saveAnnotation(projectId, imageId, bboxes) {
      return await this._fetch(`/api/projects/${projectId}/annotations/${imageId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bboxes })
      });
    }

    // =========================================================================
    // 5. TRAINING JOBS
    // =========================================================================
    async startTraining(projectId, config = {}) {
      const data = await this._fetch(`/api/projects/${projectId}/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      this.activeJobId = data.job_id;
      return data;
    }

    async getJobStatus(jobId) {
      return await this._fetch(`/api/jobs/${jobId}`);
    }

    async cancelJob(jobId) {
      return await this._fetch(`/api/jobs/${jobId}/cancel`, {
        method: 'POST'
      });
    }

    async listJobs(projectId = null) {
      const q = projectId ? `?project_id=${projectId}` : '';
      return await this._fetch(`/api/jobs${q}`);
    }

    // =========================================================================
    // 6. MODEL REGISTRY
    // =========================================================================
    async listModels(projectId = null) {
      const q = projectId ? `?project_id=${projectId}` : '';
      return await this._fetch(`/api/models${q}`);
    }

    async getModel(modelId) {
      return await this._fetch(`/api/models/${modelId}`);
    }

    async getActiveModel() {
      return await this._fetch('/api/models/active');
    }

    async activateModel(modelId) {
      return await this._fetch(`/api/models/${modelId}/activate`, {
        method: 'POST'
      });
    }

    async deleteModel(modelId) {
      return await this._fetch(`/api/models/${modelId}`, {
        method: 'DELETE'
      });
    }

    async compareModels(modelIdA, modelIdB) {
      return await this._fetch('/api/models/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id_a: modelIdA, model_id_b: modelIdB })
      });
    }

    // =========================================================================
    // 7. INFERENCE (TESTING & ROBOT SORTING)
    // =========================================================================
    async predictFrame(imageBase64, options = {}) {
      return await this._fetch('/api/inference/frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: imageBase64,
          model_id: options.modelId || null,
          conf_threshold: options.confThreshold || 0.25,
          draw_bboxes: Boolean(options.drawBboxes)
        }),
        timeoutMs: options.timeoutMs || 4000
      });
    }

    /**
     * Standardizer output deteksi kanonik yang dipahami oleh robot sortir.
     * Mengubah format deteksi YOLO menjadi input perintah pemilahan warna.
     */
    extractTopColorDetection(predictionResult, minConfidence = 0.65) {
      if (!predictionResult || !predictionResult.detections || !predictionResult.detections.length) {
        return null;
      }

      // Filter deteksi di atas confidence threshold
      const validDetections = predictionResult.detections.filter(d => d.confidence >= minConfidence);
      if (!validDetections.length) return null;

      // Ambil deteksi dengan confidence tertinggi
      const top = validDetections[0];
      const cLower = String(top.class_name || '').toLowerCase().trim();

      let colorCode = null;
      if (cLower.includes('kuning') || cLower.includes('yellow')) colorCode = 'kuning';
      else if (cLower.includes('biru') || cLower.includes('blue')) colorCode = 'biru';
      else if (cLower.includes('merah') || cLower.includes('red')) colorCode = 'merah';

      if (!colorCode) return null;

      return {
        color: colorCode,
        confidence: top.confidence,
        bbox: top.bbox,
        class_name: top.class_name,
        engine: 'yolo',
        model_id: predictionResult.model_id,
        timestamp: predictionResult.timestamp
      };
    }
  }

  return {
    AI_ENGINES,
    YoloStudioClient
  };
});
