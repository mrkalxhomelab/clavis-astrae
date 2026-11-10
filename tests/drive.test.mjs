// The Drive client against a fake Drive API (no network): folder creation,
// listing with paging, resumable upload, download, bin, token refresh on 401.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Drive, FOLDER_NAME } from '../extension/src/drive.js';
import { sealFile, openFile } from '../src/core/tabularium.js';

function fakeDrive() {
  const files = new Map(); let n = 0; let expired = true; const seen = []; const stats = { unauthorized: 0 };
  const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const fetchImpl = async (url, opts = {}) => {
    seen.push(`${opts.method || 'GET'} ${url}`);
    const auth = opts.headers?.Authorization;
    if (auth === 'Bearer old' && expired) { stats.unauthorized++; return json({ error: { message: 'expired' } }, 401); }
    assert.match(auth, /^Bearer /);
    const u = new URL(url);
    if (u.pathname === '/drive/v3/files' && (opts.method || 'GET') === 'GET') {
      const q = u.searchParams.get('q');
      const folder = q.match(/^'([^']+)' in parents/)?.[1];
      let list = [...files.values()].filter((f) => !f.trashed && (folder ? f.parents?.includes(folder) : f.name === FOLDER_NAME && f.mimeType.includes('folder')));
      const page = Number(u.searchParams.get('pageToken') || 0);
      const out = list.slice(page, page + 2);
      return json({ files: out.map(({ id, name, size, modifiedTime }) => ({ id, name, size, modifiedTime })), nextPageToken: page + 2 < list.length ? String(page + 2) : undefined });
    }
    if (u.pathname === '/drive/v3/files' && opts.method === 'POST') {
      const meta = JSON.parse(opts.body); const id = 'F' + (++n);
      files.set(id, { id, ...meta }); return json({ id });
    }
    if (u.pathname === '/upload/drive/v3/files' && opts.method === 'POST') {
      const meta = JSON.parse(opts.body); const id = 'U' + (++n);
      files.set(id, { id, ...meta, modifiedTime: new Date().toISOString() });
      return new Response(null, { status: 200, headers: { Location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=${id}` } });
    }
    if (u.pathname === '/upload/drive/v3/files' && opts.method === 'PUT') {
      const f = files.get(u.searchParams.get('upload_id'));
      f.data = new Uint8Array(await opts.body.arrayBuffer()); f.size = String(f.data.length);
      return json({ id: f.id, name: f.name, size: f.size });
    }
    const m = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (m && u.searchParams.get('alt') === 'media') return new Response(files.get(m[1]).data);
    if (m && opts.method === 'PATCH') { Object.assign(files.get(m[1]), JSON.parse(opts.body)); return json({ id: m[1] }); }
    return json({ error: { message: 'not found' } }, 404);
  };
  let token = 'old';
  return {
    files, seen, stats,
    drive: new Drive({ fetchImpl, getToken: async () => token, dropToken: async () => { token = 'new'; expired = true; } }),
  };
}

test('drive client: folder, upload, paged list, download+open, bin, token refresh', async () => {
  const { drive, files, stats } = fakeDrive();
  const pass = 'documenta mea secreta';
  for (const name of ['uno.txt', 'due.pdf', 'tre.png']) {
    const s = await sealFile(new File([`contenuto di ${name}`], name), pass, { logN: 10, hideName: name === 'tre.png' });
    await drive.upload(s.name, s.blob);
  }
  assert.equal([...files.values()].filter((f) => f.mimeType?.includes('folder')).length, 1, 'one folder only');
  assert.equal(stats.unauthorized, 1, 'expired token dropped once, then the new one is used');
  const list = await drive.list();
  assert.equal(list.length, 3, 'paging gathers all files');
  const due = list.find((f) => f.name === 'due.pdf.age');
  const r = await openFile(new File([await drive.download(due.id)], due.name), pass);
  assert.equal(r.name, 'due.pdf');
  assert.equal(await r.blob.text(), 'contenuto di due.pdf');
  const hidden = list.find((f) => /^[0-9a-f]{12}\.age$/.test(f.name));
  assert.equal((await openFile(new File([await drive.download(hidden.id)], hidden.name), pass)).name, 'tre.png');
  await drive.trash(due.id);
  assert.equal((await drive.list()).length, 2);
  await assert.rejects(drive.download('../etc'), /bad file id/);
});
