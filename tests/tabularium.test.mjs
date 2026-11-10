import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sealFile, openFile, tarBlob, untarFirst, mimeFor } from '../src/core/tabularium.js';
import { randomBytes } from '../src/core/bytes.js';

const PASS = 'in principio erat verbum';
const FAST = { logN: 10 }; // faster scrypt for tests; real use is 18
const fileOf = (bytes, name) => new File([bytes], name);
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

// Independent tools: rage (Rust, via pyrage) and the system tar.
let haveRage = true;
try { execFileSync('python3', ['-c', 'import pyrage']); } catch { haveRage = false; }
const rage = (args, input) => execFileSync('python3', ['-c', `
import sys
from pyrage import passphrase
data = sys.stdin.buffer.read()
f = passphrase.decrypt if sys.argv[1] == 'd' else passphrase.encrypt
sys.stdout.buffer.write(f(data, sys.argv[2]))`, ...args], { input, maxBuffer: 1 << 28 });

test('seal and open, name visible', async () => {
  const data = randomBytes(5000);
  const { blob, name } = await sealFile(fileOf(data, 'Contratto affitto.pdf'), PASS, FAST);
  assert.equal(name, 'Contratto affitto.pdf.age');
  const r = await openFile(new File([blob], name), PASS);
  assert.equal(r.name, 'Contratto affitto.pdf');
  assert.equal(r.hiddenName, false);
  assert.deepEqual(await bytesOf(r.blob), data);
});

test('seal and open, name hidden (long Unicode name)', async () => {
  const data = randomBytes(3000);
  const long = 'Verbale dell’assemblea condominiale – città di Barking – ' + 'è'.repeat(80) + '.pdf';
  const { blob, name } = await sealFile(fileOf(data, long), PASS, { ...FAST, hideName: true });
  assert.match(name, /^[0-9a-f]{12}\.age$/);
  const r = await openFile(new File([blob], name), PASS);
  assert.equal(r.name, long);
  assert.equal(r.hiddenName, true);
  assert.deepEqual(await bytesOf(r.blob), data);
});

test('empty file', async () => {
  const { blob, name } = await sealFile(fileOf(new Uint8Array(0), 'vuoto.txt'), PASS, FAST);
  const r = await openFile(new File([blob], name), PASS);
  assert.equal(r.blob.size, 0);
});

test('a real .tar sealed on purpose is NOT unpacked', async () => {
  // build an ordinary tar with the system tool
  const dir = mkdtempSync(join(tmpdir(), 'tab-'));
  writeFileSync(join(dir, 'a.txt'), 'hello');
  execFileSync('tar', ['-cf', join(dir, 'x.tar'), '-C', dir, 'a.txt']);
  const tar = readFileSync(join(dir, 'x.tar'));
  const { blob, name } = await sealFile(fileOf(tar, 'archivio.tar'), PASS, FAST);
  const r = await openFile(new File([blob], name), PASS);
  assert.equal(r.name, 'archivio.tar');
  assert.equal(r.blob.size, tar.length);
});

test('wrong passphrase, altered file and non-age file are rejected', async () => {
  const { blob, name } = await sealFile(fileOf(randomBytes(2000), 'x.bin'), PASS, FAST);
  await assert.rejects(openFile(new File([blob], name), 'not the right passphrase'), (e) => e.code === 'badpass');
  const b = await bytesOf(blob);
  b[b.length - 20] ^= 1;
  await assert.rejects(openFile(new File([b], name), PASS), (e) => e.code === 'damaged');
  await assert.rejects(openFile(new File([randomBytes(100)], 'y.age'), PASS), (e) => e.code === 'format');
});

test('weak document passphrase refused', async () => {
  await assert.rejects(sealFile(fileOf(randomBytes(10), 'a'), 'short'), (e) => e.code === 'weak');
});

test('larger file (16 MiB) streams correctly', async () => {
  const data = new Uint8Array(16 << 20);
  for (let i = 0; i < data.length; i += 65536) crypto.getRandomValues(data.subarray(i, i + 65536));
  const { blob, name } = await sealFile(fileOf(data, 'big.bin'), PASS, FAST);
  const r = await openFile(new File([blob], name), PASS);
  assert.deepEqual(await bytesOf(r.blob), data);
});

test('interoperability with rage (independent Rust implementation of age), both ways', { skip: !haveRage }, async () => {
  const data = randomBytes(4000);
  const { blob } = await sealFile(fileOf(data, 'a.bin'), PASS); // default work factor 18
  assert.deepEqual(new Uint8Array(rage(['d', PASS], await bytesOf(blob))), data);
  const fromRage = rage(['e', PASS], data);
  const r = await openFile(new File([fromRage], 'b.bin.age'), PASS);
  assert.equal(r.name, 'b.bin');
  assert.deepEqual(await bytesOf(r.blob), data);
});

test('hidden-name files: `age -d | tar -x` restores the original name and bytes', { skip: !haveRage }, async () => {
  const data = randomBytes(1234);
  const { blob } = await sealFile(fileOf(data, 'Ricevuta è già.pdf'), PASS, { ...FAST, hideName: true });
  const tar = rage(['d', PASS], await bytesOf(blob));
  const dir = mkdtempSync(join(tmpdir(), 'tab-'));
  execFileSync('tar', ['-xf', '-', '-C', dir], { input: tar });
  assert.deepEqual(readdirSync(dir), ['Ricevuta è già.pdf']);
  assert.deepEqual(new Uint8Array(readFileSync(join(dir, 'Ricevuta è già.pdf'))), data);
});

test('tar envelope parser rejects junk and our envelope round-trips', async () => {
  assert.equal(await untarFirst(new Blob([randomBytes(2048)])), null);
  const t = tarBlob('nome.txt', new Blob(['ciao']));
  const r = await untarFirst(t);
  assert.equal(r.name, 'nome.txt');
  assert.equal(await r.file.text(), 'ciao');
});

test('HTML and SVG are never shown as active content', () => {
  assert.equal(mimeFor('x.html'), 'text/plain');
  assert.equal(mimeFor('x.svg'), 'text/plain');
  assert.equal(mimeFor('x.PDF'), 'application/pdf');
});
