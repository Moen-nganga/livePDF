import type { PDFDocument } from '../types/document';
import { getDeviceId } from './deviceId';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';

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
}

export const api = {
  async listDocuments(): Promise<DocumentSummary[]> {
    const res = await fetch(`${API_BASE}/api/documents`, { headers: headers() });
    if (!res.ok) throw new Error('Failed to list documents');
    return res.json();
  },

  async getDocument(id: string): Promise<PDFDocument> {
    const res = await fetch(`${API_BASE}/api/documents/${id}`, { headers: headers() });
    if (!res.ok) throw new Error('Failed to load document');
    return res.json();
  },

  async saveDocument(doc: PDFDocument): Promise<void> {
    const res = await fetch(`${API_BASE}/api/documents/${doc.id}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(doc),
    });
    if (!res.ok) throw new Error('Failed to save document');
  },

  async deleteDocument(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/documents/${id}`, {
      method: 'DELETE',
      headers: headers(),
    });
    if (!res.ok) throw new Error('Failed to delete document');
  },

  async createShare(documentId: string, access: 'view' | 'edit'): Promise<ShareInfo> {
    const res = await fetch(`${API_BASE}/api/documents/${documentId}/shares`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ access }),
    });
    if (!res.ok) throw new Error('Failed to create share link');
    return res.json();
  },

  async listShares(documentId: string): Promise<ShareInfo[]> {
    const res = await fetch(`${API_BASE}/api/documents/${documentId}/shares`, {
      headers: headers(),
    });
    if (!res.ok) throw new Error('Failed to load share links');
    return res.json();
  },

  async revokeShare(token: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/shares/${token}`, {
      method: 'DELETE',
      headers: headers(),
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
  // These use credentials: 'include' (not the X-Device-Id header pattern
  // above) since auth relies on an httpOnly session cookie, not a device id.

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

  // Passes the current device's id so the server can attach this device's
  // existing anonymous documents to the now-known user.
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

  async getMe(): Promise<AuthUser | null> {
    const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.user;
  },

  async logout(): Promise<void> {
    await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
  },
};