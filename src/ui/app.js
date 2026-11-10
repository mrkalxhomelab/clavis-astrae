// CLAVIS ASTRAE — user interface. Talks only to Session; never to pad bytes.
import { h, svg, clear, download, readFileText, roman, romanDate, TEXT_SEL } from './dom.js';
import { astrolabe, seal, icon } from './art.js';
import { MANUAL, COLOPHON } from './manual.js';
import { Session } from '../core/session.js';
import { IDBStore } from '../core/store.js';
import { ALPHABET, groupGlyphs, encodeGlyphs, BEGIN, END, TransitError, dearmor } from '../core/codec.js';
import { framedSize, MAC_LEN, MAX_PLAINTEXT, PAD_SIZES } from '../core/protocol.js';
import { utf8, toHex } from '../core/bytes.js';
import { MIN_PASSPHRASE } from '../core/vault.js';
import { sealFile, openFile, mimeFor, MIN_DOC_PASSPHRASE } from '../core/tabularium.js';
import { sealText, openText } from '../core/tabula.js';

const app = document.getElementById('app');
const session = new Session(new IDBStore());
const VERSION = globalThis.CLAVIS_VERSION || 'dev';
let lockTimer = null;
let vaultExists = false;

// ---------------------------------------------------------------- helpers
const glyphSpan = (g) => g + TEXT_SEL;
const isGlyph = new Set(ALPHABET.map((a) => a.g));

function glyphBlock(armored, { markers = true } = {}) {
  const inner = armored.replace(BEGIN, '').replace(END, '');
  const glyphs = Array.from(inner).filter((c) => isGlyph.has(c)).join('');
  return h('div', { class: 'glyphs', lang: 'zxx' },
    markers ? h('span', { class: 'marker' }, 'INCIPIT EPISTULA') : null,
    groupGlyphs(glyphs).map((g) => h('span', { class: 'grp' }, Array.from(g).map(glyphSpan).join(''))),
    markers ? h('span', { class: 'marker' }, 'EXPLICIT') : null);
}

function fmtBytes(n) {
  if (n >= 1048576) return `${(n / 1048576).toFixed(n % 1048576 ? 2 : 0)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(n % 1024 ? 1 : 0)} KiB`;
  return `${n} B`;
}

function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

async function busy(msg, fn) {
  const b = h('div', { class: 'busy', role: 'alert', 'aria-busy': 'true' }, astrolabe('astrolabe'), h('div', null, msg));
  document.body.appendChild(b);
  try { return await fn(); } finally { b.remove(); }
}

function notice(head, body, good = false) {
  return h('div', { class: `notice${good ? ' good' : ''}`, role: good ? 'status' : 'alert' }, h('span', { class: 'head' }, head), body);
}

function errorText(e) {
  const map = {
    badpass: ['Clavis falsa', 'Wrong passphrase or code, or the file is damaged.'],
    weak: ['Nimis brevis', `Use at least ${Math.max(MIN_PASSPHRASE, MIN_DOC_PASSPHRASE)} characters. A short sentence works well.`],
    damaged: ['Corruptum', 'The file is damaged or was altered.'],
    format: ['Non agnoscitur', e.message],
    armored: ['Non agnoscitur', 'This age file is in text (armoured) form; only the binary form is supported.'],
    exhausted: ['Clavis exhausta', 'Not enough unused key for this letter. Shorten it, or forge a new key and deliver it in person.'],
    locked: ['Clavis suspensa', 'Sending is suspended after a restore. Set the safe offset in Arca clavium.'],
    toolong: ['Nimis longa', `A letter may hold at most ${MAX_PLAINTEXT} bytes.`],
    duplicate: ['Iam habes', 'This key is already in your vault.'],
    delivered: ['Iam tradita', 'This key was already delivered once. Forge a new one.'],
    conflict: ['Alia fenestra', 'The vault was changed in another window. Close the others and reopen.'],
    io: ['Error scribendi', 'Could not save to this device. Nothing was sent.'],
  };
  const m = map[e.code];
  if (m) return m;
  if (e instanceof TransitError && /sealed document/.test(e.message)) return ['Tabula, non epistula', 'This is a sealed document, not a letter. Open it in Tabularium, section Tabula.'];
  if (e instanceof TransitError && /is a letter/.test(e.message)) return ['Epistula, non tabula', 'This is a letter, not a sealed document. Open it in Lege.'];
  if (e instanceof TransitError) return ['Litterae corruptae', 'The signs were damaged on the way. Ask for the letter again.'];
  return ['Error', e.message || String(e)];
}

function showError(where, e) {
  const [a, b] = errorText(e);
  clear(where);
  where.appendChild(notice(a, b));
}

// ---------------------------------------------------------------- layout
function page(title, latin, body, { back = 'home', lockable = true } = {}) {
  clear(app);
  const head = h('header', { class: 'masthead compact' },
    back ? h('button', { class: 'iconbtn', 'aria-label': 'Back', onclick: () => go(back) }, icon('back')) : null,
    h('div', { class: 'grow' }, h('h1', null, title), latin ? h('div', { class: 'sub' }, latin) : null),
    lockable ? h('button', { class: 'iconbtn', 'aria-label': 'Lock the vault (Obsera)', title: 'Obsera', onclick: () => lockNow('Obseratum') }, icon('lock')) : null);
  app.append(head, h('main', null, body), colophon());
  window.scrollTo(0, 0);
}

function colophon() {
  return h('footer', { class: 'colophon' }, COLOPHON[Math.floor(Date.now() / 86400000) % COLOPHON.length]);
}

// ---------------------------------------------------------------- router
const VIEWS = {};
function go(name, arg) {
  if (name !== 'gate' && name !== 'restore-gate' && !session.unlocked) return VIEWS.gate();
  return VIEWS[name](arg);
}

