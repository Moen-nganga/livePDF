export type PlanId = 'free' | 'pro_monthly' | 'pro_yearly';

export const FEATURE_FLAGS: Record<PlanId, readonly string[]> = {
  free: ['basic_edit', 'export_watermarked'],
  pro_monthly: ['basic_edit', 'export_clean', 'ocr', 'batch_export', 'merge_split'],
  pro_yearly: ['basic_edit', 'export_clean', 'ocr', 'batch_export', 'merge_split'],
};

export interface PlanDetails {
  id: PlanId;
  label: string;
  priceUsd: number; // per billing interval
  interval: 'month' | 'year';
  stripePriceEnvVar: string; // which env var holds this plan's Stripe Price ID
}

export const PAID_PLANS: PlanDetails[] = [
  {
    id: 'pro_monthly',
    label: 'Pro Monthly',
    priceUsd: 9,
    interval: 'month',
    stripePriceEnvVar: 'STRIPE_PRICE_MONTHLY',
  },
  {
    id: 'pro_yearly',
    label: 'Pro Yearly',
    priceUsd: 90,
    interval: 'year',
    stripePriceEnvVar: 'STRIPE_PRICE_YEARLY',
  },
];

export function getPlanDetails(planId: string): PlanDetails | undefined {
  return PAID_PLANS.find((p) => p.id === planId);
}