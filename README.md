# CLAVIS ASTRAE

*De occultis stellarum* — the key of the stars.

Private letters between two people, enciphered with a genuine One-Time Pad and dressed as a medieval astronomical manuscript. It is a web app (PWA): it installs on iPhone, Android, Windows and macOS from one link, works fully offline, and needs no account.

> **Status: v1.5.0, not independently audited.** Read [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) before trusting it with anything that matters.

## How it works

- **Secrecy**: One-Time Pad. The pad comes from the browser's cryptographic random generator, is as long as the (padded) letter, and is used exactly once.
- **Authenticity**: HMAC-SHA-256 with a separate one-time key, checked before anything is decrypted.
- **Two directions**: each key holds two pads, one per direction, so both people can write at the same time with no risk of reuse.
- **At rest**: keys are stored in the browser (IndexedDB), enciphered with AES-256-GCM under an Argon2id-derived key from your passphrase.
- **Transport**: letters become groups of 32 astrological and alchemical signs, which you can send by any messenger. The signs are only an encoding and add no security.

Full specification: [docs/PROTOCOL.md](docs/PROTOCOL.md).

**Passphrase generator** (since v1.3): six random words from about 6,400 Italian, Latin, English and French words (about 76 bits), with optional dice mixed in. See `src/core/verba.js`.

**Tabularium** (since v1.1): seal your own documents in the open age format for Google Drive or any storage. See [docs/TABULARIUM.md](docs/TABULARIUM.md). Since v1.2, **Tabula** also seals Google Docs into astrological signs, readable only through the extension or the app. An optional Chrome extension in `extension/` opens and uploads sealed files and sealed Google Docs directly on Google: setup in [docs/EXTENSION_SETUP.md](docs/EXTENSION_SETUP.md).

## Publish it on GitHub Pages (Guida rapida)

1. Create a free account on github.com and **turn on two-factor authentication** (Settings → Password and authentication). Whoever controls this account controls the app.
2. Create a new **public** repository, for example `clavis-astrae`.
3. Upload the **contents** of this folder: `index.html` must sit at the top level of the repository, not inside a subfolder. On the repository page: *Add file → Upload files*, drag everything, *Commit changes*.
4. *Settings → Pages → Build and deployment*: Source **Deploy from a branch**, branch **main**, folder **/ (root)**. Save.
5. After a minute or two the app is live at `https://<your-username>.github.io/clavis-astrae/`.
6. On each device, open that address:
   - **iPhone (Safari)**: Share → *Add to Home Screen*.
   - **Android (Chrome)**: menu → *Install app*.
   - **Windows / macOS (Chrome or Edge)**: the install icon in the address bar.
   - **macOS Safari**: File → *Add to Dock*.
7. Open the app once while online. From then on it works offline.

The GitHub Pages steps may change. If something looks different, check https://docs.github.com/pages.

## First use

1. Each person opens the app on their own device and chooses a passphrase (*Scriptorium condere*).
2. **In person**, one person forges a key (*Nova clavis*), then *Trade clavem*. The app saves a delivery file and shows a one-time code.
3. Pass the file to the other device in the same room, by AirDrop, Nearby Share, a cable or a USB stick. Never send it by email, chat or cloud. The partner opens *Accipe clavem*, picks the file and types the code.
4. Compare the wax seals on both screens. They must be identical. Then delete the delivery file from both devices.
5. Write with *Scribe*, send the signs by any messenger, and read with *Lege*.

## Backups and recovery

- *Regulae → Save a backup* writes your vault, still sealed with your passphrase. Keep it offline, for example on a USB stick in a drawer.
- **Lost device**: install the app on the new device, choose *Restore a backup*, and enter that backup's passphrase.
- After a restore, sending is **suspended** on every key. Your partner opens *Arca clavium* and reads you the *next safe offset* for that key, and you enter it. Do this only once every letter you sent before has reached them. This step is what guarantees no pad byte is ever used twice.
- **Forgotten passphrase**: nothing can be recovered. Forge a new key and meet again.
- **Partner's device compromised or lost without a backup**: destroy that key on your side and forge a new one in person.

## Updating the app

1. Change the files.
2. Run `node tools/build_assets.mjs <new-version>` (and `node tools/build_extension.mjs` if shared code changed).
3. Upload the changes to GitHub.

Installed copies show *Nova editio* and update only when the user presses UPDATE. After updating, both partners compare the *Signum codicis* (code fingerprint) in *Regulae*: it must match.

## Developing and testing

Node 20 or later and Python 3 are required.

```
npm install                       # only hash-wasm, for the tests
npm test                          # automated tests (letters, vault, Tabularium, Drive client)
node tools/make_vectors.mjs       # regenerate test vectors
python3 tools/verify_vectors.py   # independent Python check of the vectors
python3 -m http.server 8000       # then open http://localhost:8000
```

The app has no build step and no runtime dependencies from the network.

Third-party code (vendored):
- `vendor/argon2.umd.min.js` from hash-wasm 4.13.0 (MIT). SHA-256: `acfe11b015852f593aaddc51116f71dc7850e4551e6b34d42c1f88cf39635f03`.
- `vendor/age.bundle.js`: age-encryption 0.3.1 (BSD-3-Clause) with @noble and @scure libraries (MIT), bundled with esbuild. Provenance is in the file header.
- Fonts under the SIL Open Font License; see `fonts/LICENSES.md`.
- Word list (`src/core/wordlist.js`): BIP39 English, Italian and French lists (MIT, bitcoin/bips) and Latin nouns from William Whitaker's WORDS (free for any use), built by `tools/make_wordlist.py`.

## Repository map

```
index.html, sw.js, manifest.webmanifest, assets.js   app shell, offline cache
src/core/   crypto engine, no DOM:
              protocol.js  OTP and HMAC letters
              codec.js     glyph encoding
              vault.js     Argon2id and AES-GCM storage
              traditio.js  key delivery
              session.js   all state changes
              store.js     IndexedDB
src/core/tabularium.js  age-format document sealing
src/core/tabula.js      sealed text in glyphs (for Google Docs)
src/ui/     interface (app.js), drawings (art.js), manual
extension/  Chrome extension for Tabularium on Google Drive
tests/      node tests and test vectors
tools/      vector generator, independent verifiers (verify_vectors.py, tabula_decode.py), asset list
docs/       PROTOCOL.md, THREAT_MODEL.md (audit checklist), TABULARIUM.md, EXTENSION_SETUP.md
```

## Known limitations

See [docs/PROTOCOL.md §8](docs/PROTOCOL.md) and [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). In short:

- A web app is only as trustworthy as the place that serves it.
- Malware on a device defeats any cipher.
- Flash storage cannot be securely erased.
- There is no biometric unlock in v1.
- Letters reveal their size to within 128 bytes.

*Stat rosa pristina nomine, nomina nuda tenemus.*
