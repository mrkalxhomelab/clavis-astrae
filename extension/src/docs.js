// Google Docs v1 client for sealed documents (Tabula).
// Scope: https://www.googleapis.com/auth/documents (your Google Docs only).
// Only glyph text (already sealed) is ever written to Google.

const API = 'https://docs.googleapis.com/v1/documents';
export const SIGN_FONT = 'Noto Sans Symbols';

export class DocsError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function docIdFromUrl(url) {
  const m = String(url || '').match(/^https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : null;
}

// Plain text of a document body: paragraphs, tables (cell by cell), table of contents.
export function plainText(doc) {
  const out = [];
  const walk = (content) => {
    for (const el of content || []) {
      if (el.paragraph) for (const pe of el.paragraph.elements || []) { if (pe.textRun) out.push(pe.textRun.content); }
      else if (el.table) for (const row of el.table.tableRows || []) for (const cell of row.tableCells || []) walk(cell.content);
      else if (el.tableOfContents) walk(el.tableOfContents.content);
    }
  };
  walk(doc.body && doc.body.content);
  return out.join('').replace(/\n$/, '');
}

export function bodyEnd(doc) {
  const c = (doc.body && doc.body.content) || [];
  return c.length ? c[c.length - 1].endIndex : 1;
}

export class Docs {
  constructor({ getToken, dropToken, fetchImpl = (...a) => fetch(...a) }) {
    this.getToken = getToken; this.dropToken = dropToken; this.fetch = fetchImpl;
  }

  async req(url, opts = {}, retry = true) {
    const token = await this.getToken(false);
    const r = await this.fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
    if (r.status === 401 && retry) { await this.dropToken(token); return this.req(url, opts, false); }
    if (!r.ok) {
      let msg = `Google Docs error ${r.status}`;
      try { const j = await r.json(); if (j.error && j.error.message) msg += `: ${j.error.message}`; } catch { /* ignore */ }
      throw new DocsError(r.status, msg);
    }
    return r.json();
  }

  get(id) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new DocsError(0, 'bad document id');
    return this.req(`${API}/${id}?fields=documentId,title,revisionId,body`);
  }

  batch(id, requests, revisionId) {
    return this.req(`${API}/${id}:batchUpdate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests, ...(revisionId ? { writeControl: { requiredRevisionId: revisionId } } : {}) }),
    });
  }

  // Replace the whole body with `text`. Fails (HTTP 400) if someone edited the
  // document since `doc` was read, so nothing is ever silently overwritten.
  async replaceBody(doc, text) {
    const end = bodyEnd(doc);
    const reqs = [];
    if (end - 1 > 1) reqs.push({ deleteContentRange: { range: { startIndex: 1, endIndex: end - 1 } } });
    reqs.push({ insertText: { location: { index: 1 }, text } });
    await this.batch(doc.documentId, reqs, doc.revisionId);
    await this.styleSigns(doc.documentId, text);
  }

  async create(title, text) {
    const d = await this.req(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    await this.batch(d.documentId, [{ insertText: { location: { index: 1 }, text } }]);
    await this.styleSigns(d.documentId, text);
    return d.documentId;
  }

  // Cosmetic: show the signs in a symbol font. Never fatal.
  async styleSigns(id, text) {
    const len = [...text].reduce((n, ch) => n + ch.length, 0); // UTF-16 units, as the Docs API counts
    try {
      await this.batch(id, [{
        updateTextStyle: {
          range: { startIndex: 1, endIndex: 1 + len },
          textStyle: { weightedFontFamily: { fontFamily: SIGN_FONT }, fontSize: { magnitude: 14, unit: 'PT' } },
          fields: 'weightedFontFamily,fontSize',
        },
      }]);
    } catch { /* font styling is optional */ }
  }
}
