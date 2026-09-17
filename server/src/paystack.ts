import crypto from 'crypto';
import { subscriptionsRepo } from './db.js';
import { getPlanDetails, getPlanIdByPaystackPlanCode, type PlanId } from './plans.js';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY ?? '';
const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';

interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

export function verifyPaystackSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const hash = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
  const a = Buffer.from(hash);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function createCheckoutSession(
  userId: string,
  email: string,
  planId: PlanId
): Promise<string> {
  const plan = getPlanDetails(planId);
  if (!plan) throw new Error(`Unknown plan: ${planId}`);

  const planCode = process.env[plan.paystackPlanEnvVar];
  if (!planCode) {
    throw new Error(
      `Missing env var ${plan.paystackPlanEnvVar} -- create a recurring Plan for "${plan.label}" in the Paystack Dashboard and set its Plan Code here.`
    );
  }

  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      amount: Math.round(plan.priceKes * 100),
      currency: 'KES',
      plan: planCode,
      metadata: { userId, planId },
      callback_url: `${APP_URL}/?upgraded=paystack`,
    }),
  });

  const json = (await response.json()) as PaystackInitializeResponse;
  if (!json.status || !json.data?.authorization_url) {
    throw new Error(json.message || 'Paystack did not return a checkout URL');
  }
  return json.data.authorization_url;
}

function parseDate(value: string | undefined | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function handlePaystackWebhookEvent(event: any): Promise<void> {
  switch (event.event) {
    case 'charge.success': {
      const data = event.data;
      const userId = data?.metadata?.userId;
      const planId = data?.metadata?.planId as PlanId | undefined;
      if (!userId || !planId) break;

      await subscriptionsRepo.upsert({
        user_id: userId,
        plan_id: planId,
        status: 'active',
        provider: 'paystack',
        paystack_customer_code: data?.customer?.customer_code ?? undefined,
        cancel_at_period_end: false,
      });
      break;
    }

    case 'subscription.create': {
      const data = event.data;
      const customerCode = data?.customer?.customer_code;
      if (!customerCode) break;
      const existing = await subscriptionsRepo.getByPaystackCustomerCode(customerCode);
      if (!existing) break;

      const planId = getPlanIdByPaystackPlanCode(data?.plan?.plan_code) ?? (existing.plan_id as PlanId);
      await subscriptionsRepo.upsert({
        user_id: existing.user_id,
        plan_id: planId,
        status: data?.status === 'active' ? 'active' : data?.status ?? existing.status,
        provider: 'paystack',
        paystack_customer_code: customerCode,
        paystack_subscription_code: data?.subscription_code,
        current_period_end: parseDate(data?.next_payment_date),
        cancel_at_period_end: false,
      });
      break;
    }

    case 'invoice.update': {
      const data = event.data;
      const customerCode = data?.customer?.customer_code;
      if (!customerCode) break;
      const existing = await subscriptionsRepo.getByPaystackCustomerCode(customerCode);
      if (!existing) break;

      const paid = data?.paid === true || data?.transaction?.status === 'success';
      await subscriptionsRepo.upsert({
        user_id: existing.user_id,
        plan_id: existing.plan_id,
        status: paid ? 'active' : existing.status,
        provider: 'paystack',
        paystack_customer_code: customerCode,
        current_period_end: parseDate(data?.subscription?.next_payment_date),
        cancel_at_period_end: existing.cancel_at_period_end,
      });
      break;
    }

    case 'subscription.disable':
    case 'subscription.not_renew': {
      const data = event.data;
      const customerCode = data?.customer?.customer_code;
      if (!customerCode) break;
      const existing = await subscriptionsRepo.getByPaystackCustomerCode(customerCode);
      if (!existing) break;

      const isDisabled = event.event === 'subscription.disable';
      await subscriptionsRepo.upsert({
        user_id: existing.user_id,
        plan_id: isDisabled ? 'free' : existing.plan_id,
        status: isDisabled ? 'canceled' : existing.status,
        provider: 'paystack',
        paystack_customer_code: customerCode,
        paystack_subscription_code: data?.subscription_code ?? existing.paystack_subscription_code ?? undefined,
        cancel_at_period_end: !isDisabled,
      });
      break;
    }

    default:
      break;
  }
}