// Tabularium extension page. Decryption happens here, in the extension's own
// origin: Google's pages never see the passphrase or the decrypted content.
import { h, clear, download } from './ui/dom.js';
import { sealFile, openFile, mimeFor, checkDocPassphrase } from './core/tabularium.js';
import { Drive, chromeTokenProvider, FOLDER_NAME } from './drive.js';

const app = document.getElementById('app');
const drive = new Drive(chromeTokenProvider());
const urls = [];
let connected = false;
let files = [];

const fmt = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MiB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${n} B`);
const notice = (head, body, good = false) => h('div', { class: `notice${good ? ' good' : ''}`, role: good ? 'status' : 'alert' }, h('span', { class: 'head' }, head), body);

function errText(e) {
  if (e.code === 'badpass') return ['Clavis falsa', 'Wrong passphrase, or the file was sealed with another one.'];
  if (e.code === 'damaged') return ['Corruptum', 'The file is damaged or was altered.'];
  if (e.code === 'weak') return ['Nimis brevis', e.message];
  if (e.code === 'format' || e.code === 'armored') return ['Non agnoscitur', e.message];
  if (e.status === 401) return ['Non conexum', 'Connect Google Drive first (you must be signed in to Chrome with your Google account).'];
  if (e.status) return ['Error Drive', e.message];
  return ['Error', e.message || String(e)];
}
function showErr(where, e) { clear(where); const [a, b] = errText(e); where.append(notice(a, b)); }

async function busy(msg, fn) {
  const b = h('div', { class: 'busy', role: 'alert' }, h('div', null, msg));
  document.body.append(b);
  try { return await fn(); } finally { b.remove(); }
}

// ---------- passphrase (kept in chrome.storage.session: memory only, cleared when Chrome closes)
async function getStored() {
  try { return (await chrome.storage.session.get('docPass')).docPass || null; } catch { return null; }
}
async function setStored(v) { try { await chrome.storage.session.set({ docPass: v }); } catch { /* ignore */ } }
async function forget() { try { await chrome.storage.session.remove('docPass'); } catch { /* ignore */ } render(); }

function passBlock(stored, confirmToo) {
  const p1 = h('input', { type: 'password', autocomplete: 'off' });
  const p2 = h('input', { type: 'password', autocomplete: 'off' });
  const rem = h('input', { type: 'checkbox' });
  const el = stored
    ? h('p', { class: 'small' }, 'Passphrase remembered until Chrome closes. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); forget(); } }, 'Forget it'))
    : h('div', null,
        h('label', { class: 'field' }, h('span', null, 'Document passphrase'), p1),
        confirmToo ? h('label', { class: 'field', style: 'margin-top:10px' }, h('span', null, 'Once more (only needed when sealing)'), p2) : null,
        h('label', { class: 'check', style: 'margin-top:10px' }, rem, h('span', null, 'Remember it until Chrome closes')));
  return {
    el,
    async get({ sealing = false } = {}) {
      const s = await getStored();
      if (s) return s;
      if (sealing && confirmToo && p1.value !== p2.value) throw new Error('The two passphrases differ.');
      const v = p1.value;
      if (sealing) checkDocPassphrase(v);
      if (rem.checked) await setStored(v);
      return v;
    },
  };
}

// ---------- viewing
function show(out, r) {
  const typed = new Blob([r.blob], { type: mimeFor(r.name) });
  const url = URL.createObjectURL(typed); urls.push(url);
  const isImg = typed.type.startsWith('image/');
  const isText = typed.type.startsWith('text/') || typed.type === 'application/json';
  const isPdf = typed.type === 'application/pdf';
  const panel = h('div', { class: 'panel ornate' },
    h('h3', { style: 'margin:0; font-family:Cinzel,serif; font-size:16px; word-break:break-all' }, r.name),
    h('p', { class: 'small' }, `${fmt(typed.size)}${r.hiddenName ? ' · name was hidden' : ''}`),
    h('div', { class: 'row', style: 'margin-top:10px' },
      isPdf || isImg ? h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, 'OPEN IN A TAB') : null,
      h('a', { class: 'btn ghost', href: url, download: r.name }, 'SAVE')));
  clear(out);
  out.append(panel);
  if (isImg) panel.append(h('img', { src: url, alt: r.name, style: 'max-width:100%; margin-top:12px; border:1px solid #DCCBA6' }));
  if (isText) typed.slice(0, 500000).text().then((t) => panel.append(h('pre', { class: 'plaintext', style: 'font-family:inherit; font-size:17px; max-height:480px; overflow:auto; margin-top:12px' }, t)));
  out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------- render
async function render() {
  const stored = await getStored();
  clear(app);
  const pb = passBlock(stored, true);
  const listErr = h('div'), listOut = h('div');
  const sealIn = h('input', { type: 'file', multiple: true });
  const hide = h('input', { type: 'checkbox' });
  const sealErr = h('div');
  const impIn = h('input', { type: 'file', accept: '.age', multiple: true });
  const impErr = h('div');
  const localIn = h('input', { type: 'file', accept: '.age' });
  const localErr = h('div'), localOut = h('div');

  const list = h('div');
  const drawList = () => {
    clear(list);
    if (!connected) { list.append(h('p', { class: 'small' }, 'Not connected.')); return; }
    if (!files.length) { list.append(h('p', { class: 'small' }, `No sealed files yet in the Drive folder “${FOLDER_NAME}”.`)); return; }
    for (const f of files) {
      list.append(h('div', { class: 'filerow' },
        h('div', null, h('div', { class: 'n' }, f.name), h('div', { class: 'm' }, `${fmt(Number(f.size || 0))} · ${new Date(f.modifiedTime).toLocaleString()}`)),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: async () => {
            clear(listErr);
            try {
              const pass = await pb.get();
              const r = await busy('Fetching and opening…', async () => openFile(new File([await drive.download(f.id)], f.name), pass));
              show(listOut, r);
            } catch (e) { showErr(listErr, e); }
          } }, 'APERI'),
          h('button', { class: 'btn ghost', onclick: async () => {
            if (!confirm(`Move “${f.name}” to the Drive bin?`)) return;
            try { await drive.trash(f.id); await refresh(); } catch (e) { showErr(listErr, e); }
          } }, 'BIN'))));
    }
  };

  async function refresh() {
    try { files = await busy('Reading the Drive folder…', () => drive.list()); connected = true; } catch (e) { connected = false; showErr(listErr, e); }
    drawList();
  }

  app.append(
    h('header', { class: 'masthead compact' },
      h('div', { class: 'grow' }, h('h1', null, 'TABULARIUM'), h('div', { class: 'sub' }, 'Clavis Astrae · private documents on Google Drive'))),
    h('main', null,
      h('p', { class: 'initial' }, 'Documents are sealed and opened only here, on this computer. Google Drive stores nothing but sealed .age files, and this extension can see only the files it put there itself.'),

      h('h2', { class: 'rubric' }, 'Tessera'),
      pb.el,

      h('h2', { class: 'rubric' }, 'Arca in Drive'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: async () => {
          clear(listErr);
          try { await drive.getToken(true); await refresh(); } catch (e) { showErr(listErr, e); }
        } }, connected ? 'REFRESH' : 'CONNECT GOOGLE DRIVE')),
      listErr, list, listOut,

      h('h2', { class: 'rubric' }, 'Sigilla et mitte · Seal and upload'),
      h('label', { class: 'field' }, h('span', null, 'Documents'), sealIn),
      h('label', { class: 'check' }, hide, h('span', null, 'Hide the file names on Drive')),
      sealErr,
      h('button', { class: 'btn block', onclick: async () => {
        clear(sealErr);
        try {
          if (!sealIn.files.length) throw new Error('Choose at least one document.');
          const pass = await pb.get({ sealing: true });
          await busy('Sealing and uploading…', async () => {
            for (const f of sealIn.files) {
              const s = await sealFile(f, pass, { hideName: hide.checked });
              await drive.upload(s.name, s.blob);
            }
          });
          sealIn.value = '';
          sealErr.append(notice('Missum', 'Sealed and uploaded.', true));
          await refresh();
        } catch (e) { showErr(sealErr, e); }
      } }, 'SIGILLA ET MITTE', h('small', null, 'seal & upload')),

      h('h2', { class: 'rubric' }, 'Importa · Upload files already sealed'),
      h('p', { class: 'small' }, 'For .age files you sealed in the Clavis Astrae app: upload them through here once, and the extension can open them from then on.'),
      h('label', { class: 'field' }, h('span', null, 'Sealed files (.age)'), impIn),
      impErr,
      h('button', { class: 'btn ghost block', onclick: async () => {
        clear(impErr);
        try {
          if (!impIn.files.length) throw new Error('Choose at least one .age file.');
          await busy('Uploading…', async () => {
            for (const f of impIn.files) {
              const head = await f.slice(0, 22).text();
              if (head !== 'age-encryption.org/v1\n') throw new Error(`“${f.name}” is not an age file.`);
              await drive.upload(f.name, f);
            }
          });
          impIn.value = '';
          await refresh();
        } catch (e) { showErr(impErr, e); }
      } }, 'Upload sealed files'),

      h('h2', { class: 'rubric' }, 'Aperi localiter · Open a file from this computer'),
      h('label', { class: 'field' }, h('span', null, 'Sealed file (.age)'), localIn),
      localErr,
      h('button', { class: 'btn ghost block', onclick: async () => {
        clear(localErr);
        try {
          if (!localIn.files[0]) throw new Error('Choose a sealed file.');
          const pass = await pb.get();
          show(localOut, await busy('Opening…', () => openFile(localIn.files[0], pass)));
        } catch (e) { showErr(localErr, e); }
      } }, 'APERI'),
      localOut),
    h('footer', { class: 'colophon' }, 'Verba volant, scripta manent.'));

  drawList();
  // Silent reconnect if Chrome already granted access.
  if (!connected) drive.getToken(false).then(() => refresh()).catch(() => {});
}

window.addEventListener('pagehide', () => { for (const u of urls) URL.revokeObjectURL(u); });
render();
