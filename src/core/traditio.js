// In-person delivery of the partner's copy of a pad (PROTOCOL.md §7).

import { randomBytes, toB64, fromB64, utf8 } from './bytes.js';
import { KDF_DEFAULT, AAD_TRADITIO, deriveKey, seal, open, serializePad, deserializePad, VaultError } from './vault.js';

// Crockford base32 (no I L O U). 20 symbols x 5 bits = 100 bits.
export const CODE_SET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newTransferCode() {
  const r = randomBytes(20);
  let s = '';
  for (let i = 0; i < 20; i++) s += CODE_SET[r[i] & 31];
  return s.match(/.{4}/g).join('-');
}

export function normalizeCode(c) {
  return c.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

// Creates the encrypted delivery file for the partner (role B).
export async function makeTraditio(pad) {
  if (pad.role !== 'A') throw new VaultError('role', 'only the creator of a key can deliver it');
  if (pad.delivered) throw new VaultError('delivered', 'this key was already delivered once; forge a new one');
  if (pad.sent > 0 || pad.received > 0) throw new VaultError('used', 'this key has already been used');
  const code = newTransferCode();
  const salt = randomBytes(16);
  const key = await deriveKey(normalizeCode(code), salt, KDF_DEFAULT);
  const partner = { ...serializePad(pad), role: 'B', outOffset: 0, inUsed: [], sent: 0, received: 0, delivered: true, locked: false };
  const box = await seal(key, utf8.encode(JSON.stringify(partner)), AAD_TRADITIO);
  const file = { type: 'clavis-traditio', v: 1, padId: pad.id, kdf: { ...KDF_DEFAULT, salt: toB64(salt) }, ...box };
  return { file, code };
}

export async function openTraditio(file, code) {
  if (!file || file.type !== 'clavis-traditio' || file.v !== 1) throw new VaultError('format', 'not a Clavis Astrae key delivery file');
  const key = await deriveKey(normalizeCode(code), fromB64(file.kdf.salt), file.kdf);
  const plain = await open(key, file, AAD_TRADITIO);
  let obj;
  try { obj = JSON.parse(utf8.decode(plain)); } catch { throw new VaultError('damaged', 'damaged key file'); }
  const pad = deserializePad(obj);
  if (pad.role !== 'B' || pad.id !== file.padId) throw new VaultError('damaged', 'damaged key file');
  return pad;
}
