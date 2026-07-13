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

    -- Auth: a user is identified by email only (magic link, no passwords).
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      created_at BIGINT NOT NULL
    );

    -- One-time tokens emailed to the user. Deliberately short-lived and
    -- single-use (see 'used' flag) — this table is the actual credential
    -- until it's exchanged for a session, so it needs the same care as a
    -- password reset token would.
    CREATE TABLE IF NOT EXISTS magic_links (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      used BOOLEAN NOT NULL DEFAULT false
    );

    -- Long-lived session tokens, set as an httpOnly cookie. Separate from
    -- magic_links so that verifying a magic link exchanges it for a
    -- session rather than the magic link itself living on as a credential.
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'none',
      provider TEXT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      crypto_tx_ref TEXT,
      current_period_end TIMESTAMP,
      cancel_at_period_end BOOLEAN DEFAULT false
    );

    -- Nullable, additive column: anonymous (device_id-only) documents keep
    -- working exactly as before. Once a device logs in, documents created
    -- afterward (and existing ones via a one-time "claim" step) get this
    -- set too, so a user's documents follow them across devices.
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
  `);
}

export interface DocumentRow {
  id: string;
  device_id: string;
  title: string;
  data: string; // JSON-serialized PDFDocument
  created_at: number;
  updated_at: number;
  user_id?: string | null;
}

export const documentsRepo = {
  async listForDevice(deviceId: string): Promise<DocumentRow[]> {
    const { rows } = await pool.query(
      'SELECT id, device_id, title, created_at, updated_at, user_id FROM documents WHERE device_id = $1 ORDER BY updated_at DESC',
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
      `INSERT INTO documents (id, device_id, title, data, created_at, updated_at, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         data = EXCLUDED.data,
         updated_at = EXCLUDED.updated_at,
         user_id = COALESCE(documents.user_id, EXCLUDED.user_id)
       WHERE documents.device_id = EXCLUDED.device_id`,
      [row.id, row.device_id, row.title, row.data, row.created_at, row.updated_at, row.user_id ?? null]
    );
  },

  async remove(id: string, deviceId: string): Promise<void> {
    await pool.query('DELETE FROM documents WHERE id = $1 AND device_id = $2', [id, deviceId]);
  },

  // One-time migration when a device logs in: attach any of its existing
  // anonymous documents to the new user_id. Only touches rows that aren't
  // already claimed, so re-running this (e.g. logging in again) is safe.
  async claimForUser(deviceId: string, userId: string): Promise<void> {
    await pool.query(
      'UPDATE documents SET user_id = $1 WHERE device_id = $2 AND user_id IS NULL',
      [userId, deviceId]
    );
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

export interface UserRow {
  id: string;
  email: string;
  created_at: number;
}

export const usersRepo = {
  async getByEmail(email: string): Promise<UserRow | undefined> {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return rows[0];
  },

  async getById(id: string): Promise<UserRow | undefined> {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0];
  },

  async create(row: UserRow): Promise<void> {
    await pool.query(
      'INSERT INTO users (id, email, created_at) VALUES ($1, $2, $3)',
      [row.id, row.email, row.created_at]
    );
  },

  // Finds the user for this email, creating one if this is their first
  // time signing in. A magic link with an unrecognized email is a valid
  // "sign up" flow, not an error — there's no separate registration step.
  async findOrCreate(email: string, newId: string): Promise<UserRow> {
    const existing = await this.getByEmail(email);
    if (existing) return existing;
    const row: UserRow = { id: newId, email, created_at: Date.now() };
    await this.create(row);
    return row;
  },
};

export interface MagicLinkRow {
  token: string;
  email: string;
  expires_at: number;
  used: boolean;
}

export const magicLinksRepo = {
  async create(row: MagicLinkRow): Promise<void> {
    await pool.query(
      'INSERT INTO magic_links (token, email, expires_at, used) VALUES ($1, $2, $3, $4)',
      [row.token, row.email, row.expires_at, row.used]
    );
  },

  async getByToken(token: string): Promise<MagicLinkRow | undefined> {
    const { rows } = await pool.query('SELECT * FROM magic_links WHERE token = $1', [token]);
    return rows[0];
  },

  async markUsed(token: string): Promise<void> {
    await pool.query('UPDATE magic_links SET used = true WHERE token = $1', [token]);
  },
};

export interface SessionRow {
  token: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

export const sessionsRepo = {
  async create(row: SessionRow): Promise<void> {
    await pool.query(
      'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
      [row.token, row.user_id, row.created_at, row.expires_at]
    );
  },

  async getByToken(token: string): Promise<SessionRow | undefined> {
    const { rows } = await pool.query('SELECT * FROM sessions WHERE token = $1', [token]);
    return rows[0];
  },

  async remove(token: string): Promise<void> {
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  },

  // Pushes a session's expiry forward — called on every authenticated
  // request so "signed in" means "active within the last N days" rather
  // than a fixed expiry counted from login time.
  async refresh(token: string, newExpiresAt: number): Promise<void> {
    await pool.query('UPDATE sessions SET expires_at = $1 WHERE token = $2', [newExpiresAt, token]);
  },
};