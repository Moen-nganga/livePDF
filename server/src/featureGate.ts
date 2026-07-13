import express from 'express';
import { subscriptionsRepo } from './db.js';
import { FEATURE_FLAGS, type PlanId } from './plans.js';

// Use after requireAuth (needs req.userId already set). Blocks the request
// with a 403 unless the caller's active plan includes this feature --
// this is the actual enforcement point; the frontend's PaywallGate/
// useFeatureGate only hide UI, they don't protect anything by themselves.
export function requireFeature(feature: string) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Not signed in' });

    const sub = await subscriptionsRepo.getByUserId(userId);
    const isActive = sub?.status === 'active';
    const planId: PlanId = isActive ? (sub!.plan_id as PlanId) : 'free';

    const allowed = FEATURE_FLAGS[planId] ?? FEATURE_FLAGS.free;
    if (!allowed.includes(feature)) {
      return res.status(403).json({ error: 'upgrade_required', feature });
    }
    next();
  };
}