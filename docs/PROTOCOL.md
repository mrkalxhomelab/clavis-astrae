# CLAVIS ASTRAE — Protocol specification (v1)

Status: draft for independent review. Not audited.

This document is Phase 1 (architecture and protocol) and Phase 2 (correctness and risk review) of the project.

## 1. Primitives used

All primitives are standard. Nothing here is invented.

| Purpose | Primitive | Source |
|---|---|---|
| Message secrecy | One-Time Pad (XOR with uniformly random pad) | Shannon 1949 |
| Message authentication | HMAC-SHA-256, 32-byte one-time key | RFC 2104, FIPS 180-4 |
| Randomness | `crypto.getRandomValues` (browser CSPRNG, seeded by the OS) | W3C Web Crypto API |
| Password-based key derivation | Argon2id | RFC 9106 (implementation: hash-wasm 4.13.0) |
| Encryption at rest | AES-256-GCM, 96-bit random IV | NIST SP 800-38D (Web Crypto) |
| Transit-error detection (not security) | CRC-32 (IEEE 802.3 polynomial) | ISO-HDLC |
| Text transport | 5-bit encoding onto a fixed 32-glyph alphabet | this document, section 6 |

## 2. Entities

- **Clavis (pad bundle)**: created once on one device (the *creator*, role A) and handed to the *partner* (role B) in person.
  - `padId`: 8 random bytes.
  - `stream[0]`: S random bytes, used only for letters A→B.
  - `stream[1]`: S random bytes, used only for letters B→A.
  - S is 64 KiB, 256 KiB or 1 MiB.
- Each device keeps, per pad:
  - `outDir`: 0 for A, 1 for B. `inDir = 1 − outDir`.
  - `outOffset`: next unused byte of the outgoing stream. It only ever grows.
  - `inUsed`: list of byte ranges of the incoming stream already consumed by authenticated letters.
  - Consumed pad bytes are overwritten with zeros in the stored state.

Splitting the pad into two disjoint streams is what makes simultaneous sending by both people safe. A and B can never draw the same pad bytes.

## 3. Letter encryption (sender)

Inputs: plaintext string `m`, pad bundle, block size `BLK = 128`.

1. `u = UTF-8(m)`, `len = |u|`. Require `len ≤ 16384`.
2. Framed plaintext: `F = u32be(len) || u || 0x00…` padded with zeros to `P = ceil((4 + len) / BLK) · BLK` bytes. Only the bucket `P` is revealed to an observer, not the exact length.
3. `o = outOffset`, `T = 32 + P`. If `o + T > S`, refuse: the pad is exhausted (*clavis exhausta*). The app never wraps around and never reuses bytes.
4. `Kmac = stream[outDir][o .. o+32)`, `Kotp = stream[outDir][o+32 .. o+32+P)`. These ranges are disjoint, so the MAC key is never XOR material and vice versa.
5. `C = F ⊕ Kotp`.
6. Header `H` (20 bytes), big-endian:

   | Bytes | Field |
   |---|---|
   | 0–1 | magic `0x43 0x41` ("CA") |
   | 2 | version `0x01` |
   | 3 | direction `outDir` |
   | 4–11 | `padId` |
   | 12–15 | offset `o` (u32) |
   | 16–19 | `P` (u32) |

7. `tag = HMAC-SHA-256(Kmac, H || C)` (32 bytes, not truncated).
8. `packet = H || C || tag`. `wire = packet || u32be(CRC32(packet))`.
9. **Commit before output**: in memory set `outOffset = o + T` and zero `stream[outDir][o .. o+T)`. Persist the encrypted vault. Only if persisting succeeds is `wire` shown to the user. If the app dies before the write, nothing was disclosed and the bytes are still unused. If it dies after, at most one segment is wasted. In no case is a segment reused.

Overhead per letter: 20 + 32 + 4 = 56 bytes, plus padding.

## 4. Letter decryption (recipient)

1. Glyph text → bytes (section 6). Check CRC-32. A mismatch means the text was damaged in transit, and the user is asked to have it resent. This check gives no security; it only separates typing or transport errors from forgery.
2. Parse `H`. Check magic and version. Check `padId` is known. Check `direction == inDir` (rejects a letter reflected back to its own sender). Check `P > 0`, `P mod 128 = 0`, and `o + 32 + P ≤ S`.
3. Replay and duplicate check: if `[o, o+32+P)` overlaps any range in `inUsed`, reject (*iam lecta*, "already read").
4. Verify `tag` with Web Crypto `verify` (constant-time comparison). On failure, reject (*sigillum fractum*). No plaintext is computed for display, and no state changes. This prevents an attacker from burning the recipient's pad with forged letters.
5. Only after a valid tag: `F = C ⊕ Kotp`. Read `len`, require `len ≤ P − 4`, require all padding bytes to be zero, and decode UTF-8 in fatal mode.
6. Commit: add the range to `inUsed`, zero those pad bytes, persist. Then display.

## 5. Security argument (Phase 2)

### 5.1 Secrecy

- `Kotp` is uniform and independent of `F` and is used exactly once. Therefore `C` is uniform and independent of `F`. This is perfect secrecy in Shannon's sense, given the stated assumptions. [Mathematical guarantee]
- What still leaks: `P` (length bucket), `o` (how much has been sent), the direction, `padId`, and timing.
- The assumptions are: the CSPRNG is good, the pad was delivered without being copied, devices are not compromised, and bytes are never reused. The last one is enforced by sections 3.9 and 4.6, the sequential offset, and the single-delivery rule (section 7). [Depends on implementation]

### 5.2 Authenticity and integrity

- HMAC-SHA-256 with a fresh uniformly random 32-byte key per letter is a PRF-based MAC. Forgery is computationally infeasible. [Standard-algorithm guarantee, computational, not information-theoretic]
- The tag covers the entire header and ciphertext. Changing the direction, pad, offset, length, or any ciphertext bit invalidates it.
- Encrypt-then-MAC, verified before decryption.
- Note: an information-theoretic one-time MAC (Wegman–Carter, for example Poly1305 with a one-time key) would match the OTP's unconditional security. HMAC was chosen per the project brief. Swapping it would be a v2 protocol change.

### 5.3 Replay, reordering, duplication

- Replay is detected by the consumed-range set (section 4.3).
- Out-of-order delivery is allowed. Each letter carries its own offset.
- A forged header cannot redirect a valid letter to other offsets, because the header is authenticated.

### 5.4 Storage

- The pads at rest are protected by AES-256-GCM under an Argon2id-derived key. This is computational security that depends on passphrase strength. [Standard-algorithm guarantee]
- An attacker who steals the device *and* the passphrase can read pad bytes not yet consumed. Consumed bytes are zeroed in the current vault, but see section 8 on residues.

## 6. Glyph encoding (5-bit armour)

The 32-symbol alphabet is fixed. Values 0–31 are listed in order:

| v | glyph | U+ | name | v | glyph | U+ | name |
|---|---|---|---|---|---|---|---|
| 0 | ☉ | 2609 | Sol | 16 | ♑ | 2651 | Capricornus |
| 1 | ☽ | 263D | Luna | 17 | ♒ | 2652 | Aquarius |
| 2 | ☿ | 263F | Mercurius | 18 | ♓ | 2653 | Pisces |
| 3 | ♀ | 2640 | Venus | 19 | 🜁 | 1F701 | Aer |
| 4 | ♂ | 2642 | Mars | 20 | 🜂 | 1F702 | Ignis |
| 5 | ♃ | 2643 | Iuppiter | 21 | 🜃 | 1F703 | Terra |
| 6 | ♄ | 2644 | Saturnus | 22 | 🜄 | 1F704 | Aqua |
| 7 | ♈ | 2648 | Aries | 23 | ☊ | 260A | Caput Draconis |
| 8 | ♉ | 2649 | Taurus | 24 | ☋ | 260B | Cauda Draconis |
| 9 | ♊ | 264A | Gemini | 25 | ☌ | 260C | Coniunctio |
| 10 | ♋ | 264B | Cancer | 26 | ☍ | 260D | Oppositio |
| 11 | ♌ | 264C | Leo | 27 | ⚹ | 26B9 | Sextilis |
| 12 | ♍ | 264D | Virgo | 28 | 🜍 | 1F70D | Sulphur |
| 13 | ♎ | 264E | Libra | 29 | 🜔 | 1F714 | Sal |
| 14 | ♏ | 264F | Scorpius | 30 | 🜚 | 1F71A | Aurum |
| 15 | ♐ | 2650 | Sagittarius | 31 | 🜛 | 1F71B | Argentum |

