import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { sealText, openText, isTabula } from '../src/core/tabula.js';
import { TransitError, ALPHABET } from '../src/core/codec.js';

const PASS = 'documenta mea secreta';
const FAST = { logN: 10 };
const TEXT = 'Verbale riunione 12/11\nPresenti: Marco, Vijay.\nÈ già tutto pronto — città, perché, più.\n☉ 中文 🌹';

test('seal and open a text, title kept inside', async () => {
  const a = await sealText({ title: 'Verbale novembre', text: TEXT }, PASS, FAST);
  assert.ok(isTabula(a));
  assert.ok(a.startsWith('INCIPIT TABULA\n') && a.endsWith('\nEXPLICIT'));
  assert.ok(!a.includes('Verbale') && !a.includes('Marco'), 'no plaintext leaks');
  const r = await openText(a, PASS);
  assert.equal(r.title, 'Verbale novembre');
  assert.equal(r.text, TEXT);
});

test('only alphabet signs between the markers', async () => {
  const a = await sealText({ text: 'x' }, PASS, FAST);
  const signs = new Set(ALPHABET.map((x) => x.g));
  const body = a.replace('INCIPIT TABULA', '').replace('EXPLICIT', '');
  for (const ch of body) assert.ok(signs.has(ch) || /\s/.test(ch), `unexpected ${ch}`);
});

test('survives what Google Docs and messengers do to text', async () => {
  const a = await sealText({ text: TEXT }, PASS, FAST);
  const mangled = 'Some header the user typed\n' +
    Array.from(a).map((c, i) => { const sign = ALPHABET.some((x) => x.g === c); return (c === ' ' ? ' ' : c) + (sign && i % 7 === 0 ? '️' : '') + (sign && i % 50 === 0 ? '​' : ''); }).join('').replace(/\n/g, '\r\n\n') + '\n\nfooter';
  assert.equal((await openText(mangled, PASS)).text, TEXT);
});

test('wrong passphrase, damaged signs, valid-checksum forgery', async () => {
  const a = await sealText({ text: TEXT }, PASS, FAST);
  await assert.rejects(openText(a, 'not the passphrase'), (e) => e.code === 'badpass');
  const chars = Array.from(a);
  const i = chars.findIndex((c, k) => k > 40 && ALPHABET.some((x) => x.g === c));
  chars[i] = chars[i] === '☉' ? '☽' : '☉';
  await assert.rejects(openText(chars.join(''), PASS), (e) => e instanceof TransitError);
  await assert.rejects(openText(a.replace('EXPLICIT', '').slice(0, -40), PASS), (e) => e instanceof TransitError);
});

test('a letter pasted where a document is expected is recognised', async () => {
  await assert.rejects(openText('INCIPIT EPISTULA\n☉☉☉☉\nEXPLICIT', PASS), (e) => e instanceof TransitError && /letter/.test(e.message));
});

test('independent check: Python decoder + rage decrypt the same Tabula', async () => {
  let ok = true;
  try { execFileSync('python3', ['-c', 'import pyrage']); } catch { ok = false; }
  if (!ok) return;
  const a = await sealText({ title: 'T', text: TEXT }, PASS); // full work factor 18
  const ageBytes = execFileSync('python3', ['tools/tabula_decode.py'], { input: a });
  const out = execFileSync('python3', ['-c', 'import sys;from pyrage import passphrase;sys.stdout.buffer.write(passphrase.decrypt(sys.stdin.buffer.read(), sys.argv[1]))', PASS], { input: ageBytes });
  assert.deepEqual(JSON.parse(out.toString('utf8')), { v: 1, title: 'T', text: TEXT });
});
