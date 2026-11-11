const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Setup lingkungan simulasi window untuk memuat rai-knowledge.js
global.window = {};
const code = fs.readFileSync(path.join(__dirname, '..', 'rai-knowledge.js'), 'utf8');
eval(code);

test('Pustaka Pengetahuan R-AI (rai-knowledge.js)', async (t) => {
  await t.test('Normalisasi Warna (raiKnownWarna)', () => {
    assert.equal(window.raiKnownWarna('kuning'), 'Kuning');
    assert.equal(window.raiKnownWarna('YELLOW'), 'Kuning');
    assert.equal(window.raiKnownWarna('biru tua'), 'Biru');
    assert.equal(window.raiKnownWarna('blue'), 'Biru');
    assert.equal(window.raiKnownWarna('merah cabe'), 'Merah');
    assert.equal(window.raiKnownWarna('red'), 'Merah');
    assert.equal(window.raiKnownWarna('hijau'), null);
    assert.equal(window.raiKnownWarna(''), null);
  });

  await t.test('Interpolasi Warna Kosong (raiFillWarna)', () => {
    const rows = [
      { warna: 'Kuning' },
      { warna: 'Unknown' },
      { warna: 'Biru' }
    ];
    window.raiFillWarna(rows);
    assert.equal(rows[0].warna, 'Kuning');
    assert.equal(rows[1].warna, 'Biru');
    assert.equal(rows[2].warna, 'Biru');
  });

  await t.test('Respon Deterministik Kata Kunci (raiKnowledgeReply)', () => {
    const mockData = { kuning: 5, biru: 8, merah: 3, gagal: 2, total: 16 };

    // Uji salam
    const replyHalo = window.raiKnowledgeReply('halo', mockData, 'id');
    assert.ok(replyHalo.includes('R-AI'));
    assert.ok(replyHalo.includes('R-LAB'));

    // Uji status mesin
    const replyStatus = window.raiKnowledgeReply('status', mockData, 'id');
    assert.ok(replyStatus.includes('total 16'));
    assert.ok(replyStatus.includes('kuning 5'));

    // Uji pertanyaan bahasa Inggris
    const replyEn = window.raiKnowledgeReply('status', mockData, 'en');
    assert.ok(replyEn.includes('Machine status: total 16'));

    // Uji proteksi kredensial/password
    const replyPass = window.raiKnowledgeReply('apa password database kamu', mockData, 'id');
    assert.ok(replyPass.includes('privasi'));
  });
});
