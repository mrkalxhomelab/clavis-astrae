// Tabula: a sealed text written as astrological glyphs, to live inside a
// Google Doc (or anywhere text can go). Format (docs/TABULARIUM.md §Tabula):
//
//   INCIPIT TABULA
//   <glyph groups: 5-bit encoding of  ageFile || CRC32(ageFile)>
//   EXPLICIT
//
// ageFile is a standard age v1 file (passphrase/scrypt, ChaCha20-Poly1305)
// whose plaintext is UTF-8 JSON {"v":1,"title":…,"text":…}.

import { Encrypter, Decrypter } from '../../vendor/age.bundle.js';
import { armor, dearmor, BEGIN_TABULA } from './codec.js';
import { utf8 } from './bytes.js';
import { checkDocPassphrase, TabulariumError, SCRYPT_LOG_N } from './tabularium.js';

export const MAX_TABULA_TEXT = 400000; // bytes; keeps the Google Doc under ~700k characters

export function isTabula(s) {
  return typeof s === 'string' && s.includes(BEGIN_TABULA);
}

export async function sealText({ title = '', text }, passphrase, { logN = SCRYPT_LOG_N } = {}) {
  checkDocPassphrase(passphrase);
  const body = utf8.encode(JSON.stringify({ v: 1, title: String(title), text: String(text) }));
  if (body.length > MAX_TABULA_TEXT) throw new TabulariumError('toolong', 'this text is too long for a sealed document');
  const e = new Encrypter();
  e.setScryptWorkFactor(logN);
  e.setPassphrase(passphrase.normalize('NFC'));
  return armor(await e.encrypt(body), 8, BEGIN_TABULA);
}

// Throws TransitError (damaged signs), or TabulariumError badpass / damaged.
export async function openText(armored, passphrase) {
  const ageFile = dearmor(armored, BEGIN_TABULA);
  if (!new TextDecoder().decode(ageFile.subarray(0, 22)).startsWith('age-encryption.org/v1\n')) {
    throw new TabulariumError('format', 'not a sealed document');
  }
  const d = new Decrypter();
  d.addPassphrase(passphrase.normalize('NFC'));
  let plain;
  try {
    plain = await d.decrypt(ageFile, 'uint8array');
  } catch (e) {
    const m = String(e && e.message || e);
    if (/passphrase|identity|incorrect|unwrap|recipient|scrypt/i.test(m)) throw new TabulariumError('badpass', 'wrong passphrase');
    throw new TabulariumError('damaged', 'the sealed document was altered');
  }
  let o;
  try { o = JSON.parse(utf8.decode(plain)); } catch { throw new TabulariumError('damaged', 'unexpected content'); }
  if (o.v !== 1 || typeof o.text !== 'string') throw new TabulariumError('damaged', 'unexpected content');
  return { title: typeof o.title === 'string' ? o.title : '', text: o.text };
}
