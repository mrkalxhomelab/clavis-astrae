// Passphrase generator: words drawn uniformly at random from WORDS.
// Randomness: the device's CSPRNG (crypto.getRandomValues). Optionally the user
// adds physical randomness (dice): both are mixed with HMAC-SHA-256, so the
// result is unpredictable as long as EITHER source is good.

import { WORDS } from './wordlist.js';
import { randomBytes, concat, u32be, utf8 } from './bytes.js';

export const DEFAULT_WORDS = 6;
export const bitsPerWord = () => Math.log2(WORDS.length);
// Words are drawn without repetition: log2(N) + log2(N-1) + … (n terms).
export const entropyBits = (n) => { let b = 0; for (let i = 0; i < n; i++) b += Math.log2(WORDS.length - i); return b; };
// Dice rolls (d6) needed for the dice alone to carry the full strength.
export const diceForFull = (n) => Math.ceil(entropyBits(n) / Math.log2(6));

export function parseDice(s) {
  const d = String(s || '').replace(/[\s,;-]/g, '');
  if (!/^[1-6]*$/.test(d)) throw new Error('dice rolls must be digits 1 to 6');
  return d;
}

async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, msg));
}

// Returns { words, phrase, bits, diceUsed }.
export async function generatePassphrase({ count = DEFAULT_WORDS, dice = '' } = {}) {
  if (!Number.isInteger(count) || count < 4 || count > 12) throw new Error('between 4 and 12 words');
  const rolls = parseDice(dice);
  const device = randomBytes(32);
  // seed = HMAC(device, "CLAVIS-VERBA-v1" || dice)  (an extractor keyed by device randomness)
  const seed = await hmac(device, concat(utf8.encode('CLAVIS-VERBA-v1|'), utf8.encode(rolls)));
  device.fill(0);
  const N = WORDS.length;
  const limit = Math.floor(0x100000000 / N) * N; // rejection sampling: no modulo bias
  const words = [];
  let ctr = 0, buf = new Uint8Array(0), pos = 0;
  while (words.length < count) {
    if (pos + 4 > buf.length) { buf = await hmac(seed, u32be(ctr++)); pos = 0; }
    const x = ((buf[pos] << 24) >>> 0) + (buf[pos + 1] << 16) + (buf[pos + 2] << 8) + buf[pos + 3];
    pos += 4;
    if (x < limit && !words.includes(WORDS[x % N])) words.push(WORDS[x % N]);
  }
  seed.fill(0);
  return { words, phrase: words.join('-'), bits: entropyBits(count), diceUsed: rolls.length };
}
