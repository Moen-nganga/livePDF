import { useEffect, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import type { Page } from '../types/document';
import { PremiumRequiredDialog } from './PremiumRequiredDialog';

const FREE_PAGE_LIMIT = 20;

interface MenuState {
  pageId: string;
  x: number;
  y: number;
}

interface PageNavProps {
  /** Called when a free-tier user hits the page limit and clicks "Upgrade" in the resulting prompt. */
  onRequirePremium?: () => void;
}

// Tracks whether the viewport is at or below a "mobile" breakpoint, kept in
// sync via a matchMedia listener (covers resize/rotation, not just the
// size at mount). Same 640px threshold and pattern used elsewhere
// (LandingScreen) -- duplicated locally rather than shared since there's
// no existing utils module to put it in yet.
function useIsMobile(breakpoint = 640): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= breakpoint
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [breakpoint]);

  return isMobile;
}

export function PageNav({ onRequirePremium }: PageNavProps) {
  const document = useEditorStore((s) => s.document);
  const activePageIndex = useEditorStore((s) => s.activePageIndex);
  const setActivePageIndex = useEditorStore((s) => s.setActivePageIndex);
  const addBlankPage = useEditorStore((s) => s.addBlankPage);
  const removePage = useEditorStore((s) => s.removePage);
  const duplicatePage = useEditorStore((s) => s.duplicatePage);
  const renamePage = useEditorStore((s) => s.renamePage);
  const isCollapsed = useEditorStore((s) => s.isPageNavCollapsed);
  const setIsCollapsed = useEditorStore((s) => s.setIsPageNavCollapsed);

  const isMobile = useIsMobile();

  const subscription = useSubscriptionStore((s) => s.subscription);
  // Client-side gate only, same caveat as Toolbar's signature gating and
  // App.tsx's AI chat gating -- there's no server resource being consumed
  // by adding a page in this check itself (unlike the weekly
  // document-creation limit, which is enforced server-side too). Worth
  // revisiting with a server-side check if this ever needs to be airtight.
  const isPremium =
    subscription?.status === 'active' &&
    (subscription.planId === 'pro_monthly' || subscription.planId === 'pro_yearly');

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [premiumPromptOpen, setPremiumPromptOpen] = useState(false);

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

  const pageCount = document.pages.length;
  const atPageLimit = !isPremium && pageCount >= FREE_PAGE_LIMIT;

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

  function handleAddPage() {
    if (atPageLimit) {
      setPremiumPromptOpen(true);
      return;
    }
    addBlankPage('A4');
  }

  function handleDuplicate(pageId: string) {
    if (atPageLimit) {
      setMenu(null);
      setPremiumPromptOpen(true);
      return;
    }
    duplicatePage(pageId);
    setMenu(null);
  }

  // Collapsed to a thin strip -- most useful on mobile, where the sidebar's
  // own width is real estate taken directly from the canvas, but left
  // available on desktop too via the same toggle for anyone who wants the
  // extra room. Nothing about page state is lost while collapsed; this is
  // purely a view toggle (isPageNavCollapsed already lives in the store as
  // transient view state, same category as showRuler/showComments).
  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        title="Show pages"
        aria-label="Show pages"
        style={{
          width: 20,
          alignSelf: 'stretch',
          border: 'none',
          borderRight: '1.5px solid var(--color-sidebar-border)',
          background: 'var(--color-surface)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          flexShrink: 0,
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M3 1.5L7 5L3 8.5" stroke="var(--color-text-muted)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    );
  }

  return (
    <aside
      className="app-sidebar"
      style={{
        width: isMobile ? 100 : 152,
        flexShrink: 0,
        padding: isMobile ? 8 : 12,
        display: 'flex',
        flexDirection: 'column',
        gap: isMobile ? 6 : 8,
        overflowY: 'auto',
        position: 'relative',
      }}
    >
      {/* Collapse toggle -- tucked at the top so it doesn't cost its own
          row of vertical space beyond what the page list already uses. */}
      <button
        onClick={() => setIsCollapsed(true)}
        title="Hide pages"
        aria-label="Hide pages"
        style={{
          alignSelf: 'flex-end',
          width: 22,
          height: 22,
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          background: 'transparent',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M7 1.5L3 5L7 8.5" stroke="var(--color-text-muted)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

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
                padding: isMobile ? 6 : 8,
                fontSize: isMobile ? 11 : 12,
                border: '2px solid var(--color-accent)',
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
              title={labelFor(page, i)}
              style={{
                width: '100%',
                border: i === activePageIndex ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                background: '#fff',
                padding: isMobile ? 6 : 8,
                fontSize: isMobile ? 11 : 12,
                cursor: 'pointer',
                boxSizing: 'border-box',
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {labelFor(page, i)}
            </button>
          )}
        </div>
      ))}

      <button
        onClick={handleAddPage}
        title={atPageLimit ? `Free plan limit: ${FREE_PAGE_LIMIT} pages — upgrade for unlimited pages` : undefined}
        style={{
          fontSize: isMobile ? 11 : 12,
          padding: isMobile ? '6px 4px' : undefined,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {atPageLimit
          ? isMobile
            ? `⭐ ${pageCount}/${FREE_PAGE_LIMIT}`
            : `⭐ Add page (${pageCount}/${FREE_PAGE_LIMIT})`
          : '+ Add page'}
      </button>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onDuplicate={() => handleDuplicate(menu.pageId)}
          onRename={() => {
            const index = document.pages.findIndex((p) => p.id === menu.pageId);
            const page = document.pages[index];
            if (page) startRename(page, index);
          }}
          onDelete={() => handleDelete(menu.pageId)}
        />
      )}

      {premiumPromptOpen && (
        <PremiumRequiredDialog
          featureName={`Pages beyond ${FREE_PAGE_LIMIT}`}
          onClose={() => setPremiumPromptOpen(false)}
          onUpgrade={() => {
            setPremiumPromptOpen(false);
            onRequirePremium?.();
          }}
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