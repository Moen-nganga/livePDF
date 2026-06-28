import { useEffect, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { Page } from '../types/document';

interface MenuState {
  pageId: string;
  x: number;
  y: number;
}

export function PageNav() {
  const document = useEditorStore((s) => s.document);
  const activePageIndex = useEditorStore((s) => s.activePageIndex);
  const setActivePageIndex = useEditorStore((s) => s.setActivePageIndex);
  const addBlankPage = useEditorStore((s) => s.addBlankPage);
  const removePage = useEditorStore((s) => s.removePage);
  const duplicatePage = useEditorStore((s) => s.duplicatePage);
  const renamePage = useEditorStore((s) => s.renamePage);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Close the context menu on any click elsewhere, or on Escape
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  if (!document) return null;

  function labelFor(page: Page, index: number): string {
    return page.name || `Page ${index + 1}`;
  }

  function startRename(page: Page, index: number) {
    setRenamingId(page.id);
    setRenameValue(labelFor(page, index));
    setMenu(null);
  }

  function commitRename(pageId: string) {
    const trimmed = renameValue.trim();
    if (trimmed) renamePage(pageId, trimmed);
    setRenamingId(null);
  }

  function handleDelete(pageId: string) {
    if (document!.pages.length <= 1) {
      // Matches the store's own guard — surfaced here so the user gets
      // an explanation instead of the click silently doing nothing.
      alert('A document needs at least one page — add another page before deleting this one.');
      setMenu(null);
      return;
    }
    removePage(pageId);
    setMenu(null);
  }

  return (
    <aside
      style={{
        width: 140,
        borderRight: '1px solid #ddd',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        overflowY: 'auto',
        background: '#fafafa',
        position: 'relative',
      }}
    >
      {document.pages.map((page, i) => (
        <div key={page.id}>
          {renamingId === page.id ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => commitRename(page.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(page.id);
                if (e.key === 'Escape') setRenamingId(null);
              }}
              style={{
                width: '100%',
                padding: 8,
                fontSize: 12,
                border: '2px solid #3380cc',
                boxSizing: 'border-box',
              }}
            />
          ) : (
            <button
              onClick={() => setActivePageIndex(i)}
              onContextMenu={(e) => {
                e.preventDefault();
                setActivePageIndex(i);
                setMenu({ pageId: page.id, x: e.clientX, y: e.clientY });
              }}
              onDoubleClick={() => startRename(page, i)}
              style={{
                width: '100%',
                border: i === activePageIndex ? '2px solid #3380cc' : '1px solid #ccc',
                background: '#fff',
                padding: 8,
                fontSize: 12,
                cursor: 'pointer',
                boxSizing: 'border-box',
              }}
            >
              {labelFor(page, i)}
            </button>
          )}
        </div>
      ))}

      <button onClick={() => addBlankPage('A4')} style={{ fontSize: 12 }}>
        + Add page
      </button>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onDuplicate={() => {
            duplicatePage(menu.pageId);
            setMenu(null);
          }}
          onRename={() => {
            const index = document.pages.findIndex((p) => p.id === menu.pageId);
            const page = document.pages[index];
            if (page) startRename(page, index);
          }}
          onDelete={() => handleDelete(menu.pageId)}
        />
      )}
    </aside>
  );
}

interface ContextMenuProps {
  x: number;
  y: number;
  onDuplicate: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function ContextMenu({ x, y, onDuplicate, onRename, onDelete }: ContextMenuProps) {
  // Fixed positioning at the raw click coordinates — this menu intentionally
  // renders outside the sidebar's own scroll/flow so it isn't clipped by
  // the sidebar's overflow:auto.
  return (
    <div
      onClick={(e) => e.stopPropagation()} // don't let the global "close on click" handler eat menu item clicks
      style={{
        position: 'fixed',
        top: y,
        left: x,
        background: '#fff',
        border: '1px solid #ccc',
        borderRadius: 4,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        zIndex: 1000,
        minWidth: 140,
        fontSize: 13,
        overflow: 'hidden',
      }}
    >
      <MenuItem label="Rename" onClick={onRename} />
      <MenuItem label="Duplicate" onClick={onDuplicate} />
      <MenuItem label="Delete" onClick={onDelete} danger />
    </div>
  );
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
        padding: '8px 12px',
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