# Tabularium — private documents

Tabularium seals your own documents so you can keep them in Google Drive, a USB stick or anywhere else. It is available in the app (menu *Tabularium*) and in the Chrome extension (`extension/`).

## Format

Tabularium writes standard **age v1** files (https://age-encryption.org/v1) with a passphrase recipient:

- **Key derivation**: scrypt, work factor 2^18 (the age default).
- **Encryption**: ChaCha20-Poly1305 in 64 KiB chunks (age STREAM), authenticated. Any change to the file is detected.
- **Implementation**: typage / `age-encryption` 0.3.1 by Filippo Valsorda (BSD-3-Clause), vendored in `vendor/age.bundle.js`.
- **Independent check**: tested against rage, the independent Rust implementation (`tests/tabularium.test.mjs`).

This is **computational** security. The One-Time Pad is not used for documents, for two reasons:

- A pad would have to be as large as the files and stored next to them.
- It would be consumed by every file.

The strength of a sealed document rests entirely on the passphrase.

## Names

- **Name visible**: `Contratto.pdf` becomes `Contratto.pdf.age`, which holds exactly the file's bytes.
- **Name hidden**: the output gets a random name such as `3f9a1c2b7e4d.age`. The real name is kept inside, in a one-entry POSIX tar envelope (pax header with the marker `comment=clavis-astrae-tabularium-v1` and the original `path`). A `.tar` you seal on purpose is never mistaken for this envelope.
- **What Drive still sees**: the size of the file (to within a few bytes) and the upload time.

## Opening without the app

Install the official tool from https://age-encryption.org (`brew install age`, `apt install age`, or `winget install FiloSottile.age`). [VERIFY: install instructions on that page]

```
age -d "Contratto.pdf.age" > "Contratto.pdf"
age -d 3f9a1c2b7e4d.age | tar -x        # hidden-name files
```

## Passphrase

- Use at least 12 characters. A sentence of five or six unusual words is a good choice.
- It is separate from the vault passphrase, so you can open documents on any device without the vault.
- It cannot be recovered. Losing it loses the documents.
- **In the app**: "remember" keeps it in memory until the scriptorium closes.
- **In the extension**: "remember" keeps it in `chrome.storage.session`, in memory only, until Chrome closes.

## Limits

- **Memory**: decrypted documents exist in the browser's memory while you view them, and in your Downloads folder if you save them.
- **Malware**: malware on the device can read them.
- **Scrypt cost**: opening takes a second or two on purpose. That cost slows down anyone guessing passphrases.
