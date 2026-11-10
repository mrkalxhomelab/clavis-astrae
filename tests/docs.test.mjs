// Google Docs client against a fake Docs API: text extraction, creating a
// sealed doc, opening it, editing with revision control (no silent overwrite).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Docs, plainText, docIdFromUrl, bodyEnd } from '../extension/src/docs.js';
import { sealText, openText, isTabula } from '../src/core/tabula.js';

// A tiny model of a Google Doc: body text as one paragraph (index 1 = first char, UTF-16 units).
function fakeDocs() {
  const store = new Map(); let n = 0;
  const docJson = (d) => ({ documentId: d.id, title: d.title, revisionId: 'r' + d.rev,
    body: { content: [{ endIndex: 1, sectionBreak: {} }, { startIndex: 1, endIndex: 1 + d.text.length + 1, paragraph: { elements: [{ textRun: { content: d.text + '\n' } }] } }] } });
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.pathname === '/v1/documents' && opts.method === 'POST') {
      const id = 'D' + String(++n).padStart(24, '0'); store.set(id, { id, title: JSON.parse(opts.body).title, text: '', rev: 1 });
      return json({ documentId: id });
    }
    let m = u.pathname.match(/^\/v1\/documents\/([^:]+)$/);
    if (m) return store.has(m[1]) ? json(docJson(store.get(m[1]))) : json({ error: { message: 'nf' } }, 404);
    m = u.pathname.match(/^\/v1\/documents\/([^:]+):batchUpdate$/);
    if (m) {
      const d = store.get(m[1]); const b = JSON.parse(opts.body);
      if (b.writeControl && b.writeControl.requiredRevisionId !== 'r' + d.rev) return json({ error: { message: 'The required revision ID does not match' } }, 400);
      for (const r of b.requests) {
        if (r.deleteContentRange) { const { startIndex: s, endIndex: e } = r.deleteContentRange.range; d.text = d.text.slice(0, s - 1) + d.text.slice(e - 1); }
        if (r.insertText) { const i = r.insertText.location.index - 1; d.text = d.text.slice(0, i) + r.insertText.text + d.text.slice(i); }
        if (r.updateTextStyle) { const { endIndex } = r.updateTextStyle.range; assert.ok(endIndex <= d.text.length + 1, 'style range inside the body'); }
      }
      d.rev++; return json({});
    }
    return json({ error: { message: 'nf' } }, 404);
  };
  return { store, docs: new Docs({ fetchImpl, getToken: async () => 't', dropToken: async () => {} }) };
}

test('doc id from URL', () => {
  assert.equal(docIdFromUrl('https://docs.google.com/document/d/1AbC_dEfGhIjKlMnOpQrStUvWxYz012345/edit?tab=t.0'), '1AbC_dEfGhIjKlMnOpQrStUvWxYz012345');
  assert.equal(docIdFromUrl('https://docs.google.com/document/u/1/d/1AbC_dEfGhIjKlMnOpQrStUvWxYz012345/edit'), '1AbC_dEfGhIjKlMnOpQrStUvWxYz012345');
  assert.equal(docIdFromUrl('https://evil.example/document/d/1AbC_dEfGhIjKlMnOpQrStUvWxYz012345'), null);
});

test('plain text from paragraphs and tables', () => {
  const doc = { body: { content: [
    { sectionBreak: {}, endIndex: 1 },
    { paragraph: { elements: [{ textRun: { content: 'Titolo\n' } }] }, endIndex: 8 },
    { table: { tableRows: [{ tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: 'a\n' } }] } }] }, { content: [{ paragraph: { elements: [{ textRun: { content: 'b\n' } }] } }] }] }] }, endIndex: 20 },
    { paragraph: { elements: [{ textRun: { content: 'Fine\n' } }] }, endIndex: 26 },
  ] } };
  assert.equal(plainText(doc), 'Titolo\na\nb\nFine');
  assert.equal(bodyEnd(doc), 26);
});

test('seal into a new doc, open it, edit and save; a stale save is refused', async () => {
  const { docs, store } = fakeDocs();
  const pass = 'documenta mea secreta';
  const armored = await sealText({ title: 'Diario', text: 'Primo giorno. È andato tutto bene ☉' }, pass, { logN: 10 });
  const id = await docs.create('Tabula 1a2b3c', armored);
  const doc = await docs.get(id);
  const text = plainText(doc);
  assert.ok(isTabula(text));
  assert.ok(!store.get(id).text.includes('giorno'), 'Google sees only signs');
  const r = await openText(text, pass);
  assert.equal(r.text, 'Primo giorno. È andato tutto bene ☉');
  // edit and save
  const again = await sealText({ title: r.title, text: r.text + '\nSecondo giorno.' }, pass, { logN: 10 });
  await docs.replaceBody(doc, again);
  assert.equal((await openText(plainText(await docs.get(id)), pass)).text, 'Primo giorno. È andato tutto bene ☉\nSecondo giorno.');
  // saving again from the OLD snapshot must fail (someone else edited)
  await assert.rejects(docs.replaceBody(doc, again), (e) => e.status === 400);
});
