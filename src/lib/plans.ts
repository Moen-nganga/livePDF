import type { PlanId } from './api';

export interface PlanDisplay {
  id: PlanId;
  label: string;
  priceUsd: number;
  interval: 'month' | 'year';
  tagline: string;
  features: string[];
}

const PRO_FEATURES = [
  'Unlimited number of PDFs that can be edited',
  'Unlimited number of Pages that can be added to a PDF',
  'E-signature adding features',
  'Access to spelling checking features',
  'Access to more PDF templates',
  'AI assistant for writing PDFs',
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


export const PLAN_LABELS: Record<PlanId, string> = {
  free: 'Free plan',
  pro_monthly: 'Pro Monthly',
  pro_yearly: 'Pro Yearly',
};