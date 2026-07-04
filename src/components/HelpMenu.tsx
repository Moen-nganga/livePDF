import { useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';

const MENU_ID = 'help';

/**
 * The Help menu — opens static HTML pages in a new tab (public/legal/),
 * scoped down from the reference screenshot to just what this app
 * actually has: Help, Privacy Policy, Terms of Service. No search,
 * training, function list, etc., since those don't apply here.
 */
export function HelpMenu() {
  const openMenuId = useEditorStore((s) => s.openMenuId);
  const setOpenMenuId = useEditorStore((s) => s.setOpenMenuId);
  const open = openMenuId === MENU_ID;

  useEffect(() => {
    if (!open) return;
    const close = () => setOpenMenuId(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenMenuId(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, setOpenMenuId]);

  function openPage(path: string) {
    setOpenMenuId(null);
    window.open(path, '_blank', 'noopener,noreferrer');
  }

  // Hovering only switches menus once one is already open by a click —
  // hovering the bar with nothing open does nothing, matching native menu
  // bars and Docs.
  function handleMouseEnter() {
    if (openMenuId !== null && openMenuId !== MENU_ID) setOpenMenuId(MENU_ID);
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} onMouseEnter={handleMouseEnter}>
      <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(open ? null : MENU_ID); }}>
        Help
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
            minWidth: 180,
            fontSize: 13,
            overflow: 'hidden',
          }}
        >
          <MenuItem label="Help" onClick={() => openPage('/legal/help.html')} />
          <Divider />
          <MenuItem label="Privacy Policy" onClick={() => openPage('/legal/privacy.html')} />
          <MenuItem label="Terms of Service" onClick={() => openPage('/legal/terms.html')} />
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0' }} />;
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
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
        borderRadius: 0,
        cursor: 'pointer',
        color: 'var(--color-text)',
        fontSize: 13,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
    >
      {label}
    </button>
  );
}