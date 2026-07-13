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
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <h3>Unsaved changes</h3>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
          You have changes that haven't been saved yet. Save before leaving, or you'll lose them.
        </p>
        {error && (
          <p style={{ color: '#dc2626', fontSize: 13 }}>
            Couldn't save — check your connection and try again.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onDiscard} style={{ color: '#dc2626' }}>
            Discard &amp; leave
          </button>
          <button onClick={onCancel}>Cancel</button>
          <button className="btn-accent" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}