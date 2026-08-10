interface SpellCheckResult {
  pageIndex: number;
  pageId: string;
  objectId: string;
  word: string;
  line: number;
}

interface Props {
  loading: boolean;
  error: string | null;
  results: SpellCheckResult[];
  onJumpTo: (pageIndex: number, objectId: string) => void;
  onClose: () => void;
}

export function SpellCheckPanel({ loading, error, results, onJumpTo, onClose }: Props) {
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
        style={{ padding: 24, width: 380, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>
            Spelling {!loading && !error && results.length > 0 ? `(${results.length})` : ''}
          </h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 16, cursor: 'pointer' }}>
            ✕
          </button>
        </div>

        {loading && (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Checking spelling…</p>
        )}

        {error && (
          <p style={{ fontSize: 13, color: '#dc2626' }}>{error}</p>
        )}

        {!loading && !error && results.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            NO SPELLING ERRORS FOUND.
          </p>
        )}

        {!loading && !error && results.length > 0 && (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {results.map((r, i) => (
              <button
                key={`${r.objectId}-${r.word}-${i}`}
                onClick={() => onJumpTo(r.pageIndex, r.objectId)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--color-border)',
                  marginBottom: 6,
                  background: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--color-text)' }}>
                  <span style={{ textDecoration: 'underline wavy #dc2626', textUnderlineOffset: 3 }}>
                    {r.word}
                  </span>
                </span>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  Page {r.pageIndex + 1}, Line {r.line}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}