// CLAVIS ASTRAE letter protocol v1. See docs/PROTOCOL.md §3–§5.
// Pure logic over pad objects; persistence is injected as `commit()`.

import { concat, u32be, readU32be, toHex, fromHex, utf8, randomBytes } from './bytes.js';

export const VERSION = 1;
export const MAGIC = [0x43, 0x41]; // "CA"
export const BLK = 128;
export const MAC_LEN = 32;
export const HDR_LEN = 20;
export const MAX_PLAINTEXT = 16384;
export const PAD_SIZES = [65536, 262144, 1048576];

export class ProtocolError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export const outDir = (pad) => (pad.role === 'A' ? 0 : 1);
export const inDir = (pad) => 1 - outDir(pad);

export function framedSize(len) {
  return Math.ceil((4 + len) / BLK) * BLK;
}

export function newPad({ size, label }) {
  if (!PAD_SIZES.includes(size)) throw new ProtocolError('size', 'unsupported pad size');
  return {
    id: toHex(randomBytes(8)),
    label: String(label || '').slice(0, 60),
    role: 'A',
    size,
    streams: [randomBytes(size), randomBytes(size)],
    outOffset: 0,
    inUsed: [],
    sent: 0,
    received: 0,
    createdAt: new Date().toISOString(),
    delivered: false,
    locked: false,
  };
}

export function remaining(pad) {
  return pad.size - pad.outOffset;
}

// Largest plaintext (bytes) that still fits in the outgoing stream.
export function capacity(pad) {
  const room = remaining(pad) - MAC_LEN;
  if (room < BLK) return 0;
  return Math.min(MAX_PLAINTEXT, Math.floor(room / BLK) * BLK - 4);
}

function header(dir, padId, offset, P) {
  return concat(new Uint8Array([MAGIC[0], MAGIC[1], VERSION, dir]), fromHex(padId), u32be(offset), u32be(P));
}

async function hmacKey(raw, usage) {
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

// Builds the packet H||C||tag. Mutates the pad (offset advance + zeroing),
// then awaits commit(result). The packet is returned only if commit() succeeds.
export async function encryptLetter(pad, text, commit) {
  if (pad.locked) throw new ProtocolError('locked', 'outgoing stream is locked until a safe offset is set');
  const u = utf8.encode(text);
  if (u.length > MAX_PLAINTEXT) throw new ProtocolError('toolong', 'letter too long');
  const P = framedSize(u.length);
  const T = MAC_LEN + P;
  const o = pad.outOffset;
  if (!Number.isInteger(o) || o < 0 || o + T > pad.size) {
    throw new ProtocolError('exhausted', 'not enough unused pad for this letter');
  }
  const dir = outDir(pad);
  const s = pad.streams[dir];
  const kmac = s.slice(o, o + MAC_LEN);
  const kotp = s.subarray(o + MAC_LEN, o + T);

  const F = new Uint8Array(P);
  F.set(u32be(u.length), 0);
  F.set(u, 4);
  const C = new Uint8Array(P);
  for (let i = 0; i < P; i++) C[i] = F[i] ^ kotp[i];
  F.fill(0);

  const H = header(dir, pad.id, o, P);
  const tag = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(kmac, 'sign'), concat(H, C)));
  kmac.fill(0);

  // Consume: advance and erase BEFORE output.
  pad.outOffset = o + T;
  s.fill(0, o, o + T);
  pad.sent += 1;
  const result = { packet: concat(H, C, tag), offset: o, P, number: pad.sent };
  await commit(result);
  return result;
}

export function parseHeader(packet) {
  if (packet.length < HDR_LEN + BLK + MAC_LEN) throw new ProtocolError('format', 'letter too short');
  if (packet[0] !== MAGIC[0] || packet[1] !== MAGIC[1]) throw new ProtocolError('format', 'not a Clavis Astrae letter');
  if (packet[2] !== VERSION) throw new ProtocolError('version', `unsupported version ${packet[2]}`);
  const dir = packet[3];
  if (dir !== 0 && dir !== 1) throw new ProtocolError('format', 'bad direction');
  const padId = toHex(packet.subarray(4, 12));
  const offset = readU32be(packet, 12);
  const P = readU32be(packet, 16);
  if (P === 0 || P % BLK !== 0) throw new ProtocolError('format', 'bad length');
  if (packet.length !== HDR_LEN + P + MAC_LEN) throw new ProtocolError('format', 'length mismatch');
  return { dir, padId, offset, P };
}

export function overlaps(ranges, a, b) {
  return ranges.some(([s, e]) => a < e && s < b);
}

// Verifies then decrypts. No state change unless the seal is valid.
export async function decryptLetter(pads, packet, commit) {
  const h = parseHeader(packet);
  const pad = pads.find((p) => p.id === h.padId);
  if (!pad) throw new ProtocolError('unknownpad', 'no key with this identifier in your vault');
  if (h.dir !== inDir(pad)) throw new ProtocolError('direction', 'this letter was written with your own outgoing stream');
  const T = MAC_LEN + h.P;
  if (h.offset + T > pad.size) throw new ProtocolError('format', 'offset outside the pad');
  if (overlaps(pad.inUsed, h.offset, h.offset + T)) throw new ProtocolError('replay', 'this part of the key was already used: letter already read or replayed');

  const s = pad.streams[h.dir];
  const H = packet.subarray(0, HDR_LEN);
  const C = packet.subarray(HDR_LEN, HDR_LEN + h.P);
  const tag = packet.subarray(HDR_LEN + h.P);
  const kmac = s.slice(h.offset, h.offset + MAC_LEN);
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(kmac, 'verify'), tag, concat(H, C));
  kmac.fill(0);
  if (!ok) throw new ProtocolError('seal', 'seal broken: the letter was altered or forged');

  const kotp = s.subarray(h.offset + MAC_LEN, h.offset + T);
  const F = new Uint8Array(h.P);
  for (let i = 0; i < h.P; i++) F[i] = C[i] ^ kotp[i];
  const len = readU32be(F, 0);
  if (len > h.P - 4) throw new ProtocolError('format', 'bad inner length');
  for (let i = 4 + len; i < h.P; i++) if (F[i] !== 0) throw new ProtocolError('format', 'bad padding');
  let text;
  try { text = utf8.decode(F.subarray(4, 4 + len)); } finally { F.fill(0); }

  pad.inUsed.push([h.offset, h.offset + T]);
  pad.inUsed.sort((x, y) => x[0] - y[0]);
  s.fill(0, h.offset, h.offset + T);
  pad.received += 1;
  const result = { pad, text, offset: h.offset, P: h.P, number: pad.received };
  await commit(result);
  return result;
}

// Highest end of incoming ranges: the partner's next safe outgoing offset.
export function nextSafeOffsetForPartner(pad) {
  return pad.inUsed.reduce((m, [, e]) => Math.max(m, e), 0);
}
