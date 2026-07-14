import Stripe from 'stripe';
import { subscriptionsRepo } from './db.js';
import { getPlanDetails, type PlanId } from './plans.js';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
  apiVersion: '2026-06-24.dahlia',
});

const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';

// Recent Stripe API versions moved current_period_end off the top-level
// Subscription object and onto each subscription item instead (a
// subscription can have multiple items/prices, each with its own billing
// period). We only ever create single-item subscriptions here, so the
// first item's period end is the one that matters.
function getCurrentPeriodEnd(subscription: Stripe.Subscription): Date {
  const item = subscription.items.data[0];
  return new Date(item.current_period_end * 1000);
}

// Creates a Stripe Checkout Session in subscription mode for the given
// user/plan. client_reference_id + metadata.userId both carry the userId
// through to the webhook (belt and suspenders -- Stripe recommends
// checking client_reference_id on the session, but metadata is also read
// directly off the subscription object in some webhook event types).
export async function createCheckoutSession(
  userId: string,
  email: string,
  planId: PlanId
): Promise<string> {
  const plan = getPlanDetails(planId);
  if (!plan) throw new Error(`Unknown plan: ${planId}`);

  const priceId = process.env[plan.stripePriceEnvVar];
  if (!priceId) {
    throw new Error(
      `Missing env var ${plan.stripePriceEnvVar} -- create a recurring Price for "${plan.label}" in the Stripe Dashboard and set its Price ID here.`
    );
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: userId,
    customer_email: email,
    metadata: { userId, planId },
    subscription_data: { metadata: { userId, planId } },
    success_url: `${APP_URL}/?upgraded=stripe`,
    cancel_url: `${APP_URL}/?upgradeCanceled=1`,
  });

  if (!session.url) throw new Error('Stripe did not return a checkout URL');
  return session.url;
}

// Called from the raw-body webhook route in index.ts after signature
// verification. Stripe is the source of truth here -- we only grant/change
// plan access in response to these events, never from the client telling
// us "I paid."
export async function handleStripeWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id ?? session.metadata?.userId;
      const planId = session.metadata?.planId as PlanId | undefined;
      if (!userId || !planId || typeof session.subscription !== 'string') break;

      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      await subscriptionsRepo.upsert({
        user_id: userId,
        plan_id: planId,
        status: subscription.status === 'active' || subscription.status === 'trialing' ? 'active' : subscription.status,
        provider: 'stripe',
        stripe_customer_id: typeof session.customer === 'string' ? session.customer : undefined,
        stripe_subscription_id: subscription.id,
        current_period_end: getCurrentPeriodEnd(subscription),
        cancel_at_period_end: subscription.cancel_at_period_end,
      });
      break;
    }

    // Fires on renewals, plan changes, and cancellation-at-period-end
    // toggles -- keeps our copy of status/period-end in sync without
    // waiting for the user to do anything in our own UI.
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.userId;
      const planId = subscription.metadata?.planId as PlanId | undefined;
      if (!userId) break;

      const isDeleted = event.type === 'customer.subscription.deleted';
      await subscriptionsRepo.upsert({
        user_id: userId,
        plan_id: isDeleted ? 'free' : (planId ?? 'free'),
        status: isDeleted ? 'canceled' : subscription.status,
        provider: 'stripe',
        stripe_subscription_id: subscription.id,
        current_period_end: getCurrentPeriodEnd(subscription),
        cancel_at_period_end: subscription.cancel_at_period_end,
      });
      break;
    }

    default:
      // Other event types (invoice.paid, payment_failed, etc.) aren't
      // needed yet -- add cases here as your billing logic grows.
      break;
  }
}