import { useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import { usePdfUpload } from '../hooks/usePdfUpload';

interface Props {
  onClose: () => void;
}

export function NewDocumentDialog({ onClose }: Props) {
  const createBlankDocument = useEditorStore((s) => s.createBlankDocument);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, loading } = usePdfUpload();

  function handleBlank() {
    createBlankDocument('A4');
    onClose();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const ok = await uploadFile(file);
    if (ok) onClose();
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
          <h3 style={{ margin: 0, fontSize: 16 }}>New document</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 16, cursor: 'pointer' }}>
            ✕
          </button>
        </div>

        <p style={{ fontSize: 13, color: '#666', marginTop: 8 }}>
          Your current document is already saved — starting a new one just switches you over,
          nothing is lost.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
          <OptionButton
            title="Blank document"
            subtitle="Start with an empty page"
            onClick={handleBlank}
          />
          <OptionButton
            title={loading ? 'Reading PDF…' : 'Upload a PDF'}
            subtitle="Start from an existing file"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={handleFile}
        />
      </div>
    </div>
  );
}

function OptionButton({
  title,
  subtitle,
  onClick,
  disabled,
}: {
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        textAlign: 'left',
        padding: '12px 14px',
        border: '1px solid #ddd',
        borderRadius: 6,
        background: '#fff',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
      onMouseEnter={(e) => !disabled && (e.currentTarget.style.background = '#f7f7f7')}
      onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
    >
      <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
      <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{subtitle}</div>
    </button>
  );
}