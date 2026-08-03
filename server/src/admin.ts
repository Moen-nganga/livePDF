import express from 'express';
import { pool } from './db.js';
import { requireAuth, requireAdmin, SESSION_TTL_MS } from './auth.js';

export const adminRouter = express.Router();

// Both middlewares run in order: requireAuth rejects with 401 if there's
// no valid session at all, then requireAdmin rejects with 403 if the
// signed-in user's email isn't in auth.ts's ADMIN_EMAILS allowlist. This
// is the real server-side enforcement the frontend's isAdmin flag alone
// can't provide -- a spoofed client-side flag never reaches this far.
adminRouter.get('/analytics', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    // Sessions don't store a separate "last active" column -- but since
    // refreshSession (auth.ts) pushes expires_at forward by SESSION_TTL_MS
    // on every authenticated request, expires_at - SESSION_TTL_MS *is* the
    // last-active timestamp. So "active in the last 24h" is just
    // expires_at >= (now - 24h) + SESSION_TTL_MS.
    const last24hCutoff = now - 24 * 60 * 60 * 1000 + SESSION_TTL_MS;

    const [
      totalUsersRes,
      loggedIn24hRes,
      premiumBreakdownRes,
      docsThisWeekRes,
    ] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM users'),

      pool.query(
        'SELECT COUNT(DISTINCT user_id)::int AS count FROM sessions WHERE expires_at >= $1',
        [last24hCutoff]
      ),

      // Only counts subscriptions that are currently 'active' -- a
      // canceled/past_due row shouldn't count as a paying premium user
      // even though the row itself still exists.
      pool.query(
        `SELECT plan_id, COUNT(*)::int AS count
         FROM subscriptions
         WHERE status = 'active' AND plan_id IN ('pro_monthly', 'pro_yearly')
         GROUP BY plan_id`
      ),

      pool.query('SELECT COUNT(*)::int AS count FROM documents WHERE created_at >= $1', [oneWeekAgo]),
    ]);

    const totalUsers = totalUsersRes.rows[0].count;
    const loggedInLast24h = loggedIn24hRes.rows[0].count;

    let premiumMonthly = 0;
    let premiumYearly = 0;
    for (const row of premiumBreakdownRes.rows) {
      if (row.plan_id === 'pro_monthly') premiumMonthly = row.count;
      if (row.plan_id === 'pro_yearly') premiumYearly = row.count;
    }
    const premiumUsers = premiumMonthly + premiumYearly;
    // Everyone who isn't an active premium subscriber counts as free --
    // covers users who never subscribed at all (no subscriptions row)
    // as well as canceled/past_due ones, same as isPremium's definition
    // on the frontend (subscription.status === 'active' && ...).
    const freePlanUsers = totalUsers - premiumUsers;

    res.json({
      totalUsers,
      loggedInLast24h,
      freePlanUsers,
      premiumUsers,
      premiumMonthly,
      premiumYearly,
      documentsCreatedThisWeek: docsThisWeekRes.rows[0].count,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to compute admin analytics:', err);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});