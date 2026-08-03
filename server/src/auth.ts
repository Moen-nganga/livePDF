import express from 'express';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { usersRepo, magicLinksRepo, sessionsRepo, documentsRepo } from './db.js';
import { sendMagicLinkEmail } from './email.js';

const SESSION_COOKIE = 'session';
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes -- short-lived on purpose

// Sliding window: a session lasts 14 days from its *last use*, not from
// login. Every authenticated request pushes expires_at forward another 14
// days (see refreshSession below), so a user who visits regularly never
// gets signed out -- only 14 days of total inactivity expires them.
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';
const isProd = process.env.NODE_ENV === 'production';

// Admin accounts, gated by email rather than a DB column -- avoids a
// migration for a single-admin setup. If you ever need more than a
// handful of admins, move this to a real `is_admin` column on the users
// table and check that instead; an allowlist that has to be redeployed
// to change doesn't scale past a few trusted people.
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS ?? 'moenmburu41@gmail.com')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

function isAdminEmail(email: string): boolean {
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

function simpleEmailCheck(email: unknown): email is string {
  // Deliberately loose -- real validation happens by virtue of the email
  // either arriving or not. This just filters out obvious garbage before
  // we burn a Resend send on it.
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

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

// Pushes both the DB session row and the browser cookie's expiry forward
// by another SESSION_TTL_MS. Called on every request that successfully
// authenticates -- this is what makes the window "sliding" instead of a
// fixed 14 days from login. Fire-and-forget from the caller's perspective
// (awaited here, but never blocks the actual request on failure since a
// failed refresh just means slightly earlier expiry next time, not a
// broken request).
async function refreshSession(res: express.Response, token: string) {
  const newExpiresAt = Date.now() + SESSION_TTL_MS;
  await sessionsRepo.refresh(token, newExpiresAt);
  setSessionCookie(res, token); // re-sends the cookie with a renewed maxAge
}

// Shared by both the magic-link /verify route and the Google OAuth
// callback -- creates the session row + cookie and claims any anonymous
// device documents onto the now-known user.
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

// Attaches req.userId if a valid, non-expired session cookie is present.
// Does NOT reject the request if there isn't one -- routes that work for
// both anonymous and logged-in users (e.g. saving a document) use this.
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

// Step 1: user submits their email, we mail them a one-time link.
// Always returns the same generic response whether or not the email is
// new -- this route shouldn't leak whether a given email has an account.
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

  await establishSession(res, user.id, typeof deviceId === 'string' ? deviceId : null);

  res.json({ ok: true, user: { id: user.id, email: user.email, isAdmin: isAdminEmail(user.email) } });
});

// --- Google OAuth (Authorization Code flow) ---
//
// This is a full-page redirect flow, not a fetch-based one: the frontend
// just links here (e.g. <a href="${API_BASE}/api/auth/google">), the
// browser navigates to Google, and Google redirects back to /callback
// below. There's no client secret or Google SDK on the frontend -- the
// token exchange happens entirely server-to-server using our client
// secret, so the profile data we get back is already trustworthy without
// needing to verify an id_token signature ourselves.

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

    // Same find-or-create path the magic-link flow uses above, so a user
    // who's used both methods with the same email ends up as one account.
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