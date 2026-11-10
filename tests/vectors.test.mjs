import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { testStream } from '../tools/make_vectors.mjs';
import { decryptLetter } from '../src/core/protocol.js';
import { dearmor } from '../src/core/codec.js';

// Fixed vectors (also verified by tools/verify_vectors.py, an independent Python implementation).
test('published test vectors decrypt to the expected plaintext', async () => {
  const { vectors } = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
  for (const v of vectors) {
    const recipient = { id: '0123456789abcdef', role: v.sender === 'A' ? 'B' : 'A', size: 65536,
      streams: [testStream(0, 65536), testStream(1, 65536)], outOffset: 0, inUsed: [], sent: 0, received: 0 };
    const packet = dearmor(v.armored);
    assert.equal(Buffer.from(packet).toString('hex'), v.packet_hex);
    const r = await decryptLetter([recipient], packet, async () => {});
    assert.equal(r.text, v.plaintext);
  }
});
