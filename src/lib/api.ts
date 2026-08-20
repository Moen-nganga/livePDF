import type { PDFDocument } from '../types/document';
import { getDeviceId } from './deviceId';

// Exported so other modules (e.g. AuthScreen's "Continue with Google" link)
// can build absolute URLs to the API's own routes -- needed for the OAuth
// redirect flow, which navigates the whole page rather than fetching.
export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';

function headers() {
  return {
    'Content-Type': 'application/json',
    'X-Device-Id': getDeviceId(),
  };
}

export interface DocumentSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface ShareInfo {
  token: string;
  access: 'view' | 'edit';
  createdAt?: number;
}

export interface AuthUser {
  id: string;
  email: string;
  // Server-asserted flag -- NOT something the client can grant itself.
  // The backend's /api/auth/me (and every other route that checks it,
  // e.g. usage limits and /api/admin/*) must read this from the user's
  // row in the DB, never trust it if sent from the client on a request.
  isAdmin?: boolean;
}

export type PlanId = 'free' | 'pro_monthly' | 'pro_yearly';

export interface SubscriptionInfo {
  planId: PlanId;
  status: string;
  provider?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  // Server-asserted flag mirroring AuthUser.isAdmin -- set by index.ts's
  // /api/subscription from the same ADMIN_EMAILS check auth.ts uses
  // elsewhere. Admins should be treated as premium in the UI even when
  // planId/status say "free", since there's no real subscription behind
  // an admin's access.
  isAdmin?: boolean;
}

// Reflects the free-tier weekly document limit WITHOUT attempting a save --
// fetched by LandingScreen so opening an old document (a pure read) can be
// gated the same way creating a new one already is via WeeklyLimitError,
// instead of only discovering the limit on the next autosave tick.
// `limit` is null for premium accounts (unlimited) -- and, once the server
// is updated, should also be null for admin accounts.
export interface UsageInfo {
  used: number;
  limit: number | null;
  limitReached: boolean;
}

// Thrown specifically when the server rejects a save because of the
// free-tier weekly document limit -- callers that create new documents
// (LandingScreen's template/blank flow, uploads) check for this via
// `instanceof` to show an upgrade prompt instead of a generic save-failed
// message, since retrying won't help and the autosave hook shouldn't just
// silently keep failing on every subsequent edit either.
export class WeeklyLimitError extends Error {
  limit: number;
  constructor(message: string, limit: number) {
    super(message);
    this.name = 'WeeklyLimitError';
    this.limit = limit;
  }
}

