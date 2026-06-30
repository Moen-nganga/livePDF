import { useEffect, useState } from 'react';
import { useEditorStore } from '../store/editorStore';

/**
 * The Edit menu — Undo, Redo, and Delete (of the currently selected
 * object). Scoped down from the reference screenshot's full Sheets Edit
 * menu: Cut/Copy/Paste and Move don't apply here (no multi-cell selection
 * concept), and Find & Replace was explicitly left out per the brief.
 */
export function EditMenu() {
  const [open, setOpen] = useState(false);

  const document = useEditorStore((s) => s.document);
  const activePageIndex = useEditorStore((s) => s.activePageIndex);
  const selectedObjectId = useEditorStore((s) => s.selectedObjectId);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const removeObject = useEditorStore((s) => s.removeObject);

  const activePage = document?.pages[activePageIndex];
  const hasSelection = !!activePage?.objects.some((o) => o.id === selectedObjectId);

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

  // Keyboard shortcuts work regardless of whether the menu is open,
  // matching how Ctrl+Z/Ctrl+Y behave in every editor that has them —
  // people expect these to just work, not require opening a menu first.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isTypingInForm =
        window.document.activeElement?.tagName === 'INPUT' ||
        window.document.activeElement?.tagName === 'TEXTAREA';
      if (isTypingInForm) return; // don't hijack undo while typing in our own form fields (rename, link URL, etc.)

      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  function handleUndo() {
    setOpen(false);
    undo();
  }

  function handleRedo() {
    setOpen(false);
    redo();
  }

  function handleDelete() {
    setOpen(false);
    if (!activePage || !selectedObjectId) return;
    removeObject(activePage.id, selectedObjectId);
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
        Edit
      </button>

      {open && (
        <div
          className="popover"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            zIndex: 1000,
            minWidth: 200,
            fontSize: 13,
            overflow: 'hidden',
          }}
        >
          <MenuItem label="Undo" shortcut="Ctrl+Z" onClick={handleUndo} disabled={!canUndo()} />
          <MenuItem label="Redo" shortcut="Ctrl+Y" onClick={handleRedo} disabled={!canRedo()} />
          <Divider />
          <MenuItem label="Delete" onClick={handleDelete} disabled={!hasSelection} danger />
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0' }} />;
}

function MenuItem({
  label,
  shortcut,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
        textAlign: 'left',
        padding: '8px 14px',
        border: 'none',
        background: 'none',
        borderRadius: 0,
        cursor: disabled ? 'default' : 'pointer',
        color: disabled
          ? 'var(--color-text-muted)'
          : danger
            ? 'var(--color-danger)'
            : 'var(--color-text)',
        fontSize: 13,
      }}
      onMouseEnter={(e) => !disabled && (e.currentTarget.style.background = '#f0f0f0')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
    >
      <span>{label}</span>
      {shortcut && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{shortcut}</span>}
    </button>
  );
}