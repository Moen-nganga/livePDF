import type { PlanId } from './api';

export interface PlanDisplay {
  id: PlanId;
  label: string;
  priceUsd: number;
  interval: 'month' | 'year';
  tagline: string;
  features: string[];
}

// Keep priceUsd in sync with server/src/plans.ts -- this file is display
// copy only, the server is the actual source of truth for what gets
// charged (Stripe reads its own Price object; Binance reads
// server/src/plans.ts's priceUsd directly).
//
// The features list here should track FEATURE_FLAGS in
// types/subscription.ts / server/src/plans.ts -- both pro plans unlock
// the same feature set today, just billed differently.
const PRO_FEATURES = [
  'Clean exports (no watermark)',
  'OCR text recognition',
  'Batch export',
  'Merge & split PDFs',
];

export const PLANS: PlanDisplay[] = [
  {
    id: 'pro_monthly',
    label: 'Pro Monthly',
    priceUsd: 8,
    interval: 'month',
    tagline: 'Full access, billed monthly',
    features: PRO_FEATURES,
  },
  {
    id: 'pro_yearly',
    label: 'Pro Yearly',
    priceUsd: 80,
    interval: 'year',
    tagline: 'Full access, billed yearly (save ~17%)',
    features: PRO_FEATURES,
  },
];

// Short label used in compact spots (AccountMenu's plan line) where the
// full PlanDisplay card copy above would be too much.
export const PLAN_LABELS: Record<PlanId, string> = {
  free: 'Free plan',
  pro_monthly: 'Pro Monthly',
  pro_yearly: 'Pro Yearly',
};