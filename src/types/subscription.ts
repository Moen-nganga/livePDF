// types/subscription.ts
export type PlanId = 'free' | 'pro_monthly' | 'pro_yearly';

export interface Subscription {
  userId: string;
  planId: PlanId;
  status: 'active' | 'past_due' | 'canceled' | 'trialing' | 'none';
  provider: 'stripe' | 'crypto';
  currentPeriodEnd: string; // ISO date
  cancelAtPeriodEnd: boolean;
  isAdmin?: boolean;
}

// A single source of truth for what each plan unlocks
export const FEATURE_FLAGS = {
  free: ['basic_edit', 'export_watermarked'],
  pro_monthly: ['basic_edit', 'export_clean', 'ocr', 'batch_export', 'merge_split'],
  pro_yearly: ['basic_edit', 'export_clean', 'ocr', 'batch_export', 'merge_split'],
} as const;

export type Feature = typeof FEATURE_FLAGS[PlanId][number];

// All features that exist, regardless of plan -- what an admin unlocks.
export const ALL_FEATURES: Feature[] = Array.from(
  new Set(Object.values(FEATURE_FLAGS).flat())
) as Feature[];

export function hasFeature(sub: Pick<Subscription, 'planId' | 'isAdmin'> | null | undefined, feature: Feature): boolean {
  if (!sub) return (FEATURE_FLAGS.free as readonly string[]).includes(feature);
  if (sub.isAdmin) return true;
  return (FEATURE_FLAGS[sub.planId] as readonly string[]).includes(feature);
}