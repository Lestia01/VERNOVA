/**
 * VERNOVA Smart Data Assistant
 * Rule-Based, Deterministic Data Assistant for R-LAB Smart Sorting Factory
 * 
 * ZERO AI/LLM DEPENDENCY - Pure JavaScript, deterministic aggregations,
 * Indonesian intent matching, and actual database analytics.
 * 
 * Timezone: Asia/Jakarta (WIB, UTC+7)
 */

(function (global) {
  'use strict';

  // =========================================================================
  // 1. HELPER & TIMEZONE UTILITIES (Asia/Jakarta / WIB = UTC+7)
  // =========================================================================
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

  function toWIBDate(dateOrEpoch) {
    const d = (dateOrEpoch instanceof Date) ? dateOrEpoch : new Date(dateOrEpoch);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getTime() + WIB_OFFSET_MS);
  }

  function formatWIB(dateOrEpoch, formatType) {
    if (!dateOrEpoch) return '-';
    const d = (dateOrEpoch instanceof Date) ? dateOrEpoch : new Date(dateOrEpoch);
    if (isNaN(d.getTime())) return '-';

    const wib = toWIBDate(d);
    const day = String(wib.getUTCDate()).padStart(2, '0');
    const monthNames = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const monthShort = [
      'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
      'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'
    ];
    const month = monthNames[wib.getUTCMonth()];
    const monthNum = String(wib.getUTCMonth() + 1).padStart(2, '0');
    const year = wib.getUTCFullYear();
    const hours = String(wib.getUTCHours()).padStart(2, '0');
    const minutes = String(wib.getUTCMinutes()).padStart(2, '0');
    const seconds = String(wib.getUTCSeconds()).padStart(2, '0');

    if (formatType === 'time') return `${hours}:${minutes}:${seconds} WIB`;
    if (formatType === 'date') return `${day} ${month} ${year}`;
    if (formatType === 'short') return `${day}/${monthNum}/${year} ${hours}:${minutes} WIB`;
    return `${day} ${month} ${year}, ${hours}:${minutes}:${seconds} WIB`;
  }

  function getDayBoundsWIB(targetDate) {
    const base = targetDate ? new Date(targetDate) : new Date();
    const wib = toWIBDate(base);
    const y = wib.getUTCFullYear();
    const m = wib.getUTCMonth();
    const d = wib.getUTCDate();

    // UTC milliseconds for 00:00:00 WIB
    const startUtcEpoch = Date.UTC(y, m, d, 0, 0, 0, 0) - WIB_OFFSET_MS;
    // UTC milliseconds for 23:59:59.999 WIB
    const endUtcEpoch = Date.UTC(y, m, d, 23, 59, 59, 999) - WIB_OFFSET_MS;

    return { startEpoch: startUtcEpoch, endEpoch: endUtcEpoch, label: `${d} ${['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'][m]} ${y}` };
  }

  // =========================================================================
  // 2. TEXT NORMALIZER & SLANG/TYPO EXPANDER
  // =========================================================================
  const SLANG_MAP = {
    'brp': 'berapa',
    'brapa': 'berapa',
    'berpa': 'berapa',
    'tdk': 'tidak',
    'tak': 'tidak',
    'gak': 'tidak',
    'ga': 'tidak',
    'g': 'tidak',
    'ngga': 'tidak',
    'nggak': 'tidak',
    'kmrn': 'kemarin',
    'kemaren': 'kemarin',
    'kmren': 'kemarin',
    'hr': 'hari',
    'hri': 'hari',
    'wrna': 'warna',
    'knp': 'kenapa',
    'ngapa': 'kenapa',
    'bnyk': 'banyak',
    'byk': 'banyak',
    'sdkt': 'sedikit',
    'dikit': 'sedikit',
    'eror': 'error',
    'erorr': 'error',
    'err': 'error',
    'rusak': 'gagal',
    'problem': 'masalah',
    'terbnyk': 'terbanyak',
    'terbyk': 'terbanyak',
    'trakhir': 'terakhir',
    'trkhir': 'terakhir',
    'skrg': 'sekarang',
    'skrang': 'sekarang',
    'kuningg': 'kuning',
    'kuningan': 'kuning',
    'merahh': 'merah',
    'blu': 'biru',
    'red': 'merah',
    'yellow': 'kuning',
    'blue': 'biru',
    'success': 'sukses',
    'fail': 'gagal',
    'failed': 'gagal',
    'device': 'perangkat',
    'alat': 'perangkat',
    'persen': 'persentase',
    'bandingin': 'bandingkan',
    'komparasi': 'bandingkan'
  };

  function normalizeText(input) {
    if (!input || typeof input !== 'string') return '';
    let text = input.toLowerCase().trim();

    // Remove punctuation except numbers, letters, spaces
    text = text.replace(/[^a-z0-9\s]/g, ' ');

    // Replace slang / typos word by word
    const tokens = text.split(/\s+/).filter(Boolean);
    const normalizedTokens = tokens.map(token => SLANG_MAP[token] || token);
    return normalizedTokens.join(' ');
  }

  // =========================================================================
  // 3. INTENT DEFINITIONS & PATTERN MATCHING
  // =========================================================================
  const INTENTS = [
    // Category E: Hardware & System Status
    {
      id: 'HARDWARE_ESP32',
      category: 'SYSTEM',
      patterns: [
        /\b(status esp32|koneksi esp32|ip esp32|rssi|sinyal wifi|wifi esp32|esp32 online|esp32 offline|kondisi esp32)\b/,
        /\b(apakah esp32 online|cek esp32|alamat ip|ram esp32|heap)\b/
      ]
    },
    {
      id: 'CAMERA_STATUS',
      category: 'SYSTEM',
      patterns: [
        /\b(status kamera|kamera aktif|webcam|ai vision|kamera nyala|kamera mati)\b/
      ]
    },
    {
      id: 'SYSTEM_STATUS',
      category: 'SYSTEM',
      patterns: [
        /\b(status sistem|kondisi sistem|kesehatan sistem|system health|status operasional|cek sistem|uptime)\b/
      ]
    },

    // Category F: Summary & Recommendations
    {
      id: 'ISSUE_HIGHLIGHTS',
      category: 'SUMMARY',
      patterns: [
        /\b(masalah|rekomendasi|saran|highlight|perlu diperhatikan|kendala|trouble|evaluasi|tindakan)\b/
      ]
    },
    {
      id: 'GENERAL_SUMMARY',
      category: 'SUMMARY',
      patterns: [
        /\b(ringkasan|rekap|rangkuman|summary|kondisi data|rekapitulasi|ikhtisar)\b/
      ]
    },

    // Conversation & Greetings
    {
      id: 'GREETING',
      category: 'CONVERSATION',
      patterns: [
        /\b(halo|hallo|hai|hello|hi|hei|selamat pagi|selamat siang|selamat sore|selamat malam)\b/
      ]
    },
    {
      id: 'IDENTITY',
      category: 'CONVERSATION',
      patterns: [
        /\b(kamu siapa|siapa kamu|kamu itu apa|kamu ai|nama kamu|namamu|who are you|what are you)\b/
      ]
    },
    {
      id: 'HELP',
      category: 'CONVERSATION',
      patterns: [
        /\b(bantuan|help|bisa apa|panduan|cara pakai|fungsi kamu)\b/
      ]
    },

    // Category C: Mode-specific Error Rate (must precede general ERROR_RATE)
    {
      id: 'MODE_ERROR_RATE',
      category: 'MODE',
      patterns: [
        /\b(error rate.*(servo|arm)|tingkat kegagalan.*(servo|arm)|persentase error.*(servo|arm)|error.*(servo|arm).*rate)\b/
      ]
    },

    // Category B: Error & Failure Analysis
    {
      id: 'ERROR_TODAY',
      category: 'ERROR',
      patterns: [
        /\b((error|kegagalan|gagal).*hari ini|berapa.*(error|gagal).*hari ini)\b/
      ]
    },
    {
      id: 'ERROR_LATEST',
      category: 'ERROR',
      patterns: [
        /\b(error terakhir|kapan error terakhir|kapan kegagalan terakhir|kegagalan terakhir|error paling akhir|error baru saja)\b/,
        /\b(kapan.*(terakhir|paling akhir).*(error|gagal))\b/
      ]
    },
    {
      id: 'ERROR_LIST',
      category: 'ERROR',
      patterns: [
        /\b(daftar error|list error|daftar kegagalan|riwayat error|rincian error|5 error|10 error|tampilkan error|log error)\b/
      ]
    },
    {
      id: 'ERROR_RATE',
      category: 'ERROR',
      patterns: [
        /\b(error rate|tingkat kegagalan|persentase error|persentase gagal|rasio error|rasio gagal)\b/
      ]
    },
    {
      id: 'ERROR_MOST_BY_MODE',
      category: 'ERROR',
      patterns: [
        /\b(mode apa paling sering error|mode sering error|mode.*banyak.*(error|gagal)|error terbanyak servo atau arm|mode mana.*banyak.*error)\b/
      ]
    },
    {
      id: 'ERROR_MODE_COMPARISON',
      category: 'ERROR',
      patterns: [
        /\b(bandingkan.*error.*(servo|arm)|perbandingan error mode|error servo vs arm|error arm vs servo)\b/
      ]
    },
    {
      id: 'ERROR_BY_TYPE',
      category: 'ERROR',
      patterns: [
        /\b(jenis error|kode error|error code|tipe error|penyebab error|kategori error)\b/
      ]
    },
    {
      id: 'ERROR_BY_COLOR',
      category: 'ERROR',
      patterns: [
        /\b(warna apa paling sering gagal|warna.*banyak.*(gagal|error)|warna.*paling sering error|kegagalan per warna)\b/
      ]
    },
    {
      id: 'ERROR_TREND',
      category: 'ERROR',
      patterns: [
        /\b(tren error|trend error|apakah error meningkat|apakah error menurun|pola error|kenaikan error)\b/
      ]
    },

    // Category C: Operational Mode & Work Patterns
    {
      id: 'MOST_USED_MODE',
      category: 'MODE',
      patterns: [
        /\b(mode apa paling sering|mode.*sering digunakan|mode paling banyak|mode terpopuler|mode dominan)\b/
      ]
    },
    {
      id: 'MODE_USAGE_COUNT',
      category: 'MODE',
      patterns: [
        /\b(berapa kali mode|penggunaan mode|frekuensi mode|statistik mode|jumlah mode|servo vs arm|arm vs servo)\b/
      ]
    },

    // Category D: Time & Trend Analysis
    {
      id: 'BUSIEST_HOURS',
      category: 'TIME',
      patterns: [
        /\b(jam berapa.*(sibuk|banyak|puncak|ramai)|jam tersibuk|puncak aktivitas|jam paling sibuk)\b/
      ]
    },
    {
      id: 'COMPARE_DAYS',
      category: 'TIME',
      patterns: [
        /\b(bandingkan.*hari ini.*kemarin|perbandingan.*hari ini.*kemarin|hari ini vs kemarin|kemarin vs hari ini)\b/
      ]
    },
    {
      id: 'COMPARE_WEEKS',
      category: 'TIME',
      patterns: [
        /\b(bandingkan.*minggu ini.*minggu lalu|perbandingan.*minggu|minggu ini vs minggu lalu)\b/
      ]
    },
    {
      id: 'ACTIVITY_RECENT',
      category: 'TIME',
      patterns: [
        /\b(aktivitas.*(terakhir|menit|jam)|sortir.*(terakhir|menit|jam|baru saja)|baru saja|sortir terbaru)\b/
      ]
    },
    {
      id: 'ACTIVITY_YESTERDAY',
      category: 'TIME',
      patterns: [
        /\b(aktivitas kemarin|sortir kemarin|data kemarin|berapa.*kemarin)\b/
      ]
    },
    {
      id: 'ACTIVITY_TODAY',
      category: 'TIME',
      patterns: [
        /\b(aktivitas hari ini|sortir hari ini|data hari ini|berapa.*hari ini)\b/
      ]
    },
    {
      id: 'ACTIVITY_PERIOD_WEEK',
      category: 'TIME',
      patterns: [
        /\b(7 hari|seminggu|minggu ini|pekan ini)\b/
      ]
    },
    {
      id: 'ACTIVITY_PERIOD_MONTH',
      category: 'TIME',
      patterns: [
        /\b(30 hari|sebulan|bulan ini)\b/
      ]
    },

    // Category A: Sorting Stats
    {
      id: 'MOST_SORTED_COLOR',
      category: 'SORTING',
      patterns: [
        /\b(warna.*(paling banyak|terbanyak|dominan|tertinggi|paling sering disortir)|paling banyak.*warna)\b/
      ]
    },
    {
      id: 'LEAST_SORTED_COLOR',
      category: 'SORTING',
      patterns: [
        /\b(warna.*(paling sedikit|tersedikit|terendah|paling jarang disortir)|paling sedikit.*warna)\b/
      ]
    },
    {
      id: 'SORTING_BY_COLOR',
      category: 'SORTING',
      patterns: [
        /\b(berapa.*warna.*(kuning|biru|merah)|jumlah.*(kuning|biru|merah)|sortir.*(kuning|biru|merah)|warna (kuning|biru|merah))\b/
      ]
    },
    {
      id: 'TOTAL_SORTING',
      category: 'SORTING',
      patterns: [
        /\b(total.*(sortir|produk|barang)|berapa.*(sudah|telah).*disortir|jumlah.*(semua|total)|semua produk)\b/
      ]
    }
  ];

  function detectIntent(normalizedQuery) {
    for (const intent of INTENTS) {
      for (const pattern of intent.patterns) {
        if (pattern.test(normalizedQuery)) {
          return intent.id;
        }
      }
    }

    // Secondary fallback keywords
    if (normalizedQuery.includes('error') || normalizedQuery.includes('gagal')) {
      if (normalizedQuery.includes('rate') || normalizedQuery.includes('persentase')) return 'ERROR_RATE';
      if (normalizedQuery.includes('mode') || normalizedQuery.includes('servo') || normalizedQuery.includes('arm')) return 'ERROR_MOST_BY_MODE';
      if (normalizedQuery.includes('terakhir') || normalizedQuery.includes('kapan')) return 'ERROR_LATEST';
      if (normalizedQuery.includes('hari ini')) return 'ERROR_TODAY';
      return 'ERROR_LIST';
    }

    if (normalizedQuery.includes('kuning') || normalizedQuery.includes('biru') || normalizedQuery.includes('merah')) {
      return 'SORTING_BY_COLOR';
    }

    if (normalizedQuery.includes('total') || normalizedQuery.includes('semua') || normalizedQuery.includes('jumlah')) {
      return 'TOTAL_SORTING';
    }

    if (normalizedQuery.includes('esp32') || normalizedQuery.includes('wifi') || normalizedQuery.includes('ip')) {
      return 'HARDWARE_ESP32';
    }

    if (normalizedQuery.includes('kamera') || normalizedQuery.includes('webcam')) {
      return 'CAMERA_STATUS';
    }

    if (normalizedQuery.includes('sistem') || normalizedQuery.includes('status')) {
      return 'SYSTEM_STATUS';
    }

    if (normalizedQuery.includes('kemarin')) {
      return 'ACTIVITY_YESTERDAY';
    }

    if (normalizedQuery.includes('hari ini')) {
      return 'ACTIVITY_TODAY';
    }

    return 'UNKNOWN';
  }

  // =========================================================================
  // 4. DATA NORMALIZER & RECORD AGGREGATOR
  // =========================================================================
  function parseTimestamp(raw) {
    if (!raw) return 0;
    if (typeof raw === 'number') return raw;
    const parsed = Date.parse(raw);
    return isNaN(parsed) ? 0 : parsed;
  }

  function normalizeRecord(item, defaultStatus, defaultColor) {
    if (!item || typeof item !== 'object') return null;

    const ts = parseTimestamp(item.timestamp || item.waktu || item.createdAt || item.date);
    const color = (item.detectedColor || item.warna || item.color || defaultColor || 'tidak diketahui').toLowerCase().trim();
    const mode = (item.mode || item.operatingMode || 'Servo');
    const status = (item.status || item.sortResult || item.executionStatus || defaultStatus || 'Berhasil');
    const isError = Boolean(
      item.sortResult === 'error' ||
      item.executionStatus === 'failed' ||
      item.commandStatus === 'watchdog_timeout' ||
      item.commandStatus === 'force_timeout' ||
      String(status).toLowerCase().includes('gagal') ||
      String(status).toLowerCase().includes('error') ||
      String(status).toLowerCase().includes('timeout') ||
      defaultStatus === 'Gagal'
    );

    const errorCode = item.errorCode || item.error || (isError ? (item.commandStatus || 'ERR_GENERIC') : null);
    const durationMs = Number(item.durationMs || item.durasi || 0);
    const runId = item.runId || item.commandId || item.id || null;
    const esp32DeviceId = item.esp32DeviceId || item.deviceId || 'ESP32_VERNOVA_DEFAULT';

    return {
      timestamp: ts,
      color,
      mode: mode.charAt(0).toUpperCase() + mode.slice(1).toLowerCase(),
      status: isError ? 'Gagal' : 'Berhasil',
      isError,
      errorCode,
      durationMs,
      runId,
      esp32DeviceId
    };
  }

  /**
   * Mengumpulkan semua log dari struktur Firebase atau memori lokal:
   * Firebase tree: smart_factory/sorting_line/{kuning, biru, merah, gagal}
   */
  function extractAllRecords(dataContext) {
    const records = [];
    if (!dataContext) return records;

    // Case 1: Full Firebase snapshot object
    const sf = dataContext.smart_factory || dataContext;
    const line = sf.sorting_line || sf;

    ['kuning', 'biru', 'merah'].forEach(col => {
      const group = line[col];
      if (group && typeof group === 'object') {
        Object.keys(group).forEach(key => {
          const norm = normalizeRecord(group[key], 'Berhasil', col);
          if (norm && norm.timestamp > 0) records.push(norm);
        });
      }
    });

    const errorGroup = line.gagal || line.errors || line.error;
    if (errorGroup && typeof errorGroup === 'object') {
      Object.keys(errorGroup).forEach(key => {
        const norm = normalizeRecord(errorGroup[key], 'Gagal', 'tidak diketahui');
        if (norm && norm.timestamp > 0) records.push(norm);
      });
    }

    // Case 2: Array of excelLogs / history logs
    if (Array.isArray(dataContext.excelLogs)) {
      dataContext.excelLogs.forEach(item => {
        const norm = normalizeRecord(item);
        if (norm && norm.timestamp > 0) records.push(norm);
      });
    } else if (Array.isArray(dataContext.history)) {
      dataContext.history.forEach(item => {
        const norm = normalizeRecord(item);
        if (norm && norm.timestamp > 0) records.push(norm);
      });
    } else if (Array.isArray(dataContext)) {
      dataContext.forEach(item => {
        const norm = normalizeRecord(item);
        if (norm && norm.timestamp > 0) records.push(norm);
      });
    }

    // De-duplicate by runId or timestamp if combined
    const seen = new Set();
    const uniqueRecords = [];
    for (const r of records) {
      const key = r.runId ? `id_${r.runId}` : `ts_${r.timestamp}_${r.color}_${r.isError}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueRecords.push(r);
      }
    }

    // Sort ascending by timestamp
    uniqueRecords.sort((a, b) => a.timestamp - b.timestamp);
    return uniqueRecords;
  }

  // =========================================================================
  // 5. STATISTICAL & AGGREGATION CALCULATIONS
  // =========================================================================
  function computeStats(records, filterFn) {
    const list = filterFn ? records.filter(filterFn) : records;
    const total = list.length;
    let successCount = 0;
    let errorCount = 0;

    const colors = { kuning: 0, biru: 0, merah: 0, lainnya: 0 };
    const modes = { Servo: 0, Arm: 0, Lainnya: 0 };
    const modeErrors = { Servo: 0, Arm: 0, Lainnya: 0 };
    const errorCodes = {};
    const hourlyDistribution = Array(24).fill(0);

    let latestRecord = null;
    let latestErrorRecord = null;

    list.forEach(r => {
      if (r.isError) {
        errorCount++;
        const m = (r.mode === 'Servo' || r.mode === 'Arm') ? r.mode : 'Lainnya';
        modeErrors[m] = (modeErrors[m] || 0) + 1;
        const code = r.errorCode || 'UNKNOWN_ERROR';
        errorCodes[code] = (errorCodes[code] || 0) + 1;
        if (!latestErrorRecord || r.timestamp > latestErrorRecord.timestamp) {
          latestErrorRecord = r;
        }
      } else {
        successCount++;
        const c = ['kuning', 'biru', 'merah'].includes(r.color) ? r.color : 'lainnya';
        colors[c] = (colors[c] || 0) + 1;
      }

      const m = (r.mode === 'Servo' || r.mode === 'Arm') ? r.mode : 'Lainnya';
      modes[m] = (modes[m] || 0) + 1;

      // Hourly bucket (WIB)
      const wib = toWIBDate(r.timestamp);
      if (wib) {
        const h = wib.getUTCHours();
        hourlyDistribution[h]++;
      }

      if (!latestRecord || r.timestamp > latestRecord.timestamp) {
        latestRecord = r;
      }
    });

    const errorRate = total > 0 ? (errorCount / total) * 100 : 0;
    const servoTotal = modes.Servo || 0;
    const armTotal = modes.Arm || 0;
    const servoErrorRate = servoTotal > 0 ? ((modeErrors.Servo || 0) / servoTotal) * 100 : 0;
    const armErrorRate = armTotal > 0 ? ((modeErrors.Arm || 0) / armTotal) * 100 : 0;

    // Highest & lowest sorted colors
    const colorEntries = [
      { color: 'Kuning', count: colors.kuning },
      { color: 'Biru', count: colors.biru },
      { color: 'Merah', count: colors.merah }
    ];
    colorEntries.sort((a, b) => b.count - a.count);
    const mostColor = colorEntries[0];
    const leastColor = colorEntries[colorEntries.length - 1];

    // Busiest hour
    let maxHourCount = -1;
    let busiestHour = 0;
    hourlyDistribution.forEach((cnt, hr) => {
      if (cnt > maxHourCount) {
        maxHourCount = cnt;
        busiestHour = hr;
      }
    });

    return {
      total,
      successCount,
      errorCount,
      errorRate: Math.round(errorRate * 10) / 10,
      colors,
      mostColor,
      leastColor,
      modes,
      modeErrors,
      servoErrorRate: Math.round(servoErrorRate * 10) / 10,
      armErrorRate: Math.round(armErrorRate * 10) / 10,
      errorCodes,
      hourlyDistribution,
      busiestHour,
      busiestHourCount: maxHourCount > 0 ? maxHourCount : 0,
      latestRecord,
      latestErrorRecord
    };
  }

  // =========================================================================
  // 6. RESPONSE FORMATTERS & INTENT DISPATCHER
  // =========================================================================
  class SmartDataAssistant {
    constructor(options = {}) {
      this.options = options;
      this.name = 'VERNOVA Smart Data Assistant';
      this.version = '1.0.0-zero-llm';
    }

    /**
     * Memproses query teks pengguna terhadap context data aktual.
     * @param {string} rawQuery
     * @param {object} contextData - Memuat { records, dbData, sortingData, excelLogs, esp32Status, cameraStatus }
     */
    processQuery(rawQuery, contextData = {}) {
      const normalized = normalizeText(rawQuery);
      if (!normalized) {
        return {
          intent: 'EMPTY',
          answer: 'Silakan masukkan pertanyaan terkait data sortir produk, analisis error, status perangkat, atau kinerja mode robot VERNOVA.',
          basis: 'Tidak ada query yang diproses.',
          suggestions: ['Total sortir produk', 'Status ESP32', 'Kapan error terakhir?', 'Ringkasan data hari ini']
        };
      }

      const intent = detectIntent(normalized);
      const records = extractAllRecords(contextData);
      let esp32 = contextData.esp32Status;
      if (!esp32 && typeof global !== 'undefined' && global.esp32Client) {
        try {
          esp32 = typeof global.esp32Client.getStatus === 'function' ? global.esp32Client.getStatus() : global.esp32Client;
        } catch (e) { esp32 = null; }
      }
      esp32 = esp32 || {};
      const camera = contextData.cameraStatus || { active: true, fps: 30 };

      // Dispatch ke handler intent
      switch (intent) {
        case 'GREETING':
          return this.handleGreeting();
        case 'IDENTITY':
          return this.handleIdentity();
        case 'HELP':
          return this.handleHelp();
        case 'TOTAL_SORTING':
          return this.handleTotalSorting(records, normalized);
        case 'SORTING_BY_COLOR':
          return this.handleSortingByColor(records, normalized);
        case 'MOST_SORTED_COLOR':
          return this.handleMostSortedColor(records);
        case 'LEAST_SORTED_COLOR':
          return this.handleLeastSortedColor(records);
        case 'ERROR_LATEST':
          return this.handleLatestError(records);
        case 'ERROR_LIST':
          return this.handleErrorList(records);
        case 'ERROR_TODAY':
          return this.handleErrorToday(records);
        case 'ERROR_RATE':
          return this.handleErrorRate(records);
        case 'ERROR_MOST_BY_MODE':
        case 'ERROR_MODE_COMPARISON':
          return this.handleErrorByMode(records, intent);
        case 'ERROR_BY_TYPE':
          return this.handleErrorByType(records);
        case 'ERROR_BY_COLOR':
          return this.handleErrorByColor(records);
        case 'ERROR_TREND':
          return this.handleErrorTrend(records);
        case 'MOST_USED_MODE':
        case 'MODE_USAGE_COUNT':
          return this.handleModeUsage(records);
        case 'MODE_ERROR_RATE':
          return this.handleModeErrorRate(records, normalized);
        case 'ACTIVITY_TODAY':
          return this.handleActivityToday(records);
        case 'ACTIVITY_YESTERDAY':
          return this.handleActivityYesterday(records);
        case 'ACTIVITY_RECENT':
          return this.handleActivityRecent(records);
        case 'BUSIEST_HOURS':
          return this.handleBusiestHours(records);
        case 'COMPARE_DAYS':
          return this.handleCompareDays(records);
        case 'COMPARE_WEEKS':
          return this.handleCompareWeeks(records);
        case 'ACTIVITY_PERIOD_WEEK':
          return this.handlePeriodWeek(records);
        case 'ACTIVITY_PERIOD_MONTH':
          return this.handlePeriodMonth(records);
        case 'HARDWARE_ESP32':
          return this.handleHardwareEsp32(esp32);
        case 'CAMERA_STATUS':
          return this.handleCameraStatus(camera);
        case 'SYSTEM_STATUS':
          return this.handleSystemStatus(records, esp32, camera);
        case 'GENERAL_SUMMARY':
          return this.handleGeneralSummary(records, esp32);
        case 'ISSUE_HIGHLIGHTS':
          return this.handleIssueHighlights(records, esp32);
        default:
          return this.handleFallback(rawQuery);
      }
    }

    // --- Intent Handlers ---

    handleGreeting() {
      return {
        intent: 'GREETING',
        answer: 'Halo! Saya **VERNOVA Smart Data Assistant**. Saya siap menyajikan data riwayat sortir produk, analisis kegagalan, performa mode Servo/Arm, dan telemetri ESP32 secara instan tanpa model AI eksternal. Ada yang bisa saya bantu analisa?',
        basis: 'Sistem operasional data assistant siap melayani.',
        suggestions: ['Total sortir produk', 'Warna apa terbanyak?', 'Kapan error terakhir?', 'Status ESP32']
      };
    }

    handleIdentity() {
      return {
        intent: 'IDENTITY',
        answer: 'Saya adalah **VERNOVA Smart Data Assistant**, asisten data cerdas berbasis aturan (*rule-based data engine*) yang mengolah riwayat log aktual lini penyortiran pabrik pintar R-LAB secara deterministik.',
        basis: 'Arsitektur Zero-LLM & Data-Grounded.',
        suggestions: ['Ringkasan data saat ini', 'Total sortir produk', 'Status sistem']
      };
    }

    handleHelp() {
      return {
        intent: 'HELP',
        answer: [
          '📌 **Analitik Data yang Dapat Anda Tanyakan:**',
          '• **Statistik Sortir:** "Berapa total produk?", "Warna apa terbanyak?", "Jumlah sortir warna kuning"',
          '• **Analisis Error:** "Kapan error terakhir?", "Berapa error rate sistem?", "Mode apa sering error?"',
          '• **Waktu & Tren:** "Aktivitas hari ini", "Bandingkan hari ini vs kemarin", "Jam paling sibuk"',
          '• **Status Perangkat:** "Status ESP32", "Status kamera", "Status sistem saat ini"',
          '• **Ringkasan:** "Beri ringkasan data", "Rekomendasi operator"'
        ].join('\n'),
        basis: 'Panduan topik kueri asisten data.',
        suggestions: ['Total sortir produk', 'Error hari ini', 'Status ESP32', 'Ringkasan data']
      };
    }

    handleTotalSorting(records, query) {
      if (records.length === 0) {
        return {
          intent: 'TOTAL_SORTING',
          answer: 'Belum ada data penyortiran yang tercatat pada basis data VERNOVA. Silakan mulai sistem sortir fisik atau aktifkan mode simulasi.',
          basis: 'Basis Perhitungan: 0 data pada Firebase Realtime Database.',
          suggestions: ['Status ESP32', 'Jalankan simulasi sortir', 'Panduan sistem']
        };
      }

      // Check if time-scoped
      const todayBounds = getDayBoundsWIB();
      const isTodayQuery = query.includes('hari ini');
      const isYesterdayQuery = query.includes('kemarin');

      let targetRecords = records;
      let scopeLabel = 'seluruh riwayat tercatat';

      if (isTodayQuery) {
        targetRecords = records.filter(r => r.timestamp >= todayBounds.startEpoch && r.timestamp <= todayBounds.endEpoch);
        scopeLabel = `hari ini (${todayBounds.label} WIB)`;
      } else if (isYesterdayQuery) {
        const yestBounds = getDayBoundsWIB(new Date(Date.now() - 24 * 60 * 60 * 1000));
        targetRecords = records.filter(r => r.timestamp >= yestBounds.startEpoch && r.timestamp <= yestBounds.endEpoch);
        scopeLabel = `kemarin (${yestBounds.label} WIB)`;
      }

      const stats = computeStats(targetRecords);
      const answer = [
        `📊 **Total Sortir Produk (${scopeLabel})**:`,
        `• **Total Percobaan:** ${stats.total} item`,
        `• **Berhasil Disortir:** ${stats.successCount} item (${stats.total > 0 ? Math.round((stats.successCount / stats.total) * 100) : 0}%)`,
        `• **Gagal / Timeout:** ${stats.errorCount} item (${stats.errorRate}%)`,
        ``,
        `🎨 **Rincian Produk Berhasil per Warna:**`,
        `• Kuning: **${stats.colors.kuning}** item`,
        `• Biru: **${stats.colors.biru}** item`,
        `• Merah: **${stats.colors.merah}** item`,
        ``,
        `🤖 **Penggunaan Mode:** Servo (${stats.modes.Servo}) | Arm (${stats.modes.Arm})`
      ].join('\n');

      return {
        intent: 'TOTAL_SORTING',
        answer,
        basis: `Basis Perhitungan: Dihitung dari ${targetRecords.length} total rekaman pada rentang ${scopeLabel}.`,
        suggestions: ['Warna apa terbanyak?', 'Kapan error terakhir?', 'Error rate sistem', 'Status ESP32']
      };
    }

    handleSortingByColor(records, query) {
      if (records.length === 0) {
        return {
          intent: 'SORTING_BY_COLOR',
          answer: 'Belum ada data warna yang tercatat pada sistem sortir.',
          basis: 'Basis Perhitungan: 0 data pada sistem.',
          suggestions: ['Total sortir produk', 'Status sistem']
        };
      }

      const stats = computeStats(records);
      let targetColor = null;
      if (query.includes('kuning')) targetColor = 'kuning';
      else if (query.includes('biru')) targetColor = 'biru';
      else if (query.includes('merah')) targetColor = 'merah';

      if (targetColor) {
        const count = stats.colors[targetColor] || 0;
        const pct = stats.successCount > 0 ? Math.round((count / stats.successCount) * 100) : 0;
        const answer = [
          `🎨 **Data Sortir Warna ${targetColor.toUpperCase()}:**`,
          `• Total berhasil: **${count}** item`,
          `• Porsi dari total berhasil: **${pct}%** (${count} dari ${stats.successCount} item)`,
          `• Posisi di antara warna lain: urutan ke-${targetColor === stats.mostColor.color.toLowerCase() ? '1 (terbanyak)' : (targetColor === stats.leastColor.color.toLowerCase() ? '3 (tersedikit)' : '2')}`
        ].join('\n');

        return {
          intent: 'SORTING_BY_COLOR',
          answer,
          basis: `Basis Perhitungan: Dihitung dari ${stats.successCount} data produk sukses pada basis data.`,
          suggestions: ['Warna apa terbanyak?', 'Total semua warna', 'Error rate sistem']
        };
      }

      // If no specific color was singled out, show summary of all 3
      const answer = [
        `🎨 **Distribusi Seluruh Warna Produk:**`,
        `• 🟡 Kuning: **${stats.colors.kuning}** item (${stats.successCount > 0 ? Math.round((stats.colors.kuning / stats.successCount) * 100) : 0}%)`,
        `• 🔵 Biru: **${stats.colors.biru}** item (${stats.successCount > 0 ? Math.round((stats.colors.biru / stats.successCount) * 100) : 0}%)`,
        `• 🔴 Merah: **${stats.colors.merah}** item (${stats.successCount > 0 ? Math.round((stats.colors.merah / stats.successCount) * 100) : 0}%)`,
        `• Total produk berhasil: **${stats.successCount}** item`
      ].join('\n');

      return {
        intent: 'SORTING_BY_COLOR',
        answer,
        basis: `Basis Perhitungan: Dihitung dari ${stats.successCount} data sortir sukses.`,
        suggestions: ['Warna apa terbanyak?', 'Berapa total sortir?', 'Mode paling sering']
      };
    }

    handleMostSortedColor(records) {
      if (records.length === 0) {
        return {
          intent: 'MOST_SORTED_COLOR',
          answer: 'Belum ada data sortir untuk menentukan warna terbanyak.',
          basis: 'Basis Perhitungan: 0 data pada sistem.',
          suggestions: ['Status ESP32', 'Total sortir produk']
        };
      }

      const stats = computeStats(records);
      const top = stats.mostColor;
      const pct = stats.successCount > 0 ? Math.round((top.count / stats.successCount) * 100) : 0;

      const answer = [
        `🏆 **Warna Paling Banyak Disortir:**`,
        `• Warna: **${top.color}**`,
        `• Jumlah: **${top.count}** item`,
        `• Persentase: **${pct}%** dari total ${stats.successCount} item sukses`,
        ``,
        `Perbandingan dengan warna lain:`,
        `• Kuning: ${stats.colors.kuning} item`,
        `• Biru: ${stats.colors.biru} item`,
        `• Merah: ${stats.colors.merah} item`
      ].join('\n');

      return {
        intent: 'MOST_SORTED_COLOR',
        answer,
        basis: `Basis Perhitungan: Dihitung dari ${stats.successCount} item sukses pada rentang seluruh log.`,
        suggestions: ['Warna apa paling sedikit?', 'Total sortir produk', 'Error rate']
      };
    }

    handleLeastSortedColor(records) {
      if (records.length === 0) {
        return {
          intent: 'LEAST_SORTED_COLOR',
          answer: 'Belum ada data sortir untuk menentukan warna tersedikit.',
          basis: 'Basis Perhitungan: 0 data pada sistem.',
          suggestions: ['Status ESP32', 'Total sortir produk']
        };
      }

      const stats = computeStats(records);
      const bot = stats.leastColor;
      const pct = stats.successCount > 0 ? Math.round((bot.count / stats.successCount) * 100) : 0;

      const answer = [
        `📉 **Warna Paling Sedikit Disortir:**`,
        `• Warna: **${bot.color}**`,
        `• Jumlah: **${bot.count}** item`,
        `• Persentase: **${pct}%** dari total ${stats.successCount} item sukses`,
        ``,
        `Perbandingan dengan warna lain:`,
        `• Kuning: ${stats.colors.kuning} item`,
        `• Biru: ${stats.colors.biru} item`,
        `• Merah: ${stats.colors.merah} item`
      ].join('\n');

      return {
        intent: 'LEAST_SORTED_COLOR',
        answer,
        basis: `Basis Perhitungan: Dihitung dari ${stats.successCount} item sukses pada basis data.`,
        suggestions: ['Warna apa paling banyak?', 'Total sortir produk', 'Error rate']
      };
    }

    handleLatestError(records) {
      const errorRecords = records.filter(r => r.isError);
      if (errorRecords.length === 0) {
        return {
          intent: 'ERROR_LATEST',
          answer: '✅ **Kabar Baik!** Tidak ada riwayat error atau kegagalan yang tercatat pada sistem sortir VERNOVA.',
          basis: 'Basis Perhitungan: 0 error dari total seluruh rekaman.',
          suggestions: ['Total sortir produk', 'Status sistem', 'Error rate sistem']
        };
      }

      const latest = errorRecords[errorRecords.length - 1];
      const answer = [
        `⚠️ **Error Terakhir yang Tercatat:**`,
        `• **Waktu:** ${formatWIB(latest.timestamp)}`,
        `• **Kode Error:** \`${latest.errorCode || 'ERR_UNKNOWN'}\``,
        `• **Mode Operasi:** ${latest.mode}`,
        `• **Warna Terdeteksi:** ${latest.color}`,
        `• **Status:** ${latest.status}`,
        latest.runId ? `• **Run ID / Command ID:** \`${latest.runId}\`` : '',
        ``,
        `> **Catatan Operasional:** Data kegagalan ini dicatat otomatis saat watchdog timeout terpicu atau aktuator tidak merespons konfirmasi. Belum tentu mencerminkan kerusakan permanen pada komponen fisik.`
      ].filter(Boolean).join('\n');

      return {
        intent: 'ERROR_LATEST',
        answer,
        basis: `Basis Perhitungan: Berdasarkan data log error terbaru dari total ${errorRecords.length} kejadian error.`,
        suggestions: ['Mode apa sering error?', 'Berapa error hari ini?', 'Daftar semua error']
      };
    }

    handleErrorList(records) {
      const errorRecords = records.filter(r => r.isError);
      if (errorRecords.length === 0) {
        return {
          intent: 'ERROR_LIST',
          answer: 'Tidak ditemukan log error pada sistem saat ini.',
          basis: 'Basis Perhitungan: 0 error tercatat.',
          suggestions: ['Total sortir produk', 'Status sistem']
        };
      }

      // Take last 5 errors (most recent first)
      const recent = errorRecords.slice(-5).reverse();
      const listStr = recent.map((e, idx) => {
        return `${idx + 1}. [${formatWIB(e.timestamp, 'short')}] Mode: **${e.mode}** | Kode: \`${e.errorCode || 'ERR_TIMEOUT'}\` | Warna: ${e.color}`;
      }).join('\n');

      const answer = [
        `📋 **Daftar ${recent.length} Error Terbaru:**`,
        listStr,
        ``,
        `• Total error tercatat: **${errorRecords.length}** kejadian`,
        `> **Catatan:** Log di atas mencatat kegagalan komunikasi atau batas waktu aktuasi pada siklus kerja terkait.`
      ].join('\n');

      return {
        intent: 'ERROR_LIST',
        answer,
        basis: `Basis Perhitungan: Dihitung dari ${errorRecords.length} error pada basis data.`,
        suggestions: ['Mode apa sering error?', 'Kapan error terakhir?', 'Error rate sistem']
      };
    }

    handleErrorToday(records) {
      const todayBounds = getDayBoundsWIB();
      const todayRecords = records.filter(r => r.timestamp >= todayBounds.startEpoch && r.timestamp <= todayBounds.endEpoch);
      const todayErrors = todayRecords.filter(r => r.isError);

      const stats = computeStats(todayRecords);

      const answer = [
        `⚠️ **Laporan Error Hari Ini (${todayBounds.label} WIB):**`,
        `• **Jumlah Error:** **${todayErrors.length}** kejadian`,
        `• **Total Percobaan Hari Ini:** ${todayRecords.length} item`,
        `• **Error Rate Hari Ini:** **${stats.errorRate}%**`,
        todayErrors.length > 0 ? `• **Error Terakhir Hari Ini:** ${formatWIB(todayErrors[todayErrors.length - 1].timestamp, 'time')}` : '• Tidak ada error pada hari ini.',
        ``,
        `📊 **Distribusi Error per Mode:** Servo: ${stats.modeErrors.Servo} | Arm: ${stats.modeErrors.Arm}`
      ].join('\n');

      return {
        intent: 'ERROR_TODAY',
        answer,
        basis: `Basis Perhitungan: Dihitung dari ${todayRecords.length} total rekaman sortir pada hari ini (${todayBounds.label} WIB).`,
        suggestions: ['Error rate sistem', 'Mode apa sering error?', 'Bandingkan dengan kemarin']
      };
    }

    handleErrorRate(records) {
      if (records.length === 0) {
        return {
          intent: 'ERROR_RATE',
          answer: 'Belum ada data rekaman untuk menghitung error rate.',
          basis: 'Basis Perhitungan: 0 data pada sistem.',
          suggestions: ['Status ESP32', 'Total sortir produk']
        };
      }

      const stats = computeStats(records);
      const answer = [
        `📈 **Error Rate (Tingkat Kegagalan) Sistem:**`,
        `• **Error Rate Keseluruhan:** **${stats.errorRate}%**`,
        `• **Total Percobaan:** ${stats.total} item`,
        `• **Sukses:** ${stats.successCount} item | **Gagal:** ${stats.errorCount} item`,
        ``,
        `🔬 **Error Rate per Mode:**`,
        `• Mode Servo: **${stats.servoErrorRate}%** (${stats.modeErrors.Servo} error dari ${stats.modes.Servo} percobaan)`,
        `• Mode Arm: **${stats.armErrorRate}%** (${stats.modeErrors.Arm} error dari ${stats.modes.Arm} percobaan)`,
        ``,
        `> Formula: \`Error Rate = (Jumlah Error / Total Percobaan) × 100%\``
      ].join('\n');

      return {
        intent: 'ERROR_RATE',
        answer,
        basis: `Basis Perhitungan: Dihitung dari ${stats.total} total siklus sortir (${stats.successCount} sukses + ${stats.errorCount} gagal).`,
        suggestions: ['Mode apa sering error?', 'Kapan error terakhir?', 'Rekomendasi sistem']
      };
    }

    handleErrorByMode(records, intent = 'ERROR_MOST_BY_MODE') {
      const errorRecords = records.filter(r => r.isError);
      if (errorRecords.length === 0) {
        return {
          intent,
          answer: '✅ Belum ada kegagalan yang tercatat pada mode Servo maupun Arm.',
          basis: 'Basis Perhitungan: 0 error tercatat.',
          suggestions: ['Total sortir produk', 'Mode kerja paling sering']
        };
      }

      const stats = computeStats(records);
      const servoErr = stats.modeErrors.Servo || 0;
      const armErr = stats.modeErrors.Arm || 0;

      let dominantMode = 'Seimbang';
      if (servoErr > armErr) dominantMode = 'Mode Servo';
      else if (armErr > servoErr) dominantMode = 'Mode Arm';

      const answer = [
        `🤖 **Analisis Error Berdasarkan Mode Operasi:**`,
        `• Mode dengan error terbanyak: **${dominantMode}**`,
        `• **Mode Servo:** ${servoErr} error (${stats.servoErrorRate}% error rate dari ${stats.modes.Servo} percobaan)`,
        `• **Mode Arm:** ${armErr} error (${stats.armErrorRate}% error rate dari ${stats.modes.Arm} percobaan)`,
        ``,
        `⚠️ **Catatan Teknis Korelasi vs Kausalitas:**`,
        `Data di atas menunjukkan korelasi frekuensi kegagalan pada mode kerja yang tercatat dalam log, **namun belum membuktikan bahwa mekanisme mekanis ${dominantMode} adalah penyebab kerusakan fisik**. Kegagalan dapat dipengaruhi oleh timeout transmisi Wi-Fi, waktu tunggu perintah, atau durasi gerak lengan robot.`
      ].join('\n');

      return {
        intent,
        answer,
        basis: `Basis Perhitungan: Dihitung dari ${errorRecords.length} error di antara ${records.length} total rekaman.`,
        suggestions: ['Error rate mode arm', 'Error rate mode servo', 'Error terakhir']
      };
    }

    handleErrorByType(records) {
      const errorRecords = records.filter(r => r.isError);
      if (errorRecords.length === 0) {
        return {
          intent: 'ERROR_BY_TYPE',
          answer: 'Belum ada jenis error yang tercatat pada sistem.',
          basis: 'Basis Perhitungan: 0 error tercatat.',
          suggestions: ['Total sortir produk', 'Status sistem']
        };
      }

      const stats = computeStats(records);
      const codes = Object.entries(stats.errorCodes).sort((a, b) => b[1] - a[1]);

      const breakdown = codes.map(([code, count]) => {
        const pct = Math.round((count / errorRecords.length) * 100);
        return `• \`${code}\`: **${count}** kali (${pct}%)`;
      }).join('\n');

      const answer = [
        `🔍 **Rincian Kode & Jenis Error:**`,
        breakdown,
        ``,
        `• Total error tercatat: **${errorRecords.length}** kali`,
        `> Kode seperti \`ERR_WATCHDOG_12S\` menandakan ESP32 tidak menerima konfirmasi penyelesaian sortir sebelum batas waktu 12 detik.`
      ].join('\n');

      return {
        intent: 'ERROR_BY_TYPE',
        answer,
        basis: `Basis Perhitungan: Dihitung dari ${errorRecords.length} rekaman error pada basis data.`,
        suggestions: ['Mode apa sering error?', 'Error terakhir', 'Error rate sistem']
      };
    }

    handleErrorByColor(records) {
      const errorRecords = records.filter(r => r.isError);
      if (errorRecords.length === 0) {
        return {
          intent: 'ERROR_BY_COLOR',
          answer: 'Tidak ada kegagalan sortir yang tercatat per warna.',
          basis: 'Basis Perhitungan: 0 error tercatat.',
          suggestions: ['Total sortir produk', 'Distribusi warna']
        };
      }

      const colorFailures = { kuning: 0, biru: 0, merah: 0, 'tidak diketahui': 0 };
      errorRecords.forEach(e => {
        const c = colorFailures.hasOwnProperty(e.color) ? e.color : 'tidak diketahui';
        colorFailures[c]++;
      });

      const answer = [
        `🎨 **Kegagalan Sortir Berdasarkan Warna Terdeteksi:**`,
        `• Kuning: **${colorFailures.kuning}** kali`,
        `• Biru: **${colorFailures.biru}** kali`,
        `• Merah: **${colorFailures.merah}** kali`,
        colorFailures['tidak diketahui'] > 0 ? `• Tidak terdefinisi: **${colorFailures['tidak diketahui']}** kali` : '',
        ``,
        `> Kegagalan pada warna tertentu umumnya terjadi jika objek keluar jalur conveyor atau kamera mendeteksi pantulan cahaya.`
      ].filter(Boolean).join('\n');

      return {
        intent: 'ERROR_BY_COLOR',
        answer,
        basis: `Basis Perhitungan: Dihitung dari ${errorRecords.length} kejadian kegagalan sortir.`,
        suggestions: ['Mode apa sering error?', 'Total sortir produk', 'Error rate']
      };
    }

    handleErrorTrend(records) {
      if (records.length < 4) {
        return {
          intent: 'ERROR_TREND',
          answer: 'Data riwayat belum mencukupi untuk menganalisis tren perubahan error (diperlukan minimal 4 rekaman).',
          basis: `Basis Perhitungan: Tersedia ${records.length} data.`,
          suggestions: ['Error rate sistem', 'Error hari ini']
        };
      }

      // Split into two halves chronologically
      const half = Math.floor(records.length / 2);
      const firstHalf = records.slice(0, half);
      const secondHalf = records.slice(half);

      const stats1 = computeStats(firstHalf);
      const stats2 = computeStats(secondHalf);

      const deltaRate = Math.round((stats2.errorRate - stats1.errorRate) * 10) / 10;
      let trendText = 'Relatif Stabil';
      if (deltaRate > 1) trendText = `Meningkat (+${deltaRate}%) ⚠️`;
      else if (deltaRate < -1) trendText = `Menurun (${deltaRate}%) ✅`;

      const answer = [
        `📊 **Analisis Tren Error (Separuh Awal vs Separuh Akhir Data):**`,
        `• **Status Tren:** **${trendText}**`,
        `• Error Rate Periode Awal: **${stats1.errorRate}%** (${stats1.errorCount} error / ${stats1.total} percobaan)`,
        `• Error Rate Periode Baru: **${stats2.errorRate}%** (${stats2.errorCount} error / ${stats2.total} percobaan)`,
        ``,
        deltaRate > 1 ? `> **Perhatian:** Terjadi peningkatan kegagalan pada sesi-sesi terakhir. Periksa kestabilan koneksi Wi-Fi dan kebersihan lintasan conveyor.` : `> **Kondisi Baik:** Sistem menunjukkan stabilitas operasional yang terjaga.`
      ].join('\n');

      return {
        intent: 'ERROR_TREND',
        answer,
        basis: `Basis Perhitungan: Membandingkan ${firstHalf.length} data awal dengan ${secondHalf.length} data terbaru.`,
        suggestions: ['Error rate sistem', 'Mode apa sering error?', 'Rekomendasi']
      };
    }

    handleModeUsage(records) {
      if (records.length === 0) {
        return {
          intent: 'MODE_USAGE_COUNT',
          answer: 'Belum ada data penggunaan mode yang tercatat.',
          basis: 'Basis Perhitungan: 0 data pada sistem.',
          suggestions: ['Status ESP32', 'Total sortir']
        };
      }

      const stats = computeStats(records);
      const topMode = stats.modes.Servo >= stats.modes.Arm ? 'Mode Servo' : 'Mode Arm';

      const answer = [
        `🤖 **Statistik Penggunaan Mode Kerja Robot:**`,
        `• Mode paling dominan: **${topMode}**`,
        `• **Mode Servo:** ${stats.modes.Servo} kali pemrosesan (${stats.total > 0 ? Math.round((stats.modes.Servo / stats.total) * 100) : 0}%)`,
        `• **Mode Arm (Lengan Robot):** ${stats.modes.Arm} kali pemrosesan (${stats.total > 0 ? Math.round((stats.modes.Arm / stats.total) * 100) : 0}%)`,
        ``,
        `⚙️ **Tingkat Keberhasilan:**`,
        `• Servo: ${stats.modes.Servo - stats.modeErrors.Servo} sukses (${100 - stats.servoErrorRate}%)`,
        `• Arm: ${stats.modes.Arm - stats.modeErrors.Arm} sukses (${100 - stats.armErrorRate}%)`
      ].join('\n');

      return {
        intent: 'MODE_USAGE_COUNT',
        answer,
        basis: `Basis Perhitungan: Dihitung dari total ${stats.total} data pemrosesan mode pada sistem.`,
        suggestions: ['Error rate mode arm', 'Error rate mode servo', 'Bandingkan error mode']
      };
    }

    handleModeErrorRate(records, query) {
      if (records.length === 0) {
        return {
          intent: 'MODE_ERROR_RATE',
          answer: 'Belum ada data rekaman untuk menghitung error rate mode.',
          basis: 'Basis Perhitungan: 0 data.',
          suggestions: ['Status ESP32', 'Total sortir']
        };
      }

      const stats = computeStats(records);
      const isArm = query.includes('arm');
      const isServo = query.includes('servo');

      if (isArm && !isServo) {
        return {
          intent: 'MODE_ERROR_RATE',
          answer: `🤖 **Error Rate Mode Arm:** **${stats.armErrorRate}%**\n• Rincian: ${stats.modeErrors.Arm} kegagalan dari ${stats.modes.Arm} kali percobaan mode Arm.\n• Sukses: ${stats.modes.Arm - stats.modeErrors.Arm} item.`,
          basis: `Basis Perhitungan: Dihitung dari ${stats.modes.Arm} percobaan mode Arm.`,
          suggestions: ['Error rate mode servo', 'Bandingkan error mode', 'Total sortir']
        };
      }

      if (isServo && !isArm) {
        return {
          intent: 'MODE_ERROR_RATE',
          answer: `🦾 **Error Rate Mode Servo:** **${stats.servoErrorRate}%**\n• Rincian: ${stats.modeErrors.Servo} kegagalan dari ${stats.modes.Servo} kali percobaan mode Servo.\n• Sukses: ${stats.modes.Servo - stats.modeErrors.Servo} item.`,
          basis: `Basis Perhitungan: Dihitung dari ${stats.modes.Servo} percobaan mode Servo.`,
          suggestions: ['Error rate mode arm', 'Bandingkan error mode', 'Total sortir']
        };
      }

      const answer = [
        `🤖 **Perbandingan Error Rate Kedua Mode:**`,
        `• **Mode Servo:** **${stats.servoErrorRate}%** (${stats.modeErrors.Servo} error / ${stats.modes.Servo} total)`,
        `• **Mode Arm:** **${stats.armErrorRate}%** (${stats.modeErrors.Arm} error / ${stats.modes.Arm} total)`
      ].join('\n');

      return {
        intent: 'MODE_ERROR_RATE',
        answer,
        basis: `Basis Perhitungan: Dihitung dari total ${stats.total} rekaman sortir.`,
        suggestions: ['Mode apa sering error?', 'Error rate keseluruhan', 'Total sortir']
      };
    }

    handleActivityToday(records) {
      const todayBounds = getDayBoundsWIB();
      const todayRecords = records.filter(r => r.timestamp >= todayBounds.startEpoch && r.timestamp <= todayBounds.endEpoch);

      if (todayRecords.length === 0) {
        return {
          intent: 'ACTIVITY_TODAY',
          answer: `📅 **Aktivitas Hari Ini (${todayBounds.label} WIB):**\nBelum ada aktivitas sortir yang tercatat untuk hari ini. Silakan jalankan penyortiran pada conveyor.`,
          basis: `Basis Perhitungan: 0 rekaman pada rentang 00:00:00 - 23:59:59 WIB hari ini.`,
          suggestions: ['Status ESP32', 'Data kemarin', 'Total semua sortir']
        };
      }

      const stats = computeStats(todayRecords);
      const answer = [
        `📅 **Ringkasan Aktivitas Sortir Hari Ini (${todayBounds.label} WIB):**`,
        `• **Total Diproses:** ${stats.total} item`,
        `• **Sukses:** ${stats.successCount} item (${Math.round((stats.successCount / stats.total) * 100)}%)`,
        `• **Gagal:** ${stats.errorCount} item (${stats.errorRate}%)`,
        `• **Warna Sukses:** Kuning (${stats.colors.kuning}) | Biru (${stats.colors.biru}) | Merah (${stats.colors.merah})`,
        `• **Jam Paling Aktif:** Pukul ${String(stats.busiestHour).padStart(2, '0')}:00 WIB (${stats.busiestHourCount} item)`
      ].join('\n');

      return {
        intent: 'ACTIVITY_TODAY',
        answer,
        basis: `Basis Perhitungan: Dihitung dari ${todayRecords.length} log sortir hari ini (${todayBounds.label} WIB).`,
        suggestions: ['Bandingkan dengan kemarin', 'Error hari ini', 'Jam tersibuk']
      };
    }

    handleActivityYesterday(records) {
      const yestBounds = getDayBoundsWIB(new Date(Date.now() - 24 * 60 * 60 * 1000));
      const yestRecords = records.filter(r => r.timestamp >= yestBounds.startEpoch && r.timestamp <= yestBounds.endEpoch);

      if (yestRecords.length === 0) {
        return {
          intent: 'ACTIVITY_YESTERDAY',
          answer: `📅 **Aktivitas Kemarin (${yestBounds.label} WIB):**\nTidak ada rekaman data sortir pada tanggal kemarin.`,
          basis: `Basis Perhitungan: 0 rekaman pada rentang kemarin WIB.`,
          suggestions: ['Aktivitas hari ini', 'Total semua sortir']
        };
      }

      const stats = computeStats(yestRecords);
      const answer = [
        `📅 **Ringkasan Aktivitas Kemarin (${yestBounds.label} WIB):**`,
        `• **Total Diproses:** ${stats.total} item`,
        `• **Sukses:** ${stats.successCount} item`,
        `• **Gagal:** ${stats.errorCount} item (${stats.errorRate}%)`,
        `• **Distribusi Warna:** Kuning (${stats.colors.kuning}), Biru (${stats.colors.biru}), Merah (${stats.colors.merah})`
      ].join('\n');

      return {
        intent: 'ACTIVITY_YESTERDAY',
        answer,
        basis: `Basis Perhitungan: Dihitung dari ${yestRecords.length} log sortir kemarin (${yestBounds.label} WIB).`,
        suggestions: ['Bandingkan hari ini dan kemarin', 'Aktivitas hari ini', 'Total semua sortir']
      };
    }

    handleActivityRecent(records) {
      if (records.length === 0) {
        return {
          intent: 'ACTIVITY_RECENT',
          answer: 'Belum ada rekaman aktivitas sortir baru-baru ini.',
          basis: 'Basis Perhitungan: 0 rekaman.',
          suggestions: ['Status ESP32', 'Total sortir']
        };
      }

      const recent = records.slice(-3).reverse();
      const listStr = recent.map((r, i) => {
        return `${i + 1}. [${formatWIB(r.timestamp, 'time')}] Warna: **${r.color}** | Mode: **${r.mode}** | Status: **${r.status}**`;
      }).join('\n');

      const answer = [
        `⏱️ **Aktivitas Sortir Terakhir:**`,
        listStr,
        ``,
        `• Total keseluruhan data: **${records.length}** item`
      ].join('\n');

      return {
        intent: 'ACTIVITY_RECENT',
        answer,
        basis: `Basis Perhitungan: 3 rekaman terbaru dari total ${records.length} data.`,
        suggestions: ['Aktivitas hari ini', 'Kapan error terakhir?', 'Status ESP32']
      };
    }

    handleBusiestHours(records) {
      if (records.length === 0) {
        return {
          intent: 'BUSIEST_HOURS',
          answer: 'Belum ada data untuk menghitung jam-jam tersibuk.',
          basis: 'Basis Perhitungan: 0 rekaman.',
          suggestions: ['Status ESP32', 'Total sortir']
        };
      }

      const stats = computeStats(records);
      const bHour = stats.busiestHour;
      const bCount = stats.busiestHourCount;

      const answer = [
        `⏰ **Jam Paling Sibuk (Zona Waktu WIB):**`,
        `• **Puncak Aktivitas:** Pukul **${String(bHour).padStart(2, '0')}:00 - ${String(bHour + 1).padStart(2, '0')}:00 WIB**`,
        `• **Volume Sortir:** **${bCount}** item disortir pada jam tersebut`,
        `• **Porsi Aktivitas:** ${stats.total > 0 ? Math.round((bCount / stats.total) * 100) : 0}% dari seluruh data`,
        ``,
        `> Informasi ini berguna untuk menentukan jadwal pemeliharaan berkala di luar jam sibuk pabrik.`
      ].join('\n');

      return {
        intent: 'BUSIEST_HOURS',
        answer,
        basis: `Basis Perhitungan: Dihitung dari distribusi per jam atas ${stats.total} rekaman sortir (WIB).`,
        suggestions: ['Aktivitas hari ini', 'Total sortir produk', 'Error rate']
      };
    }

    handleCompareDays(records) {
      const todayBounds = getDayBoundsWIB();
      const yestBounds = getDayBoundsWIB(new Date(Date.now() - 24 * 60 * 60 * 1000));

      const todayRecords = records.filter(r => r.timestamp >= todayBounds.startEpoch && r.timestamp <= todayBounds.endEpoch);
      const yestRecords = records.filter(r => r.timestamp >= yestBounds.startEpoch && r.timestamp <= yestBounds.endEpoch);

      const tStats = computeStats(todayRecords);
      const yStats = computeStats(yestRecords);

      const deltaTotal = tStats.total - yStats.total;
      const deltaPercent = yStats.total > 0 ? Math.round((deltaTotal / yStats.total) * 100) : (tStats.total > 0 ? 100 : 0);
      const deltaSign = deltaTotal >= 0 ? `+${deltaTotal}` : `${deltaTotal}`;

      const answer = [
        `⚖️ **Perbandingan Aktivitas Hari Ini vs Kemarin (WIB):**`,
        `• **Hari Ini:** ${tStats.total} item (Sukses: ${tStats.successCount}, Gagal: ${tStats.errorCount})`,
        `• **Kemarin:** ${yStats.total} item (Sukses: ${yStats.successCount}, Gagal: ${yStats.errorCount})`,
        `• **Selisih Volume:** **${deltaSign} item** (${deltaPercent >= 0 ? `+${deltaPercent}%` : `${deltaPercent}%`})`,
        `• **Perbandingan Error Rate:** Hari ini: **${tStats.errorRate}%** | Kemarin: **${yStats.errorRate}%**`
      ].join('\n');

      return {
        intent: 'COMPARE_DAYS',
        answer,
        basis: `Basis Perhitungan: Dihitung dari ${todayRecords.length} data hari ini dan ${yestRecords.length} data kemarin.`,
        suggestions: ['Aktivitas hari ini', 'Aktivitas kemarin', 'Error hari ini']
      };
    }

    handleCompareWeeks(records) {
      const now = Date.now();
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

      const thisWeekRecords = records.filter(r => r.timestamp >= (now - oneWeekMs));
      const lastWeekRecords = records.filter(r => r.timestamp >= (now - 2 * oneWeekMs) && r.timestamp < (now - oneWeekMs));

      const tStats = computeStats(thisWeekRecords);
      const lStats = computeStats(lastWeekRecords);

      const deltaTotal = tStats.total - lStats.total;
      const deltaSign = deltaTotal >= 0 ? `+${deltaTotal}` : `${deltaTotal}`;

      const answer = [
        `⚖️ **Perbandingan 7 Hari Terakhir vs 7 Hari Sebelumnya:**`,
        `• **7 Hari Terakhir:** ${tStats.total} item (Sukses: ${tStats.successCount}, Gagal: ${tStats.errorCount})`,
        `• **7 Hari Sebelumnya:** ${lStats.total} item (Sukses: ${lStats.successCount}, Gagal: ${lStats.errorCount})`,
        `• **Selisih Total:** **${deltaSign} item**`,
        `• **Error Rate:** 7 Hari Terakhir: **${tStats.errorRate}%** | 7 Hari Sebelumnya: **${lStats.errorRate}%**`
      ].join('\n');

      return {
        intent: 'COMPARE_WEEKS',
        answer,
        basis: `Basis Perhitungan: Membandingkan ${thisWeekRecords.length} rekaman minggu ini dengan ${lastWeekRecords.length} rekaman minggu lalu.`,
        suggestions: ['Aktivitas hari ini', 'Total sortir', 'Error rate']
      };
    }

    handlePeriodWeek(records) {
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
      const weekRecords = records.filter(r => r.timestamp >= (Date.now() - oneWeekMs));
      const stats = computeStats(weekRecords);

      const answer = [
        `🗓️ **Statistik Sortir 7 Hari Terakhir:**`,
        `• Total diproses: **${stats.total}** item`,
        `• Sukses: **${stats.successCount}** item | Gagal: **${stats.errorCount}** item (${stats.errorRate}%)`,
        `• Warna terbanyak: **${stats.mostColor.color}** (${stats.mostColor.count} item)`
      ].join('\n');

      return {
        intent: 'ACTIVITY_PERIOD_WEEK',
        answer,
        basis: `Basis Perhitungan: Dihitung dari ${weekRecords.length} log dalam 7 hari terakhir.`,
        suggestions: ['Aktivitas hari ini', 'Perbandingan minggu ini', 'Total sortir']
      };
    }

    handlePeriodMonth(records) {
      const oneMonthMs = 30 * 24 * 60 * 60 * 1000;
      const monthRecords = records.filter(r => r.timestamp >= (Date.now() - oneMonthMs));
      const stats = computeStats(monthRecords);

      const answer = [
        `🗓️ **Statistik Sortir 30 Hari Terakhir:**`,
        `• Total diproses: **${stats.total}** item`,
        `• Sukses: **${stats.successCount}** item | Gagal: **${stats.errorCount}** item (${stats.errorRate}%)`,
        `• Dominasi Mode: Servo (${stats.modes.Servo}) | Arm (${stats.modes.Arm})`
      ].join('\n');

      return {
        intent: 'ACTIVITY_PERIOD_MONTH',
        answer,
        basis: `Basis Perhitungan: Dihitung dari ${monthRecords.length} log dalam 30 hari terakhir.`,
        suggestions: ['Aktivitas hari ini', '7 hari terakhir', 'Error rate']
      };
    }

    handleHardwareEsp32(esp32) {
      const isOnline = Boolean(esp32.online || esp32.state === 'READY' || esp32.state === 'BUSY' || esp32.isSimulated);
      const isSim = Boolean(esp32.isSimulated || esp32.state === 'SIMULATED');

      const answer = [
        `📡 **Status Hardware ESP32 Wi-Fi:**`,
        `• **Status Koneksi:** ${isOnline ? (isSim ? '🟢 **ONLINE (Mode Simulasi)**' : '🟢 **ONLINE (Hardware Terhubung)**') : '🔴 **OFFLINE**'}`,
        `• **Alamat Host/IP:** \`${esp32.host || 'http://192.168.4.1'}\``,
        `• **Sinyal Wi-Fi (RSSI):** ${esp32.rssi ? `${esp32.rssi} dBm` : (isSim ? '-45 dBm (Virtual)' : 'Tidak terdeteksi')}`,
        `• **Free RAM / Heap:** ${esp32.freeHeap ? `${Math.round(esp32.freeHeap / 1024)} KB` : (isSim ? '184 KB (Virtual)' : '-')}`,
        `• **Mode Aktif Terkini:** ${esp32.currentMode || 'Servo'}`,
        `• **Uptime Firmware:** ${esp32.uptimeMs ? `${Math.round(esp32.uptimeMs / 1000)} detik` : '-'}`
      ].join('\n');

      return {
        intent: 'HARDWARE_ESP32',
        answer,
        basis: 'Basis Data: Snapshot telemetri ESP32 Client via HTTP REST API.',
        suggestions: ['Status kamera', 'Status sistem', 'Total sortir']
      };
    }

    handleCameraStatus(camera) {
      const isActive = camera.active !== false;
      const answer = [
        `📹 **Status Kamera & AI Vision:**`,
        `• **Kondisi Kamera:** ${isActive ? '🟢 **AKTIF / MONITORING**' : '🔴 **NON-AKTIF**'}`,
        `• **Model AI:** TensorFlow.js / Teachable Machine (Deteksi Warna)`,
        `• **Kelas Deteksi:** Kuning, Biru, Merah, Background`,
        `• **Frame Rate (FPS):** ~${camera.fps || 30} FPS`,
        `• **Ambang Probabilitas:** 85% confidence threshold`
      ].join('\n');

      return {
        intent: 'CAMERA_STATUS',
        answer,
        basis: 'Basis Data: Status live webcam operator browser.',
        suggestions: ['Status ESP32', 'Total sortir', 'Ringkasan sistem']
      };
    }

    handleSystemStatus(records, esp32, camera) {
      const stats = computeStats(records);
      const isEspOnline = Boolean(esp32.online || esp32.isSimulated || esp32.state === 'READY');
      const isCamActive = camera.active !== false;

      const answer = [
        `🏭 **Status Menyeluruh Sistem Pabrik VERNOVA:**`,
        `• **Hardware ESP32:** ${isEspOnline ? '🟢 Online' : '🔴 Offline'} (${esp32.isSimulated ? 'Simulasi' : (esp32.host || '192.168.4.1')})`,
        `• **Kamera AI Vision:** ${isCamActive ? '🟢 Aktif' : '🔴 Non-aktif'}`,
        `• **Penyimpanan Data:** 🟢 Firebase Realtime Database Aktif`,
        `• **Total Riwayat Data:** ${stats.total} item disortir (${stats.successCount} sukses, ${stats.errorCount} gagal)`,
        `• **Tingkat Error Sistem:** **${stats.errorRate}%**`,
        `• **Error Terakhir:** ${stats.latestErrorRecord ? formatWIB(stats.latestErrorRecord.timestamp, 'short') : 'Tidak ada'}`
      ].join('\n');

      return {
        intent: 'SYSTEM_STATUS',
        answer,
        basis: `Basis Perhitungan: Dihitung dari status telemetri perangkat dan ${stats.total} rekaman sortir.`,
        suggestions: ['Status ESP32', 'Total sortir', 'Rekomendasi operator']
      };
    }

    handleGeneralSummary(records, esp32) {
      if (records.length === 0) {
        return {
          intent: 'GENERAL_SUMMARY',
          answer: 'Belum ada data untuk menghasilkan ringkasan sistem. Silakan jalankan penyortiran.',
          basis: 'Basis Perhitungan: 0 data pada sistem.',
          suggestions: ['Status ESP32', 'Panduan sistem']
        };
      }

      const stats = computeStats(records);
      const todayBounds = getDayBoundsWIB();
      const todayRecords = records.filter(r => r.timestamp >= todayBounds.startEpoch && r.timestamp <= todayBounds.endEpoch);
      const todayStats = computeStats(todayRecords);

      const answer = [
        `📋 **Ringkasan Eksekutif Data VERNOVA:**`,
        `1. **Produksi & Sortir:** Total **${stats.total}** produk diproses (${stats.successCount} berhasil, ${stats.errorCount} gagal).`,
        `2. **Aktivitas Hari Ini:** **${todayStats.total}** produk diproses hari ini dengan error rate **${todayStats.errorRate}%**.`,
        `3. **Komposisi Warna:** Warna **${stats.mostColor.color}** mendominasi (${stats.mostColor.count} item), disusul warna lain.`,
        `4. **Efisiensi Mode:** Mode Servo (${stats.modes.Servo} kali, error ${stats.servoErrorRate}%) vs Mode Arm (${stats.modes.Arm} kali, error ${stats.armErrorRate}%).`,
        `5. **Integritas Sistem:** Hardware ESP32 saat ini ${esp32.online || esp32.isSimulated ? 'terhubung' : 'belum terhubung'}.`
      ].join('\n');

      return {
        intent: 'GENERAL_SUMMARY',
        answer,
        basis: `Basis Perhitungan: Dihitung dari ${stats.total} data historis (${todayStats.total} data hari ini).`,
        suggestions: ['Rekomendasi operator', 'Error terbanyak servo atau arm', 'Jam tersibuk']
      };
    }

    handleIssueHighlights(records, esp32) {
      const stats = computeStats(records);
      const recommendations = [];

      // Check ESP32 status
      if (!esp32.online && !esp32.isSimulated) {
        recommendations.push('⚠️ **ESP32 Belum Terkoneksi:** Pastikan modul ESP32 dinyalakan dan perangkat terhubung ke Wi-Fi `VERNOVA-ROBOT` atau klik tombol Wi-Fi di topbar.');
      }

      // Check Error Rate
      if (stats.errorRate > 15) {
        recommendations.push(`⚠️ **Error Rate Tinggi (${stats.errorRate}%):** Tingkat kegagalan melampaui batas wajar 15%. Periksa watchdog timer, kestabilan tegangan catu daya servo, dan kelancaran conveyor belt.`);
      }

      // Check Mode disparity
      if (stats.armErrorRate > stats.servoErrorRate + 10 && stats.modes.Arm > 3) {
        recommendations.push(`ℹ️ **Evaluasi Mode Arm:** Mode Arm mencatat error rate (${stats.armErrorRate}%) lebih tinggi dari Servo (${stats.servoErrorRate}%). Pertimbangkan memperpanjang delay gerak arm atau mengecek sudut servo capit.`);
      }

      if (recommendations.length === 0) {
        recommendations.push('✅ **Sistem Dalam Kondisi Optimal:** Tidak ada isu kritis yang memerlukan tindakan mendesak. Jalankan penyortiran sesuai SOP standar.');
      }

      const answer = [
        `💡 **Sorotan Masalah & Rekomendasi Operasional (SOP):**`,
        recommendations.join('\n\n'),
        ``,
        `> **Catatan:** Rekomendasi di atas dibuat secara deterministik berdasarkan batas ambang metrik telemetri aktual.`
      ].join('\n');

      return {
        intent: 'ISSUE_HIGHLIGHTS',
        answer,
        basis: `Basis Perhitungan: Evaluasi rule-based atas ${stats.total} data sortir dan telemetri perangkat.`,
        suggestions: ['Ringkasan data', 'Error rate sistem', 'Status sistem']
      };
    }

    handleFallback(rawQuery) {
      const answer = [
        `🤖 **VERNOVA Smart Data Assistant**`,
        `Saya adalah asisten data deterministik berbasis aturan untuk sistem sortir pabrik VERNOVA. Saya dapat menghitung dan menyajikan data aktual tanpa model AI eksternal.`,
        ``,
        `📌 **Pertanyaan yang dapat Anda ajukan:**`,
        `• **Statistik Sortir:** "Berapa total produk disortir?", "Warna apa paling banyak?", "Jumlah sortir warna kuning"`,
        `• **Analisis Error:** "Kapan error terakhir?", "Berapa error rate sistem?", "Mode apa sering error?"`,
        `• **Analisis Waktu:** "Aktivitas hari ini", "Bandingkan hari ini vs kemarin", "Jam paling sibuk"`,
        `• **Status Perangkat:** "Status ESP32", "Status kamera", "Status sistem saat ini"`,
        `• **Ringkasan:** "Beri ringkasan data", "Rekomendasi operator"`
      ].join('\n');

      return {
        intent: 'UNKNOWN',
        answer,
        basis: 'Query di luar domain analitik data pabrik sortir VERNOVA.',
        suggestions: ['Total sortir produk', 'Warna apa terbanyak?', 'Kapan error terakhir?', 'Status ESP32']
      };
    }
  }

  // Export module for Browser and Node.js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      SmartDataAssistant,
      normalizeText,
      detectIntent,
      computeStats,
      extractAllRecords,
      getDayBoundsWIB,
      formatWIB,
      toWIBDate
    };
  } else {
    global.SmartDataAssistant = SmartDataAssistant;
    global.smartDataAssistant = new SmartDataAssistant();
  }
})(typeof window !== 'undefined' ? window : globalThis);
