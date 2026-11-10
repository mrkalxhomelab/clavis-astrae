// Glyph armour: bytes <-> 32-glyph alphabet (5 bits per glyph), plus CRC-32
// for transit-error detection. This layer gives NO security; see PROTOCOL.md §6.

import { concat, u32be, readU32be } from './bytes.js';

export const ALPHABET = [
  { g: '☉', name: 'Sol' }, { g: '☽', name: 'Luna' }, { g: '☿', name: 'Mercurius' },
  { g: '♀', name: 'Venus' }, { g: '♂', name: 'Mars' }, { g: '♃', name: 'Iuppiter' },
  { g: '♄', name: 'Saturnus' },
  { g: '♈', name: 'Aries' }, { g: '♉', name: 'Taurus' }, { g: '♊', name: 'Gemini' },
  { g: '♋', name: 'Cancer' }, { g: '♌', name: 'Leo' }, { g: '♍', name: 'Virgo' },
  { g: '♎', name: 'Libra' }, { g: '♏', name: 'Scorpius' }, { g: '♐', name: 'Sagittarius' },
  { g: '♑', name: 'Capricornus' }, { g: '♒', name: 'Aquarius' }, { g: '♓', name: 'Pisces' },
  { g: '🜁', name: 'Aer' }, { g: '🜂', name: 'Ignis' }, { g: '🜃', name: 'Terra' },
  { g: '🜄', name: 'Aqua' },
  { g: '☊', name: 'Caput Draconis' }, { g: '☋', name: 'Cauda Draconis' },
  { g: '☌', name: 'Coniunctio' }, { g: '☍', name: 'Oppositio' }, { g: '⚹', name: 'Sextilis' },
  { g: '🜍', name: 'Sulphur' }, { g: '🜔', name: 'Sal' }, { g: '🜚', name: 'Aurum' },
  { g: '🜛', name: 'Argentum' },
];

const GLYPHS = ALPHABET.map((a) => a.g);
const VALUE = new Map(GLYPHS.map((g, i) => [g.codePointAt(0), i]));
if (GLYPHS.length !== 32 || VALUE.size !== 32) throw new Error('alphabet must have 32 distinct glyphs');

export const BEGIN = 'INCIPIT EPISTULA';
export const END = 'EXPLICIT';

export class TransitError extends Error {}

// --- CRC-32 (IEEE, reflected, poly 0xEDB88320) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- 5-bit packing ---
export function bytesToValues(b) {
  const out = [];
  let acc = 0, bits = 0;
  for (const x of b) {
    acc = (acc << 8) | x; bits += 8;
    while (bits >= 5) { bits -= 5; out.push((acc >>> bits) & 31); }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31);
  return out;
}

export function valuesToBytes(v) {
  const n = Math.floor((v.length * 5) / 8);
  if (Math.ceil((n * 8) / 5) !== v.length) throw new TransitError('impossible glyph count');
  const out = new Uint8Array(n);
  let acc = 0, bits = 0, o = 0;
  for (const x of v) {
    acc = (acc << 5) | x; bits += 5;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >>> bits) & 255; }
    acc &= (1 << bits) - 1;
  }
  if (acc !== 0) throw new TransitError('non-zero padding bits');
  return out;
}

export function encodeGlyphs(bytes) {
  return bytesToValues(bytes).map((v) => GLYPHS[v]).join('');
}

export function decodeGlyphs(text) {
  const vals = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfe0e || cp === 0xfe0f || /\s/u.test(ch)) continue;
    const v = VALUE.get(cp);
    if (v === undefined) throw new TransitError(`unknown sign “${ch}”`);
    vals.push(v);
  }
  return valuesToBytes(vals);
}

// Split glyph string into groups of 5 (by code point).
export function groupGlyphs(glyphs, size = 5) {
  const arr = Array.from(glyphs);
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size).join(''));
  return out;
}

export function armor(packet, perLine = 6) {
  const wire = concat(packet, u32be(crc32(packet)));
  const groups = groupGlyphs(encodeGlyphs(wire));
  const lines = [];
  for (let i = 0; i < groups.length; i += perLine) lines.push(groups.slice(i, i + perLine).join(' '));
  return `${BEGIN}\n${lines.join('\n')}\n${END}`;
}

export function dearmor(text) {
  let body = text;
  const b = text.indexOf(BEGIN);
  if (b >= 0) body = body.slice(b + BEGIN.length);
  const e = body.indexOf(END);
  if (e >= 0) body = body.slice(0, e);
  const wire = decodeGlyphs(body);
  if (wire.length < 5) throw new TransitError('too short');
  const packet = wire.subarray(0, wire.length - 4);
  if (crc32(packet) !== readU32be(wire, wire.length - 4)) throw new TransitError('checksum mismatch');
  return packet.slice();
}
