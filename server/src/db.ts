import Database from 'better-sqlite3';

const db = new Database(process.env.DB_PATH ?? 'data.sqlite');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON'); // required for ON DELETE CASCADE on shares to actually fire

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    title TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_documents_device_id ON documents(device_id);

  CREATE TABLE IF NOT EXISTS shares (
    token TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    access TEXT NOT NULL CHECK (access IN ('view', 'edit')),
    created_at INTEGER NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_shares_document_id ON shares(document_id);
`);

export interface DocumentRow {
  id: string;
  device_id: string;
  title: string;
  data: string; // JSON-serialized PDFDocument
  created_at: number;
  updated_at: number;
}

export const documentsRepo = {
  listForDevice(deviceId: string): DocumentRow[] {
    return db
      .prepare(
        'SELECT id, device_id, title, created_at, updated_at FROM documents WHERE device_id = ? ORDER BY updated_at DESC'
      )
      .all(deviceId) as DocumentRow[];
  },

  get(id: string, deviceId: string): DocumentRow | undefined {
    return db
      .prepare('SELECT * FROM documents WHERE id = ? AND device_id = ?')
      .get(id, deviceId) as DocumentRow | undefined;
  },

  // No device check — used only when a valid share token has already been
  // verified by the caller. The token is the credential in that path, not
  // the device id, so this intentionally bypasses ownership.
  getById(id: string): DocumentRow | undefined {
    return db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as
      | DocumentRow
      | undefined;
  },

  upsert(row: DocumentRow): void {
    db.prepare(
      `INSERT INTO documents (id, device_id, title, data, created_at, updated_at)
       VALUES (@id, @device_id, @title, @data, @created_at, @updated_at)
       ON CONFLICT(id) DO UPDATE SET
         title = @title,
         data = @data,
         updated_at = @updated_at
       WHERE device_id = @device_id`
    ).run(row);
  },

  remove(id: string, deviceId: string): void {
    db.prepare('DELETE FROM documents WHERE id = ? AND device_id = ?').run(id, deviceId);
  },
};

export interface ShareRow {
  token: string;
  document_id: string;
  access: 'view' | 'edit';
  created_at: number;
}

export const sharesRepo = {
  create(row: ShareRow): void {
    db.prepare(
      'INSERT INTO shares (token, document_id, access, created_at) VALUES (?, ?, ?, ?)'
    ).run(row.token, row.document_id, row.access, row.created_at);
  },

  // Looked up with no device_id check by design — a share token IS the
  // credential. Anyone holding it gets the access level it was created
  // with. This mirrors Google Docs' "anyone with the link" sharing model.
  getByToken(token: string): ShareRow | undefined {
    return db.prepare('SELECT * FROM shares WHERE token = ?').get(token) as
      | ShareRow
      | undefined;
  },

  listForDocument(documentId: string): ShareRow[] {
    return db
      .prepare('SELECT * FROM shares WHERE document_id = ? ORDER BY created_at DESC')
      .all(documentId) as ShareRow[];
  },

  revoke(token: string): void {
    db.prepare('DELETE FROM shares WHERE token = ?').run(token);
  },
};