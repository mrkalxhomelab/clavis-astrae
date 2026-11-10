// Generates tests/vectors.json: letters built from a DETERMINISTIC test pad,
// so an independent implementation (tools/verify_vectors.py) can recompute them.
// Test pad: stream[d][i] = SHA-256("CLAVIS-TEST-PAD" || d || u32be(floor(i/32)))[i mod 32].
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { encryptLetter } from '../src/core/protocol.js';
import { armor } from '../src/core/codec.js';
import { toHex } from '../src/core/bytes.js';

export function testStream(d, size) {
  const out = new Uint8Array(size);
  for (let blk = 0; blk * 32 < size; blk++) {
    const h = createHash('sha256').update(Buffer.from('CLAVIS-TEST-PAD')).update(Buffer.from([d]))
      .update(Buffer.from([blk >>> 24, (blk >>> 16) & 255, (blk >>> 8) & 255, blk & 255])).digest();
    out.set(h.subarray(0, Math.min(32, size - blk * 32)), blk * 32);
  }
  return out;
}

const SIZE = 65536;
const messages = [
  { role: 'A', text: '' },
  { role: 'A', text: 'Secretum finis Africae.' },
  { role: 'A', text: 'Perché la città è già più bella così.' },
  { role: 'B', text: 'Stat rosa pristina nomine, nomina nuda tenemus. ☉🜂' },
  { role: 'A', text: 'x'.repeat(300) },
];

const pads = {
  A: { id: '0123456789abcdef', role: 'A', size: SIZE, streams: [testStream(0, SIZE), testStream(1, SIZE)], outOffset: 0, inUsed: [], sent: 0, received: 0 },
  B: { id: '0123456789abcdef', role: 'B', size: SIZE, streams: [testStream(0, SIZE), testStream(1, SIZE)], outOffset: 0, inUsed: [], sent: 0, received: 0 },
};

const vectors = [];
for (const m of messages) {
  const r = await encryptLetter(pads[m.role], m.text, async () => {});
  vectors.push({ sender: m.role, plaintext: m.text, offset: r.offset, P: r.P, packet_hex: toHex(r.packet), armored: armor(r.packet) });
}
writeFileSync(new URL('../tests/vectors.json', import.meta.url), JSON.stringify({
  description: 'CLAVIS ASTRAE v1 test vectors. Pad: stream[d][i] = SHA-256("CLAVIS-TEST-PAD"||byte(d)||u32be(i div 32))[i mod 32], size 65536, padId 0123456789abcdef.',
  vectors,
}, null, 2) + '\n');
console.log(`wrote ${vectors.length} vectors`);
