// Persistence adapters. A save is atomic and guarded by a generation counter,
// so two windows (or a stale tab) can never overwrite each other's state.

export class StoreError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export class MemoryStore {
  constructor() { this.record = null; this.failNext = false; }
  async load() { return this.record ? structuredClone(this.record) : null; }
  async save(record, expectedGen, { force = false } = {}) {
    if (this.failNext) { this.failNext = false; throw new StoreError('io', 'simulated storage failure'); }
    const cur = this.record ? this.record.gen : 0;
    if (!force && cur !== expectedGen) throw new StoreError('conflict', 'vault changed in another window');
    this.record = structuredClone(record);
  }
  async clear() { this.record = null; }
}

export class IDBStore {
  constructor(name = 'clavis-astrae') { this.name = name; }
  db() {
    if (this._db) return this._db;
    this._db = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('vault');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._db;
  }
  async load() {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const r = db.transaction('vault', 'readonly').objectStore('vault').get('main');
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  }
  async save(record, expectedGen, { force = false } = {}) {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('vault', 'readwrite', { durability: 'strict' });
      const st = tx.objectStore('vault');
      let conflict = false;
      const g = st.get('main');
      g.onsuccess = () => {
        const cur = g.result ? g.result.gen : 0;
        if (!force && cur !== expectedGen) { conflict = true; tx.abort(); return; }
        st.put(record, 'main');
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(conflict
        ? new StoreError('conflict', 'vault changed in another window')
        : new StoreError('io', 'could not write to storage'));
      tx.onerror = () => {};
    });
  }
  async clear() {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('vault', 'readwrite');
      tx.objectStore('vault').delete('main');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
