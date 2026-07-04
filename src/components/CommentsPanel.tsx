import { useEffect, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { Page } from '../types/document';

interface Props {
  page: Page;
  isReadOnly: boolean;
}

/**
 * Right-hand comments panel for the active page. Lists both general
 * (page-level) comments and comments anchored to a specific object,
 * sorted newest-first. There's no marker/pin drawn on the canvas itself —
 * this list is the only place comments are visible, which keeps
 * PdfCanvas/Fabric untouched.
 *
 * Adding/resolving/deleting comments is hidden for read-only share
 * sessions, same as every other content-modifying control in this app
 * (Toolbar, EditMenu, AddMenu) — viewers can still read existing comments.
 */
export function CommentsPanel({ page, isReadOnly }: Props) {
  const document = useEditorStore((s) => s.document);
  const selectedObjectId = useEditorStore((s) => s.selectedObjectId);
  const addComment = useEditorStore((s) => s.addComment);
  const resolveComment = useEditorStore((s) => s.resolveComment);
  const deleteComment = useEditorStore((s) => s.deleteComment);

  const [text, setText] = useState('');
  const [attachToSelected, setAttachToSelected] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  // If the user deselects the object (or it gets deleted) after checking
  // "attach to selected object", uncheck it too — otherwise submitting
  // would silently fall back to a general comment without the user
  // noticing the checkbox no longer means what it says.
  useEffect(() => {
    if (!selectedObjectId) setAttachToSelected(false);
  }, [selectedObjectId]);

  // Switching pages: clear the draft rather than carrying half-typed text
  // (and a stale "attach to selected" choice) onto an unrelated page.
  useEffect(() => {
    setText('');
    setAttachToSelected(false);
  }, [page.id]);

  const allComments = document?.comments ?? [];
  const pageComments = allComments
    .filter((c) => c.pageId === page.id)
    .filter((c) => showResolved || !c.resolved)
    .sort((a, b) => b.createdAt - a.createdAt);

  function describeTarget(objectId?: string): string {
    if (!objectId) return 'General comment';
    const obj = page.objects.find((o) => o.id === objectId);
    if (!obj) return 'On a deleted object';
    if (obj.type === 'text') {
      const trimmed = obj.text.trim();
      const preview = trimmed.slice(0, 24);
      return `On text: "${preview}${trimmed.length > 24 ? '…' : ''}"`;
    }
    return `On ${obj.type} object`;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    addComment(page.id, trimmed, attachToSelected ? selectedObjectId ?? undefined : undefined);
    setText('');
  }

  return (
    <aside
      style={{
        width: 260,
        flexShrink: 0,
        borderLeft: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <strong style={{ fontSize: 13 }}>Comments</strong>
        <label
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          Show resolved
        </label>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {pageComments.length === 0 && (
          <div style={{ padding: '14px', fontSize: 12, color: 'var(--color-text-muted)' }}>
            No comments on this page yet.
          </div>
        )}
        {pageComments.map((c) => (
          <div
            key={c.id}
            style={{
              padding: '10px 14px',
              borderBottom: '1px solid #f0f0f0',
              opacity: c.resolved ? 0.55 : 1,
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
              {describeTarget(c.objectId)}
            </div>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {c.text}
            </div>
            {!isReadOnly && (
              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button
                  onClick={() => resolveComment(c.id, !c.resolved)}
                  style={{
                    fontSize: 11,
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-text-secondary)',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {c.resolved ? 'Unresolve' : 'Resolve'}
                </button>
                <button
                  onClick={() => deleteComment(c.id)}
                  style={{
                    fontSize: 11,
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-danger)',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {!isReadOnly && (
        <form onSubmit={handleSubmit} style={{ borderTop: '1px solid var(--color-border)', padding: 10 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a comment…"
            rows={2}
            style={{ width: '100%', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 6,
            }}
          >
            <label
              style={{
                fontSize: 11,
                color: selectedObjectId ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                cursor: selectedObjectId ? 'pointer' : 'default',
              }}
              title={selectedObjectId ? undefined : 'Select an object on the canvas first'}
            >
              <input
                type="checkbox"
                checked={attachToSelected}
                disabled={!selectedObjectId}
                onChange={(e) => setAttachToSelected(e.target.checked)}
              />
              Attach to selected object
            </label>
            <button
              type="submit"
              disabled={!text.trim()}
              className="btn-accent"
              style={{ fontSize: 12, padding: '4px 10px' }}
            >
              Add
            </button>
          </div>
        </form>
      )}
    </aside>
  );
}