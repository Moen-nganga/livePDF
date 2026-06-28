import { useState } from 'react';
import { exportToPdf } from '../lib/exportPdf';
import type { PDFDocument } from '../types/document';

interface Props {
  document: PDFDocument;
  onClose: () => void;
}

export function DownloadDialog({ document, onClose }: Props) {
  const [filename, setFilename] = useState(document.title || 'document');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await exportToPdf(document, filename);
      onClose();
    } catch (err) {
      console.error('Export failed', err);
      alert('Could not save the PDF. Please try again.');
    } finally {
      setSaving(false);
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
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: 24,
          width: 380,
          boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Save as PDF</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 16, cursor: 'pointer' }}>
            ✕
          </button>
        </div>

        <label style={{ display: 'block', marginTop: 16 }}>
          <span style={{ fontSize: 12, color: '#666' }}>File name</span>
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 4 }}>
            <input
              autoFocus
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => e.key === 'Enter' && !saving && handleSave()}
              style={{
                flex: 1,
                padding: '8px 10px',
                border: '1px solid #ccc',
                borderRadius: 4,
                fontSize: 14,
              }}
            />
            <span style={{ marginLeft: 6, color: '#888', fontSize: 14 }}>.pdf</span>
          </div>
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !filename.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}