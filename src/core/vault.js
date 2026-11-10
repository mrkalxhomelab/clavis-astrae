// Encryption at rest: Argon2id (RFC 9106) -> AES-256-GCM (Web Crypto).
// Argon2id comes from the vendored hash-wasm build (globalThis.hashwasm).

import { randomBytes, toB64, fromB64, utf8 } from './bytes.js';

export const KDF_DEFAULT = { alg: 'argon2id', m: 65536, t: 3, p: 1 };
export const AAD_VAULT = 'CLAVIS-ASTRAE-VAULT-v1';
export const AAD_TRADITIO = 'CLAVIS-ASTRAE-TRADITIO-v1';
export const MIN_PASSPHRASE = 12;

export class VaultError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function argon2id() {
  const hw = globalThis.hashwasm;
  if (!hw || typeof hw.argon2id !== 'function') throw new VaultError('kdf', 'Argon2id implementation not loaded');
  return hw.argon2id;
}

export async function deriveKey(passphrase, salt, kdf = KDF_DEFAULT) {
  if (kdf.alg !== 'argon2id') throw new VaultError('kdf', 'unsupported KDF');
  const raw = await argon2id()({
    password: utf8.encode(passphrase.normalize('NFC')),
    salt,
    parallelism: kdf.p,
    iterations: kdf.t,
    memorySize: kdf.m,
    hashLength: 32,
    outputType: 'binary',
  });
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  raw.fill(0);
  return key;
}

export async function seal(key, plainBytes, aad) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8.encode(aad), tagLength: 128 }, key, plainBytes));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function open(key, box, aad) {
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(box.iv), additionalData: utf8.encode(aad), tagLength: 128 },
      key, fromB64(box.ct)));
  } catch {
    throw new VaultError('badpass', 'wrong passphrase or damaged data');
  }
}

// --- state (de)serialisation ---
export function serializeState(state) {
  return utf8.encode(JSON.stringify({
    v: 1,
    settings: state.settings,
    letters: state.letters,
    pads: state.pads.map(serializePad),
  }));
}

export function serializePad(p) {
  return {
    id: p.id, label: p.label, role: p.role, size: p.size,
    streams: [toB64(p.streams[0]), toB64(p.streams[1])],
    outOffset: p.outOffset, inUsed: p.inUsed, sent: p.sent, received: p.received,
    createdAt: p.createdAt, delivered: p.delivered, locked: p.locked,
  };
}

export function deserializePad(o) {
  const p = {
    ...o,
    streams: [fromB64(o.streams[0]), fromB64(o.streams[1])],
    inUsed: (o.inUsed || []).map(([s, e]) => [s, e]),
  };
  validatePad(p);
  return p;
}

export function validatePad(p) {
  const bad = (m) => { throw new VaultError('damaged', `damaged key: ${m}`); };
  if (!/^[0-9a-f]{16}$/.test(p.id)) bad('id');
  if (p.role !== 'A' && p.role !== 'B') bad('role');
  if (![65536, 262144, 1048576].includes(p.size)) bad('size');
  if (p.streams.length !== 2 || p.streams[0].length !== p.size || p.streams[1].length !== p.size) bad('length');
  if (!Number.isInteger(p.outOffset) || p.outOffset < 0 || p.outOffset > p.size) bad('offset');
  for (const r of p.inUsed) if (!(r[0] >= 0 && r[1] > r[0] && r[1] <= p.size)) bad('ranges');
}

export function deserializeState(bytes) {
  const o = JSON.parse(utf8.decode(bytes));
  if (o.v !== 1) throw new VaultError('version', 'unsupported vault version');
  return {
    settings: { lockMinutes: 5, keepTranscripts: true, ...(o.settings || {}) },
    letters: o.letters || [],
    pads: o.pads.map(deserializePad),
  };
}

export function emptyState() {
  return { settings: { lockMinutes: 5, keepTranscripts: true }, letters: [], pads: [] };
}

// A sealed vault record (what is stored / backed up).
export async function sealRecord(key, salt, kdf, state, gen) {
  const box = await seal(key, serializeState(state), AAD_VAULT);
  return { type: 'clavis-arca', v: 1, kdf: { ...kdf, salt: toB64(salt) }, gen, ...box };
}

export async function openRecord(record, passphrase) {
  if (record.type !== 'clavis-arca' || record.v !== 1) throw new VaultError('format', 'not a Clavis Astrae vault');
  const salt = fromB64(record.kdf.salt);
  const key = await deriveKey(passphrase, salt, record.kdf);
  const state = deserializeState(await open(key, record, AAD_VAULT));
  return { key, salt, kdf: { alg: record.kdf.alg, m: record.kdf.m, t: record.kdf.t, p: record.kdf.p }, state };
}
