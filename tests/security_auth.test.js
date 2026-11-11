const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const TARGET_ADMIN_HASH = "4a9ca4596692e94f9d2912b06a0d007564a22ee750339a6021c2392149b25d6d";

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

test('Verifikasi Keamanan Password Admin (SHA-256)', async (t) => {
  await t.test('Password admin yang benar cocok dengan hash', () => {
    assert.equal(sha256Hex('098765'), TARGET_ADMIN_HASH);
  });

  await t.test('Password yang salah ditolak oleh hash', () => {
    assert.notEqual(sha256Hex('admin'), TARGET_ADMIN_HASH);
    assert.notEqual(sha256Hex('123456'), TARGET_ADMIN_HASH);
    assert.notEqual(sha256Hex(''), TARGET_ADMIN_HASH);
  });
});
