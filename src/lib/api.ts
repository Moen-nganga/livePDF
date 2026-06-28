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
};