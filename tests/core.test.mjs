import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairOfDevices, PASS_A } from './helpers.mjs';
import { Session } from '../src/core/session.js';
import { MemoryStore } from '../src/core/store.js';
import { armor, dearmor, encodeGlyphs, decodeGlyphs, ALPHABET, TransitError, BEGIN, END } from '../src/core/codec.js';
import { MAX_PLAINTEXT, framedSize } from '../src/core/protocol.js';
import { randomBytes } from '../src/core/bytes.js';

const code = (e) => e.code;

test('short message round trip', async () => {
  const { alice, bob, padId } = await pairOfDevices();
  const { armored } = await alice.encrypt(padId, 'Venite ad completorium.');
  assert.match(armored, /^INCIPIT EPISTULA\n/);
  const r = await bob.decrypt(armored);
  assert.equal(r.text, 'Venite ad completorium.');
});

test('accents, Italian and Unicode symbols', async () => {
  const { alice, bob, padId } = await pairOfDevices();
  for (const m of ['Perché è già là? Città, più, così.', 'Ünïcödé ∑ ☉ 🜂 中文 العربية 👁️‍🗨️ 🌹']) {
    const { armored } = await alice.encrypt(padId, m);
    assert.equal((await bob.decrypt(armored)).text, m);
  }
});

test('empty message', async () => {
  const { alice, bob, padId } = await pairOfDevices();
  const { armored } = await alice.encrypt(padId, '');
  assert.equal((await bob.decrypt(armored)).text, '');
});

test('long message at the maximum size; over the maximum is refused', async () => {
  const { alice, bob, padId } = await pairOfDevices();
  const m = 'à'.repeat(MAX_PLAINTEXT / 2); // 2 bytes each
  const { armored } = await alice.encrypt(padId, m);
  assert.equal((await bob.decrypt(armored)).text, m);
  await assert.rejects(alice.encrypt(padId, m + 'x'), (e) => code(e) === 'toolong');
});

test('both directions, in any order, and concurrently', async () => {
  const { alice, bob, padId } = await pairOfDevices();
  const [a1, b1] = await Promise.all([alice.encrypt(padId, 'from A'), bob.encrypt(padId, 'from B')]);
  const a2 = await alice.encrypt(padId, 'second from A');
  assert.equal((await bob.decrypt(a2.armored)).text, 'second from A'); // out of order
  assert.equal((await bob.decrypt(a1.armored)).text, 'from A');
  assert.equal((await alice.decrypt(b1.armored)).text, 'from B');
  // A and B used disjoint streams, so offsets may coincide without reuse:
  assert.equal(a1.letter.offset, 0);
  assert.equal(b1.letter.offset, 0);
  assert.notEqual(a1.pad.outDir, b1.pad.outDir);
});

test('same text with two different pads gives different letters', async () => {
  const { alice, padId } = await pairOfDevices();
  const p2 = await alice.forgePad(65536, 'Altera');
  const x = await alice.encrypt(padId, 'idem');
  const y = await alice.encrypt(p2.id, 'idem');
  assert.notEqual(x.armored, y.armored);
});

test('pad bytes are never reused: offsets strictly increase and consumed bytes are zeroed', async () => {
  const { alice, padId } = await pairOfDevices();
  let last = -1, end = 0;
  for (let i = 0; i < 20; i++) {
    const r = await alice.encrypt(padId, 'x'.repeat(i * 13));
    assert.ok(r.letter.offset >= end && r.letter.offset > last);
    last = r.letter.offset; end = r.letter.offset + 32 + r.letter.P;
  }
  const pad = alice.state.pads[0];
  assert.ok(pad.streams[0].subarray(0, end).every((b) => b === 0));
});

test('insufficient pad is refused, never wraps', async () => {
  const { alice, padId } = await pairOfDevices();
  const big = 'q'.repeat(MAX_PLAINTEXT - 4);
  let n = 0;
  await assert.rejects((async () => { for (;;) { await alice.encrypt(padId, big); n++; } })(),
    (e) => code(e) === 'exhausted');
  assert.equal(n, Math.floor(65536 / (32 + framedSize(big.length))));
});

