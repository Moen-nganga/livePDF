import { useEffect, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { api } from '../lib/api';
import { ShareDialog } from './ShareDialog';
import { NewDocumentDialog } from './NewDocumentDialog';

/**
 * The File menu — a dropdown styled after Google Sheets' File menu, scoped
 * to just the actions this app actually supports: New, Make a copy,
 * Rename, Delete, Share. (Other items from that reference, like Move or
 * Version history, don't apply here — there's no folder structure or
 * revision history in this app.)
 */
export function FileMenu() {
  const [open, setOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [newDocOpen, setNewDocOpen] = useState(false);

  const document = useEditorStore((s) => s.document);
  const createBlankDocument = useEditorStore((s) => s.createBlankDocument);
  const copyDocument = useEditorStore((s) => s.copyDocument);
  const setIsRenamingTitle = useEditorStore((s) => s.setIsRenamingTitle);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function handleNew() {
    setOpen(false);
    setNewDocOpen(true);
  }

  async function handleMakeACopy() {
    setOpen(false);
    const copy = copyDocument();
    if (!copy) return;
    try {
      await api.saveDocument(copy);
    } catch {
      // Auto-save will retry shortly via the normal save-status flow;
      // no need to interrupt the user here.
    }
  }

  function handleRename() {
    setOpen(false);
    if (!document) return;
    // Triggers the same inline, highlight-and-type editing as clicking the
    // title directly — see EditableTitle, which reads this same flag.
    setIsRenamingTitle(true);
  }

  async function handleDelete() {
    setOpen(false);
    if (!document) return;
    const ok = confirm(
      `Delete "${document.title}"? This cannot be undone.`
    );
    if (!ok) return;

    try {
      await api.deleteDocument(document.id);
    } catch {
      alert('Could not delete the document — check your connection and try again.');
      return;
    }
    // After deleting, there's nothing left to show, so start fresh —
    // matches "New" behavior. A future improvement could instead load
    // the next most recent document if one exists.
    createBlankDocument('A4');
  }

  function handleShare() {
    setOpen(false);
    setShareOpen(true);
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
        File
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            minWidth: 200,
            fontSize: 13,
            overflow: 'hidden',
          }}
        >
          <MenuItem label="New" onClick={handleNew} />
          <MenuItem label="Make a copy" onClick={handleMakeACopy} />
          <Divider />
          <MenuItem label="Rename" onClick={handleRename} />
          <MenuItem label="Share" onClick={handleShare} />
          <Divider />
          <MenuItem label="Delete" onClick={handleDelete} danger />
        </div>
      )}

      {shareOpen && document && (
        <ShareDialog document={document} onClose={() => setShareOpen(false)} />
      )}

      {newDocOpen && <NewDocumentDialog onClose={() => setNewDocOpen(false)} />}
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: '1px solid #eee', margin: '4px 0' }} />;
}

function MenuItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '8px 14px',
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        color: danger ? '#cc3333' : '#222',
        fontSize: 13,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
    >
      {label}
    </button>
  );
}