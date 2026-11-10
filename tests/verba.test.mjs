import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePassphrase, entropyBits, diceForFull, parseDice } from '../src/core/verba.js';
import { WORDS } from '../src/core/wordlist.js';

test('word list: size, letters only, no duplicates, no near-duplicates', () => {
  assert.ok(WORDS.length > 6000);
  assert.equal(new Set(WORDS).size, WORDS.length);
  for (const w of WORDS) assert.match(w, /^[a-z]{4,10}$/);
  const set = new Set(WORDS);
  for (const w of WORDS) for (let i = 0; i < w.length; i++) assert.ok(!set.has(w.slice(0, i) + w.slice(i + 1)), `${w} near-duplicate`);
});

test('six words carry about 75 bits; seven about 88', () => {
  assert.ok(entropyBits(6) > 75 && entropyBits(6) < 77);
  assert.ok(entropyBits(7) > 88);
  assert.equal(diceForFull(6), 30);
});

test('generation: right count, words from the list, not repeating across runs', async () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const r = await generatePassphrase({ count: 6 });
    assert.equal(r.words.length, 6);
    assert.equal(new Set(r.words).size, 6, 'no repeated word');
    for (const w of r.words) assert.ok(WORDS.includes(w));
    assert.ok(!seen.has(r.phrase)); seen.add(r.phrase);
  }
});

test('same dice rolls never give the same passphrase (device randomness is mixed in)', async () => {
  const dice = '123456'.repeat(5);
  const a = await generatePassphrase({ dice }), b = await generatePassphrase({ dice });
  assert.notEqual(a.phrase, b.phrase);
  assert.equal(a.diceUsed, 30);
  assert.throws(() => parseDice('1237'), /1 to 6/);
});

test('rough uniformity of the first word (chi-square on 16 buckets)', async () => {
  const buckets = new Array(16).fill(0); const n = 4000;
  for (let i = 0; i < n; i++) {
    const r = await generatePassphrase({ count: 4 });
    buckets[Math.floor((WORDS.indexOf(r.words[0]) / WORDS.length) * 16)]++;
  }
  const e = n / 16; const chi = buckets.reduce((s, o) => s + (o - e) ** 2 / e, 0);
  assert.ok(chi < 40, `chi-square ${chi}`); // 15 dof: p < 0.001 beyond ~37.7
});