test('replay / duplicate letter is rejected', async () => {
  const { alice, bob, padId } = await pairOfDevices();
  const { armored } = await alice.encrypt(padId, 'semel');
  await bob.decrypt(armored);
  await assert.rejects(bob.decrypt(armored), (e) => code(e) === 'replay');
});

test('a letter reflected back to its sender is rejected', async () => {
  const { alice, padId } = await pairOfDevices();
  const { armored } = await alice.encrypt(padId, 'speculum');
  await assert.rejects(alice.decrypt(armored), (e) => code(e) === 'direction');
});

test('altered ciphertext, header or seal is rejected and changes no state', async () => {
  const { alice, bob, padId } = await pairOfDevices();
  const { armored } = await alice.encrypt(padId, 'integra');
  const packet = dearmor(armored);
  for (const pos of [3 + 5, 20, 20 + 64, packet.length - 1]) { // header field, ciphertext, ciphertext, tag
    const bad = packet.slice();
    bad[pos] ^= 1;
    const before = structuredClone(bob.state.pads[0].inUsed);
    await assert.rejects(bob.decrypt(armor(bad)), (e) => ['seal', 'direction', 'unknownpad', 'format'].includes(code(e)));
    assert.deepEqual(bob.state.pads[0].inUsed, before);
  }
  assert.equal((await bob.decrypt(armored)).text, 'integra'); // original still readable
});

test('corruption in transit is detected by the checksum', async () => {
  const { alice, bob, padId } = await pairOfDevices();
  const { armored } = await alice.encrypt(padId, 'via');
  const glyphs = Array.from(armored);
  const i = glyphs.findIndex((c, k) => k > BEGIN.length + 10 && ALPHABET.some((a) => a.g === c));
  glyphs[i] = glyphs[i] === '☉' ? '☽' : '☉';
  await assert.rejects(bob.decrypt(glyphs.join('')), (e) => e instanceof TransitError);
});

test('messenger noise is tolerated: emoji selectors, extra spaces, chat text around', async () => {
  const { alice, bob, padId } = await pairOfDevices();
  const { armored } = await alice.encrypt(padId, 'tolerantia');
  const noisy = 'Here it is:\n' + Array.from(armored).map((c) => (ALPHABET.some((a) => a.g === c) ? c + '️ ' : c)).join('') + '\nbye';
  assert.equal((await bob.decrypt(noisy)).text, 'tolerantia');
});

test('glyph codec: exact length for all sizes 0..300 and alphabet is 32 distinct', () => {
  assert.equal(new Set(ALPHABET.map((a) => a.g)).size, 32);
  for (let n = 0; n <= 300; n++) {
    const b = randomBytes(n);
    assert.deepEqual(decodeGlyphs(encodeGlyphs(b)), b);
  }
  assert.throws(() => decodeGlyphs('☉'), TransitError); // impossible count
  assert.throws(() => decodeGlyphs('☉🜛'), TransitError); // non-zero padding bits
  assert.throws(() => decodeGlyphs('☉X☉☉'), TransitError); // unknown sign
});

test('key delivery: wrong code and damaged file are rejected; key can be delivered only once', async () => {
  const alice = new Session(new MemoryStore());
  await alice.create(PASS_A);
  const pad = await alice.forgePad(65536, 'Bibliotheca');
  const { file, code: c } = await alice.deliverPad(pad.id);
  await assert.rejects(alice.deliverPad(pad.id), (e) => code(e) === 'delivered');
  const bob = new Session(new MemoryStore());
  await bob.create('aedificium septentrionale');
  await assert.rejects(bob.receivePad(file, 'AAAA-AAAA-AAAA-AAAA-AAAA'), (e) => code(e) === 'badpass');
  const dam = structuredClone(file);
  dam.ct = dam.ct.slice(0, 40) + (dam.ct[40] === 'A' ? 'B' : 'A') + dam.ct.slice(41);
  await assert.rejects(bob.receivePad(dam, c), (e) => code(e) === 'badpass');
  await assert.rejects(bob.receivePad({ type: 'other' }, c), (e) => code(e) === 'format');
  await bob.receivePad(file, c.toLowerCase().replace(/-/g, ' ')); // code typed loosely
  await assert.rejects(bob.receivePad(file, c), (e) => code(e) === 'duplicate');
});

