// Tabularium: personal document encryption in the standard age format
// (https://age-encryption.org/v1), passphrase recipient (scrypt) + ChaCha20-Poly1305 STREAM.
// Files stay decryptable with the official `age` / `rage` tools:
//   age -d file.pdf.age > file.pdf
//   age -d 3f9a1c2b7e4d.age | tar -x      (hidden-name files: a one-entry tar inside)
// This is computational security; the One-Time Pad is not used here (see docs/TABULARIUM.md).

import { Encrypter, Decrypter } from '../../vendor/age.bundle.js';
import { randomBytes, toHex, utf8 } from './bytes.js';

export const MIN_DOC_PASSPHRASE = 12;
export const SCRYPT_LOG_N = 18; // age default

export class TabulariumError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---------------------------------------------------------------- tar (POSIX ustar + pax)
const enc = (s) => utf8.encode(s);

function octal(n, width) {
  return n.toString(8).padStart(width - 1, '0') + '\0';
}

function header({ name, size, type = '0', mtime }) {
  const h = new Uint8Array(512);
  const put = (off, bytes) => h.set(bytes.subarray(0, Math.min(bytes.length, 512 - off)), off);
  put(0, enc(name).subarray(0, 100));
  put(100, enc('0000644\0'));
  put(108, enc('0000000\0'));
  put(116, enc('0000000\0'));
  put(124, enc(octal(size, 12)));
  put(136, enc(octal(mtime, 12)));
  put(148, enc('        '));
  h[156] = type.charCodeAt(0);
  put(257, enc('ustar\0'));
  put(263, enc('00'));
  let sum = 0;
  for (const b of h) sum += b;
  put(148, enc(sum.toString(8).padStart(6, '0') + '\0 '));
  return h;
}

function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  const bodyLen = enc(body).length;
  let len = bodyLen + 1;
  while (String(len).length + bodyLen !== len) len = String(len).length + bodyLen;
  return enc(len + body);
}

export const MARKER = 'clavis-astrae-tabularium-v1';

const pad512 = (n) => new Uint8Array((512 - (n % 512)) % 512);

// Builds the tar as a Blob (no copy of the file contents into memory).
export function tarBlob(name, fileBlob) {
  const mtime = Math.floor(Date.now() / 1000);
  const safe = name.replace(/[\\/]/g, '_') || 'documentum';
  const parts = [];
  const nameBytes = enc(safe);
  const ascii = /^[\x20-\x7e]*$/.test(safe);
  // The pax header always carries a marker, so a .tar the user sealed on purpose
  // is never mistaken for a hidden-name envelope when opened.
  const rec = new Uint8Array([...paxRecord('comment', MARKER), ...paxRecord('path', safe)]);
  parts.push(header({ name: 'PaxHeader', size: rec.length, type: 'x', mtime }), rec, pad512(rec.length));
  const fallback = ascii && nameBytes.length <= 100 ? safe : 'documentum' + (safe.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] || '');
  parts.push(header({ name: fallback, size: fileBlob.size, mtime }), fileBlob, pad512(fileBlob.size), new Uint8Array(1024));
  return new Blob(parts);
}

function readHeader(b) {
  if (b.length < 512) return null;
  if (String.fromCharCode(...b.subarray(257, 262)) !== 'ustar') return null;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : b[i];
  const field = (o, l) => new TextDecoder().decode(b.subarray(o, o + l)).replace(/\0.*$/s, '');
  if (parseInt(field(148, 8).trim(), 8) !== sum) return null;
  const size = parseInt(field(124, 12).trim() || '0', 8);
  if (!Number.isSafeInteger(size)) return null;
  return { name: field(0, 100), size, type: String.fromCharCode(b[156] || 48) };
}

// If blob is a hidden-name envelope written by tarBlob, return {name, file}.
export async function untarFirst(blob) {
  const bytes = async (a, z) => new Uint8Array(await blob.slice(a, z).arrayBuffer());
  const h0 = readHeader(await bytes(0, 512));
  if (!h0 || h0.type !== 'x' || h0.size > 65536) return null;
  let off = 512;
  const pax = new TextDecoder().decode(await bytes(off, off + h0.size));
  if (!pax.includes(` comment=${MARKER}\n`)) return null;
  const m = pax.match(/(?:^|\n)\d+ path=([^\n]*)\n/);
  off += h0.size + ((512 - (h0.size % 512)) % 512);
  const h = readHeader(await bytes(off, off + 512));
  if (!h) return null;
  off += 512;
  const name = m ? m[1] : h.name;
  if (h.type !== '0' && h.type !== '\0') return null;
  if (off + h.size > blob.size) return null;
  return { name: name.split('/').pop() || 'documentum', file: blob.slice(off, off + h.size) };
}

// ---------------------------------------------------------------- seal / open
export function checkDocPassphrase(p) {
  if (typeof p !== 'string' || [...p].length < MIN_DOC_PASSPHRASE) {
    throw new TabulariumError('weak', `the document passphrase must have at least ${MIN_DOC_PASSPHRASE} characters`);
  }
}

// file: a Blob/File with .name. Returns { blob, name } of the .age file.
export async function sealFile(file, passphrase, { hideName = false, logN = SCRYPT_LOG_N } = {}) {
  checkDocPassphrase(passphrase);
  const name = file.name || 'documentum';
  const payload = hideName ? tarBlob(name, file) : file;
  const e = new Encrypter();
  e.setScryptWorkFactor(logN);
  e.setPassphrase(passphrase.normalize('NFC'));
  const out = await e.encrypt(payload.stream());
  const blob = await new Response(out).blob();
  return { blob, name: hideName ? toHex(randomBytes(6)) + '.age' : name + '.age' };
}

export async function openFile(file, passphrase) {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const magic = new TextDecoder().decode(head);
  if (!magic.startsWith('age-encryption.org/v1\n')) {
    if (magic.startsWith('-----BEGIN AGE ENCRYPTED FILE-----')) throw new TabulariumError('armored', 'ASCII-armoured age files are not supported here; use the binary form');
    throw new TabulariumError('format', 'this is not an age-encrypted file');
  }
  const d = new Decrypter();
  d.addPassphrase(passphrase.normalize('NFC'));
  let plain;
  try {
    const stream = await d.decrypt(file.stream());
    plain = await new Response(stream).blob();
  } catch (e) {
    const m = String(e && e.message || e);
    if (/passphrase|identity|no identity|incorrect|unwrap|recipient|scrypt/i.test(m)) throw new TabulariumError('badpass', 'wrong passphrase, or the file was not sealed with a passphrase');
    throw new TabulariumError('damaged', 'the file is damaged or was altered');
  }
  const t = await untarFirst(plain);
  if (t) return { name: t.name, blob: t.file, hiddenName: true };
  const base = (file.name || 'documentum.age').replace(/\.age$/i, '') || 'documentum';
  return { name: base, blob: plain, hiddenName: false };
}

const TYPES = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', txt: 'text/plain', md: 'text/plain', csv: 'text/csv',
  json: 'application/json', html: 'text/plain', htm: 'text/plain', svg: 'text/plain',
};

// HTML and SVG are shown as plain text: a decrypted document must never run script.
export function mimeFor(name) {
  const ext = (name.match(/\.([A-Za-z0-9]+)$/)?.[1] || '').toLowerCase();
  return TYPES[ext] || 'application/octet-stream';
}
