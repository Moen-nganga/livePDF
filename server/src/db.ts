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

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      created_at BIGINT NOT NULL
    );

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

    -- Tracks Binance Pay orders from creation through to webhook
    -- confirmation. Needed because the Binance webhook payload only
    -- carries back the merchantTradeNo we gave it -- this table is what
    -- lets us map that back to "which user, which plan" once the webhook
    -- fires. (Stripe doesn't need an equivalent table: its Checkout
    -- Session already carries client_reference_id/metadata that round-trip
    -- through Stripe's own webhook automatically.)
    CREATE TABLE IF NOT EXISTS payment_orders (
      merchant_trade_no TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'binance',
      status TEXT NOT NULL DEFAULT 'created', -- created | paid | failed | expired
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_payment_orders_user_id ON payment_orders(user_id);

    ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
  `);
}

export interface DocumentRow {
  id: string;
  device_id: string;
  title: string;
  data: string;
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

  async getById(id: string): Promise<DocumentRow | undefined> {
    const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1', [id]);
    return rows[0];
  },

  async upsert(row: DocumentRow): Promise<void> {
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

  async claimForUser(deviceId: string, userId: string): Promise<void> {
    await pool.query(
      'UPDATE documents SET user_id = $1 WHERE device_id = $2 AND user_id IS NULL',
      [userId, deviceId]
    );
  },

  async countCreatedSince(owner: { userId?: string; deviceId?: string }, sinceMs: number): Promise<number> {
    if (owner.userId) {
      const { rows } = await pool.query(
        'SELECT COUNT(*) FROM documents WHERE user_id = $1 AND created_at >= $2',
        [owner.userId, sinceMs]
      );
      return Number(rows[0].count);
    }
    const { rows } = await pool.query(
      'SELECT COUNT(*) FROM documents WHERE device_id = $1 AND user_id IS NULL AND created_at >= $2',
      [owner.deviceId, sinceMs]
    );
    return Number(rows[0].count);
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

  async findOrCreate(email: string, newId: string): Promise<UserRow> {
    const existing = await this.getByEmail(email);
    if (existing) return existing;
    const row: UserRow = { id: newId, email, created_at: Date.now() };
    await this.create(row);
    return row;
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

  async refresh(token: string, newExpiresAt: number): Promise<void> {
    await pool.query('UPDATE sessions SET expires_at = $1 WHERE token = $2', [newExpiresAt, token]);
  },
};

export interface SubscriptionRow {
  user_id: string;
  plan_id: string;
  status: string;
  provider: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  crypto_tx_ref: string | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
}

export const subscriptionsRepo = {
  async getByUserId(userId: string): Promise<SubscriptionRow | undefined> {
    const { rows } = await pool.query('SELECT * FROM subscriptions WHERE user_id = $1', [userId]);
    return rows[0];
  },

  async upsert(row: Partial<SubscriptionRow> & { user_id: string }): Promise<void> {
    await pool.query(
      `INSERT INTO subscriptions (
         user_id, plan_id, status, provider, stripe_customer_id,
         stripe_subscription_id, crypto_tx_ref, current_period_end, cancel_at_period_end
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id,
         status = EXCLUDED.status,
         provider = EXCLUDED.provider,
         stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
         stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, subscriptions.stripe_subscription_id),
         crypto_tx_ref = COALESCE(EXCLUDED.crypto_tx_ref, subscriptions.crypto_tx_ref),
         current_period_end = EXCLUDED.current_period_end,
         cancel_at_period_end = EXCLUDED.cancel_at_period_end`,
      [
        row.user_id,
        row.plan_id ?? 'free',
        row.status ?? 'none',
        row.provider ?? null,
        row.stripe_customer_id ?? null,
        row.stripe_subscription_id ?? null,
        row.crypto_tx_ref ?? null,
        row.current_period_end ?? null,
        row.cancel_at_period_end ?? false,
      ]
    );
  },
};

export interface PaymentOrderRow {
  merchant_trade_no: string;
  user_id: string;
  plan_id: string;
  provider: string;
  status: string;
  created_at: number;
  updated_at: number;
}

export const paymentOrdersRepo = {
  async create(row: PaymentOrderRow): Promise<void> {
    await pool.query(
      `INSERT INTO payment_orders (merchant_trade_no, user_id, plan_id, provider, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [row.merchant_trade_no, row.user_id, row.plan_id, row.provider, row.status, row.created_at, row.updated_at]
    );
  },

  async getByMerchantTradeNo(merchantTradeNo: string): Promise<PaymentOrderRow | undefined> {
    const { rows } = await pool.query('SELECT * FROM payment_orders WHERE merchant_trade_no = $1', [merchantTradeNo]);
    return rows[0];
  },

  async updateStatus(merchantTradeNo: string, status: string): Promise<void> {
    await pool.query(
      'UPDATE payment_orders SET status = $1, updated_at = $2 WHERE merchant_trade_no = $3',
      [status, Date.now(), merchantTradeNo]
    );
  },
};