test('vault: wrong passphrase rejected; reopen keeps state', async () => {
  const { alice, padId } = await pairOfDevices();
  await alice.encrypt(padId, 'memoria');
  const store = alice.store;
  const again = new Session(store);
  await assert.rejects(again.unlock('not the passphrase!'), (e) => code(e) === 'badpass');
  await again.unlock(PASS_A);
  assert.equal(again.pads()[0].sent, 1);
  assert.equal(again.letters()[0].text, 'memoria');
});

test('weak passphrase refused', async () => {
  const s = new Session(new MemoryStore());
  await assert.rejects(s.create('short'), (e) => code(e) === 'weak');
});

test('sudden interruption: if saving fails no letter is returned, so no pad byte is ever exposed twice', async () => {
  const { alice, bob, padId } = await pairOfDevices();
  alice.store.failNext = true;
  await assert.rejects(alice.encrypt(padId, 'interrupta'), (e) => code(e) === 'io');
  // App "restarts": reload from storage. Nothing was output, so nothing leaked.
  const restarted = new Session(alice.store);
  await restarted.unlock(PASS_A);
  const r = await restarted.encrypt(padId, 'post');
  assert.equal((await bob.decrypt(r.armored)).text, 'post');
  // The in-memory session that failed never reuses its offset either:
  const r2 = await alice.encrypt(padId, 'x').catch((e) => e);
  assert.equal(r2.code, 'conflict'); // stale window cannot overwrite newer state
});

test('two windows on the same device cannot both write (generation check)', async () => {
  const { alice, padId } = await pairOfDevices();
  const w2 = new Session(alice.store);
  await w2.unlock(PASS_A);
  await alice.encrypt(padId, 'prima');
  await assert.rejects(w2.encrypt(padId, 'secunda'), (e) => code(e) === 'conflict');
});

test('backup export, restore locks sending until safe offset is set', async () => {
  const { alice, bob, padId } = await pairOfDevices();
  const backup = await alice.backup();
  const a1 = await alice.encrypt(padId, 'post backup');
  await bob.decrypt(a1.armored);
  // Alice loses her device and restores the older backup on a new one.
  const fresh = new Session(new MemoryStore());
  await fresh.restore(structuredClone(backup), PASS_A);
  await assert.rejects(fresh.encrypt(padId, 'x'), (e) => code(e) === 'locked');
  const safe = bob.pads()[0].nextSafeForPartner;
  assert.ok(safe > 0);
  await fresh.setSafeOffset(padId, safe);
  const a2 = await fresh.encrypt(padId, 'after restore');
  assert.ok(a2.letter.offset >= safe);
  assert.equal((await bob.decrypt(a2.armored)).text, 'after restore');
});

test('changing passphrase; disabling transcripts erases stored plaintext', async () => {
  const { alice, padId } = await pairOfDevices();
  await alice.encrypt(padId, 'secretum');
  await alice.changePassphrase('in principio erat verbum');
  const s = new Session(alice.store);
  await assert.rejects(s.unlock(PASS_A));
  await s.unlock('in principio erat verbum');
  await s.updateSettings({ keepTranscripts: false });
  assert.equal(s.letters()[0].text, null);
});

test('destroyed key cannot be used', async () => {
  const { alice, bob, padId } = await pairOfDevices();
  const { armored } = await alice.encrypt(padId, 'ultima');
  await bob.destroyPad(padId);
  await assert.rejects(bob.decrypt(armored), (e) => code(e) === 'unknownpad');
});