async function parseErrorBody(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

// Site-wide analytics for the admin dashboard. Backend should compute these
// from the users/subscriptions tables -- this endpoint must itself be
// protected server-side (401/403 for any non-admin caller), since this is
// exactly the kind of data that must never depend solely on the client
// choosing whether to render the Admin button.
export interface AdminAnalytics {
  totalUsers: number;
  loggedInLast24h: number;
  freePlanUsers: number;
  premiumUsers: number;
  premiumMonthly: number;
  premiumYearly: number;
  documentsCreatedThisWeek: number;
  generatedAt: string;
}

export const api = {
  async listDocuments(): Promise<DocumentSummary[]> {
    const res = await fetch(`${API_BASE}/api/documents`, { headers: headers(), credentials: 'include' });
    if (!res.ok) throw new Error('Failed to list documents');
    return res.json();
  },

  async getDocument(id: string): Promise<PDFDocument> {
    const res = await fetch(`${API_BASE}/api/documents/${id}`, { headers: headers(), credentials: 'include' });
    if (!res.ok) throw new Error('Failed to load document');
    return res.json();
  },

  async getUsage(): Promise<UsageInfo> {
    const res = await fetch(`${API_BASE}/api/usage`, { headers: headers(), credentials: 'include' });
    if (!res.ok) throw new Error('Failed to load usage');
    return res.json();
  },

  async saveDocument(doc: PDFDocument): Promise<void> {
    const res = await fetch(`${API_BASE}/api/documents/${doc.id}`, {
      method: 'PUT',
      headers: headers(),
      credentials: 'include',
      body: JSON.stringify(doc),
    });
    if (!res.ok) {
      const data = await parseErrorBody(res);
      if (data.error === 'weekly_limit_reached') {
        throw new WeeklyLimitError(data.message ?? 'Weekly limit reached', data.limit ?? 10);
      }
      throw new Error('Failed to save document');
    }
  },

  async deleteDocument(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/documents/${id}`, {
      method: 'DELETE',
      headers: headers(),
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Failed to delete document');
  },

  async createShare(documentId: string, access: 'view' | 'edit'): Promise<ShareInfo> {
    const res = await fetch(`${API_BASE}/api/documents/${documentId}/shares`, {
      method: 'POST',
      headers: headers(),
      credentials: 'include',
      body: JSON.stringify({ access }),
    });
    if (!res.ok) throw new Error('Failed to create share link');
    return res.json();
  },

  async listShares(documentId: string): Promise<ShareInfo[]> {
    const res = await fetch(`${API_BASE}/api/documents/${documentId}/shares`, {
      headers: headers(),
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Failed to load share links');
    return res.json();
  },

  async revokeShare(token: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/shares/${token}`, {
      method: 'DELETE',
      headers: headers(),
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Failed to revoke share link');
  },

  async getSharedDocument(token: string): Promise<{ document: PDFDocument; access: 'view' | 'edit' }> {
    const res = await fetch(`${API_BASE}/api/shared/${token}`);
    if (!res.ok) throw new Error('This share link is invalid or has been revoked');
    return res.json();
  },

  async saveSharedDocument(token: string, doc: PDFDocument): Promise<void> {
    const res = await fetch(`${API_BASE}/api/shared/${token}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    if (!res.ok) throw new Error('Failed to save — this link may be view-only');
  },

  // --- Auth ---
  async requestMagicLink(email: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/auth/request-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? 'Failed to send sign-in link');
  },

  async verifyMagicLink(token: string): Promise<AuthUser> {
    const res = await fetch(`${API_BASE}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token, deviceId: getDeviceId() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? 'This link is invalid or has expired');
    return data.user;
  },

  // Verifies the JWT credential handed back by Google's One Tap prompt.
  // Mirrors verifyMagicLink above (same deviceId-claiming behavior on the
  // backend) but hits a different endpoint since the credential itself is
  // a signed Google JWT rather than our own magic-link token.
  async googleOneTapLogin(credential: string): Promise<AuthUser> {
    const res = await fetch(`${API_BASE}/api/auth/google/onetap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ credential, deviceId: getDeviceId() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? 'Google sign-in failed');
    return data.user;
  },

  async getMe(): Promise<AuthUser | null> {
    const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.user;
  },

  async logout(): Promise<void> {
    await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
  },

  // --- Billing ---
  async getSubscription(): Promise<SubscriptionInfo> {
    const res = await fetch(`${API_BASE}/api/subscription`, { credentials: 'include' });
    if (!res.ok) return { planId: 'free', status: 'none' };
    return res.json();
  },

  async createStripeCheckout(planId: PlanId): Promise<string> {
    const res = await fetch(`${API_BASE}/api/checkout/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ planId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? 'Failed to start checkout');
    return data.url;
  },

  async createBinanceCheckout(planId: PlanId): Promise<string> {
    const res = await fetch(`${API_BASE}/api/checkout/binance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ planId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? 'Failed to start checkout');
    return data.url;
  },

  async sendChatMessage(messages: ChatMessage[], documentContext?: string): Promise<string> {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ messages, documentContext }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.error === 'upgrade_required') {
        throw new Error('upgrade_required');
      }
      throw new Error(data.error ?? 'Failed to get a response');
    }
    return data.reply;
  },

  // --- Admin ---
  // Backend MUST reject this with 403 for any non-admin session -- this
  // client call is only a convenience, not the access control.
  async getAdminAnalytics(): Promise<AdminAnalytics> {
    const res = await fetch(`${API_BASE}/api/admin/analytics`, {
      headers: headers(),
      credentials: 'include',
    });
    if (!res.ok) {
      const data = await parseErrorBody(res);
      throw new Error(data.error ?? 'Failed to load analytics');
    }
    return res.json();
  },
};