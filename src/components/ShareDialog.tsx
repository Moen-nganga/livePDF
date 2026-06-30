import { useEffect, useState } from 'react';
import { api, type ShareInfo } from '../lib/api';
import type { PDFDocument } from '../types/document';

interface Props {
  document: PDFDocument;
  onClose: () => void;
}

export function ShareDialog({ document, onClose }: Props) {
  const [shares, setShares] = useState<ShareInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<'view' | 'edit' | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  useEffect(() => {
    api
      .listShares(document.id)
      .then(setShares)
      .catch(() => setShares([]))
      .finally(() => setLoading(false));
  }, [document.id]);

  async function createLink(access: 'view' | 'edit') {
    setCreating(access);
    try {
      const share = await api.createShare(document.id, access);
      setShares((prev) => [share, ...prev]);
      await copyLink(share.token);
    } catch {
      alert('Could not create the share link. Check your connection and try again.');
    } finally {
      setCreating(null);
    }
  }

  async function copyLink(token: string) {
    const url = `${window.location.origin}${window.location.pathname}?share=${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken((t) => (t === token ? null : t)), 2000);
    } catch {
      // Clipboard API can fail without a permissions prompt in some
      // contexts (e.g. non-HTTPS) — fall back to a visible prompt so the
      // link is still obtainable.
      prompt('Copy this link:', url);
    }
  }

  async function revoke(token: string) {
    const ok = confirm('Revoke this link? Anyone who has it will lose access immediately.');
    if (!ok) return;
    try {
      await api.revokeShare(token);
      setShares((prev) => prev.filter((s) => s.token !== token));
    } catch {
      alert('Could not revoke the link. Check your connection and try again.');
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
    >
      <div
        className="surface-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          padding: 24,
          width: 420,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Share "{document.title}"</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 16, cursor: 'pointer' }}>
            ✕
          </button>
        </div>

        <p style={{ fontSize: 13, color: '#666', marginTop: 8 }}>
          Anyone with the link gets the access level you choose below — no account needed on
          their end. There's no way to limit it to a specific person, so only share links with
          people you trust with that access level.
        </p>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            onClick={() => createLink('view')}
            disabled={creating !== null}
            style={{ flex: 1, padding: '8px 0' }}
          >
            {creating === 'view' ? 'Creating…' : 'Create view-only link'}
          </button>
          <button
            onClick={() => createLink('edit')}
            disabled={creating !== null}
            style={{ flex: 1, padding: '8px 0' }}
          >
            {creating === 'edit' ? 'Creating…' : 'Create edit link'}
          </button>
        </div>

        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Active links</div>
          {loading && <div style={{ fontSize: 13, color: '#888' }}>Loading…</div>}
          {!loading && shares.length === 0 && (
            <div style={{ fontSize: 13, color: '#888' }}>No share links yet.</div>
          )}
          {shares.map((share) => (
            <div
              key={share.token}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 0',
                borderBottom: '1px solid #f0f0f0',
                fontSize: 13,
              }}
            >
              <span>
                {share.access === 'edit' ? 'Can edit' : 'Can view'}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => copyLink(share.token)} style={{ fontSize: 12 }}>
                  {copiedToken === share.token ? 'Copied!' : 'Copy link'}
                </button>
                <button onClick={() => revoke(share.token)} style={{ fontSize: 12, color: '#cc3333' }}>
                  Revoke
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}