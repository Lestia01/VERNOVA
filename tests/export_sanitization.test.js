const test = require('node:test');
const assert = require('node:assert/strict');

// Implementasi fungsi sanitasi sel dari index.html & guest.html
function safeCell(v) {
  const s = String(v ?? '');
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

test('Sanitasi Formula Injection (safeCell)', async (t) => {
  await t.test('Menonaktifkan formula diawali =', () => {
    assert.equal(safeCell('=1+1'), "'=1+1");
    assert.equal(safeCell('=cmd|/C calc!A0'), "'=cmd|/C calc!A0");
  });

  await t.test('Menonaktifkan formula diawali +, -, atau @', () => {
    assert.equal(safeCell('+5000'), "'+5000");
    assert.equal(safeCell('-100'), "'-100");
    assert.equal(safeCell('@SUM(A1:A10)'), "'@SUM(A1:A10)");
  });

  await t.test('Mempertahankan teks normal tanpa perubahan', () => {
    assert.equal(safeCell('Kuning'), 'Kuning');
    assert.equal(safeCell('Berhasil'), 'Berhasil');
    assert.equal(safeCell('Servo'), 'Servo');
    assert.equal(safeCell('1200'), '1200');
  });

  await t.test('Menangani nilai null atau undefined', () => {
    assert.equal(safeCell(null), '');
    assert.equal(safeCell(undefined), '');
  });
});

test('Enkapsulasi String CSV (csvEscape)', async (t) => {
  await t.test('Mengenkapsulasi teks berisi koma', () => {
    assert.equal(csvEscape('Kuning, Biru'), '"Kuning, Biru"');
  });

  await t.test('Meng-escape tanda petik dua ganda', () => {
    assert.equal(csvEscape('Robot "R-LAB"'), '"Robot ""R-LAB"""');
  });

  await t.test('Mengenkapsulasi newline', () => {
    assert.equal(csvEscape("Baris 1\nBaris 2"), '"Baris 1\nBaris 2"');
  });
});
