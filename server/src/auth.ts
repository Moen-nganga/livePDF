import express from 'express';
import { nanoid } from 'nanoid';
import { usersRepo, magicLinksRepo, sessionsRepo, documentsRepo } from './db.js';
import { sendMagicLinkEmail } from './email.js';

const SESSION_COOKIE = 'session';
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes — short-lived on purpose
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';
const isProd = process.env.NODE_ENV === 'production';

function simpleEmailCheck(email: unknown): email is string {
  // Deliberately loose — real validation happens by virtue of the email
  // either arriving or not. This just filters out obvious garbage before
  // we burn a Resend send on it.
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function setSessionCookie(res: express.Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // not readable by client JS — mitigates XSS token theft
    secure: isProd, // requires HTTPS in production; allow http for local dev
    sameSite: 'lax', // sent on normal navigation/top-level GETs, blocked on cross-site POSTs (CSRF mitigation)
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function clearSessionCookie(res: express.Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

// Attaches req.userId if a valid, non-expired session cookie is present.
// Does NOT reject the request if there isn't one — routes that work for
// both anonymous and logged-in users (e.g. saving a document) use this.
export async function optionalAuth(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction
) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();

  const session = await sessionsRepo.getByToken(token);
  if (session && session.expires_at > Date.now()) {
    (req as any).userId = session.user_id;
  }
  next();
}

// Rejects with 401 if there's no valid session. Use for routes that only
// make sense for a logged-in user (billing, account settings, etc.).
export async function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  const session = await sessionsRepo.getByToken(token);
  if (!session || session.expires_at <= Date.now()) {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Session expired' });
  }

  (req as any).userId = session.user_id;
  next();
}

export const authRouter = express.Router();

// Step 1: user submits their email, we mail them a one-time link.
// Always returns the same generic response whether or not the email is
// new — this route shouldn't leak whether a given email has an account.
authRouter.post('/request-link', async (req, res) => {
  const email = req.body?.email;
  if (!simpleEmailCheck(email)) {
    return res.status(400).json({ error: 'Please provide a valid email address' });
  }
  const normalizedEmail = email.trim().toLowerCase();

  const token = nanoid(32);
  await magicLinksRepo.create({
    token,
    email: normalizedEmail,
    expires_at: Date.now() + MAGIC_LINK_TTL_MS,
    used: false,
  });

  const link = `${APP_URL}/?token=${token}`;

  try {
    await sendMagicLinkEmail(normalizedEmail, link);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }

  res.json({ ok: true });
});

// Step 2: user clicks the link, we exchange the one-time token for a
// session cookie. Also accepts an optional deviceId so we can attach this
// device's existing anonymous documents to the now-known user.
authRouter.post('/verify', async (req, res) => {
  const token = req.body?.token;
  const deviceId = req.body?.deviceId;
  if (typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing token' });
  }

  const magicLink = await magicLinksRepo.getByToken(token);
  if (!magicLink || magicLink.used || magicLink.expires_at <= Date.now()) {
    return res.status(400).json({ error: 'This link is invalid or has expired' });
  }

  await magicLinksRepo.markUsed(token);

  const user = await usersRepo.findOrCreate(magicLink.email, nanoid());

  const sessionToken = nanoid(32);
  await sessionsRepo.create({
    token: sessionToken,
    user_id: user.id,
    created_at: Date.now(),
    expires_at: Date.now() + SESSION_TTL_MS,
  });

  setSessionCookie(res, sessionToken);

  if (typeof deviceId === 'string' && deviceId) {
    await documentsRepo.claimForUser(deviceId, user.id);
  }

  res.json({ ok: true, user: { id: user.id, email: user.email } });
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await sessionsRepo.remove(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', optionalAuth, async (req, res) => {
  const userId = (req as any).userId;
  if (!userId) return res.status(401).json({ error: 'Not signed in' });

  const user = await usersRepo.getById(userId);
  if (!user) return res.status(401).json({ error: 'Not signed in' });

  res.json({ user: { id: user.id, email: user.email } });
});