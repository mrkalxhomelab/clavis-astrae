# CLAVIS ASTRAE — Threat model and audit checklist

CLAVIS ASTRAE is **not** claimed to be unbreakable. It has had no independent audit.

## Assets

1. Unused pad bytes (both streams).
2. Letters' plaintext.
3. The vault passphrase.
4. Integrity of the app code itself.

## Guarantees, by kind

| Kind | What is guaranteed |
|---|---|
| Mathematical | With a uniform pad used once, the ciphertext reveals nothing about the plaintext beyond the length bucket (Shannon). |
| Standard algorithms | HMAC-SHA-256 forgery is infeasible; AES-256-GCM and Argon2id protect stored pads, given a strong passphrase. |
| Implementation | No pad reuse (sequential offsets, commit-before-output, separate streams, single delivery); verify-before-decrypt; replay detection. Covered by the automated tests, not yet audited. |
| Residual risk | See the table below. |

## Threats

| Threat | Effect | Mitigation | Residual risk |
|---|---|---|---|
| Device stolen, locked | Attacker has the encrypted vault | AES-GCM + Argon2id; inactivity lock | Weak passphrase can be brute-forced offline |
| Device stolen, unlocked | Reads unused pad, sends letters as you | Inactivity lock (default 5 min) | High within the timeout window |
| Physical access, short | Copies vault file | Same as above | Same as above |
| Pad material stolen in transfer | Total loss of secrecy for that pad | In-person transfer only, 100-bit one-time code, single delivery | If the file *and* the code are captured |
| Malware on a device | Reads keys and plaintext | None possible from a web app | **Total compromise of that device.** OTP does not protect an infected endpoint |
| Tampered letter | Forged or modified content | HMAC verified before decrypting | None known |
| Interception of letters | Learns metadata | OTP; padding to 128-byte buckets | Length bucket, timing, offsets, pad id |
| Replay or duplicate | Same letter accepted twice | Consumed-range set | Lost if the vault is restored from an old backup (receiver side) |
| One vault lost | That person can no longer read or write | Encrypted backups | Restoring a backup requires the safe-offset procedure |
| One device compromised | Partner's letters to it are readable | Generate a new pad in person | Past letters, if the attacker also has old backups or vault copies |
| Human error: reusing a pad | Catastrophic: XOR of two plaintexts | App enforces offsets; never wraps; single delivery | Restoring backups carelessly; cloning a browser profile |
| Human error: weak passphrase | Vault brute-force | Minimum 12 characters; passphrase advice | User choice |
| Malicious hosting / GitHub account takeover | Modified app steals keys | Self-hosting, 2FA on GitHub, update prompt, version fingerprint | Real. Browsers can install a new service worker when the app is closed. Inherent to web apps |
| Tabularium files on Drive | Offline guessing of the document passphrase | scrypt 2^18 per guess; minimum 12 characters | Weak passphrase; file sizes and upload times visible to Google |
| Sealed Google Docs (Tabula) | Someone with your Google account opens the docs | Content is only signs (age inside); new document created, so history holds no plaintext | The original's history until you delete it and empty the bin; title (unless hidden), size, edit times |
| Chrome extension | Has a Google token for its own Drive files | Scope `drive.file` only; passphrase never typed into Google pages | Malware or a malicious extension in the same browser |
| Browser storage eviction | Loss of the vault | Install to Home Screen, keep backups | iOS Safari policies may change |

## Secure deletion

Consumed pad bytes are overwritten with zeros inside the vault, and the vault is re-encrypted and saved. On SSD and flash storage, earlier encrypted copies can remain physically until the hardware reuses those blocks. A web page cannot force their erasure. Those copies are still protected by the vault passphrase.

## Independent audit checklist

- [ ] Pad bytes come only from `crypto.getRandomValues`; check chunking (65536-byte limit) and that no other source is mixed in.
- [ ] For every sent letter, `[o, o+T)` ranges are disjoint, strictly increasing and never exceed S.
- [ ] State is persisted before ciphertext is returned (`commit` precedes return in `encryptLetter`).
- [ ] MAC key and OTP key ranges are disjoint; no pad byte is used for two purposes.
- [ ] HMAC input is exactly `H || C`; the header is fully authenticated; the tag is not truncated.
- [ ] The tag is verified with `subtle.verify` before any XOR for display.
- [ ] Failed verification causes no state change.
- [ ] Direction check rejects reflected letters.
- [ ] Replay check uses range overlap, not offset equality.
- [ ] Padding bytes are checked to be zero; UTF-8 decoding is fatal.
- [ ] Glyph codec: exact length recovery, zero padding bits enforced, presentation selectors removed, unknown characters rejected.
- [ ] Argon2id parameters and salt handling; a new salt on each password change.
- [ ] AES-GCM: a new random IV on every save; AAD set and checked.
- [ ] Delivery file can be produced once; the creator's copy cannot be re-exported.
- [ ] Duplicate `padId` import rejected.
- [ ] No network requests at runtime (check the service worker and that there are no third-party URLs).
- [ ] No logging of keys or plaintext (`console` usage).
- [ ] Backup restore locks outgoing streams.
- [ ] Test vectors in `tests/vectors.json` reproduce with `tools/verify_vectors.py` (independent Python implementation).
- [ ] Vendored `vendor/argon2.umd.min.js` matches the published hash-wasm 4.13.0 release.
