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

// Fixed height of the mobile bottom tab strip -- exported so App.tsx can
// reserve matching space (paddingBottom) in the canvas area instead of the
// fixed-position bar overlapping page content.
export const PAGE_NAV_MOBILE_BAR_HEIGHT = 48;

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

  // Mobile-only: which page's action sheet (Rename/Duplicate/Delete) is
  // open, and whether the rename dialog is showing. Kept separate from the
  // desktop `menu`/`renamingId` state above because the mobile bottom-sheet
  // presentation is different enough (full-width sheet vs. anchored
  // context menu, modal rename vs. inline input) that reusing the same
  // state would tangle two different UIs together.
  const [mobileActionSheetPageId, setMobileActionSheetPageId] = useState<string | null>(null);
  const [mobileRenamePageId, setMobileRenamePageId] = useState<string | null>(null);
  const [mobileRenameValue, setMobileRenameValue] = useState('');

  // Close the (desktop) context menu on any click elsewhere, or on Escape
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
      setMobileActionSheetPageId(null);
      return;
    }
    removePage(pageId);
    setMenu(null);
    setMobileActionSheetPageId(null);
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
      setMobileActionSheetPageId(null);
      setPremiumPromptOpen(true);
      return;
    }
    duplicatePage(pageId);
    setMenu(null);
    setMobileActionSheetPageId(null);
  }

  function openMobileRename(page: Page, index: number) {
    setMobileRenamePageId(page.id);
    setMobileRenameValue(labelFor(page, index));
    setMobileActionSheetPageId(null);
  }

  function commitMobileRename() {
    if (!mobileRenamePageId) return;
    const trimmed = mobileRenameValue.trim();
    if (trimmed) renamePage(mobileRenamePageId, trimmed);
    setMobileRenamePageId(null);
  }

  // ---- Mobile: horizontal bottom tab strip, Google Sheets style ----
  // Tapping a tab that's already active opens the action sheet (rename /
  // duplicate / delete) rather than dedicating separate on-screen space to
  // a per-tab menu button, which wouldn't fit at this bar's height once
  // there are more than a couple of pages.
  if (isMobile) {
    return (
      <>
        <nav
          className="pagenav-mobile-bar"
          aria-label="Pages"
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            height: PAGE_NAV_MOBILE_BAR_HEIGHT,
            display: 'flex',
            alignItems: 'stretch',
            background: 'var(--color-surface)',
            borderTop: '1px solid var(--color-sidebar-border)',
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            zIndex: 500,
          }}
        >
          {document.pages.map((page, i) => {
            const active = i === activePageIndex;
            return (
              <button
                key={page.id}
                onClick={() => {
                  if (active) {
                    setMobileActionSheetPageId(page.id);
                  } else {
                    setActivePageIndex(i);
                  }
                }}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '0 16px',
                  border: 'none',
                  borderTop: active ? '2px solid var(--color-accent)' : '2px solid transparent',
                  background: active ? 'var(--color-accent-bg)' : 'transparent',
                  fontWeight: active ? 600 : 400,
                  fontSize: 13,
                  color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  whiteSpace: 'nowrap',
                }}
              >
                {labelFor(page, i)}
                {active && <span style={{ fontSize: 10 }}>▾</span>}
              </button>
            );
          })}
          <button
            onClick={handleAddPage}
            title={atPageLimit ? `Free plan limit: ${FREE_PAGE_LIMIT} pages — upgrade for unlimited pages` : 'Add page'}
            style={{
              flexShrink: 0,
              width: 44,
              border: 'none',
              borderLeft: '1px solid var(--color-sidebar-border)',
              background: 'transparent',
              fontSize: 18,
              color: atPageLimit ? 'var(--color-accent)' : 'var(--color-text-secondary)',
            }}
          >
            {atPageLimit ? '⭐' : '+'}
          </button>
        </nav>

        {mobileActionSheetPageId && (
          <MobileActionSheet
            pageLabel={(() => {
              const idx = document.pages.findIndex((p) => p.id === mobileActionSheetPageId);
              const page = document.pages[idx];
              return page ? labelFor(page, idx) : '';
            })()}
            onRename={() => {
              const idx = document.pages.findIndex((p) => p.id === mobileActionSheetPageId);
              const page = document.pages[idx];
              if (page) openMobileRename(page, idx);
            }}
            onDuplicate={() => handleDuplicate(mobileActionSheetPageId)}
            onDelete={() => handleDelete(mobileActionSheetPageId)}
            onClose={() => setMobileActionSheetPageId(null)}
          />
        )}

        {mobileRenamePageId && (
          <MobileRenameDialog
            value={mobileRenameValue}
            onChange={setMobileRenameValue}
            onCancel={() => setMobileRenamePageId(null)}
            onSave={commitMobileRename}
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
      </>
    );
  }

  // ---- Desktop: unchanged side column ----

  // Collapsed to a thin strip -- left available on desktop via a toggle for
  // anyone who wants the extra canvas width. Nothing about page state is
  // lost while collapsed; this is purely a view toggle (isPageNavCollapsed
  // already lives in the store as transient view state, same category as
  // showRuler/showComments).
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
        width: 152,
        flexShrink: 0,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
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
                padding: 8,
                fontSize: 12,
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
                padding: 8,
                fontSize: 12,
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
          fontSize: 12,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {atPageLimit ? `⭐ Add page (${pageCount}/${FREE_PAGE_LIMIT})` : '+ Add page'}
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

// Bottom sheet with Rename / Duplicate / Delete for the mobile tab strip --
// large tap targets, dimmed backdrop, dismissable by tapping outside.
function MobileActionSheet({
  pageLabel,
  onRename,
  onDuplicate,
  onDelete,
  onClose,
}: {
  pageLabel: string;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          background: '#fff',
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
          paddingBottom: 'env(safe-area-inset-bottom, 12px)',
          boxShadow: '0 -4px 16px rgba(0,0,0,0.15)',
        }}
      >
        <div style={{ padding: '14px 16px 6px', fontSize: 13, color: '#888', fontWeight: 600 }}>
          {pageLabel}
        </div>
        <SheetItem label="Rename" onClick={onRename} />
        <SheetItem label="Duplicate" onClick={onDuplicate} />
        <SheetItem label="Delete" onClick={onDelete} danger />
        <SheetItem label="Cancel" onClick={onClose} />
      </div>
    </div>
  );
}

function SheetItem({
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
        padding: '14px 16px',
        border: 'none',
        borderTop: '1px solid #eee',
        background: 'none',
        fontSize: 15,
        color: danger ? '#cc3333' : '#222',
      }}
    >
      {label}
    </button>
  );
}

// Centered modal for renaming a page on mobile -- a full input dialog reads
// better on a small screen than trying to swap a tab in the scrolling
// bottom strip into an inline edit field.
function MobileRenameDialog({
  value,
  onChange,
  onCancel,
  onSave,
}: {
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="surface-card"
        style={{ width: 'min(320px, 92vw)', padding: 20, boxSizing: 'border-box' }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Rename page</div>
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => e.key === 'Enter' && onSave()}
          style={{
            width: '100%',
            padding: 10,
            border: '1px solid #ccc',
            borderRadius: 4,
            fontSize: 16, // 16px prevents iOS Safari from auto-zooming on focus
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onCancel} style={{ padding: '10px 14px' }}>
            Cancel
          </button>
          <button className="btn-accent" onClick={onSave} style={{ padding: '10px 14px' }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}