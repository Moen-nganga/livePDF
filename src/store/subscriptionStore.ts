import { create } from 'zustand';
import { api, type SubscriptionInfo } from '../lib/api';

interface SubscriptionState {
  subscription: SubscriptionInfo | null;
  loading: boolean;
  fetchSubscription: () => Promise<void>;
  // True for admins OR active pro subscribers. Use this instead of
  // re-deriving "is this user premium" at each call site -- keeps the
  // admin bypass in one place, matching the server-side checks in
  // index.ts (isAdminUser) and admin.ts (requireAdmin).
  isPremium: () => boolean;
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  subscription: null,
  loading: false,

  fetchSubscription: async () => {
    set({ loading: true });
    try {
      const subscription = await api.getSubscription();
      set({ subscription, loading: false });
    } catch {
      set({ subscription: { planId: 'free', status: 'none' }, loading: false });
    }
  },

  isPremium: () => {
    const sub = get().subscription;
    if (!sub) return false;
    if (sub.isAdmin) return true;
    return sub.status === 'active' && (sub.planId === 'pro_monthly' || sub.planId === 'pro_yearly');
  },
}));