// ---------------------------------------------------------------- gate
VIEWS.gate = async (msg) => {
  vaultExists = await session.exists();
  clear(app);
  const err = h('div');
  const masthead = h('header', { class: 'masthead' }, astrolabe(), h('h1', null, 'CLAVIS ASTRAE'), h('div', { class: 'motto' }, 'DE OCCULTIS STELLARUM'));
  let body;
  if (!vaultExists) {
    const p1 = h('input', { type: 'password', autocomplete: 'new-password', id: 'p1' });
    const p2 = h('input', { type: 'password', autocomplete: 'new-password', id: 'p2' });
    body = [
      h('h2', { class: 'rubric' }, 'Scriptorium condere'),
      h('p', { class: 'initial' }, 'Found your scriptorium. Choose a passphrase to seal the keys kept on this device. It never leaves this device, and it cannot be recovered if forgotten.'),
      h('label', { class: 'field' }, h('span', null, 'Passphrase'), p1),
      h('label', { class: 'field' }, h('span', null, 'Once more'), p2),
      h('p', { class: 'small' }, `At least ${MIN_PASSPHRASE} characters. A sentence of five or six unusual words is strong and memorable.`),
      err,
      h('button', { class: 'btn block', onclick: async () => {
        if (p1.value !== p2.value) return showError(err, { code: 'x', message: 'The two passphrases differ.' });
        try {
          await busy('Forging the vault…', () => session.create(p1.value));
          p1.value = p2.value = '';
          armLock(); go('home');
        } catch (e) { showError(err, e); }
      } }, 'CONDE', h('small', null, 'create')),
      h('button', { class: 'btn ghost block', onclick: () => VIEWS['restore-gate']() }, 'Restore a backup'),
    ];
  } else {
    const p = h('input', { type: 'password', autocomplete: 'current-password', id: 'pass' });
    const open = async () => {
      try {
        await busy('Opening the vault…', () => session.unlock(p.value));
        p.value = '';
        armLock(); go('home');
      } catch (e) { showError(err, e); }
    };
    p.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    body = [
      msg ? notice(msg, 'The vault was locked.', true) : null,
      h('h2', { class: 'rubric' }, 'Scriptorium clausum'),
      h('label', { class: 'field' }, h('span', null, 'Passphrase'), p),
      err,
      h('button', { class: 'btn block', onclick: open }, 'APERI', h('small', null, 'open')),
      h('button', { class: 'btn ghost block', onclick: () => VIEWS['restore-gate']() }, 'Restore a backup'),
    ];
  }
  app.append(masthead, h('main', null, body), colophon());
  setTimeout(() => app.querySelector('input')?.focus(), 50);
};

VIEWS['restore-gate'] = () => restoreView(true);

function restoreView(fromGate) {
  const err = h('div');
  const f = h('input', { type: 'file', accept: '.json,application/json' });
  const p = h('input', { type: 'password', autocomplete: 'current-password' });
  const body = [
    h('p', { class: 'initial' }, 'Restore a vault from a backup file. It replaces the vault on this device.'),
    notice('Cave', 'A backup is an older state of your keys. After restoring, sending is suspended on every key until your partner tells you the next safe offset. This prevents any byte of a key from being used twice.'),
    h('label', { class: 'field' }, h('span', null, 'Backup file'), f),
    h('label', { class: 'field' }, h('span', null, 'Passphrase of that backup'), p),
    err,
    h('button', { class: 'btn danger block', onclick: async () => {
      try {
        if (!f.files[0]) throw new Error('Choose a backup file.');
        const rec = JSON.parse(await readFileText(f.files[0]));
        if (!confirm('Replace the vault on this device with this backup?')) return;
        await busy('Restoring…', () => session.restore(rec, p.value));
        p.value = '';
        armLock(); toast('Restituta. Sending suspended until safe offsets are set.'); go('vault');
      } catch (e) { showError(err, e instanceof SyntaxError ? new Error('Not a backup file.') : e); }
    } }, 'RESTITUE', h('small', null, 'restore')),
  ];
  page('RESTITUTIO', 'Restore from backup', body, { back: fromGate ? 'gate' : 'settings', lockable: !fromGate });
}

// ---------------------------------------------------------------- home
const MENU = [
  ['forge', '☉', 'Nova clavis', 'Forge a new key'],
  ['write', '☿', 'Scribe', 'Encipher a letter'],
  ['read', '☽', 'Lege', 'Decipher a letter'],
  ['vault', '♄', 'Arca clavium', 'Key vault'],
  ['receive', '♀', 'Accipe clavem', 'Receive a key'],
  ['deliver', '♂', 'Trade clavem', 'Deliver a key'],
  ['letters', '♃', 'Epistulae', 'Letters'],
  ['tabularium', '🜚', 'Tabularium', 'Private documents'],
  ['settings', '⚹', 'Regulae', 'Settings'],
  ['manual', '☊', 'Liber', 'Manual'],
];

VIEWS.home = () => {
  clear(app);
  const pads = session.pads();
  const masthead = h('header', { class: 'masthead' },
    h('button', { class: 'iconbtn', style: 'position:absolute; right:8px; top:calc(8px + env(safe-area-inset-top))', 'aria-label': 'Lock the vault (Obsera)', title: 'Obsera', onclick: () => lockNow('Obseratum') }, icon('lock')),
    astrolabe(), h('h1', null, 'CLAVIS ASTRAE'), h('div', { class: 'motto' }, 'DE OCCULTIS STELLARUM'));
  const summary = pads.length
    ? h('p', { class: 'small', style: 'text-align:center' }, `${pads.length} ${pads.length === 1 ? 'key' : 'keys'} in the vault · ${session.letters().length} letters`)
    : h('p', { class: 'small', style: 'text-align:center' }, 'Your vault is empty. Forge a key, or receive one from your partner.');
  const menu = h('ul', { class: 'menu' }, MENU.map(([v, s, la, en], i) =>
    h('li', null, h('button', { onclick: () => go(v) },
      h('span', { class: 'sign', 'aria-hidden': 'true' }, glyphSpan(s)),
      h('span', { class: 'label' }, h('span', { class: 'la' }, la), h('span', { class: 'en' }, en)),
      h('span', { class: 'num', 'aria-hidden': 'true' }, roman(i + 1))))));
  app.append(masthead, h('main', null, summary, menu), colophon());
};

