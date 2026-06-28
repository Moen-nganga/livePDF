import Database from 'better-sqlite3';

const db = new Database(process.env.DB_PATH ?? 'data.sqlite');
db.pragma('journal_mode = WAL');

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
