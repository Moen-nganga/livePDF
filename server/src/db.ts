import { Pool } from 'pg';

// Neon requires SSL. Its connection strings normally already include
// `?sslmode=require`, but we set this explicitly too so it still works
// even if that query param gets stripped (e.g. some connection poolers
// or env var editors trim it).
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Call this once at startup, before the server starts accepting requests.
// (better-sqlite3's db.exec ran synchronously at import time; pg is async,
// so table creation has to be awaited explicitly instead.)
export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      title TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_documents_device_id ON documents(device_id);

    CREATE TABLE IF NOT EXISTS shares (
      token TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      access TEXT NOT NULL CHECK (access IN ('view', 'edit')),
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shares_document_id ON shares(document_id);
  `);
}

export interface DocumentRow {
  id: string;
  device_id: string;
  title: string;
  data: string; // JSON-serialized PDFDocument
  created_at: number;
  updated_at: number;
}

export const documentsRepo = {
  async listForDevice(deviceId: string): Promise<DocumentRow[]> {
    const { rows } = await pool.query(
      'SELECT id, device_id, title, created_at, updated_at FROM documents WHERE device_id = $1 ORDER BY updated_at DESC',
      [deviceId]
    );
    return rows;
  },

  async get(id: string, deviceId: string): Promise<DocumentRow | undefined> {
    const { rows } = await pool.query(
      'SELECT * FROM documents WHERE id = $1 AND device_id = $2',
      [id, deviceId]
    );
    return rows[0];
  },

  // No device check — used only when a valid share token has already been
  // verified by the caller. The token is the credential in that path, not
  // the device id, so this intentionally bypasses ownership.
  async getById(id: string): Promise<DocumentRow | undefined> {
    const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1', [id]);
    return rows[0];
  },

  async upsert(row: DocumentRow): Promise<void> {
    // The WHERE clause on the DO UPDATE keeps the original semantics: if a
    // row with this id already exists under a *different* device_id, the
    // update is skipped (id collision doesn't let one device overwrite
    // another device's document).
    await pool.query(
      `INSERT INTO documents (id, device_id, title, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         data = EXCLUDED.data,
         updated_at = EXCLUDED.updated_at
       WHERE documents.device_id = EXCLUDED.device_id`,
      [row.id, row.device_id, row.title, row.data, row.created_at, row.updated_at]
    );
  },

  async remove(id: string, deviceId: string): Promise<void> {
    await pool.query('DELETE FROM documents WHERE id = $1 AND device_id = $2', [id, deviceId]);
  },
};

export interface ShareRow {
  token: string;
  document_id: string;
  access: 'view' | 'edit';
  created_at: number;
}

export const sharesRepo = {
  async create(row: ShareRow): Promise<void> {
    await pool.query(
      'INSERT INTO shares (token, document_id, access, created_at) VALUES ($1, $2, $3, $4)',
      [row.token, row.document_id, row.access, row.created_at]
    );
  },

  // Looked up with no device_id check by design — a share token IS the
  // credential. Anyone holding it gets the access level it was created
  // with. This mirrors Google Docs' "anyone with the link" sharing model.
  async getByToken(token: string): Promise<ShareRow | undefined> {
    const { rows } = await pool.query('SELECT * FROM shares WHERE token = $1', [token]);
    return rows[0];
  },

  async listForDocument(documentId: string): Promise<ShareRow[]> {
    const { rows } = await pool.query(
      'SELECT * FROM shares WHERE document_id = $1 ORDER BY created_at DESC',
      [documentId]
    );
    return rows;
  },

  async revoke(token: string): Promise<void> {
    await pool.query('DELETE FROM shares WHERE token = $1', [token]);
  },
};