// ---------------------------------------------------------------- forge
VIEWS.forge = () => {
  const label = h('input', { type: 'text', maxlength: 60, placeholder: 'e.g. Adso et Guilielmus' });
  const sizeSel = h('select', null, PAD_SIZES.map((s) => h('option', { value: s, selected: s === 262144 }, `${fmtBytes(s)} each way (about ${Math.floor(s / 160)} short letters)`)));
  const err = h('div');
  page('NOVA CLAVIS', 'Forge a new key', [
    h('p', { class: 'initial' }, 'A key holds two pads of true random bytes: one for your letters to your partner, one for theirs to you. It is drawn from your device’s cryptographic random generator.'),
    h('label', { class: 'field' }, h('span', null, 'Name of the key'), label),
    h('label', { class: 'field' }, h('span', null, 'Size'), sizeSel),
    err,
    h('button', { class: 'btn block', onclick: async () => {
      try {
        const p = await busy('Drawing random bytes…', () => session.forgePad(Number(sizeSel.value), label.value.trim() || 'Clavis'));
        forged(p);
      } catch (e) { showError(err, e); }
    } }, 'CUDE', h('small', null, 'forge')),
  ]);
};

function forged(p) {
  page('NOVA CLAVIS', 'Forged', [
    h('div', { class: 'panel ornate keycard' }, seal(p.id),
      h('div', null, h('h3', null, p.label), h('div', { class: 'meta' }, `${fmtBytes(p.size)} each way · id ${p.id}`))),
    notice('Nunc trade', 'Your partner does not have this key yet. Deliver it in person: meet, then use Trade clavem.', true),
    h('button', { class: 'btn block', onclick: () => go('deliver', p.id) }, 'TRADE CLAVEM', h('small', null, 'deliver now')),
    h('button', { class: 'btn ghost block', onclick: () => go('home') }, 'Later'),
  ]);
}

// ---------------------------------------------------------------- deliver
VIEWS.deliver = (preselect) => {
  const eligible = session.pads().filter((p) => p.role === 'A' && !p.delivered && p.sent === 0 && p.received === 0);
  if (!eligible.length) {
    return page('TRADE CLAVEM', 'Deliver a key', [
      h('p', null, 'There is no key waiting to be delivered. Only a key you forged, unused and never delivered, can be handed over.'),
      h('button', { class: 'btn block', onclick: () => go('forge') }, 'NOVA CLAVIS', h('small', null, 'forge one')),
    ]);
  }
  const sel = h('select', null, eligible.map((p) => h('option', { value: p.id, selected: p.id === preselect }, `${p.label} · ${p.id}`)));
  const err = h('div');
  page('TRADE CLAVEM', 'Deliver a key', [
    notice('Coram tantum', 'In person only. Never send the delivery file by email, chat or cloud. Pass it between devices in the same room: AirDrop, Nearby Share, a cable or a USB stick.'),
    h('label', { class: 'field' }, h('span', null, 'Key'), sel),
    h('p', { class: 'small' }, 'The app will save a delivery file and show a one-time code. The file can be made only once for each key.'),
    err,
    h('button', { class: 'btn block', onclick: async () => {
      try {
        const id = sel.value;
        const info = session.pads().find((p) => p.id === id);
        const { file, code } = await busy('Sealing the delivery…', () => session.deliverPad(id));
        download(`clavis-${id}.traditio.json`, JSON.stringify(file));
        delivered(info, code, file);
      } catch (e) { showError(err, e); }
    } }, 'PARA TRADITIONEM', h('small', null, 'prepare')),
  ]);
};

function delivered(info, code, file) {
  page('TRADE CLAVEM', 'Delivery ready', [
    h('div', { class: 'panel ornate keycard' }, seal(info.id), h('div', null, h('h3', null, info.label), h('div', { class: 'meta' }, `id ${info.id}`))),
    h('h2', { class: 'rubric' }, 'Signum traditionis'),
    h('div', { class: 'code', 'aria-label': 'Delivery code' }, code),
    h('ol', null,
      h('li', null, 'The file ', h('i', null, `clavis-${info.id}.traditio.json`), ' was saved. Move it to your partner’s device, here in the room.'),
      h('li', null, 'On their device: Accipe clavem, choose the file, type this code. Read it aloud; do not write it down.'),
      h('li', null, 'Compare the wax seals on both screens. They must be identical.'),
      h('li', null, 'Then delete the delivery file from both devices and from your Downloads.')),
    h('button', { class: 'btn ghost block', onclick: () => download(`clavis-${info.id}.traditio.json`, JSON.stringify(file)) }, 'Save the file again'),
    h('button', { class: 'btn block', onclick: () => go('home') }, 'FACTUM', h('small', null, 'done, code hidden')),
  ], { back: null });
}

// ---------------------------------------------------------------- receive
VIEWS.receive = () => {
  const f = h('input', { type: 'file', accept: '.json,application/json' });
  const c = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX' });
  const err = h('div');
  page('ACCIPE CLAVEM', 'Receive a key', [
    h('p', { class: 'initial' }, 'Your partner forged a key and is here with you. They pass you the delivery file and read you the code.'),
    h('label', { class: 'field' }, h('span', null, 'Delivery file'), f),
    h('label', { class: 'field' }, h('span', null, 'Code'), c),
    err,
    h('button', { class: 'btn block', onclick: async () => {
      try {
        if (!f.files[0]) throw new Error('Choose the delivery file.');
        let file;
        try { file = JSON.parse(await readFileText(f.files[0])); } catch { throw new Error('This is not a delivery file.'); }
        const p = await busy('Opening the delivery…', () => session.receivePad(file, c.value));
        c.value = '';
        page('ACCIPE CLAVEM', 'Received', [
          h('div', { class: 'panel ornate keycard' }, seal(p.id), h('div', null, h('h3', null, p.label), h('div', { class: 'meta' }, `${fmtBytes(p.size)} each way · id ${p.id}`))),
          notice('Accepta', 'Compare this seal with the one on your partner’s screen. They must be identical. Then delete the delivery file from this device.', true),
          h('button', { class: 'btn block', onclick: () => go('home') }, 'FACTUM', h('small', null, 'done')),
        ]);
      } catch (e) { showError(err, e); }
    } }, 'ACCIPE', h('small', null, 'receive')),
  ]);
};

