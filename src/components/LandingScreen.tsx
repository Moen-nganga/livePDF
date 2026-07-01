import { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import { useEditorStore } from '../store/editorStore';
import { TEMPLATES, type TemplateDefinition } from '../lib/templates';
import { api, type DocumentSummary } from '../lib/api';

interface Props {
  onEnter: () => void;
}

export function LandingScreen({ onEnter }: Props) {
  const loadDocument = useEditorStore((s) => s.loadDocument);
  const [recent, setRecent] = useState<DocumentSummary[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);

  useEffect(() => {
    api.listDocuments()
      .then((docs) => setRecent(docs.slice(0, 6)))
      .catch(() => setRecent([]))
      .finally(() => setLoadingRecent(false));
  }, []);

  async function openTemplate(template: TemplateDefinition) {
    if (creating) return;
    setCreating(template.id);
    try {
      const doc = {
        id: nanoid(),
        title: template.id === 'blank' ? 'Untitled document' : template.label,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pages: template.buildPages(),
      };
      await api.saveDocument(doc);
      loadDocument(doc);
      onEnter();
    } catch {
      // Backend save failed — still open the doc locally, autosave will retry
      const doc = {
        id: nanoid(),
        title: template.id === 'blank' ? 'Untitled document' : template.label,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pages: template.buildPages(),
      };
      loadDocument(doc);
      onEnter();
    } finally {
      setCreating(null);
    }
  }

  async function openRecent(summary: DocumentSummary) {
    try {
      const doc = await api.getDocument(summary.id);
      loadDocument(doc);
      onEnter();
    } catch {
      alert('Could not open that document. It may have been deleted.');
      setRecent((r) => r.filter((d) => d.id !== summary.id));
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg)',
      fontFamily: 'var(--font-family)',
      overflowY: 'auto',
    }}>
      {/* Top bar */}
      <header style={{
        background: 'var(--color-surface)',
        borderBottom: '1.5px solid var(--color-border)',
        boxShadow: 'var(--shadow-header)',
        padding: '14px 32px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <rect width="28" height="28" rx="6" fill="#1a73e8" />
          <rect x="7" y="8" width="14" height="1.8" rx="0.9" fill="white" />
          <rect x="7" y="12" width="14" height="1.8" rx="0.9" fill="white" />
          <rect x="7" y="16" width="10" height="1.8" rx="0.9" fill="white" />
          <rect x="7" y="20" width="7" height="1.8" rx="0.9" fill="white" />
        </svg>
        <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text)' }}>
          PDF Editor
        </span>
      </header>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px 80px' }}>

        {/* Template picker */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: 'var(--color-text)' }}>
            Start a new document
          </h2>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 16,
          marginBottom: 52,
        }}>
          {TEMPLATES.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              loading={creating === template.id}
              onClick={() => openTemplate(template)}
            />
          ))}
        </div>

        {/* Recent documents */}
        <h2 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 500, color: 'var(--color-text)' }}>
          Recent documents
        </h2>

        {loadingRecent && (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</p>
        )}

        {!loadingRecent && recent.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            No recent documents yet — create one above to get started.
          </p>
        )}

        {!loadingRecent && recent.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 12,
          }}>
            {recent.map((doc) => (
              <RecentCard key={doc.id} doc={doc} onClick={() => openRecent(doc)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  loading,
  onClick,
}: {
  template: TemplateDefinition;
  loading: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      disabled={loading}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        padding: 0,
        border: hovered ? '2px solid var(--color-accent)' : '2px solid var(--color-border)',
        borderRadius: 10,
        background: 'var(--color-surface)',
        cursor: loading ? 'default' : 'pointer',
        overflow: 'hidden',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        boxShadow: hovered ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        textAlign: 'left',
      }}
    >
      {/* Thumbnail */}
      <div style={{
        height: 108,
        background: template.color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 40,
        position: 'relative',
      }}>
        {template.id === 'blank'
          ? <BlankIcon />
          : <span style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.12))' }}>{template.icon}</span>
        }
        {loading && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(255,255,255,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, color: 'var(--color-text-secondary)',
          }}>
            Creating…
          </div>
        )}
      </div>
      {/* Label */}
      <div style={{ padding: '10px 12px 12px' }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', lineHeight: 1.3 }}>
          {template.label}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3, lineHeight: 1.4 }}>
          {template.description}
        </div>
      </div>
    </button>
  );
}

function BlankIcon() {
  return (
    <svg width="52" height="64" viewBox="0 0 52 64" fill="none">
      <rect x="2" y="2" width="48" height="60" rx="4" fill="white" stroke="#dadce0" strokeWidth="2" />
      <rect x="10" y="16" width="32" height="2.5" rx="1.25" fill="#dadce0" />
      <rect x="10" y="23" width="32" height="2.5" rx="1.25" fill="#dadce0" />
      <rect x="10" y="30" width="24" height="2.5" rx="1.25" fill="#dadce0" />
      <rect x="10" y="37" width="28" height="2.5" rx="1.25" fill="#dadce0" />
      <path d="M36 2 L50 16" stroke="#dadce0" strokeWidth="2" />
      <path d="M36 2 L36 16 L50 16" fill="#f0f2f5" stroke="#dadce0" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function RecentCard({ doc, onClick }: { doc: DocumentSummary; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);

  const ago = formatAgo(doc.updatedAt);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        border: hovered ? '1.5px solid var(--color-accent)' : '1.5px solid var(--color-border)',
        borderRadius: 8,
        background: 'var(--color-surface)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        boxShadow: hovered ? 'var(--shadow-sm)' : 'none',
      }}
    >
      <div style={{
        width: 36, height: 44, flexShrink: 0,
        background: '#e8f0fe', borderRadius: 4,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18,
      }}>
        📄
      </div>
      <div style={{ overflow: 'hidden' }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: 'var(--color-text)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {doc.title || 'Untitled document'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
          {ago}
        </div>
      </div>
    </button>
  );
}

function formatAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}