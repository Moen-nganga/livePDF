import { create } from 'zustand';
import { api, type SubscriptionInfo } from '../lib/api';

interface SubscriptionState {
  subscription: SubscriptionInfo | null;
  loading: boolean;
  fetchSubscription: () => Promise<void>;
}

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
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
}));