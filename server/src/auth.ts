import express from 'express';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { usersRepo, sessionsRepo, documentsRepo } from './db.js';

const SESSION_COOKIE = 'session';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';
const isProd = process.env.NODE_ENV === 'production';

const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS ?? 'moenmburu41@gmail.com')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.has(email.toLowerCase());
}

// --- Google OAuth config ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
// Must exactly match an "Authorized redirect URI" configured in the Google
// Cloud Console for this OAuth client, including scheme, host, and path.
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ?? `${APP_URL}/api/auth/google/callback`;

// Short-lived cookies used only to survive the redirect round-trip to
// Google and back -- not related to the long-lived session cookie above.
const OAUTH_STATE_COOKIE = 'g_oauth_state';
const OAUTH_DEVICE_COOKIE = 'g_oauth_device';
const OAUTH_COOKIE_TTL_MS = 10 * 60 * 1000; // 10 minutes is plenty for a login redirect

function setSessionCookie(res: express.Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // not readable by client JS -- mitigates XSS token theft
    secure: isProd, // requires HTTPS in production; allow http for local dev
    sameSite: 'lax', // sent on normal navigation/top-level GETs, blocked on cross-site POSTs (CSRF mitigation)
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function clearSessionCookie(res: express.Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function setOAuthCookie(res: express.Response, name: string, value: string) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax', // 'lax' still attaches on the top-level GET redirect back from Google
    maxAge: OAUTH_COOKIE_TTL_MS,
    path: '/',
  });
}

function clearOAuthCookies(res: express.Response) {
  res.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });
  res.clearCookie(OAUTH_DEVICE_COOKIE, { path: '/' });
}

async function refreshSession(res: express.Response, token: string) {
  const newExpiresAt = Date.now() + SESSION_TTL_MS;
  await sessionsRepo.refresh(token, newExpiresAt);
  setSessionCookie(res, token); // re-sends the cookie with a renewed maxAge
}

async function establishSession(
  res: express.Response,
  userId: string,
  deviceId?: string | null
) {
  const sessionToken = nanoid(32);
  await sessionsRepo.create({
    token: sessionToken,
    user_id: userId,
    created_at: Date.now(),
    expires_at: Date.now() + SESSION_TTL_MS,
  });
  setSessionCookie(res, sessionToken);

  if (deviceId) {
    await documentsRepo.claimForUser(deviceId, userId);
  }
}

export async function optionalAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();

  const session = await sessionsRepo.getByToken(token);
  if (session && session.expires_at > Date.now()) {
    (req as any).userId = session.user_id;
    await refreshSession(res, token);
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
  await refreshSession(res, token);
  next();
}

// Rejects with 401 if not signed in, or 403 if signed in but not an admin.
// Layers on top of requireAuth's session check rather than duplicating it
// -- mount as [requireAuth, requireAdmin] so req.userId is already set by
// the time this runs.
export async function requireAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const userId = (req as any).userId;
  if (!userId) return res.status(401).json({ error: 'Not signed in' });

  const user = await usersRepo.getById(userId);
  if (!user || !isAdminEmail(user.email)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
}

export const authRouter = express.Router();

// --- Google OAuth (Authorization Code flow) ---

// Step 1: redirect the browser to Google's consent screen.
authRouter.get('/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.error('Google OAuth is not configured (missing GOOGLE_CLIENT_ID/SECRET)');
    return res.redirect(`${APP_URL}/?authError=google_not_configured`);
  }

  // CSRF protection: random value stored in a short-lived cookie, checked
  // against the `state` Google sends back in the callback.
  const state = crypto.randomBytes(24).toString('hex');
  setOAuthCookie(res, OAUTH_STATE_COOKIE, state);

  // deviceId can't ride along in a request body on a GET redirect, so we
  // stash it in a cookie instead and pick it back up in the callback.
  const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : '';
  if (deviceId) setOAuthCookie(res, OAUTH_DEVICE_COOKIE, deviceId);

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online', // we don't need a refresh token -- our own session cookie handles longevity
    prompt: 'select_account',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// Step 2: Google redirects back here with a code (or an error/denial).
authRouter.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expectedState = req.cookies?.[OAUTH_STATE_COOKIE];
  const deviceId = req.cookies?.[OAUTH_DEVICE_COOKIE];

  clearOAuthCookies(res);

  const stateOk = typeof state === 'string' && !!expectedState && state === expectedState;
  if (error || typeof code !== 'string' || !stateOk) {
    return res.redirect(`${APP_URL}/?authError=google`);
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status})`);
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) throw new Error('No access token in response');

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileRes.ok) throw new Error(`Failed to fetch profile (${profileRes.status})`);
    const profile = (await profileRes.json()) as { email?: string; email_verified?: boolean };

    if (!profile.email || !profile.email_verified) {
      return res.redirect(`${APP_URL}/?authError=google_unverified`);
    }

    const normalizedEmail = profile.email.toLowerCase();

    const user = await usersRepo.findOrCreate(normalizedEmail, nanoid());

    await establishSession(res, user.id, deviceId ?? null);

    res.redirect(APP_URL);
  } catch (err) {
    console.error('Google OAuth callback failed:', err);
    res.redirect(`${APP_URL}/?authError=google`);
  }
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

  res.json({ user: { id: user.id, email: user.email, isAdmin: isAdminEmail(user.email) } });
});