// ---------------------------------------------------------------- write
VIEWS.write = () => {
  const pads = session.pads().filter((p) => !p.locked && p.capacity > 0);
  if (!pads.length) {
    return page('SCRIBE', 'Encipher a letter', [
      h('p', null, 'No key can write right now. Forge a key and deliver it, receive one, or set the safe offset of a suspended key in Arca clavium.'),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => go('forge') }, 'NOVA CLAVIS'), h('button', { class: 'btn ghost', onclick: () => go('vault') }, 'ARCA')),
    ]);
  }
  const sel = h('select', null, pads.map((p) => h('option', { value: p.id }, `${p.label} · ${p.id.slice(0, 6)}`)));
  const ta = h('textarea', { placeholder: 'Secretum finis Africae…', spellcheck: 'true' });
  const stats = h('div', { class: 'stats' });
  const err = h('div');
  const btn = h('button', { class: 'btn block' }, 'ENCIPHER', h('small', null, 'obsigna'));
  const upd = () => {
    const p = pads.find((x) => x.id === sel.value);
    const n = utf8.encode(ta.value).length;
    const P = framedSize(n);
    const need = MAC_LEN + P;
    clear(stats);
    stats.append(
      h('span', null, 'Letter length'), h('b', null, `${n} bytes`),
      h('span', null, 'Key needed (padded + seal)'), h('b', null, `${P} + ${MAC_LEN} bytes`),
      h('span', null, 'Unused key, outgoing'), h('b', null, fmtBytes(p.remaining)),
      h('span', null, 'Letters of this size left'), h('b', null, String(Math.floor(p.remaining / need))));
    btn.disabled = n > p.capacity;
  };
  sel.addEventListener('change', upd); ta.addEventListener('input', upd); upd();
  btn.addEventListener('click', async () => {
    try {
      const r = await busy('Enciphering…', () => session.encrypt(sel.value, ta.value));
      ta.value = '';
      showLetter(r.letter, { fresh: true });
    } catch (e) { showError(err, e); }
  });
  page('SCRIBE', 'Encipher a letter', [
    h('label', { class: 'field' }, h('span', null, 'Key'), sel),
    h('label', { class: 'field' }, h('span', null, 'Letter'), ta),
    h('div', { class: 'panel' }, stats),
    err, btn,
  ]);
};

// ---------------------------------------------------------------- show letter
function shareTools(letter) {
  const name = `epistula-${letter.padId.slice(0, 6)}-${roman(letter.number)}.txt`;
  return h('div', { class: 'row' },
    h('button', { class: 'btn', onclick: async () => {
      try { await navigator.clipboard.writeText(letter.armored); toast('Copied.'); } catch { toast('Copy failed: select the text by hand.'); }
    } }, 'COPY'),
    navigator.share ? h('button', { class: 'btn', onclick: () => navigator.share({ text: letter.armored }).catch(() => {}) }, 'SHARE') : null,
    h('button', { class: 'btn ghost', onclick: () => download(name, letter.armored + '\n', 'text/plain') }, 'FILE'),
    h('button', { class: 'btn ghost', onclick: () => manuscript(letter) }, 'MANUSCRIPT'));
}

function showLetter(letter, { fresh = false } = {}) {
  const out = letter.dir === 'out';
  page(`EPISTULA ${roman(letter.number)}`, `${out ? 'Sent' : 'Received'} · ${letter.padLabel}`, [
    fresh ? notice('Obsignata', 'The letter is sealed and that part of the key is now destroyed. Send the signs below by any messenger.', true) : null,
    letter.text !== null && !fresh ? h('div', { class: 'panel ornate' }, h('div', { class: 'plaintext' }, letter.text)) : null,
    out || letter.armored ? h('h2', { class: 'rubric' }, 'Signa') : null,
    h('div', { class: 'panel' }, glyphBlock(letter.armored)),
    shareTools(letter),
    h('p', { class: 'small' }, `${romanDate(letter.at)} · offset ${letter.offset} · ${letter.P} bytes`),
  ], { back: fresh ? 'home' : 'letters' });
}

