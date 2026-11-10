// The in-app manual (Liber). Plain data rendered with textContent.
export const MANUAL = [
  ['Prooemium', 'What this is', [
    'Clavis Astrae lets two people exchange letters that no one else can read. Each letter is enciphered with a One-Time Pad: a long secret of truly random bytes that only the two of you hold. Every byte of the pad is used once and then destroyed.',
    'The stars and zodiac signs are only the dress of the ciphertext. The secrecy comes from the pad, not from the symbols.',
    'Nothing leaves your device on its own. There is no account, no server, no tracking. You carry letters yourself, by any messenger you like.',
  ]],
  ['De clave', 'The key, and why it must be handed over in person', [
    'One of you forges a key (Nova clavis). It contains two separate pads: one for letters from the creator to the partner, one for letters back. So both of you can write at the same time without ever using the same bytes.',
    'The key must reach your partner in person. Meet, then use Trade clavem: the app saves a delivery file, encrypted with a one-time code shown on screen. Pass the file from device to device in the same room (AirDrop, Nearby Share, a cable or a USB stick) and read the code aloud. Never send the file by email, chat or cloud.',
    'A key can be delivered only once. If the delivery fails, destroy that key and forge a new one.',
    'After the delivery, compare the wax seals on both devices: they must be identical.',
  ]],
  ['Scribe', 'Writing a letter', [
    'Choose the key, write, and press Encipher. Every letter is padded to a multiple of 128 bytes, so an onlooker learns only its rough size.',
    'Share the letter as text (it starts with INCIPIT EPISTULA and ends with EXPLICIT) or as a small file. Messaging apps may show some zodiac signs as coloured emoji; that does no harm.',
  ]],
  ['Lege', 'Reading a letter', [
    'Paste the whole letter, or open the letter file, and press Decipher. The app checks, in order: that the signs arrived intact, that you hold the key, that this part of the key was not used before, and that the seal (HMAC) is unbroken. Only then is the text shown.',
    '“Litterae corruptae” means the text was damaged on the way: ask for it again. “Sigillum fractum” means the letter was altered or forged: do not trust it. “Iam lecta” means the letter was already read or is a replay.',
  ]],
  ['Arca', 'Your vault', [
    'Keys and letters live only on this device, enciphered with your passphrase (Argon2id and AES-256-GCM). If you forget the passphrase, nobody can recover them.',
    'The scriptorium closes itself after a few minutes of quiet. Choose the time in Regulae.',
    'Only one window may hold the vault open at a time.',
  ]],
  ['Custodia', 'Backups, and the danger of going back in time', [
    'A backup is your vault file, still protected by your passphrase. Keep it offline.',
    'Restoring a backup brings back an older state of your keys. To be sure no byte is used twice, sending is suspended on every key after a restore. Ask your partner to open Arca clavium and read you the “next safe offset” for that key, then enter it. Do this only when every letter you sent before has reached them.',
    'Old backups contain key bytes you have since used. Delete backups you no longer need.',
  ]],
  ['Pericula', 'What this cannot protect against', [
    'Malware on either phone or computer can read everything. A One-Time Pad does not protect an infected device.',
    'Someone who holds your unlocked device can read and write as you.',
    'This is a web app. Whoever controls the site that serves it could change the code. Host it yourself, protect that account with two-factor authentication, and install updates only after comparing the codex fingerprint with your partner.',
    'Deleted data may linger on flash storage, still enciphered with your passphrase.',
    'This software has not been independently audited. Do not stake lives on it.',
  ]],
];

export const COLOPHON = [
  'Stat rosa pristina nomine, nomina nuda tenemus.',
  'De occultis stellarum.',
  'Verba volant, scripta manent.',
  'Omnia mutantur, nihil interit.',
  'Nosce te ipsum.',
];
