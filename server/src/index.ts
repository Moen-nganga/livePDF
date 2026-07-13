import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { nanoid } from 'nanoid';
import { documentsRepo, sharesRepo, subscriptionsRepo, initDb } from './db.js';
import { authRouter, requireAuth } from './auth.js';
import { stripe, createCheckoutSession, handleStripeWebhookEvent } from './stripe.js';
import { createBinanceOrder, verifyBinanceWebhookSignature, handleBinanceWebhookEvent } from './binancePay.js';
import { usersRepo } from './db.js';
import type { PlanId } from './plans.js';

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
    credentials: true,
  })
);
app.use(cookieParser());

// --- Webhook routes: MUST be registered before express.json() below. ---
// Both Stripe's and Binance Pay's signature verification is computed over
// the *raw* request body bytes -- if the global JSON parser runs first,
// the body has already been parsed/re-serialized and the signature check
// will fail (harmlessly, but permanently). express.raw() here captures the
// untouched bytes for just these two routes.

app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.header('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return res.status(400).json({ error: 'Missing signature or webhook secret' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    await handleStripeWebhookEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error('Error handling Stripe webhook event:', err);
    // 500 tells Stripe to retry -- appropriate here since the failure is
    // on our side (e.g. a transient DB error), not a bad event.
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/webhooks/binance', express.raw({ type: 'application/json' }), async (req, res) => {
  const timestamp = req.header('binancepay-timestamp');
  const nonce = req.header('binancepay-nonce');
  const signature = req.header('binancepay-signature');
  const rawBody = (req.body as Buffer).toString('utf8');

  if (!timestamp || !nonce || !signature) {
    return res.status(400).json({ returnCode: 'FAIL', returnMessage: 'Missing signature headers' });
  }

  try {
    const valid = await verifyBinanceWebhookSignature(timestamp, nonce, rawBody, signature);
    if (!valid) {
      console.error('Binance Pay webhook signature verification failed');
      return res.status(400).json({ returnCode: 'FAIL', returnMessage: 'Invalid signature' });
    }

    const payload = JSON.parse(rawBody);
    await handleBinanceWebhookEvent(payload);

    // Binance Pay requires exactly this ack shape on success, or it will
    // keep retrying the notification (up to 6 times).
    res.json({ returnCode: 'SUCCESS', returnMessage: null });
  } catch (err) {
    console.error('Error handling Binance Pay webhook event:', err);
    res.status(500).json({ returnCode: 'FAIL', returnMessage: 'Internal error' });
  }
});

// --- Everything below this line uses the parsed JSON body as normal. ---
app.use(express.json({ limit: '25mb' })); // generous: documents embed base64 images

app.use('/api/auth', authRouter);

function requireDeviceId(req: express.Request, res: express.Response): string | null {
  const deviceId = req.header('x-device-id');
  if (!deviceId) {
    res.status(400).json({ error: 'Missing X-Device-Id header' });
    return null;
  }
  return deviceId;
}

app.get('/api/documents', async (req, res) => {
  const deviceId = requireDeviceId(req, res);
  if (!deviceId) return;
  const rows = await documentsRepo.listForDevice(deviceId);
  res.json(rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })));
});

