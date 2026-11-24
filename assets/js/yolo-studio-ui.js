/**
 * VERNOVA — YOLO Training Studio Interactive UI Controller
 * Mengelola navigasi tab Studio, Project Manager, Dataset Manager,
 * Annotation Canvas (Bounding Box), Dataset Validation, Background Training Monitor,
 * Model Registry & Evaluation, Model Testing, dan Dual-Engine Dashboard Integration.
 */

(function (root) {
  'use strict';

  class YoloStudioUI {
    constructor() {
      this.client = (typeof YoloStudioClient !== 'undefined') ? new YoloStudioClient() : null;
      this.currentProject = null;
      this.projects = [];
      this.images = [];
      this.selectedImage = null;
      this.bboxes = [];
      this.selectedBBoxIdx = -1;
      this.selectedClassIdx = 0;
      this.activeTab = 'projects';
      this.pollTimer = null;
      this.activeJobId = null;

      // Canvas annotation state
      this.canvas = null;
      this.ctx = null;
      this.imgElement = new Image();
      this.isDrawing = false;
      this.dragMode = null; // 'draw', 'move', 'resize'
      this.dragHandle = null;
      this.startX = 0;
      this.startY = 0;

      // Test webcam state
      this.testStream = null;
      this.testInterval = null;

      // Color scheme for bounding boxes
      this.classColors = {
        0: { fill: 'rgba(239, 68, 68, 0.25)', stroke: '#ef4444', text: '#fee2e2' }, // Merah
        1: { fill: 'rgba(234, 179, 8, 0.25)', stroke: '#eab308', text: '#fef9c3' }, // Kuning
        2: { fill: 'rgba(59, 130, 246, 0.25)', stroke: '#3b82f6', text: '#dbeafe' }, // Biru
        default: { fill: 'rgba(16, 185, 129, 0.25)', stroke: '#10b981', text: '#d1fae5' }
      };
    }

    async init() {
      this.updateEnginePills();
      await this.checkBackendStatus();
      await this.loadProjects();
      await this.loadModels();
    }

    async checkBackendStatus() {
      const banner = document.getElementById('yolo-backend-status-badge');
      if (!this.client) return;
      const res = await this.client.checkHealth();
      if (banner) {
        if (res.ok) {
          banner.className = 'pill on cursor-pointer';
          banner.innerHTML = '<span class="live-dot !bg-emerald-500"></span> YOLO Backend: ONLINE';
          banner.title = 'FastAPI + OpenCV Backend aktif di localhost:8000';
        } else {
          banner.className = 'pill warn cursor-pointer';
          banner.innerHTML = '<span class="live-dot !bg-amber-500"></span> YOLO Backend: STANDBY';
          banner.title = 'Jalankan server backend: python -m uvicorn yolo_studio.server:app --port 8000';
        }
      }
    }

    updateEnginePills() {
      const current = this.client ? this.client.getEngine() : 'teachable_machine';
      const btnTm = document.getElementById('btn-engine-tm');
      const btnYolo = document.getElementById('btn-engine-yolo');
      const secTm = document.getElementById('section-tm-config');
      const secYolo = document.getElementById('section-yolo-config');
      const pillEngine = document.getElementById('status-engine-pill');

      if (btnTm && btnYolo) {
        if (current === 'yolo') {
          btnYolo.classList.add('bg-blue-600', 'text-white', 'shadow');
          btnYolo.classList.remove('text-slate-600', 'dark:text-slate-300');
          btnTm.classList.remove('bg-blue-600', 'text-white', 'shadow');
          btnTm.classList.add('text-slate-600', 'dark:text-slate-300');
          if (secTm) secTm.classList.add('hidden');
          if (secYolo) secYolo.classList.remove('hidden');
          if (pillEngine) {
            pillEngine.innerText = 'ENGINE: YOLO';
            pillEngine.className = 'pill blue';
          }
        } else {
          btnTm.classList.add('bg-blue-600', 'text-white', 'shadow');
          btnTm.classList.remove('text-slate-600', 'dark:text-slate-300');
          btnYolo.classList.remove('bg-blue-600', 'text-white', 'shadow');
          btnYolo.classList.add('text-slate-600', 'dark:text-slate-300');
          if (secTm) secTm.classList.remove('hidden');
          if (secYolo) secYolo.classList.add('hidden');
          if (pillEngine) {
            pillEngine.innerText = 'ENGINE: TM';
            pillEngine.className = 'pill on';
          }
        }
      }
    }

    switchEngine(engineName) {
      if (!this.client) return;
      this.client.setEngine(engineName);
      this.updateEnginePills();
      const toastMsg = engineName === 'yolo'
        ? 'AI Engine dialihkan ke YOLO + OpenCV Studio'
        : 'AI Engine dialihkan ke Google Teachable Machine';
      if (typeof showToast === 'function') showToast(toastMsg);
    }

    switchTab(tabId) {
      this.activeTab = tabId;
      document.querySelectorAll('.yolo-tab-btn').forEach(b => {
        if (b.dataset.tab === tabId) {
          b.classList.add('border-b-2', 'border-blue-600', 'text-blue-600', 'font-black');
          b.classList.remove('text-slate-500');
        } else {
          b.classList.remove('border-b-2', 'border-blue-600', 'text-blue-600', 'font-black');
          b.classList.add('text-slate-500');
        }
      });

      document.querySelectorAll('.yolo-subpage').forEach(p => {
        p.classList.toggle('hidden', p.id !== `yolo-tab-${tabId}`);
      });

      if (tabId === 'projects') this.loadProjects();
      else if (tabId === 'dataset') this.loadDataset();
      else if (tabId === 'validation') this.runValidation();
      else if (tabId === 'jobs') this.loadJobs();
      else if (tabId === 'models') this.loadModels();
    }

    // =========================================================================
    // 1. PROJECTS
    // =========================================================================
    async loadProjects() {
      if (!this.client) return;
      const listContainer = document.getElementById('yolo-project-list');
      if (!listContainer) return;

      try {
        this.projects = await this.client.listProjects();
        if (!this.currentProject && this.projects.length) {
          this.currentProject = this.projects[0];
        }
        this.renderProjects();
        this.updateHeaderProjectBadge();
      } catch (err) {
        listContainer.innerHTML = `<div class="p-6 text-center text-xs t-muted">Backend belum terhubung. Pastikan server aktif di port 8000.<br><code class="text-[10px] mt-1 block">python -m uvicorn yolo_studio.server:app --port 8000</code></div>`;
      }
    }

    renderProjects() {
      const container = document.getElementById('yolo-project-list');
      if (!container) return;
      if (!this.projects.length) {
        container.innerHTML = `
          <div class="col-span-full p-8 text-center border-2 border-dashed rounded-2xl" style="border-color:var(--border)">
            <i class="fas fa-folder-open text-3xl t-muted mb-2"></i>
            <p class="font-bold text-xs t-main">Belum Ada Proyek YOLO</p>
            <p class="text-[11px] t-muted mt-1">Buat proyek baru untuk memulai pengumpulan gambar dan training model sortir.</p>
            <button onclick="window.yoloStudioUI.openCreateProjectModal()" class="btn-primary mt-4 px-4 py-2 text-xs">
              <i class="fas fa-plus mr-1.5"></i>Buat Proyek Pertama
            </button>
          </div>`;
        return;
      }

      container.innerHTML = this.projects.map(p => {
        const isSelected = this.currentProject && this.currentProject.id === p.id;
        const classesBadges = (p.classes || []).map(c => 
          `<span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">${c}</span>`
        ).join(' ');

        return `
          <div class="card p-4 transition-all cursor-pointer ${isSelected ? 'ring-2 ring-blue-500 shadow-md' : 'hover:border-slate-400'}" onclick="window.yoloStudioUI.selectProject('${p.id}')">
            <div class="flex items-start justify-between mb-2">
              <div>
                <h4 class="font-bold text-sm t-main flex items-center gap-1.5">
                  <i class="fas fa-diagram-project text-blue-500"></i>
                  <span>${p.name}</span>
                </h4>
                <p class="text-[11px] t-muted mt-0.5">${p.description || 'Proyek deteksi objek sortir'}</p>
              </div>
              <button onclick="event.stopPropagation(); window.yoloStudioUI.deleteProject('${p.id}')" class="icon-btn text-red-500 hover:bg-red-50" title="Hapus Proyek">
                <i class="fas fa-trash-can text-xs"></i>
              </button>
            </div>

            <div class="flex flex-wrap gap-1.5 my-2.5">
              ${classesBadges}
            </div>

            <div class="flex items-center justify-between pt-2 border-t text-[11px] t-muted" style="border-color:var(--border)">
              <span><i class="fas fa-images mr-1"></i>${p.image_count || 0} Gambar</span>
              <span><i class="fas fa-tag mr-1"></i>${p.annotated_count || 0} Dianotasi</span>
            </div>
          </div>
        `;
      }).join('');
    }

    updateHeaderProjectBadge() {
      const badge = document.getElementById('yolo-current-project-badge');
      if (badge && this.currentProject) {
        badge.innerText = `Proyek Aktif: ${this.currentProject.name} (${this.currentProject.classes?.join(', ')})`;
      }
    }

    selectProject(projectId) {
      const p = this.projects.find(x => x.id === projectId);
      if (p) {
        this.currentProject = p;
        this.renderProjects();
        this.updateHeaderProjectBadge();
        if (typeof showToast === 'function') showToast(`Proyek dipilih: ${p.name}`);
      }
    }

    openCreateProjectModal() {
      if (typeof openModal === 'function') openModal('yolo-create-project-modal');
    }

    async saveNewProject() {
      const name = (document.getElementById('yolo-new-proj-name')?.value || '').trim();
      const desc = (document.getElementById('yolo-new-proj-desc')?.value || '').trim();
      const classesRaw = (document.getElementById('yolo-new-proj-classes')?.value || '').trim();

      if (!name) {
        if (typeof showToast === 'function') showToast('Nama proyek tidak boleh kosong!');
        return;
      }

      const classes = classesRaw ? classesRaw.split(',').map(c => c.trim()).filter(Boolean) : ['merah', 'kuning', 'biru'];

      try {
        const created = await this.client.createProject(name, desc, classes);
        this.currentProject = created;
        if (typeof closeModal === 'function') closeModal('yolo-create-project-modal');
        if (typeof showToast === 'function') showToast(`Proyek "${created.name}" berhasil dibuat!`);
        await this.loadProjects();
        this.switchTab('dataset');
      } catch (err) {
        if (typeof showToast === 'function') showToast('Gagal membuat proyek: ' + err.message);
      }
    }

    async deleteProject(projectId) {
      if (!confirm('Apakah Anda yakin ingin menghapus proyek ini beserta seluruh dataset dan modelnya?')) return;
      try {
        await this.client.deleteProject(projectId);
        if (this.currentProject && this.currentProject.id === projectId) {
          this.currentProject = null;
        }
        if (typeof showToast === 'function') showToast('Proyek berhasil dihapus.');
        await this.loadProjects();
      } catch (err) {
        if (typeof showToast === 'function') showToast('Gagal menghapus proyek: ' + err.message);
      }
    }

    // =========================================================================
    // 2. DATASET & CAPTURE
    // =========================================================================
    async loadDataset() {
      if (!this.currentProject || !this.client) return;
      const gallery = document.getElementById('yolo-dataset-gallery');
      if (!gallery) return;

      try {
        this.images = await this.client.listImages(this.currentProject.id);
        const countSpan = document.getElementById('yolo-dataset-count');
        if (countSpan) countSpan.innerText = `${this.images.length} gambar total`;

        if (!this.images.length) {
          gallery.innerHTML = `
            <div class="col-span-full p-8 text-center border-2 border-dashed rounded-2xl" style="border-color:var(--border)">
              <i class="fas fa-camera text-3xl t-muted mb-2"></i>
              <p class="font-bold text-xs t-main">Dataset Masih Kosong</p>
              <p class="text-[11px] t-muted mt-1">Gunakan tombol "Upload Gambar", "Upload ZIP", atau "Capture Kamera" untuk mengumpulkan gambar objek.</p>
            </div>`;
          return;
        }

        gallery.innerHTML = this.images.map(img => {
          const imgUrl = this.client.getImageUrl(this.currentProject.id, img.filename);
          const hasAnn = img.is_annotated && img.annotation_count > 0;
          return `
            <div class="relative group rounded-xl overflow-hidden border bg-white dark:bg-slate-900 cursor-pointer shadow-sm hover:shadow-md transition-all" onclick="window.yoloStudioUI.openAnnotation('${img.id}')">
              <img src="${imgUrl}" alt="${img.filename}" class="w-full h-32 object-cover" loading="lazy">
              <div class="p-2 flex items-center justify-between text-[10px]">
                <span class="truncate font-mono">${img.filename}</span>
                <span class="px-1.5 py-0.5 rounded font-bold ${hasAnn ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-100 text-amber-800'}">
                  ${hasAnn ? `${img.annotation_count} box` : 'Belum Anotasi'}
                </span>
              </div>
              <button onclick="event.stopPropagation(); window.yoloStudioUI.deleteImage('${img.id}')" class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-red-600 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-[10px]" title="Hapus Gambar">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          `;
        }).join('');
      } catch (err) {
        gallery.innerHTML = `<div class="p-6 text-center text-xs text-red-500">Gagal memuat dataset: ${err.message}</div>`;
      }
    }

    async handleUploadFiles(files) {
      if (!this.currentProject || !files.length) return;
      if (typeof showToast === 'function') showToast(`Mengunggah ${files.length} file...`);

      let successCount = 0;
      for (const file of files) {
        try {
          if (file.name.toLowerCase().endsWith('.zip')) {
            await this.client.uploadZip(this.currentProject.id, file);
          } else {
            await this.client.uploadImage(this.currentProject.id, file);
          }
          successCount++;
        } catch (e) {
          console.warn('Upload error:', e);
        }
      }

      if (typeof showToast === 'function') showToast(`${successCount} file berhasil diunggah!`);
      await this.loadDataset();
      await this.loadProjects();
    }

    async deleteImage(imageId) {
      if (!this.currentProject) return;
      try {
        await this.client.deleteImage(this.currentProject.id, imageId);
        await this.loadDataset();
        await this.loadProjects();
      } catch (err) {
        if (typeof showToast === 'function') showToast('Gagal menghapus gambar: ' + err.message);
      }
    }

    // Camera Capture for Dataset
    async startCameraCapture() {
      const vid = document.getElementById('yolo-capture-video');
      const container = document.getElementById('yolo-capture-box');
      if (!vid || !container) return;

      container.classList.remove('hidden');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        vid.srcObject = stream;
        vid.play();
        this.captureStream = stream;
      } catch (err) {
        if (typeof showToast === 'function') showToast('Kamera tidak dapat diakses: ' + err.message);
      }
    }

    stopCameraCapture() {
      const vid = document.getElementById('yolo-capture-video');
      const container = document.getElementById('yolo-capture-box');
      if (this.captureStream) {
        this.captureStream.getTracks().forEach(t => t.stop());
        this.captureStream = null;
      }
      if (vid) vid.srcObject = null;
      if (container) container.classList.add('hidden');
    }

    async snapCamera() {
      const vid = document.getElementById('yolo-capture-video');
      if (!vid || !this.currentProject) return;

      const canvas = document.createElement('canvas');
      canvas.width = vid.videoWidth || 640;
      canvas.height = vid.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
      const b64 = canvas.toDataURL('image/jpeg', 0.9);

      try {
        await this.client.captureCamera(this.currentProject.id, b64);
        if (typeof showToast === 'function') showToast('Foto tersimpan ke dataset!');
        await this.loadDataset();
        await this.loadProjects();
      } catch (err) {
        if (typeof showToast === 'function') showToast('Gagal simpan foto: ' + err.message);
      }
    }

    // =========================================================================
    // 3. ANNOTATION STUDIO CANVAS
    // =========================================================================
    async openAnnotation(imageId) {
      if (!this.currentProject) return;
      this.selectedImage = this.images.find(img => img.id === imageId);
      if (!this.selectedImage) return;

      this.switchTab('annotation');
      const filenameSpan = document.getElementById('yolo-ann-filename');
      if (filenameSpan) filenameSpan.innerText = this.selectedImage.filename;

      // Load existing annotations
      try {
        const ann = await this.client.getAnnotation(this.currentProject.id, imageId);
        this.bboxes = ann.bboxes || [];
      } catch (e) {
        this.bboxes = [];
      }

      this.initAnnotationCanvas();
      this.renderClassSelector();
      this.renderBBoxList();
    }

    initAnnotationCanvas() {
      this.canvas = document.getElementById('yolo-annotation-canvas');
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');

      const imgUrl = this.client.getImageUrl(this.currentProject.id, this.selectedImage.filename);
      this.imgElement.crossOrigin = 'anonymous';
      this.imgElement.src = imgUrl;

      this.imgElement.onload = () => {
        // Size canvas proportionally
        const container = this.canvas.parentElement;
        const maxW = Math.min(800, container.clientWidth - 32);
        const scale = maxW / this.imgElement.naturalWidth;
        this.canvas.width = maxW;
        this.canvas.height = this.imgElement.naturalHeight * scale;
        this.drawAnnotationFrame();
      };

      this.bindCanvasEvents();
    }

    bindCanvasEvents() {
      if (this._canvasEventsBound) return;
      this._canvasEventsBound = true;

      this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
      this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
      this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    }

    getCanvasPos(e) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left),
        y: (e.clientY - rect.top)
      };
    }

    onMouseDown(e) {
      const pos = this.getCanvasPos(e);
      this.startX = pos.x;
      this.startY = pos.y;
      this.isDrawing = true;
    }

    onMouseMove(e) {
      if (!this.isDrawing) return;
      const pos = this.getCanvasPos(e);
      this.drawAnnotationFrame(pos);
    }

    onMouseUp(e) {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      const pos = this.getCanvasPos(e);

      const x = Math.min(this.startX, pos.x);
      const y = Math.min(this.startY, pos.y);
      const w = Math.abs(pos.x - this.startX);
      const h = Math.abs(pos.y - this.startY);

      // Minimum box size
      if (w > 10 && h > 10) {
        const classes = this.currentProject.classes || ['merah', 'kuning', 'biru'];
        const classIdx = this.selectedClassIdx;
        const className = classes[classIdx] || classes[0];

        // Normalize to [0, 1]
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        const x_center = (x + w / 2) / cw;
        const y_center = (y + h / 2) / ch;
        const norm_w = w / cw;
        const norm_h = h / ch;

        this.bboxes.push({
          class_id: classIdx,
          class_name: className,
          x_center: Math.max(0, Math.min(1, x_center)),
          y_center: Math.max(0, Math.min(1, y_center)),
          width: Math.max(0.01, Math.min(1, norm_w)),
          height: Math.max(0.01, Math.min(1, norm_h))
        });
        this.renderBBoxList();
      }
      this.drawAnnotationFrame();
    }

    drawAnnotationFrame(currentPos = null) {
      if (!this.ctx || !this.canvas) return;
      const cw = this.canvas.width;
      const ch = this.canvas.height;

      this.ctx.clearRect(0, 0, cw, ch);
      if (this.imgElement.complete && this.imgElement.naturalWidth > 0) {
        this.ctx.drawImage(this.imgElement, 0, 0, cw, ch);
      }

      // Draw saved bboxes
      this.bboxes.forEach((b, idx) => {
        const color = this.classColors[b.class_id] || this.classColors.default;
        const bx = (b.x_center - b.width / 2) * cw;
        const by = (b.y_center - b.height / 2) * ch;
        const bw = b.width * cw;
        const bh = b.height * ch;

        this.ctx.fillStyle = color.fill;
        this.ctx.fillRect(bx, by, bw, bh);
        this.ctx.strokeStyle = color.stroke;
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(bx, by, bw, bh);

        // Label banner
        this.ctx.fillStyle = color.stroke;
        this.ctx.fillRect(bx, by - 18, Math.min(bw, 75), 18);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = 'bold 11px Inter, sans-serif';
        this.ctx.fillText(`${b.class_name}`, bx + 4, by - 5);
      });

      // Draw active drawing box
      if (this.isDrawing && currentPos) {
        const x = Math.min(this.startX, currentPos.x);
        const y = Math.min(this.startY, currentPos.y);
        const w = Math.abs(currentPos.x - this.startX);
        const h = Math.abs(currentPos.y - this.startY);

        this.ctx.strokeStyle = '#3b82f6';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([4, 4]);
        this.ctx.strokeRect(x, y, w, h);
        this.ctx.setLineDash([]);
      }
    }

    renderClassSelector() {
      const container = document.getElementById('yolo-class-selector-group');
      if (!container || !this.currentProject) return;
      const classes = this.currentProject.classes || ['merah', 'kuning', 'biru'];

      container.innerHTML = classes.map((c, idx) => {
        const isSel = idx === this.selectedClassIdx;
        const color = this.classColors[idx] || this.classColors.default;
        return `
          <button type="button" onclick="window.yoloStudioUI.selectAnnotationClass(${idx})" class="px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 ${isSel ? 'ring-2 ring-blue-500 bg-white dark:bg-slate-800' : 'opacity-70'}">
            <span class="w-3 h-3 rounded-full" style="background:${color.stroke}"></span>
            <span>${c}</span>
          </button>
        `;
      }).join('');
    }

    selectAnnotationClass(idx) {
      this.selectedClassIdx = idx;
      this.renderClassSelector();
    }

    renderBBoxList() {
      const container = document.getElementById('yolo-bbox-list');
      if (!container) return;
      if (!this.bboxes.length) {
        container.innerHTML = '<p class="text-xs t-muted italic text-center py-4">Belum ada bounding box. Klik & drag pada gambar untuk menambahkan.</p>';
        return;
      }

      container.innerHTML = this.bboxes.map((b, idx) => {
        const color = this.classColors[b.class_id] || this.classColors.default;
        return `
          <div class="flex items-center justify-between p-2 rounded-lg border text-xs bg-white dark:bg-slate-900" style="border-color:var(--border)">
            <span class="flex items-center gap-2 font-bold">
              <span class="w-2.5 h-2.5 rounded-full" style="background:${color.stroke}"></span>
              <span>${b.class_name}</span>
            </span>
            <span class="font-mono text-[10px] t-muted">
              (${Math.round(b.width * 100)}% x ${Math.round(b.height * 100)}%)
            </span>
            <button onclick="window.yoloStudioUI.removeBBox(${idx})" class="text-red-500 hover:text-red-700 ml-2">
              <i class="fas fa-trash-can text-xs"></i>
            </button>
          </div>
        `;
      }).join('');
    }

    removeBBox(idx) {
      this.bboxes.splice(idx, 1);
      this.drawAnnotationFrame();
      this.renderBBoxList();
    }

    async saveCurrentAnnotations() {
      if (!this.currentProject || !this.selectedImage) return;
      try {
        await this.client.saveAnnotation(this.currentProject.id, this.selectedImage.id, this.bboxes);
        if (typeof showToast === 'function') showToast('Anotasi tersimpan!');
        await this.loadProjects();
      } catch (err) {
        if (typeof showToast === 'function') showToast('Gagal simpan anotasi: ' + err.message);
      }
    }

    navigateAnnotation(direction) {
      if (!this.images.length || !this.selectedImage) return;
      const idx = this.images.findIndex(img => img.id === this.selectedImage.id);
      const nextIdx = idx + direction;
      if (nextIdx >= 0 && nextIdx < this.images.length) {
        this.openAnnotation(this.images[nextIdx].id);
      }
    }

    // =========================================================================
    // 4. DATASET VALIDATION
    // =========================================================================
    async runValidation() {
      if (!this.currentProject || !this.client) return;
      const container = document.getElementById('yolo-validation-results');
      if (!container) return;

      try {
        const rep = await this.client.validateDataset(this.currentProject.id);
        const warnHtml = (rep.warnings || []).map(w => `
          <div class="flex items-start gap-2 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 text-xs border border-amber-200 dark:border-amber-800">
            <i class="fas fa-triangle-exclamation mt-0.5"></i>
            <span>${w}</span>
          </div>
        `).join('');

        const distHtml = Object.entries(rep.class_distribution || {}).map(([c, count]) => `
          <div class="p-3 rounded-xl border text-center bg-white dark:bg-slate-900" style="border-color:var(--border)">
            <p class="text-[10px] font-bold uppercase t-muted">${c}</p>
            <p class="text-lg font-black t-main mt-0.5">${count} sampel</p>
          </div>
        `).join('');

        container.innerHTML = `
          <div class="space-y-4">
            <div class="p-4 rounded-xl border flex items-center justify-between ${rep.is_ready ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-300' : 'bg-red-50 dark:bg-red-950/20 border-red-300'}">
              <div class="flex items-center gap-3">
                <i class="fas ${rep.is_ready ? 'fa-circle-check text-emerald-600' : 'fa-circle-xmark text-red-500'} text-2xl"></i>
                <div>
                  <h4 class="font-bold text-sm t-main">${rep.is_ready ? 'Dataset Siap untuk Training YOLO' : 'Dataset Belum Memenuhi Syarat Minimal'}</h4>
                  <p class="text-xs t-muted mt-0.5">${rep.total_images} gambar (${rep.annotated_images} dianotasi, ${rep.unannotated_images} kosong)</p>
                </div>
              </div>
              ${rep.is_ready ? `<button onclick="window.yoloStudioUI.switchTab('training')" class="btn-primary px-4 py-2 text-xs">Lanjut ke Training <i class="fas fa-arrow-right ml-1"></i></button>` : ''}
            </div>

            <div class="grid grid-cols-3 gap-3">
              ${distHtml}
            </div>

            <div class="p-4 rounded-xl border bg-white dark:bg-slate-900" style="border-color:var(--border)">
              <h5 class="font-bold text-xs t-main mb-2">Pembagian Split Dataset (70% Train / 20% Val / 10% Test)</h5>
              <div class="flex gap-2 text-xs">
                <span class="px-3 py-1.5 rounded-lg bg-blue-100 text-blue-800 font-bold">Train: ${rep.splits?.train_count || 0}</span>
                <span class="px-3 py-1.5 rounded-lg bg-indigo-100 text-indigo-800 font-bold">Val: ${rep.splits?.val_count || 0}</span>
                <span class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-800 font-bold">Test: ${rep.splits?.test_count || 0}</span>
              </div>
            </div>

            ${warnHtml ? `<div class="space-y-2"><h5 class="font-bold text-xs text-amber-600">Catatan & Peringatan:</h5>${warnHtml}</div>` : ''}
          </div>
        `;
      } catch (err) {
        container.innerHTML = `<p class="text-xs text-red-500">Gagal validasi: ${err.message}</p>`;
      }
    }

    // =========================================================================
    // 5. TRAINING JOBS & MONITORING
    // =========================================================================
    async startTraining() {
      if (!this.currentProject || !this.client) return;
      const epochs = parseInt(document.getElementById('yolo-train-epochs')?.value || '10');
      const batchSize = parseInt(document.getElementById('yolo-train-batch')?.value || '16');
      const imgsz = parseInt(document.getElementById('yolo-train-imgsz')?.value || '640');
      const device = document.getElementById('yolo-train-device')?.value || 'auto';

      try {
        const job = await this.client.startTraining(this.currentProject.id, {
          epochs,
          batch_size: batchSize,
          imgsz,
          device
        });

        this.activeJobId = job.job_id;
        if (typeof showToast === 'function') showToast(`Training job dimulai (${job.job_id})`);
        this.switchTab('jobs');
        this.pollJob(job.job_id);
      } catch (err) {
        if (typeof showToast === 'function') showToast('Gagal memulai training: ' + err.message);
      }
    }

    pollJob(jobId) {
      if (this.pollTimer) clearInterval(this.pollTimer);

      const fetchStatus = async () => {
        try {
          const job = await this.client.getJobStatus(jobId);
          this.renderActiveJob(job);
          if (['Completed', 'Failed', 'Cancelled'].includes(job.status)) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
            if (job.status === 'Completed') {
              if (typeof showToast === 'function') showToast('Training selesai dengan sukses!');
              await this.loadModels();
            }
          }
        } catch (e) {
          clearInterval(this.pollTimer);
        }
      };

      fetchStatus();
      this.pollTimer = setInterval(fetchStatus, 1200);
    }

    renderActiveJob(job) {
      const container = document.getElementById('yolo-active-job-view');
      if (!container) return;

      const progress = job.progress_pct || 0;
      const curMetrics = job.current_metrics || {};

      container.innerHTML = `
        <div class="card p-5 space-y-4">
          <div class="flex items-center justify-between pb-3 border-b" style="border-color:var(--border)">
            <div>
              <span class="text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase ${job.status === 'Completed' ? 'bg-emerald-100 text-emerald-800' : job.status === 'Training' ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-800'}">
                ${job.status}
              </span>
              <h4 class="font-bold text-sm t-main mt-1">Job: ${job.job_id}</h4>
              <p class="text-[11px] t-muted">Epoch ${job.current_epoch} / ${job.total_epochs} · Durasi: ${job.duration_sec}s</p>
            </div>
            ${['Training', 'Preparing Dataset', 'Queued'].includes(job.status) ? `
              <button onclick="window.yoloStudioUI.cancelActiveJob('${job.job_id}')" class="btn-warn px-3 py-1.5 text-xs">
                <i class="fas fa-stop mr-1"></i>Batalkan
              </button>` : ''}
          </div>

          <!-- Progress Bar -->
          <div>
            <div class="flex justify-between text-xs font-bold mb-1">
              <span>Progres Training</span>
              <span>${progress.toFixed(1)}%</span>
            </div>
            <div class="w-full bg-slate-200 dark:bg-slate-700 h-2.5 rounded-full overflow-hidden">
              <div class="bg-blue-600 h-full transition-all duration-300" style="width:${progress}%"></div>
            </div>
          </div>

          <!-- Live Metrics Grid -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div class="p-3 rounded-xl border bg-white dark:bg-slate-900" style="border-color:var(--border)">
              <p class="text-[10px] font-bold t-muted uppercase">Train Loss</p>
              <p class="text-base font-black text-rose-500 mt-0.5">${curMetrics.train_loss !== null ? curMetrics.train_loss : '—'}</p>
            </div>
            <div class="p-3 rounded-xl border bg-white dark:bg-slate-900" style="border-color:var(--border)">
              <p class="text-[10px] font-bold t-muted uppercase">Precision</p>
              <p class="text-base font-black text-emerald-600 mt-0.5">${curMetrics.precision !== null ? (curMetrics.precision * 100).toFixed(1) + '%' : '—'}</p>
            </div>
            <div class="p-3 rounded-xl border bg-white dark:bg-slate-900" style="border-color:var(--border)">
              <p class="text-[10px] font-bold t-muted uppercase">Recall</p>
              <p class="text-base font-black text-blue-600 mt-0.5">${curMetrics.recall !== null ? (curMetrics.recall * 100).toFixed(1) + '%' : '—'}</p>
            </div>
            <div class="p-3 rounded-xl border bg-white dark:bg-slate-900" style="border-color:var(--border)">
              <p class="text-[10px] font-bold t-muted uppercase">mAP50</p>
              <p class="text-base font-black text-indigo-600 mt-0.5">${curMetrics.mAP50 !== null ? (curMetrics.mAP50 * 100).toFixed(1) + '%' : '—'}</p>
            </div>
          </div>

          <!-- Hardware & System Stats -->
          <div class="p-3 rounded-xl border text-[11px] flex justify-between t-muted" style="border-color:var(--border);background:var(--surface-soft)">
            <span>CPU: ${job.system_stats?.cpu_percent || 0}% · RAM: ${job.system_stats?.ram_percent || 0}%</span>
            <span>Device: ${job.system_stats?.gpu_name || 'CPU'}</span>
          </div>
        </div>
      `;
    }

    async cancelActiveJob(jobId) {
      if (!confirm('Batalkan proses training?')) return;
      try {
        await this.client.cancelJob(jobId);
        if (typeof showToast === 'function') showToast('Training dibatalkan.');
      } catch (err) {
        if (typeof showToast === 'function') showToast('Gagal membatalkan: ' + err.message);
      }
    }

    async loadJobs() {
      if (!this.client) return;
      const list = document.getElementById('yolo-jobs-history');
      if (!list) return;

      try {
        const jobs = await this.client.listJobs(this.currentProject ? this.currentProject.id : null);
        if (!jobs.length) {
          list.innerHTML = '<p class="text-xs t-muted text-center py-4">Belum ada riwayat training job.</p>';
          return;
        }

        list.innerHTML = jobs.map(j => `
          <div class="p-3 rounded-xl border flex items-center justify-between text-xs bg-white dark:bg-slate-900 cursor-pointer hover:border-slate-400" onclick="window.yoloStudioUI.pollJob('${j.job_id}')" style="border-color:var(--border)">
            <div>
              <p class="font-bold t-main">${j.job_id}</p>
              <p class="text-[10px] t-muted">Status: ${j.status} · ${j.total_epochs} epoch · ${j.duration_sec}s</p>
            </div>
            <div class="text-right">
              <span class="font-bold text-indigo-600">mAP50: ${(j.current_metrics?.mAP50 ? (j.current_metrics.mAP50 * 100).toFixed(1) : 0)}%</span>
            </div>
          </div>
        `).join('');
      } catch (err) {
        list.innerHTML = `<p class="text-xs text-red-500">${err.message}</p>`;
      }
    }

    // =========================================================================
    // 6. MODEL REGISTRY
    // =========================================================================
    async loadModels() {
      if (!this.client) return;
      const list = document.getElementById('yolo-models-list');
      const selectInDash = document.getElementById('yolo-active-model-select');

      try {
        const models = await this.client.listModels();
        if (selectInDash) {
          selectInDash.innerHTML = models.map(m => `
            <option value="${m.id}" ${m.is_active ? 'selected' : ''}>${m.project_name} (v${m.version}) · mAP: ${(m.metrics.mAP50 * 100).toFixed(1)}%</option>
          `).join('');
        }

        if (!list) return;
        if (!models.length) {
          list.innerHTML = '<p class="text-xs t-muted text-center py-6 col-span-full">Belum ada model yang selesai dilatih.</p>';
          return;
        }

        list.innerHTML = models.map(m => `
          <div class="card p-4 space-y-3 ${m.is_active ? 'ring-2 ring-emerald-500' : ''}">
            <div class="flex items-start justify-between">
              <div>
                <span class="text-[9px] px-2 py-0.5 rounded font-bold uppercase ${m.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}">
                  ${m.is_active ? 'MODEL AKTIF ROBOT' : `Versi ${m.version}`}
                </span>
                <h4 class="font-bold text-sm t-main mt-1">${m.project_name}</h4>
                <p class="text-[10px] font-mono t-muted">${m.id}</p>
              </div>
              <button onclick="window.yoloStudioUI.deleteModel('${m.id}')" class="icon-btn text-red-500"><i class="fas fa-trash text-xs"></i></button>
            </div>

            <!-- Metrics -->
            <div class="grid grid-cols-3 gap-2 text-center text-xs">
              <div class="p-2 rounded-lg bg-slate-50 dark:bg-slate-800">
                <span class="text-[9px] t-muted block">mAP50</span>
                <span class="font-black text-indigo-600">${(m.metrics.mAP50 * 100).toFixed(1)}%</span>
              </div>
              <div class="p-2 rounded-lg bg-slate-50 dark:bg-slate-800">
                <span class="text-[9px] t-muted block">Precision</span>
                <span class="font-black text-emerald-600">${(m.metrics.precision * 100).toFixed(1)}%</span>
              </div>
              <div class="p-2 rounded-lg bg-slate-50 dark:bg-slate-800">
                <span class="text-[9px] t-muted block">Recall</span>
                <span class="font-black text-blue-600">${(m.metrics.recall * 100).toFixed(1)}%</span>
              </div>
            </div>

            <div class="flex items-center justify-between pt-2 border-t text-[11px]" style="border-color:var(--border)">
              <span class="t-muted">${(m.classes || []).join(', ')}</span>
              ${!m.is_active ? `
                <button onclick="window.yoloStudioUI.activateModel('${m.id}')" class="btn-primary px-3 py-1 text-xs">
                  <i class="fas fa-check mr-1"></i>Jadikan Model Aktif
                </button>` : '<span class="font-bold text-emerald-600 text-xs"><i class="fas fa-circle-check mr-1"></i>Aktif</span>'}
            </div>
          </div>
        `).join('');
      } catch (err) {
        if (list) list.innerHTML = `<p class="text-xs text-red-500 col-span-full">${err.message}</p>`;
      }
    }

    async activateModel(modelId) {
      try {
        await this.client.activateModel(modelId);
        if (typeof showToast === 'function') showToast('Model aktif robot diperbarui!');
        await this.loadModels();
      } catch (err) {
        if (typeof showToast === 'function') showToast('Gagal mengaktifkan model: ' + err.message);
      }
    }

    async deleteModel(modelId) {
      if (!confirm('Hapus model ini dari registry?')) return;
      try {
        await this.client.deleteModel(modelId);
        if (typeof showToast === 'function') showToast('Model dihapus.');
        await this.loadModels();
      } catch (err) {
        if (typeof showToast === 'function') showToast('Gagal menghapus model: ' + err.message);
      }
    }

    // =========================================================================
    // 7. MODEL TESTING
    // =========================================================================
    async testUploadedImage(file) {
      if (!file || !this.client) return;
      const reader = new FileReader();
      reader.onload = async (e) => {
        const b64 = e.target.result;
        const resBox = document.getElementById('yolo-test-results');
        const imgEl = document.getElementById('yolo-test-preview');
        const confThresh = parseFloat(document.getElementById('yolo-test-conf-slider')?.value || '0.25');

        if (imgEl) imgEl.src = b64;
        try {
          const res = await this.client.predictFrame(b64, {
            confThreshold: confThresh,
            drawBboxes: true
          });
          if (imgEl && res.annotated_image_base64) {
            imgEl.src = 'data:image/jpeg;base64,' + res.annotated_image_base64;
          }
          if (resBox) {
            const dets = res.detections || [];
            resBox.innerHTML = `
              <div class="p-3 rounded-xl border bg-white dark:bg-slate-900 space-y-1.5 text-xs">
                <div class="flex justify-between font-bold">
                  <span>Hasil Deteksi (${dets.length} objek)</span>
                  <span class="text-indigo-600 font-mono">${res.inference_time_ms} ms</span>
                </div>
                ${dets.map(d => `
                  <div class="flex justify-between p-1.5 rounded bg-slate-50 dark:bg-slate-800 text-[11px]">
                    <span class="font-bold text-blue-600">${d.class_name}</span>
                    <span>Confidence: <strong>${(d.confidence * 100).toFixed(1)}%</strong></span>
                  </div>
                `).join('')}
              </div>`;
          }
        } catch (err) {
          if (resBox) resBox.innerHTML = `<p class="text-xs text-red-500">${err.message}</p>`;
        }
      };
      reader.readAsDataURL(file);
    }
  }

  root.YoloStudioUI = YoloStudioUI;
  root.yoloStudioUI = new YoloStudioUI();

})(typeof window !== 'undefined' ? window : globalThis);
