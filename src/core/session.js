// Session: the unlocked vault and every state-changing operation.
// The UI talks only to this class; it never touches pad bytes.

import { randomBytes, toHex } from './bytes.js';
import { armor, dearmor } from './codec.js';
import { newPad, encryptLetter, decryptLetter, capacity, remaining, outDir, inDir,
  nextSafeOffsetForPartner, ProtocolError } from './protocol.js';
import { KDF_DEFAULT, MIN_PASSPHRASE, deriveKey, sealRecord, openRecord, emptyState, VaultError } from './vault.js';
import { makeTraditio, openTraditio } from './traditio.js';

export class Session {
  constructor(store) {
    this.store = store;
    this.key = null; this.salt = null; this.kdf = null; this.state = null; this.gen = 0;
  }

  get unlocked() { return !!this.key; }

  async exists() { return !!(await this.store.load()); }

  static checkPassphrase(p) {
    if (typeof p !== 'string' || [...p].length < MIN_PASSPHRASE) {
      throw new VaultError('weak', `the passphrase must have at least ${MIN_PASSPHRASE} characters`);
    }
  }

  async create(passphrase) {
    Session.checkPassphrase(passphrase);
    if (await this.exists()) throw new VaultError('exists', 'a vault already exists on this device');
    this.salt = randomBytes(16);
    this.kdf = { ...KDF_DEFAULT };
    this.key = await deriveKey(passphrase, this.salt, this.kdf);
    this.state = emptyState();
    this.gen = 0;
    await this.save();
  }

  async unlock(passphrase) {
    const rec = await this.store.load();
    if (!rec) throw new VaultError('none', 'no vault on this device');
    const o = await openRecord(rec, passphrase);
    Object.assign(this, { key: o.key, salt: o.salt, kdf: o.kdf, state: o.state, gen: rec.gen });
  }

  lock() {
    if (this.state) for (const p of this.state.pads) { p.streams[0].fill(0); p.streams[1].fill(0); }
    this.key = null; this.state = null; this.salt = null;
  }

  need() { if (!this.unlocked) throw new VaultError('locked', 'the vault is locked'); }

  async save(opts) {
    const rec = await sealRecord(this.key, this.salt, this.kdf, this.state, this.gen + 1);
    await this.store.save(rec, this.gen, opts);
    this.gen += 1;
  }

  pad(id) {
    const p = this.state.pads.find((x) => x.id === id);
    if (!p) throw new ProtocolError('unknownpad', 'unknown key');
    return p;
  }

  padInfo(p) {
    return {
      id: p.id, label: p.label, role: p.role, size: p.size, sent: p.sent, received: p.received,
      createdAt: p.createdAt, delivered: p.delivered, locked: p.locked,
      outDir: outDir(p), inDir: inDir(p),
      remaining: remaining(p), capacity: capacity(p),
      usedFraction: p.outOffset / p.size,
      nextSafeForPartner: nextSafeOffsetForPartner(p),
      outOffset: p.outOffset,
    };
  }

  pads() { this.need(); return this.state.pads.map((p) => this.padInfo(p)); }

  async forgePad(size, label) {
    this.need();
    const p = newPad({ size, label });
    this.state.pads.push(p);
    await this.save();
    return this.padInfo(p);
  }

  // Produces the one-time delivery file. The pad is marked delivered and saved
  // BEFORE the file is returned, so it can never be produced twice.
  async deliverPad(id) {
    this.need();
    const p = this.pad(id);
    const { file, code } = await makeTraditio(p);
    p.delivered = true;
    await this.save();
    return { file, code };
  }

  async receivePad(file, code) {
    this.need();
    const p = await openTraditio(file, code);
    if (this.state.pads.some((x) => x.id === p.id)) {
      throw new VaultError('duplicate', 'this key is already in your vault');
    }
    this.state.pads.push(p);
    await this.save();
    return this.padInfo(p);
  }

  async destroyPad(id) {
    this.need();
    const p = this.pad(id);
    p.streams[0].fill(0); p.streams[1].fill(0);
    this.state.pads = this.state.pads.filter((x) => x.id !== id);
    await this.save();
  }

  logLetter(entry) {
    this.state.letters.unshift({ id: toHex(randomBytes(8)), at: new Date().toISOString(), ...entry });
  }

  async encrypt(id, text) {
    this.need();
    const p = this.pad(id);
    let armored;
    await encryptLetter(p, text, async (r) => {
      armored = armor(r.packet);
      this.logLetter({
        padId: p.id, padLabel: p.label, dir: 'out', number: r.number, offset: r.offset, P: r.P,
        text: this.state.settings.keepTranscripts ? text : null, armored,
      });
      await this.save();
    });
    return { armored, letter: this.state.letters[0], pad: this.padInfo(p) };
  }

  async decrypt(armoredText) {
    this.need();
    const packet = dearmor(armoredText);
    const r = await decryptLetter(this.state.pads, packet, async (res) => {
      this.logLetter({
        padId: res.pad.id, padLabel: res.pad.label, dir: 'in', number: res.number, offset: res.offset, P: res.P,
        text: this.state.settings.keepTranscripts ? res.text : null, armored: armoredText.trim(),
      });
      await this.save();
    });
    return { text: r.text, letter: this.state.letters[0], pad: this.padInfo(r.pad) };
  }

  letters() { this.need(); return this.state.letters; }

  async deleteLetter(id) {
    this.need();
    this.state.letters = this.state.letters.filter((l) => l.id !== id);
    await this.save();
  }

  settings() { this.need(); return { ...this.state.settings }; }

  async updateSettings(s) {
    this.need();
    const lm = Number(s.lockMinutes);
    if (s.lockMinutes !== undefined && !(lm >= 1 && lm <= 60)) throw new VaultError('settings', 'lock time must be 1–60 minutes');
    Object.assign(this.state.settings, s, s.lockMinutes !== undefined ? { lockMinutes: lm } : {});
    if (s.keepTranscripts === false) for (const l of this.state.letters) l.text = null;
    await this.save();
  }

  async changePassphrase(newPass) {
    this.need();
    Session.checkPassphrase(newPass);
    this.salt = randomBytes(16);
    this.kdf = { ...KDF_DEFAULT };
    this.key = await deriveKey(newPass, this.salt, this.kdf);
    await this.save();
  }

  // The backup is the sealed record itself (encrypted with the vault passphrase).
  async backup() {
    this.need();
    return await this.store.load();
  }

  // Restoring brings back old pad state: every outgoing stream is locked
  // until the partner reports a safe offset (PROTOCOL.md §8.3).
  async restore(record, passphrase) {
    const o = await openRecord(record, passphrase);
    for (const p of o.state.pads) p.locked = true;
    const cur = await this.store.load();
    Object.assign(this, { key: o.key, salt: o.salt, kdf: o.kdf, state: o.state, gen: cur ? cur.gen : 0 });
    await this.save({ force: true });
  }

  async setSafeOffset(id, n) {
    this.need();
    const p = this.pad(id);
    if (!Number.isInteger(n) || n < 0 || n > p.size) throw new ProtocolError('offset', 'invalid offset');
    const next = Math.max(p.outOffset, n);
    p.streams[outDir(p)].fill(0, 0, next);
    p.outOffset = next;
    p.locked = false;
    await this.save();
    return this.padInfo(p);
  }

  async wipeDevice() {
    this.lock();
    await this.store.clear();
  }
}
