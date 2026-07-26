import { useState } from 'react';

interface Props {
  onSave: () => Promise<boolean>;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog({ onSave, onDiscard, onCancel }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(false);
    const ok = await onSave();
    setSaving(false);
    if (!ok) setError(true);
    // On success the caller (App.tsx) closes this dialog itself — it
    // knows hasUnsavedChanges just flipped to false and can decide what
    // to do next (here: nothing, so a second Home click goes straight
    // through, per the requested behavior).
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(32,33,36,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 380,
          background: 'var(--color-surface, #ffffff)',
          borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
          padding: 22,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>
          Unsaved changes
        </h3>
        <p style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', marginTop: 8, marginBottom: 0, lineHeight: 1.5 }}>
          You have changes that haven't been saved yet. Save before leaving, or you'll lose them.
        </p>
        {error && (
          <p style={{ color: '#dc2626', fontSize: 12.5, marginTop: 10, marginBottom: 0 }}>
            Couldn't save — check your connection and try again.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button
            onClick={onDiscard}
            disabled={saving}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#dc2626',
              fontSize: 13,
              fontWeight: 500,
              padding: '8px 12px',
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            Discard &amp; leave
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            style={{
              border: '1.5px solid var(--color-border)',
              background: 'transparent',
              color: 'var(--color-text)',
              fontSize: 13,
              fontWeight: 500,
              padding: '8px 14px',
              borderRadius: 20,
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            className="btn-accent"
            onClick={handleSave}
            disabled={saving}
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: '8px 16px',
              borderRadius: 20,
              border: 'none',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}