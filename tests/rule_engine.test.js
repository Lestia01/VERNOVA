const test = require('node:test');
const assert = require('node:assert/strict');

function parseRuleCmd(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  const has = (...ws) => ws.some(w => t.includes(w));
  let action = null;
  const armHit = /mode\s*arm|arm\s*mode|ke\s*arm/.test(t);
  const servoHit = /mode\s*servo|servo\s*mode|ke\s*servo/.test(t);
  if (armHit) action = { type: 'mode', arg: 'Arm' };
  else if (servoHit) action = { type: 'mode', arg: 'Servo' };
  else if (has('export pdf')) action = { type: 'export', arg: 'pdf' };
  else if (has('export excel', 'export xlsx')) action = { type: 'export', arg: 'xlsx' };
  else if (has('export csv')) action = { type: 'export', arg: 'csv' };
  else if (has('force timeout')) action = { type: 'timeout' };
  else if (has('jeda', 'pause')) action = { type: 'pause' };
  else if (has('lanjut', 'resume')) action = { type: 'resume' };
  if (!action) return null;

  const num = (t.match(/(\d+)/) || [])[1];
  if (!num) return null;
  const v = parseInt(num, 10);
  const maps = [
    ['kuning', 'kuning'], ['yellow', 'kuning'],
    ['biru', 'biru'], ['blue', 'biru'],
    ['merah', 'merah'], ['red', 'merah'],
    ['total', 'total'], ['semua', 'total'],
    ['error', 'error'], ['eror', 'error'], ['gagal', 'error']
  ];
  const found = [];
  maps.forEach(([w, m]) => { if (t.includes(w) && !found.includes(m)) found.push(m); });
  let conds = [];
  if (found.includes('total')) conds = [{ m: 'total', op: '>=', v }];
  else if (found.includes('error')) conds = [{ m: 'error', op: '>=', v }];
  else if (found.length >= 2) conds = [{ m: found[0], op: '>=', v }, { m: found[1], op: '>=', v, sum: true }];
  else if (found.length === 1) conds = [{ m: found[0], op: '>=', v }];
  else return null;
  return { conds, action };
}

function ruleFires(rule, metrics) {
  const vals = rule.conds.map(c => metrics[c.m] || 0);
  if (rule.conds.length === 2 && rule.conds[1].sum) return (vals[0] + vals[1]) >= rule.conds[0].v;
  return vals.every((x, i) => x >= rule.conds[i].v);
}

test('Mesin Aturan Automasi (Rule Engine)', async (t) => {
  await t.test('Parsing perintah aturan mode arm saat error tercapai', () => {
    const cmd = parseRuleCmd('buat aturan kalau error 50 maka mode arm');
    assert.ok(cmd);
    assert.equal(cmd.action.type, 'mode');
    assert.equal(cmd.action.arg, 'Arm');
    assert.equal(cmd.conds[0].m, 'error');
    assert.equal(cmd.conds[0].v, 50);
  });

  await t.test('Parsing perintah aturan export pdf saat total tercapai', () => {
    const cmd = parseRuleCmd('kalau total 100 maka export pdf');
    assert.ok(cmd);
    assert.equal(cmd.action.type, 'export');
    assert.equal(cmd.action.arg, 'pdf');
    assert.equal(cmd.conds[0].m, 'total');
    assert.equal(cmd.conds[0].v, 100);
  });

  await t.test('Evaluasi penembakan aturan (ruleFires)', () => {
    const rule = { conds: [{ m: 'total', op: '>=', v: 20 }] };
    assert.equal(ruleFires(rule, { total: 10 }), false);
    assert.equal(ruleFires(rule, { total: 20 }), true);
    assert.equal(ruleFires(rule, { total: 25 }), true);
  });
});