- **Encoding**: the bytes of `wire` are read as a big-endian bit string, cut into 5-bit groups (MSB first), and the last group is right-padded with zero bits. The glyph count is `g = ceil(8n/5)`.
- **Decoding**: `n = floor(5g/8)`. This is exact because the padding is under 8 bits. The padding bits must be zero, otherwise the input is rejected.
- **Text form**:

  ```
  INCIPIT EPISTULA
  ☉♈🜂☍⚹ ♄♓☊🜔♀ … (groups of 5 glyphs, 6 groups per line)
  EXPLICIT
  ```

- The parser takes the text between `INCIPIT` and `EXPLICIT`, if present. It removes U+FE0E and U+FE0F (text/emoji presentation selectors that messengers add or drop), and ignores whitespace. Any other character that is not in the alphabet is an error. Integrity of the transport is then checked by the CRC.
- The glyphs are only a visual encoding. They provide no security. All security comes from sections 3 and 4.

## 7. Pad delivery (*traditio*)

- The creator generates the pad bundle on their device.
- **Delivery file**: the app writes one *traditio* file containing the partner's copy (role B) of the bundle. It is encrypted with AES-256-GCM under `Argon2id(transferCode)`. `transferCode` is 20 random characters from a 32-symbol set (100 bits), shown once on screen and read aloud in person.
- **Channel**: the file must move only in person, by AirDrop or nearby share between devices in the same room, a USB stick, or a cable. It must never be sent by email, chat or cloud.
- **Single delivery**: the delivery file can be produced only once per pad. This prevents two devices from holding role B and both sending from `stream[1]`, which would reuse pad bytes.
- On import, the app rejects a `padId` that is already present (duplicate key).

Because the file is password-encrypted, the transfer step is computationally secure, not information-theoretically secure. Keeping it physical removes network exposure.

## 8. Known limitations

1. **Residues on flash storage.** Browsers store IndexedDB on SSD or flash. Older encrypted copies of the vault may persist physically. They are protected only by the passphrase. True secure deletion is not achievable from a web page.
2. **Code delivery.** The app is a web page. Whoever controls the hosting (GitHub account, GitHub itself) could serve modified code. See THREAT_MODEL.md.
3. **Backups.** A restored backup brings back older pad state.
   - After a restore, each outgoing stream is locked until the user sets a safe offset obtained from the partner. The partner's app shows "next safe offset" for each pad.
   - A backup also contains pad bytes later consumed, so it weakens forward secrecy. Keep few backups and delete old ones.
4. **Memory.** JavaScript cannot reliably wipe memory. Decrypted pad bytes live in the page's memory while the vault is unlocked. The inactivity lock drops references, but the garbage collector decides when memory is reused.
5. **No biometric unlock in v1.** WebAuthn-based unlock is possible but not implemented.
6. **Length bucket and traffic metadata** are visible to anyone who sees the letters.

## 9. Constants

| Name | Value |
|---|---|
| `BLK` | 128 |
| Max plaintext | 16384 bytes |
| MAC key | 32 bytes |
| Header | 20 bytes |
| Argon2id | m = 65536 KiB, t = 3, p = 1, output 32 bytes, salt 16 bytes |
| AES-GCM | 256-bit key, 96-bit random IV per save, AAD `CLAVIS-ASTRAE-VAULT-v1` / `CLAVIS-ASTRAE-TRADITIO-v1` |

Argon2id parameters follow the spirit of RFC 9106 §4, second recommended option (64 MiB), reduced to p = 1 because the WebAssembly implementation is single-threaded. Reviewers should verify against RFC 9106.
