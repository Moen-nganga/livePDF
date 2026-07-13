import crypto from 'node:crypto';
import { subscriptionsRepo, paymentOrdersRepo } from './db.js';
import { getPlanDetails, type PlanId } from './plans.js';

const BASE_URL = 'https://bpay.binanceapi.com';
const API_KEY = process.env.BINANCE_PAY_API_KEY ?? '';
const API_SECRET = process.env.BINANCE_PAY_API_SECRET ?? '';
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';

function randomNonce(length = 32): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[crypto.randomInt(chars.length)];
  return out;
}

// Binance Pay's request signing: HMAC-SHA512 of
// `${timestamp}\n${nonce}\n${jsonBody}\n`, hex-encoded and uppercased,
// sent as the BinancePay-Signature header alongside the API key (as
// BinancePay-Certificate-SN) and the timestamp/nonce themselves. This is
// entirely separate from webhook verification below, which uses RSA
// against a Binance-issued public key, not this HMAC secret.
interface BinancePayApiResponse<T> {
  status: string;
  code: string;
  errorMessage?: string;
  data: T;
}

async function signedRequest<T>(path: string, body: object): Promise<T> {
  if (!API_KEY || !API_SECRET) {
    throw new Error('BINANCE_PAY_API_KEY / BINANCE_PAY_API_SECRET are not set');
  }

  const timestamp = Date.now().toString();
  const nonce = randomNonce();
  const jsonBody = JSON.stringify(body);
  const payload = `${timestamp}\n${nonce}\n${jsonBody}\n`;
  const signature = crypto.createHmac('sha512', API_SECRET).update(payload).digest('hex').toUpperCase();

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'BinancePay-Timestamp': timestamp,
      'BinancePay-Nonce': nonce,
      'BinancePay-Certificate-SN': API_KEY,
      'BinancePay-Signature': signature,
    },
    body: jsonBody,
  });

  const data = (await res.json()) as BinancePayApiResponse<T>;
  if (data.status !== 'SUCCESS') {
    throw new Error(`Binance Pay error: ${data.errorMessage ?? data.code ?? 'unknown error'}`);
  }
  return data.data;
}

interface CreateOrderResult {
  prepayId: string;
  checkoutUrl: string;
  qrcodeLink?: string;
  deeplink?: string;
}

// Creates a Binance Pay order and records it in payment_orders so the
// webhook (which only gets merchantTradeNo back) can be traced to a user
// and plan. Returns the hosted checkoutUrl to redirect the user to.
export async function createBinanceOrder(userId: string, planId: PlanId): Promise<string> {
  const plan = getPlanDetails(planId);
  if (!plan) throw new Error(`Unknown plan: ${planId}`);

  const merchantTradeNo = crypto.randomUUID().replace(/-/g, '');

  await paymentOrdersRepo.create({
    merchant_trade_no: merchantTradeNo,
    user_id: userId,
    plan_id: planId,
    provider: 'binance',
    status: 'created',
    created_at: Date.now(),
    updated_at: Date.now(),
  });

  const result = await signedRequest<CreateOrderResult>('/binancepay/openapi/v3/order', {
    env: { terminalType: 'WEB' },
    merchantTradeNo,
    orderAmount: plan.priceUsd,
    currency: 'USDT',
    goods: {
      goodsType: '02',
      goodsCategory: 'Z000',
      referenceGoodsId: plan.id,
      goodsName: plan.label,
      goodsDetail: `${plan.label} subscription (${plan.interval}ly)`,
    },
    returnUrl: `${APP_URL}/?upgraded=binance`,
    cancelUrl: `${APP_URL}/?upgradeCanceled=1`,
  });

  return result.checkoutUrl;
}

// --- Webhook verification ---
// Binance signs webhook payloads with an RSA private key; merchants verify
// with the corresponding public key, fetched once via the certificate API
// and cached in memory for the life of the process (it doesn't rotate
// often -- if verification ever starts failing unexpectedly, restarting
// the server to force a re-fetch is the first thing to try).
let cachedPublicKey: string | null = null;

async function getBinancePublicKey(): Promise<string> {
  if (cachedPublicKey) return cachedPublicKey;
  const result = await signedRequest<{ certPublic: string }[]>('/binancepay/openapi/certificates', {});
  const cert = Array.isArray(result) ? result[0] : undefined;
  if (!cert?.certPublic) throw new Error('Could not fetch Binance Pay public key');
  cachedPublicKey = cert.certPublic;
  return cachedPublicKey;
}

export async function verifyBinanceWebhookSignature(
  timestamp: string,
  nonce: string,
  rawBody: string,
  signatureBase64: string
): Promise<boolean> {
  const publicKey = await getBinancePublicKey();
  const payload = `${timestamp}\n${nonce}\n${rawBody}\n`;
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(payload);
  verifier.end();
  return verifier.verify(publicKey, signatureBase64, 'base64');
}

interface BinanceWebhookPayload {
  bizType: string;
  bizStatus: string;
  data: string;
}

// Handles a verified webhook event. Only PAY events with a SUCCESS status
// actually grant plan access -- PAY_FAIL/PAY_CLOSED are logged but not
// treated as an error response (Binance still expects an HTTP 200/SUCCESS
// ack either way, or it will keep retrying).
export async function handleBinanceWebhookEvent(payload: BinanceWebhookPayload): Promise<void> {
  if (payload.bizType !== 'PAY') return;

  const data = JSON.parse(payload.data) as { merchantTradeNo: string; transactionId?: string };
  const order = await paymentOrdersRepo.getByMerchantTradeNo(data.merchantTradeNo);
  if (!order) return;

  if (payload.bizStatus === 'PAY_SUCCESS') {
    await paymentOrdersRepo.updateStatus(order.merchant_trade_no, 'paid');
    // Binance Pay doesn't have a native "subscription" concept like
    // Stripe -- it's a one-time charge per billing period. We treat a
    // successful payment as granting access for one interval (30 or 365
    // days) from now; renewing means the user pays again before that.
    const plan = getPlanDetails(order.plan_id);
    const days = plan?.interval === 'year' ? 365 : 30;
    const periodEnd = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await subscriptionsRepo.upsert({
      user_id: order.user_id,
      plan_id: order.plan_id as PlanId,
      status: 'active',
      provider: 'crypto',
      crypto_tx_ref: data.transactionId ?? data.merchantTradeNo,
      current_period_end: periodEnd,
      cancel_at_period_end: false,
    });
  } else if (payload.bizStatus === 'PAY_FAIL' || payload.bizStatus === 'PAY_CLOSED') {
    await paymentOrdersRepo.updateStatus(order.merchant_trade_no, 'failed');
  }
}