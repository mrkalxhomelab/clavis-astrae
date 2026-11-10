// Sealed Google Docs (Tabula): seal a document into glyphs, or open, edit and
// re-seal one. Everything is decrypted here, in the extension's own page.
import { h, clear, download } from './ui/dom.js';
import { generaPanel } from './ui/genera.js';
import { sealText, openText, isTabula } from './core/tabula.js';
import { checkDocPassphrase } from './core/tabularium.js';
import { TransitError } from './core/codec.js';
import { toHex, randomBytes } from './core/bytes.js';
import { Docs, docIdFromUrl, plainText } from './docs.js';
import { chromeTokenProvider } from './drive.js';

const app = document.getElementById('app');
const docs = new Docs(chromeTokenProvider());
const tokens = chromeTokenProvider();
let dirty = false;

const notice = (head, body, good = false) => h('div', { class: `notice${good ? ' good' : ''}`, role: good ? 'status' : 'alert' }, h('span', { class: 'head' }, head), body);
function errText(e) {
  if (e instanceof TransitError) return ['Litterae corruptae', `The signs in this document are damaged or incomplete (${e.message}).`];
  if (e.code === 'badpass') return ['Clavis falsa', 'Wrong passphrase.'];
  if (e.code === 'damaged') return ['Corruptum', 'The sealed document was altered.'];
  if (e.code === 'weak' || e.code === 'toolong') return ['Cave', e.message];
  if (e.status === 401) return ['Non conexum', 'Connect your Google account first.'];
  if (e.status === 400 && /revision/i.test(e.message)) return ['Mutatum', 'The document changed on Google since you opened it. Reload this page and open it again; your edits are still in the box, copy them first.'];
  if (e.status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(e.message)) return ['API non activa', `The Google Docs API is not enabled in your Google Cloud project. Enable it (APIs & Services → Library → Google Docs API), wait a minute, then reload. (${e.message})`];
  if (e.status === 403 && /insufficient|scope|permission/i.test(e.message)) return ['Licentia deest', `Google gave this extension an older permission without access to Docs. Press RECONNECT below and allow access to Google Docs. (${e.message})`];
  if (e.status === 400 && /not supported/i.test(e.message)) return ['Non Google Doc', 'This is a Word or other uploaded file shown in Docs, not a native Google Doc. In Docs choose File → Save as Google Docs, then use the copy.'];
  if (e.status === 403 || e.status === 404) return ['Non accessibile', `Google refused access to this document. If you are signed into several Google accounts, the document must belong to the one Chrome is signed into. Press RECONNECT to choose again. (${e.message})`];
  if (e.status) return ['Error Google', e.message];
  return ['Error', e.message || String(e)];
}
async function reconnect() {
  await new Promise((r) => (chrome.identity.clearAllCachedAuthTokens ? chrome.identity.clearAllCachedAuthTokens(r) : r()));
  await tokens.getToken(true);
  location.reload();
}
const showErr = (where, e) => {
  clear(where);
  const [a, b] = errText(e);
  where.append(notice(a, b));
  if (e.status === 401 || e.status === 403 || e.status === 404) {
    where.append(h('button', { class: 'btn ghost block', style: 'margin-top:10px', onclick: () => reconnect().catch((x) => showErr(where, x)) }, 'RECONNECT'));
  }
};
async function busy(msg, fn) {
  const b = h('div', { class: 'busy', role: 'alert' }, h('div', null, msg));
  document.body.append(b);
  try { return await fn(); } finally { b.remove(); }
}

async function storedPass() { try { return (await chrome.storage.session.get('docPass')).docPass || null; } catch { return null; } }
async function rememberPass(v) { try { await chrome.storage.session.set({ docPass: v }); } catch { /* ignore */ } }

function frame(sub, ...body) {
  clear(app);
  app.append(
    h('header', { class: 'masthead compact' }, h('div', { class: 'grow' }, h('h1', null, 'TABULA'), h('div', { class: 'sub' }, sub))),
    h('main', null, ...body),
    h('footer', { class: 'colophon' }, 'Stat rosa pristina nomine, nomina nuda tenemus.'));
}

async function passInputs(confirmToo) {
  const s = await storedPass();
  const p1 = h('input', { type: 'password', autocomplete: 'off' });
  const p2 = h('input', { type: 'password', autocomplete: 'off' });
  const rem = h('input', { type: 'checkbox' });
  return {
    el: s ? h('p', { class: 'small' }, 'Using the document passphrase remembered until Chrome closes.') : h('div', null,
      h('label', { class: 'field' }, h('span', null, 'Document passphrase'), p1),
      confirmToo ? h('label', { class: 'field', style: 'margin-top:10px' }, h('span', null, 'Once more'), p2) : null,
      confirmToo ? generaPanel([p1, p2]) : null,
      h('label', { class: 'check', style: 'margin-top:10px' }, rem, h('span', null, 'Remember it until Chrome closes'))),
    async get() {
      if (s) return s;
      if (confirmToo) { if (p1.value !== p2.value) throw new Error('The two passphrases differ.'); checkDocPassphrase(p1.value); }
      if (rem.checked) await rememberPass(p1.value);
      return p1.value;
    },
  };
}

// ---------------------------------------------------------------- entry
async function start() {
  const id = new URLSearchParams(location.search).get('doc');
  if (!id) return chooseDoc();
  const err = h('div');
  frame('Opening the document…', err);
  try {
    let doc;
    try { doc = await docs.get(id); } catch (e) {
      if (e.status !== 401) throw e;
      return connectFirst(id);
    }
    const text = plainText(doc);
    if (isTabula(text)) return openView(doc, text);
    return sealView(doc, text);
  } catch (e) { showErr(err, e); }
}

function chooseDoc() {
  const url = h('input', { type: 'text', placeholder: 'https://docs.google.com/document/d/…' });
  const err = h('div');
  frame('Seal or open a Google Doc',
    h('p', { class: 'initial' }, 'Open the Google Doc in Chrome and click the Tabularium icon, or paste its link here.'),
    h('label', { class: 'field' }, h('span', null, 'Link of the Google Doc'), url), err,
    h('button', { class: 'btn block', onclick: () => {
      const id = docIdFromUrl(url.value.trim());
      if (!id) return showErr(err, new Error('That is not a Google Docs link.'));
      location.search = '?doc=' + id;
    } }, 'PERGE', h('small', null, 'continue')));
}

function connectFirst(id) {
  const err = h('div');
  frame('Connect your Google account',
    h('p', null, 'Allow Tabularium to read and write your Google Docs. Sealing and opening happen only on this computer.'), err,
    h('button', { class: 'btn block', onclick: async () => {
      try { await tokens.getToken(true); location.search = '?doc=' + id; } catch (e) { showErr(err, e); }
    } }, 'CONNECT GOOGLE'));
}

// ---------------------------------------------------------------- seal a plain document
async function sealView(doc, text) {
  const hideTitle = h('input', { type: 'checkbox' });
  const pi = await passInputs(true);
  const err = h('div'), out = h('div');
  frame(`Seal “${doc.title}”`,
    h('p', { class: 'initial' }, 'This document is not sealed yet. Tabularium will create a NEW Google Doc that holds only astrological signs. The original is not changed.'),
    h('h2', { class: 'rubric' }, 'Textus'),
    h('div', { class: 'panel preview' }, text.slice(0, 1500) + (text.length > 1500 ? '…' : '')),
    h('p', { class: 'small' }, `${[...text].length} characters. Only the plain text is sealed: bold, headings, tables, images and comments are not kept.`),
    h('label', { class: 'check' }, hideTitle, h('span', null, 'Hide the title too (the new document gets a neutral name; the real title is kept inside)')),
    pi.el, err,
    h('button', { class: 'btn block', onclick: async () => {
      clear(err);
      try {
        const pass = await pi.get();
        const armored = await busy('Sealing…', () => sealText({ title: doc.title, text }, pass));
        const title = hideTitle.checked ? `Tabula ${toHex(randomBytes(3))}` : `${doc.title} · sigillatum`;
        const newId = await busy('Writing the sealed document…', () => docs.create(title, armored));
        const link = `https://docs.google.com/document/d/${newId}/edit`;
        clear(out);
        out.append(
          notice('Sigillatum', 'The sealed document is ready.', true),
          h('div', { class: 'row' },
            h('a', { class: 'btn', href: link, target: '_blank', rel: 'noopener' }, 'OPEN THE SEALED DOC'),
            h('a', { class: 'btn ghost', href: `?doc=${newId}` }, 'TEST: OPEN IT HERE')),
          h('h2', { class: 'rubric' }, 'Ultimum · Last steps'),
          h('ol', null,
            h('li', null, 'Check that the sealed document opens here with your passphrase (button above).'),
            h('li', null, 'Then delete the original: open it, File → Move to bin. Then empty the Drive bin.'),
            h('li', null, 'The original’s version history goes with it. The new document’s history holds only signs.')));
      } catch (e) { showErr(err, e); }
    } }, 'OBSIGNA', h('small', null, 'seal into a new document')),
    out);
}

// ---------------------------------------------------------------- open, edit, re-seal
async function openView(doc, armored) {
  const pi = await passInputs(false);
  const err = h('div');
  const go = async () => {
    clear(err);
    try {
      const pass = await pi.get();
      const r = await busy('Opening…', () => openText(armored, pass));
      editor(doc, r, pass);
    } catch (e) { showErr(err, e); }
  };
  frame(`“${doc.title}”`,
    h('p', { class: 'initial' }, 'This Google Doc is sealed. Anyone else sees only the signs.'),
    h('div', { class: 'panel signs-preview', 'aria-hidden': 'true' }, armored.slice(0, 400)),
    pi.el, err,
    h('button', { class: 'btn block', onclick: go }, 'APERI', h('small', null, 'open')));
  if (await storedPass()) go();
}

function editor(doc, opened, pass) {
  const title = h('input', { type: 'text', value: opened.title });
  const ta = h('textarea', { class: 'editor', spellcheck: 'true' });
  ta.value = opened.text;
  const err = h('div');
  const status = h('p', { class: 'small' }, 'Saved.');
  const mark = () => { dirty = true; status.textContent = 'Unsaved changes.'; };
  ta.addEventListener('input', mark); title.addEventListener('input', mark);
  let current = doc;
  frame('Opened · edits are sealed again when you save',
    h('label', { class: 'field' }, h('span', null, 'Title (inside the seal)'), title),
    h('label', { class: 'field' }, h('span', null, 'Text'), ta),
    status, err,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: async () => {
        clear(err);
        try {
          const armored = await busy('Sealing…', () => sealText({ title: title.value, text: ta.value }, pass));
          await busy('Writing to Google Docs…', () => docs.replaceBody(current, armored));
          current = await docs.get(current.documentId);
          dirty = false; status.textContent = `Saved and sealed · ${new Date().toLocaleTimeString()}`;
        } catch (e) { showErr(err, e); }
      } }, 'SERVA', h('small', null, 'save')),
      h('button', { class: 'btn ghost', onclick: () => download(`${title.value || 'tabula'}.txt`, ta.value, 'text/plain') }, 'EXPORT .TXT'),
      h('button', { class: 'btn ghost', onclick: () => { if (!dirty || confirm('Close without saving?')) { dirty = false; ta.value = ''; window.close(); } } }, 'CLOSE')),
    h('p', { class: 'small' }, 'Google keeps every saved version, but each version holds only signs. “Export .txt” writes the plain text to this computer: delete it when done.'));
  ta.focus();
}

window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
start();