app.get('/api/documents/:id', async (req, res) => {
  const deviceId = requireDeviceId(req, res);
  if (!deviceId) return;
  const row = await documentsRepo.get(req.params.id, deviceId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(JSON.parse(row.data));
});

app.put('/api/documents/:id', async (req, res) => {
  const deviceId = requireDeviceId(req, res);
  if (!deviceId) return;
  const doc = req.body;
  if (!doc || typeof doc !== 'object') {
    return res.status(400).json({ error: 'Invalid document body' });
  }
  const now = Date.now();
  await documentsRepo.upsert({
    id: req.params.id,
    device_id: deviceId,
    title: doc.title ?? 'Untitled document',
    data: JSON.stringify(doc),
    created_at: doc.createdAt ?? now,
    updated_at: now,
  });
  res.json({ ok: true, updatedAt: now });
});

app.delete('/api/documents/:id', async (req, res) => {
  const deviceId = requireDeviceId(req, res);
  if (!deviceId) return;
  await documentsRepo.remove(req.params.id, deviceId);
  res.json({ ok: true });
});

app.post('/api/documents', (req, res) => {
  const deviceId = requireDeviceId(req, res);
  if (!deviceId) return;
  res.json({ id: nanoid() });
});

app.post('/api/documents/:id/shares', async (req, res) => {
  const deviceId = requireDeviceId(req, res);
  if (!deviceId) return;

  const owned = await documentsRepo.get(req.params.id, deviceId);
  if (!owned) return res.status(404).json({ error: 'Not found' });

  const access = req.body?.access;
  if (access !== 'view' && access !== 'edit') {
    return res.status(400).json({ error: "access must be 'view' or 'edit'" });
  }

  const token = nanoid(21);
  await sharesRepo.create({
    token,
    document_id: req.params.id,
    access,
    created_at: Date.now(),
  });
  res.json({ token, access });
});

app.get('/api/documents/:id/shares', async (req, res) => {
  const deviceId = requireDeviceId(req, res);
  if (!deviceId) return;
  const owned = await documentsRepo.get(req.params.id, deviceId);
  if (!owned) return res.status(404).json({ error: 'Not found' });
  const shares = await sharesRepo.listForDocument(req.params.id);
  res.json(shares.map((s) => ({ token: s.token, access: s.access, createdAt: s.created_at })));
});

app.delete('/api/shares/:token', async (req, res) => {
  const deviceId = requireDeviceId(req, res);
  if (!deviceId) return;
  const share = await sharesRepo.getByToken(req.params.token);
  if (!share) return res.json({ ok: true });
  const owned = await documentsRepo.get(share.document_id, deviceId);
  if (!owned) return res.status(403).json({ error: 'Not the owner of this share' });
  await sharesRepo.revoke(req.params.token);
  res.json({ ok: true });
});

app.get('/api/shared/:token', async (req, res) => {
  const share = await sharesRepo.getByToken(req.params.token);
  if (!share) return res.status(404).json({ error: 'This share link is invalid or has been revoked' });
  const doc = await documentsRepo.getById(share.document_id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json({ document: JSON.parse(doc.data), access: share.access });
});

app.put('/api/shared/:token', async (req, res) => {
  const share = await sharesRepo.getByToken(req.params.token);
  if (!share) return res.status(404).json({ error: 'This share link is invalid or has been revoked' });
  if (share.access !== 'edit') {
    return res.status(403).json({ error: 'This link is view-only' });
  }
  const doc = await documentsRepo.getById(share.document_id);
  if (!doc) return res.status(404).json({ error: 'Not found' });

  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid document body' });
  }
  const now = Date.now();
  await documentsRepo.upsert({
    id: doc.id,
    device_id: doc.device_id,
    title: body.title ?? doc.title,
    data: JSON.stringify(body),
    created_at: doc.created_at,
    updated_at: now,
  });
  res.json({ ok: true, updatedAt: now });
});

// --- Billing ---

app.get('/api/subscription', requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const sub = await subscriptionsRepo.getByUserId(userId);
  if (!sub) {
    return res.json({ planId: 'free', status: 'none' });
  }
  res.json({
    planId: sub.status === 'active' ? sub.plan_id : 'free',
    status: sub.status,
    provider: sub.provider,
    currentPeriodEnd: sub.current_period_end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
});

app.post('/api/checkout/stripe', requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const planId = req.body?.planId as PlanId | undefined;
  if (planId !== 'pro_monthly' && planId !== 'pro_yearly') {
    return res.status(400).json({ error: 'Invalid planId' });
  }

  try {
    const user = await usersRepo.getById(userId);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    const url = await createCheckoutSession(userId, user.email, planId);
    res.json({ url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to start checkout' });
  }
});

app.post('/api/checkout/binance', requireAuth, async (req, res) => {
  const userId = (req as any).userId;
  const planId = req.body?.planId as PlanId | undefined;
  if (planId !== 'pro_monthly' && planId !== 'pro_yearly') {
    return res.status(400).json({ error: 'Invalid planId' });
  }

  try {
    const checkoutUrl = await createBinanceOrder(userId, planId);
    res.json({ url: checkoutUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to start checkout' });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 8787;

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`PDF editor API listening on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });