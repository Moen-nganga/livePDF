import { useEffect, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { useI18nStore } from '../store/i18nStore';

const MENU_ID = 'view';

/**
 * The View menu — Full screen and the page sidebar toggle so far. Scoped
 * down the same way EditMenu/FileMenu are: only what this app actually
 * supports, nothing copied over from a reference screenshot for its own
 * sake. (Ruler, Comments, and Suggesting/Mode from the Docs reference are
 * intentionally left out until those features actually exist elsewhere in
 * the app.)
 *
 * Available regardless of owner/read-only status — viewing fullscreen is
 * just as useful on a view-only share link as it is for the owner. The
 * page sidebar toggle is only relevant for owners, since PageNav itself is
 * only rendered for `isOwner` in App.tsx.
 */
export function ViewMenu() {
  const openMenuId = useEditorStore((s) => s.openMenuId);
  const setOpenMenuId = useEditorStore((s) => s.setOpenMenuId);
  const open = openMenuId === MENU_ID;
  const t = useI18nStore((s) => s.t);

  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

  const isOwner = useEditorStore((s) => s.shareSession === null);
  const isPageNavCollapsed = useEditorStore((s) => s.isPageNavCollapsed);
  const setIsPageNavCollapsed = useEditorStore((s) => s.setIsPageNavCollapsed);
  const showRuler = useEditorStore((s) => s.showRuler);
  const setShowRuler = useEditorStore((s) => s.setShowRuler);
  const showComments = useEditorStore((s) => s.showComments);
  const setShowComments = useEditorStore((s) => s.setShowComments);

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

  // Fullscreen can be exited by the browser itself (Esc, its own UI chrome,
  // switching tabs on some platforms) without ever calling our handler, so
  // the menu label has to stay in sync via the event rather than the click
  // handler alone.
  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  async function handleToggleFullscreen() {
    setOpenMenuId(null);

    // Fullscreen the canvas area specifically (not the whole app) so the
    // menus/toolbar disappear and only the PDF itself fills the screen.
    // Falls back to the whole document if that element isn't there for
    // some reason, so the action never silently does nothing.
    const target =
      (document.querySelector('.app-canvas-area') as HTMLElement | null) ??
      document.documentElement;

    try {
      if (!document.fullscreenElement) {
        await target.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Some browsers/contexts (e.g. iframes without allow="fullscreen")
      // reject this — nothing else to do but leave the view as-is.
    }
  }

  function handleTogglePageSidebar() {
    setOpenMenuId(null);
    setIsPageNavCollapsed(!isPageNavCollapsed);
  }

  function handleToggleRuler() {
    setOpenMenuId(null);
    setShowRuler(!showRuler);
  }

  function handleToggleComments() {
    setOpenMenuId(null);
    setShowComments(!showComments);
  }

  // Hovering only switches menus once one is already open by a click —
  // hovering the bar with nothing open does nothing, matching native menu
  // bars and Docs.
  function handleMouseEnter() {
    if (openMenuId !== null && openMenuId !== MENU_ID) setOpenMenuId(MENU_ID);
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} onMouseEnter={handleMouseEnter}>
      <button
        className={open ? 'tool-active' : undefined}
        onClick={(e) => { e.stopPropagation(); setOpenMenuId(open ? null : MENU_ID); }}
      >
        {t('viewMenu.view')}
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
          <MenuItem
            label={isFullscreen ? t('viewMenu.exitFullScreen') : t('viewMenu.fullScreen')}
            shortcut="F11"
            onClick={handleToggleFullscreen}
            checked={isFullscreen}
          />
          <Divider />
          {isOwner && (
            <MenuItem
              label={t('viewMenu.showPageSidebar')}
              onClick={handleTogglePageSidebar}
              checked={!isPageNavCollapsed}
            />
          )}
          <MenuItem label={t('viewMenu.showRuler')} onClick={handleToggleRuler} checked={showRuler} />
          <MenuItem label={t('viewMenu.showComments')} onClick={handleToggleComments} checked={showComments} />
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
  checked,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  checked?: boolean;
}) {
  return (
    <button
      onClick={onClick}
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
        cursor: 'pointer',
        color: 'var(--color-text)',
        fontSize: 13,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 14, display: 'inline-block' }}>{checked ? '✓' : ''}</span>
        {label}
      </span>
      {shortcut && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{shortcut}</span>}
    </button>
  );
}