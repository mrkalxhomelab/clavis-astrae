// Minimal Google Drive v3 client. Scope: drive.file — the extension can see
// ONLY the files it created itself (or that you upload through it).
// No file contents are ever sent in clear: only already-sealed .age bytes.

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_NAME = 'Clavis Astrae Tabularium';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class DriveError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class Drive {
  // getToken(interactive) -> Promise<string>; dropToken(token) -> Promise<void>
  constructor({ getToken, dropToken, fetchImpl = (...a) => fetch(...a) }) {
    this.getToken = getToken; this.dropToken = dropToken; this.fetch = fetchImpl; this.folderId = null;
  }

  async req(url, opts = {}, retry = true) {
    const token = await this.getToken(false);
    const r = await this.fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
    if (r.status === 401 && retry) {
      await this.dropToken(token);
      return this.req(url, opts, false);
    }
    if (!r.ok) {
      let msg = `Google Drive error ${r.status}`;
      try { const j = await r.json(); if (j.error && j.error.message) msg += `: ${j.error.message}`; } catch { /* ignore */ }
      throw new DriveError(r.status, msg);
    }
    return r;
  }

  async folder() {
    if (this.folderId) return this.folderId;
    const q = `name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`;
    const r = await (await this.req(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`)).json();
    if (r.files && r.files.length) return (this.folderId = r.files[0].id);
    const c = await (await this.req(`${API}/files?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
    })).json();
    return (this.folderId = c.id);
  }

  async list() {
    const id = await this.folder();
    const q = `'${id}' in parents and trashed=false`;
    const files = [];
    let page = '';
    do {
      const r = await (await this.req(`${API}/files?q=${encodeURIComponent(q)}&orderBy=modifiedTime desc&pageSize=200&fields=nextPageToken,files(id,name,size,modifiedTime)${page ? '&pageToken=' + encodeURIComponent(page) : ''}`)).json();
      files.push(...(r.files || []));
      page = r.nextPageToken || '';
    } while (page);
    return files;
  }

  // Resumable upload: works for any size.
  async upload(name, blob) {
    const id = await this.folder();
    const start = await this.req(`${UPLOAD}/files?uploadType=resumable&fields=id,name,size`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(blob.size) },
      body: JSON.stringify({ name, parents: [id], mimeType: 'application/octet-stream' }),
    });
    const loc = start.headers.get('Location');
    if (!loc || !loc.startsWith(UPLOAD + '/')) throw new DriveError(0, 'unexpected upload location');
    const r = await this.req(loc, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
    return r.json();
  }

  async download(fileId) {
    if (!/^[A-Za-z0-9_-]+$/.test(fileId)) throw new DriveError(0, 'bad file id');
    const r = await this.req(`${API}/files/${fileId}?alt=media`);
    return r.blob();
  }

  async trash(fileId) {
    if (!/^[A-Za-z0-9_-]+$/.test(fileId)) throw new DriveError(0, 'bad file id');
    await this.req(`${API}/files/${fileId}?fields=id`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
    });
  }
}

// Chrome identity glue (only used inside the extension).
export function chromeTokenProvider() {
  return {
    getToken: (interactive = false) => new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (res) => {
        const err = chrome.runtime.lastError;
        const token = typeof res === 'string' ? res : res && res.token;
        if (err || !token) reject(new DriveError(401, (err && err.message) || 'not signed in'));
        else resolve(token);
      });
    }),
    dropToken: (token) => new Promise((resolve) => chrome.identity.removeCachedAuthToken({ token }, resolve)),
  };
}
