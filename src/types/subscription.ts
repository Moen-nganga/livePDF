// types/subscription.ts
export type PlanId = 'free' | 'pro_monthly' | 'pro_yearly';

export interface Subscription {
  userId: string;
  planId: PlanId;
  status: 'active' | 'past_due' | 'canceled' | 'trialing' | 'none';
  provider: 'stripe' | 'crypto';
  currentPeriodEnd: string; // ISO date
  cancelAtPeriodEnd: boolean;
}

// A single source of truth for what each plan unlocks
export const FEATURE_FLAGS = {
  free: ['basic_edit', 'export_watermarked'],
  pro_monthly: ['basic_edit', 'export_clean', 'ocr', 'batch_export', 'merge_split'],
  pro_yearly: ['basic_edit', 'export_clean', 'ocr', 'batch_export', 'merge_split'],
} as const;

export type Feature = typeof FEATURE_FLAGS[PlanId][number];