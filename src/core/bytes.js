// Byte helpers. No DOM. Works in browsers and Node 20+.

export function randomBytes(n) {
  // crypto.getRandomValues is limited to 65536 bytes per call.
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) {
    crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  }
  return out;
}

export function concat(...parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function u32be(n) {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new RangeError('u32 out of range');
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

export function readU32be(b, o) {
  return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
}

export function toHex(b) {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(h) {
  if (h.length % 2) throw new Error('bad hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    const v = parseInt(h.substr(i * 2, 2), 16);
    if (Number.isNaN(v)) throw new Error('bad hex');
    out[i] = v;
  }
  return out;
}

export function toB64(b) {
  let s = '';
  for (let i = 0; i < b.length; i += 32768) {
    s += String.fromCharCode.apply(null, b.subarray(i, i + 32768));
  }
  return btoa(s);
}

export function fromB64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function equalBytes(a, b) {
  // Not used for MAC checks (those use subtle.verify). For ids only.
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export const utf8 = {
  encode: (s) => new TextEncoder().encode(s),
  decode: (b) => new TextDecoder('utf-8', { fatal: true }).decode(b),
};
