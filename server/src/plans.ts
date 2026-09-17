export type PlanId = 'free' | 'pro_monthly' | 'pro_yearly';

export const FEATURE_FLAGS: Record<PlanId, readonly string[]> = {
  free: ['basic_edit', 'export_watermarked'],
  pro_monthly: ['basic_edit', 'export_clean', 'ocr', 'batch_export', 'merge_split'],
  pro_yearly: ['basic_edit', 'export_clean', 'ocr', 'batch_export', 'merge_split'],
};

export interface PlanDetails {
  id: PlanId;
  label: string;
  priceKes: number;
  interval: 'month' | 'year';
  paystackPlanEnvVar: string;
}

export const PAID_PLANS: PlanDetails[] = [
  {
    id: 'pro_monthly',
    label: 'Pro Monthly',
    priceKes: 9,
    interval: 'month',
    paystackPlanEnvVar: 'PAYSTACK_PLAN_MONTHLY',
  },
  {
    id: 'pro_yearly',
    label: 'Pro Yearly',
    priceKes: 90,
    interval: 'year',
    paystackPlanEnvVar: 'PAYSTACK_PLAN_YEARLY',
  },
];

export function getPlanDetails(planId: string): PlanDetails | undefined {
  return PAID_PLANS.find((p) => p.id === planId);
}

export function getPlanIdByPaystackPlanCode(planCode: string | undefined): PlanId | undefined {
  if (!planCode) return undefined;
  const plan = PAID_PLANS.find((p) => process.env[p.paystackPlanEnvVar] === planCode);
  return plan?.id;
}