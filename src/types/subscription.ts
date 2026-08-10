// types/subscription.ts
export type PlanId = 'free' | 'pro_monthly' | 'pro_yearly';

export interface Subscription {
  userId: string;
  planId: PlanId;
  status: 'active' | 'past_due' | 'canceled' | 'trialing' | 'none';
  provider: 'stripe' | 'crypto';
  currentPeriodEnd: string; // ISO date
  cancelAtPeriodEnd: boolean;
  // True for admin accounts (see auth.ts's ADMIN_EMAILS). Admins should be
  // treated as premium everywhere in the UI even though planId/status may
  // say "free" -- there's no real Stripe subscription behind an admin's
  // access, so don't infer premium from planId alone anywhere gating logic
  // reads this: check isAdmin explicitly instead.
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

// Central helper for "can this subscription use this feature" so admin
// bypass logic lives in exactly one place instead of being re-checked
// (and possibly forgotten) at every call site.
export function hasFeature(sub: Pick<Subscription, 'planId' | 'isAdmin'> | null | undefined, feature: Feature): boolean {
  if (!sub) return (FEATURE_FLAGS.free as readonly string[]).includes(feature);
  if (sub.isAdmin) return true;
  return (FEATURE_FLAGS[sub.planId] as readonly string[]).includes(feature);
}