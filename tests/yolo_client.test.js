const test = require('node:test');
const assert = require('node:assert/strict');
const { YoloStudioClient, AI_ENGINES } = require('../assets/js/yolo-client.js');

test('VERNOVA YOLO Training Studio Client (yolo-client.js)', async (t) => {

  await t.test('1. Validasi Konstanta AI Engines', () => {
    assert.equal(AI_ENGINES.TEACHABLE_MACHINE, 'teachable_machine');
    assert.equal(AI_ENGINES.YOLO, 'yolo');
  });

  await t.test('2. Inisialisasi & Sanitasi URL Backend', () => {
    const c1 = new YoloStudioClient({ baseUrl: '127.0.0.1:8000/' });
    assert.equal(c1.baseUrl, 'http://127.0.0.1:8000');

    const c2 = new YoloStudioClient({ baseUrl: 'http://localhost:5000' });
    assert.equal(c2.baseUrl, 'http://localhost:5000');

    const c3 = new YoloStudioClient();
    assert.equal(c3.baseUrl, 'http://127.0.0.1:8000');
    assert.equal(c3.getEngine(), AI_ENGINES.TEACHABLE_MACHINE);
    assert.equal(c3.isYoloActive(), false);
  });

  await t.test('3. Penggantian AI Engine & Validasi', () => {
    const client = new YoloStudioClient();
    let eventFired = null;
    client.onStatusChange(ev => { eventFired = ev; });

    client.setEngine(AI_ENGINES.YOLO);
    assert.equal(client.getEngine(), AI_ENGINES.YOLO);
    assert.equal(client.isYoloActive(), true);
    assert.ok(eventFired);
    assert.equal(eventFired.engine, AI_ENGINES.YOLO);

    client.setEngine(AI_ENGINES.TEACHABLE_MACHINE);
    assert.equal(client.isYoloActive(), false);

    assert.throws(() => {
      client.setEngine('engine_khayalan');
    }, /Engine tidak valid/);
  });

  await t.test('4. Standardisasi Output Deteksi YOLO untuk Robot Sortir', () => {
    const client = new YoloStudioClient();

    // Kasus A: Deteksi valid di atas ambang batas (Kuning)
    const mockPredYellow = {
      engine: 'yolo',
      model_id: 'model_test_v1',
      timestamp: '2026-11-24T14:30:00Z',
      detections: [
        {
          class_name: 'kuning',
          confidence: 0.89,
          bbox: { x1: 50, y1: 40, x2: 150, y2: 160 }
        }
      ]
    };

    const resYellow = client.extractTopColorDetection(mockPredYellow, 0.70);
    assert.ok(resYellow);
    assert.equal(resYellow.color, 'kuning');
    assert.equal(resYellow.confidence, 0.89);
    assert.equal(resYellow.engine, 'yolo');
    assert.deepEqual(resYellow.bbox, { x1: 50, y1: 40, x2: 150, y2: 160 });

    // Kasus B: Deteksi di bawah ambang batas (dieliminasi)
    const mockPredLow = {
      engine: 'yolo',
      detections: [{ class_name: 'merah', confidence: 0.45, bbox: {} }]
    };
    const resLow = client.extractTopColorDetection(mockPredLow, 0.70);
    assert.equal(resLow, null);

    // Kasus C: Deteksi Biru (Red/Blue/Yellow mapping)
    const mockPredBlue = {
      engine: 'yolo',
      detections: [
        { class_name: 'Blue Cylinder', confidence: 0.94, bbox: { x1: 10, y1: 10, x2: 80, y2: 80 } }
      ]
    };
    const resBlue = client.extractTopColorDetection(mockPredBlue, 0.65);
    assert.ok(resBlue);
    assert.equal(resBlue.color, 'biru');

    // Kasus D: Prediksi kosong
    const resEmpty = client.extractTopColorDetection({ detections: [] });
    assert.equal(resEmpty, null);
  });
});