// ---------------------------------------------------------------- manuscript
function manuscript(letter, { showDate = true } = {}) {
  const inner = letter.armored.replace(BEGIN, '').replace(END, '');
  const glyphs = Array.from(inner).filter((c) => isGlyph.has(c));
  const first = glyphs[0] || '☉';
  const zod = ALPHABET.slice(7, 19).map((a) => glyphSpan(a.g)).join(' ');
  const dateToggle = h('label', { class: 'check no-print', style: 'color:#E9DBB8; justify-content:center; margin-top:12px' },
    h('input', { type: 'checkbox', checked: showDate, onchange: (e) => manuscript(letter, { showDate: e.target.checked }) }), 'Show the date');
  clear(app);
  app.append(
    h('header', { class: 'masthead compact no-print' },
      h('button', { class: 'iconbtn', 'aria-label': 'Back', onclick: () => showLetter(letter) }, icon('back')),
      h('div', { class: 'grow' }, h('h1', null, 'MANUSCRIPTUM'), h('div', { class: 'sub' }, 'The same signs, in their finest dress')),
      h('button', { class: 'iconbtn', 'aria-label': 'Print', title: 'Print', onclick: () => window.print() },
        svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z"/></svg>'))),
    h('div', { class: 'ms-wrap' },
      h('article', { class: 'manuscript' }, h('div', { class: 'frame' },
        h('div', { class: 'ms-title' }, 'CLAVIS ASTRAE'),
        h('div', { class: 'ms-motto' }, 'DE OCCULTIS STELLARUM'),
        h('div', { class: 'zodiac', 'aria-hidden': 'true' }, zod),
        h('div', { class: 'ms-head' }, seal(letter.padId),
          h('div', { class: 'meta' },
            h('div', null, h('i', null, 'Epistula'), ` № ${roman(letter.number)}`),
            h('div', null, h('i', null, 'Clavis'), ` ${letter.padId.slice(0, 8).toUpperCase()}`),
            showDate ? h('div', null, h('i', null, 'Datum'), ` ${romanDate(letter.at)}`) : null)),
        h('div', { class: 'ms-rule' }),
        h('div', { class: 'incipit' }, 'Incipit epistula'),
        h('div', { class: 'ms-body' },
          h('span', { class: 'ms-initial', 'aria-hidden': 'true' }, glyphSpan(first)),
          h('div', { class: 'glyphs', lang: 'zxx' }, groupGlyphs(glyphs.slice(1).join('')).map((g) => h('span', { class: 'grp' }, Array.from(g).map(glyphSpan).join(''))))),
        h('div', { class: 'explicit' }, 'Explicit.'),
        h('div', { class: 'ms-foot' }, 'Stat rosa pristina nomine, nomina nuda tenemus.'))),
      dateToggle,
      h('p', { class: 'ms-note' }, 'The page is only a dress: the signs are the same as in the plain view.')));
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- read
const LADDER = [
  ['Signa integra', 'The signs arrived intact'],
  ['Clavis inventa', 'You hold the matching key'],
  ['Nondum lecta', 'This part of the key is unused'],
  ['Sigillum integrum', 'The seal is unbroken'],
  ['Littera aperta', 'The letter is opened'],
];

function ladder(failedAt, okUpTo) {
  return h('ol', { class: 'ladder', 'aria-label': 'Verification' }, LADDER.map(([la, en], i) => {
    const st = i < okUpTo ? 'ok' : i === failedAt ? 'fail' : 'skip';
    return h('li', { class: st },
      h('span', { class: 'mark', 'aria-hidden': 'true' }, st === 'ok' ? '☉' : st === 'fail' ? '☍' : '·'),
      h('span', null, h('span', { class: 'la' }, la), ` — ${en}`, h('span', { class: 'sr' }, st === 'ok' ? ' (passed)' : st === 'fail' ? ' (failed)' : ' (not checked)')));
  }));
}

function failStep(e) {
  if (e instanceof TransitError) return 0;
  return { format: 0, version: 0, unknownpad: 1, direction: 1, replay: 2, seal: 3 }[e.code] ?? 4;
}

VIEWS.read = () => {
  const ta = h('textarea', { class: 'cipher', placeholder: 'INCIPIT EPISTULA … EXPLICIT', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' });
  const f = h('input', { type: 'file', accept: '.txt,text/plain' });
  f.addEventListener('change', async () => { if (f.files[0]) ta.value = await readFileText(f.files[0]); });
  const out = h('div');
  page('LEGE', 'Decipher a letter', [
    h('label', { class: 'field' }, h('span', null, 'Paste the whole letter'), ta),
    h('label', { class: 'field' }, h('span', null, 'Or open a letter file'), f),
    h('button', { class: 'btn block', onclick: async () => {
      clear(out);
      try {
        const r = await busy('Checking the seal…', () => session.decrypt(ta.value));
        ta.value = '';
        out.append(...[ladder(-1, 5),
          h('div', { class: 'panel ornate' }, h('p', { class: 'small' }, `Epistula ${roman(r.letter.number)} · ${r.letter.padLabel}`), h('div', { class: 'plaintext' }, r.text)),
          r.letter.text === null ? h('p', { class: 'small' }, 'Transcripts are off: this text will not be kept after you leave this page.') : null].filter(Boolean));
      } catch (e) {
        const k = failStep(e);
        const [a, b] = errorText(e.code === 'seal' ? { code: 'x', message: '' } : e);
        out.append(ladder(k, k),
          e.code === 'seal' ? notice('Sigillum fractum', 'The letter was altered or forged. Nothing is shown. Do not trust it.')
          : e.code === 'replay' ? notice('Iam lecta', 'This letter was already read, or it is a replay. Read it again in Epistulae.')
          : e.code === 'unknownpad' ? notice('Clavis ignota', 'You do not hold the key this letter was written with.')
          : e.code === 'direction' ? notice('Speculum', 'This letter was written by you, not to you.')
          : notice(...errorText(e)));
      }
    } }, 'DECIPHER', h('small', null, 'resigna')),
    out,
  ]);
};

// ---------------------------------------------------------------- vault
VIEWS.vault = () => {
  const pads = session.pads();
  page('ARCA CLAVIUM', 'Key vault', pads.length ? pads.map((p) => {
    const err = h('div');
    const tags = [
      h('span', { class: 'tag gold' }, p.role === 'A' ? 'CREATOR' : 'PARTNER'),
      p.role === 'A' ? h('span', { class: `tag ${p.delivered ? 'gold' : 'red'}` }, p.delivered ? 'TRADITA' : 'NONDUM TRADITA') : null,
      p.locked ? h('span', { class: 'tag red' }, 'SUSPENSA') : null,
      p.capacity === 0 ? h('span', { class: 'tag red' }, 'EXHAUSTA') : null,
    ];
    const off = h('input', { type: 'number', min: 0, max: p.size, step: 1, inputmode: 'numeric' });
    return h('div', { class: 'panel keycard' },
      seal(p.id),
      h('div', null,
        h('h3', null, p.label),
        h('div', { class: 'meta' }, `id ${p.id} · ${fmtBytes(p.size)} each way`),
        h('div', { style: 'margin:6px 0' }, tags),
        h('div', { class: 'meta' }, `Outgoing used: ${(p.usedFraction * 100).toFixed(1)}% · ${fmtBytes(p.remaining)} left`),
        h('div', { class: 'bar', role: 'img', 'aria-label': `${(p.usedFraction * 100).toFixed(0)} percent used` }, h('i', { style: `width:${Math.max(0.5, p.usedFraction * 100)}%` })),
        h('div', { class: 'meta', style: 'margin-top:6px' }, `Letters: ${p.sent} sent · ${p.received} received`),
        h('div', { class: 'meta' }, 'Next safe offset for your partner: ', h('b', null, String(p.nextSafeForPartner)))),
      h('div', { class: 'actions' },
        p.locked ? h('div', { class: 'panel', style: 'margin-bottom:10px' },
          notice('Clavis suspensa', 'This key was restored from a backup. Ask your partner for the “next safe offset” shown on their copy of this key, and enter it. Do it only when every letter you sent has reached them.'),
          h('label', { class: 'field', style: 'margin-top:10px' }, h('span', null, 'Safe offset from partner'), off),
          h('button', { class: 'btn block', style: 'margin-top:10px', onclick: async () => {
            try { await session.setSafeOffset(p.id, Number(off.value)); toast('Clavis soluta.'); go('vault'); } catch (e) { showError(err, e); }
          } }, 'SOLVE', h('small', null, 'release'))) : null,
        err,
        h('div', { class: 'row' },
          p.role === 'A' && !p.delivered ? h('button', { class: 'btn', onclick: () => go('deliver', p.id) }, 'TRADE') : null,
          h('button', { class: 'btn ghost', onclick: async () => {
            if (!confirm(`Destroy the key “${p.label}”? Letters written with it can no longer be read or sent. This cannot be undone.`)) return;
            await session.destroyPad(p.id); toast('Clavis deleta.'); go('vault');
          } }, 'DESTROY'))));
  }) : [h('p', null, 'The vault is empty.'), h('button', { class: 'btn block', onclick: () => go('forge') }, 'NOVA CLAVIS')]);
};

// ---------------------------------------------------------------- letters
VIEWS.letters = () => {
  const ls = session.letters();
  page('EPISTULAE', 'Letters', ls.length ? [
    h('p', { class: 'small' }, session.settings().keepTranscripts ? 'Transcripts are kept inside your encrypted vault.' : 'Transcripts are off: only the signs are kept.'),
    ls.map((l) => h('button', { class: 'letter-item', onclick: () => showLetter(l) },
      h('span', { class: 'dirsign', 'aria-hidden': 'true' }, glyphSpan(l.dir === 'out' ? '☿' : '☽')),
      h('span', { class: 't' },
        h('div', { class: 'l1' }, `${l.dir === 'out' ? 'Missa' : 'Accepta'} · Epistula ${roman(l.number)}`),
        h('div', { class: 'l2' }, `${l.padLabel} · ${romanDate(l.at)}${l.text ? ' · ' + l.text.slice(0, 60) : ''}`)))),
  ] : [h('p', null, 'No letters yet.')]);
};

// ---------------------------------------------------------------- settings
VIEWS.settings = async () => {
  const s = session.settings();
  const err = h('div');
  const lm = h('input', { type: 'number', min: 1, max: 60, value: s.lockMinutes, inputmode: 'numeric' });
  const kt = h('input', { type: 'checkbox', checked: s.keepTranscripts });
  const np1 = h('input', { type: 'password', autocomplete: 'new-password' });
  const np2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const fp = h('div', { class: 'panel' }, h('p', { class: 'small' }, 'Computing…'));
  page('REGULAE', 'Settings', [
    h('h2', { class: 'rubric' }, 'Custodia'),
    h('label', { class: 'field' }, h('span', null, 'Close the scriptorium after (minutes)'), lm),
    h('label', { class: 'check' }, kt, h('span', null, 'Keep transcripts of letters inside the encrypted vault. Turning this off erases the stored texts.')),
    err,
    h('button', { class: 'btn block', onclick: async () => {
      try {
        if (!kt.checked && s.keepTranscripts && !confirm('Erase every stored transcript?')) return;
        await session.updateSettings({ lockMinutes: Number(lm.value), keepTranscripts: kt.checked });
        armLock(); toast('Servata.');
      } catch (e) { showError(err, e); }
    } }, 'SERVA', h('small', null, 'save')),

    h('h2', { class: 'rubric' }, 'Nova tessera'),
    h('label', { class: 'field' }, h('span', null, 'New passphrase'), np1),
    h('label', { class: 'field' }, h('span', null, 'Once more'), np2),
    h('button', { class: 'btn ghost block', onclick: async () => {
      try {
        if (np1.value !== np2.value) throw new Error('The two passphrases differ.');
        await busy('Re-sealing the vault…', () => session.changePassphrase(np1.value));
        np1.value = np2.value = ''; toast('Tessera mutata.');
      } catch (e) { showError(err, e); }
    } }, 'Change passphrase'),

    h('h2', { class: 'rubric' }, 'Exemplar'),
    h('p', { class: 'small' }, 'The backup is your vault, sealed with your passphrase. Keep it offline. Old backups hold key bytes you have since used: delete them when no longer needed.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', onclick: async () => {
        const rec = await session.backup();
        download(`clavis-astrae-arca-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(rec));
      } }, 'Save a backup'),
      h('button', { class: 'btn ghost', onclick: () => restoreView(false) }, 'Restore')),

    h('h2', { class: 'rubric' }, 'Signum codicis'),
    h('p', { class: 'small' }, 'Fingerprint of the app code on this device. Compare it with your partner’s before and after every update: it must match.'),
    fp,

    h('h2', { class: 'rubric' }, 'Deletio'),
    h('button', { class: 'btn danger block', onclick: async () => {
      const t = prompt('This erases the vault and every key on this device. Type DELE to confirm.');
      if (t !== 'DELE') return;
      await session.wipeDevice(); toast('Deleta.'); go('gate');
    } }, 'ERASE THIS DEVICE'),
    h('p', { class: 'small' }, `Editio ${VERSION}`),
  ]);
  codexFingerprint().then((r) => {
    clear(fp);
    fp.append(h('div', { class: 'glyphs', style: 'justify-content:center; font-size:28px' }, groupGlyphs(r.glyphs).map((g) => h('span', { class: 'grp' }, Array.from(g).map(glyphSpan).join('')))),
      h('p', { class: 'small', style: 'text-align:center; word-break:break-all' }, r.hex));
  }).catch(() => { clear(fp); fp.append(h('p', { class: 'small' }, 'Unavailable here.')); });
};

async function codexFingerprint() {
  const assets = (globalThis.CLAVIS_ASSETS || []).slice().sort();
  const parts = [];
  for (const a of assets) {
    const r = await fetch(a, { cache: 'force-cache' });
    if (!r.ok) throw new Error('missing ' + a);
    parts.push(utf8.encode(a + '\n'), new Uint8Array(await r.arrayBuffer()));
  }
  let len = 0; for (const p of parts) len += p.length;
  const all = new Uint8Array(len); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  return { hex: toHex(d).match(/.{8}/g).join(' '), glyphs: encodeGlyphs(d.subarray(0, 10)) };
}

// ---------------------------------------------------------------- tabularium
let docPass = null; // document passphrase, kept in memory only while unlocked
const blobUrls = [];

function passFields(confirmToo) {
  const p1 = h('input', { type: 'password', autocomplete: 'off' });
  const p2 = h('input', { type: 'password', autocomplete: 'off' });
  const remember = h('input', { type: 'checkbox' });
  const wrap = docPass
    ? h('p', { class: 'small' }, 'Using the document passphrase remembered for this session. ',
        h('button', { class: 'btn ghost', style: 'min-height:36px; font-size:12px', onclick: () => { docPass = null; go('tabularium'); } }, 'Forget it'))
    : h('div', null,
        h('label', { class: 'field' }, h('span', null, 'Document passphrase'), p1),
        confirmToo ? h('label', { class: 'field', style: 'margin-top:12px' }, h('span', null, confirmToo === 'sealing' ? 'Once more (only when sealing)' : 'Once more'), p2) : null,
        h('label', { class: 'check', style: 'margin-top:12px' }, remember, h('span', null, 'Remember it until the scriptorium closes')));
  return {
    el: wrap,
    get({ sealing = confirmToo === true } = {}) {
      if (docPass) return docPass;
      if (confirmToo && sealing && p1.value !== p2.value) throw new Error('The two passphrases differ.');
      const v = p1.value;
      if (remember.checked) docPass = v;
      p1.value = p2.value = '';
      return v;
    },
  };
}

function urlFor(blob) {
  const u = URL.createObjectURL(blob);
  blobUrls.push(u);
  return u;
}

VIEWS.tabularium = () => {
  const sealIn = h('input', { type: 'file' });
  const hide = h('input', { type: 'checkbox' });
  const sp = passFields(true);
  const sealErr = h('div'), sealOut = h('div');
  const openIn = h('input', { type: 'file', accept: '.age,application/octet-stream' });
  const op = passFields(false);
  const openErr = h('div'), openOut = h('div');
  const tabIn = h('textarea', { class: 'cipher', style: 'font-family: var(--signa), \'EB Garamond\', serif', spellcheck: 'false' });
  const tp = passFields('sealing');
  const tabErr = h('div'), tabOut = h('div');

  page('TABULARIUM', 'Private documents', [
    h('p', { class: 'initial' }, 'Seal your own records before you keep them in Google Drive or anywhere else. Only someone with the document passphrase can open them.'),
    h('p', { class: 'small' }, 'Files use the open age format: you can also open them on any computer with the official age tool, even without this app. This is strong standard encryption (scrypt and ChaCha20-Poly1305), not the One-Time Pad. Its strength rests on your passphrase, which cannot be recovered if forgotten.'),

    h('h2', { class: 'rubric' }, 'Sigilla · Seal'),
    h('label', { class: 'field' }, h('span', null, 'Document'), sealIn),
    h('label', { class: 'check' }, hide, h('span', null, 'Hide the file name (the sealed file gets a random name; the real one is kept inside)')),
    sp.el,
    sealErr,
    h('button', { class: 'btn block', onclick: async () => {
      clear(sealErr); clear(sealOut);
      try {
        const f = sealIn.files[0];
        if (!f) throw new Error('Choose a document.');
        const pass = sp.get();
        const r = await busy('Sealing the document…', () => sealFile(f, pass, { hideName: hide.checked }));
        download(r.name, r.blob, 'application/octet-stream');
        sealIn.value = '';
        sealOut.append(notice('Sigillatum', `Saved as “${r.name}” (${fmtBytes(r.blob.size)}). Upload it to Google Drive, then delete the original if you no longer need it on this device.`, true));
      } catch (e) { showError(sealErr, e); }
    } }, 'SIGILLA', h('small', null, 'seal')),
    sealOut,

    h('h2', { class: 'rubric' }, 'Aperi · Open'),
    h('label', { class: 'field' }, h('span', null, 'Sealed file (.age)'), openIn),
    op.el,
    openErr,
    h('button', { class: 'btn block', onclick: async () => {
      clear(openErr); clear(openOut);
      try {
        const f = openIn.files[0];
        if (!f) throw new Error('Choose a sealed file.');
        const pass = op.get();
        const r = await busy('Opening the document…', () => openFile(f, pass));
        const typed = new Blob([r.blob], { type: mimeFor(r.name) });
        const url = urlFor(typed);
        const isImg = typed.type.startsWith('image/');
        const isText = typed.type.startsWith('text/') || typed.type === 'application/json';
        openOut.append(h('div', { class: 'panel ornate' },
          h('h3', { style: 'margin:0; font-family:Cinzel,serif; font-size:16px' }, r.name),
          h('p', { class: 'small' }, `${fmtBytes(typed.size)}${r.hiddenName ? ' · name was hidden' : ''}`),
          isImg ? h('img', { src: url, alt: r.name, style: 'max-width:100%; margin-top:10px; border:1px solid #DCCBA6' }) : null,
          isText ? h('pre', { class: 'plaintext', style: 'font-family:inherit; font-size:17px; max-height:360px; overflow:auto; margin-top:10px' }, await typed.slice(0, 200000).text()) : null,
          h('div', { class: 'row', style: 'margin-top:12px' },
            !isText ? h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, 'OPEN') : null,
            h('a', { class: 'btn ghost', href: url, download: r.name }, 'SAVE'))));
      } catch (e) { showError(openErr, e); }
    } }, 'APERI', h('small', null, 'open')),
    openOut,

    h('h2', { class: 'rubric' }, 'Tabula · Sealed Google Docs'),
    h('p', { class: 'small' }, 'A Tabula is a document written only in signs, for example inside a Google Doc sealed with the Chrome extension. Here you can read one by pasting its signs, or write one to paste into a document.'),
    tabErr,
    h('label', { class: 'field' }, h('span', null, 'Paste the signs (INCIPIT TABULA … EXPLICIT), or write plain text to seal'), tabIn),
    tp.el,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: async () => {
        clear(tabErr); clear(tabOut);
        try {
          const pass = tp.get();
          const r = await busy('Opening…', () => openText(tabIn.value, pass));
          tabOut.append(h('div', { class: 'panel ornate' },
            r.title ? h('h3', { style: 'margin:0 0 8px; font-family:Cinzel,serif; font-size:16px' }, r.title) : null,
            h('div', { class: 'plaintext', style: 'font-size:18px' }, r.text)));
        } catch (e) { showError(tabErr, e); }
      } }, 'LEGE TABULAM', h('small', null, 'read')),
      h('button', { class: 'btn ghost', onclick: async () => {
        clear(tabErr); clear(tabOut);
        try {
          if (!tabIn.value.trim()) throw new Error('Write the text to seal.');
          if (tabIn.value.includes('INCIPIT TABULA')) throw new Error('This is already sealed.');
          const pass = tp.get({ sealing: true });
          const a = await busy('Sealing…', () => sealText({ title: '', text: tabIn.value }, pass));
          tabIn.value = a;
          tabOut.append(notice('Obsignata', 'The box now holds the signs. Copy them into a Google Doc (or anywhere).', true),
            h('button', { class: 'btn block', onclick: async () => { try { await navigator.clipboard.writeText(a); toast('Copied.'); } catch { toast('Select the text by hand.'); } } }, 'COPY'));
        } catch (e) { showError(tabErr, e); }
      } }, 'SCRIBE TABULAM', h('small', null, 'seal text'))),
    tabOut,
  ]);
};

// ---------------------------------------------------------------- manual
VIEWS.manual = () => {
  page('LIBER', 'Manual', [h('div', { class: 'manual' },
    MANUAL.map(([la, en, ps]) => [h('h3', null, `${la} · ${en}`), ps.map((t) => h('p', null, t))]),
    h('h3', null, 'Alphabetum · The 32 signs'),
    h('p', { class: 'small' }, 'Each sign stands for 5 bits. The order is fixed (see PROTOCOL.md).'),
    h('table', null, ALPHABET.map((a, i) => h('tr', null, h('td', { class: 's' }, glyphSpan(a.g)), h('td', null, a.name), h('td', null, String(i))))),
    h('h3', null, 'Editio'), h('p', { class: 'small' }, `Version ${VERSION}. Not independently audited.`))]);
};

// ---------------------------------------------------------------- inactivity lock
function armLock() {
  clearTimeout(lockTimer);
  if (!session.unlocked) return;
  const mins = session.settings().lockMinutes || 5;
  lockTimer = setTimeout(() => lockNow('Obseratum'), mins * 60000);
}

function lockNow(msg) {
  clearTimeout(lockTimer);
  docPass = null;
  for (const u of blobUrls) URL.revokeObjectURL(u);
  blobUrls.length = 0;
  session.lock();
  VIEWS.gate(msg);
}

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (session.unlocked && hiddenAt && Date.now() - hiddenAt > (session.settings().lockMinutes || 5) * 60000) lockNow('Obseratum');
});
for (const ev of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(ev, () => { if (session.unlocked) armLock(); }, { passive: true });

// ---------------------------------------------------------------- service worker (updates only on consent)
function updateBanner(reg) {
  if (document.querySelector('.banner')) return;
  const b = h('div', { class: 'banner', role: 'status' },
    h('span', { class: 'grow' }, 'Nova editio: a new version is ready. Compare the code fingerprint with your partner after updating.'),
    h('button', { class: 'btn', onclick: () => reg.waiting && reg.waiting.postMessage('skipWaiting') }, 'UPDATE'));
  document.body.prepend(b);
}

async function initSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    if (reg.waiting && navigator.serviceWorker.controller) updateBanner(reg);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) updateBanner(reg); });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
  } catch { /* offline use still works once installed */ }
}

// ---------------------------------------------------------------- single window
function holdWindowLock() {
  if (!navigator.locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    navigator.locks.request('clavis-astrae-vault', { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(false); return; }
      resolve(true);
      return new Promise(() => {}); // held for the life of this window
    });
  });
}

(async function start() {
  const ok = await holdWindowLock();
  if (!ok) {
    clear(app);
    app.append(h('header', { class: 'masthead' }, astrolabe(), h('h1', null, 'CLAVIS ASTRAE')),
      h('main', null, notice('Alia fenestra', 'Clavis Astrae is already open in another window or tab. Use that one: only one window may hold the vault, so no key byte can ever be used twice.')));
    return;
  }
  initSW();
  VIEWS.gate();
})();
