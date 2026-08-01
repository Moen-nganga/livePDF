import { useEffect, useState } from 'react';
import { useEditorStore } from './store/editorStore';
import { useAuthStore } from './store/authStore';
import { useI18nStore } from './store/i18nStore';
import { useSubscriptionStore } from './store/subscriptionStore';
import { useAutoSave } from './hooks/useAutoSave';
import { cacheDocumentForOffline } from './lib/offlineCache';
import { api } from './lib/api';
import type { PDFDocument } from './types/document';
import { Toolbar } from './components/Toolbar';
import { EditableTitle } from './components/EditableTitle';
import { FileMenu } from './components/FileMenu';
import { EditMenu } from './components/EditMenu';
import { AddMenu } from './components/AddMenu';
import { HelpMenu } from './components/HelpMenu';
import { PdfCanvas } from './components/PdfCanvas';
import { PageNav, PAGE_NAV_MOBILE_BAR_HEIGHT } from './components/PageNav';
import { UploadButton } from './components/UploadButton';
import { MergePdfsButton } from './components/MergePdfsButton';
import { SplitPdfButton } from './components/SplitPdfButton';
import { DownloadDialog } from './components/DownloadDialog';
import { LandingScreen } from './components/LandingScreen';
import { AuthScreen } from './components/AuthScreen';
import { UpgradeScreen } from './components/UpgradeScreen';
import { UnsavedChangesDialog } from './components/UnsavedChangesDialog';
import { AIChatWidget } from './components/AIChatWidget';

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

// Tracks whether the viewport is at or below a "mobile" breakpoint, kept in
// sync via a matchMedia listener (covers resize/rotation, not just the
// size at mount). Same 640px threshold and pattern used in PageNav.tsx /
// LandingScreen -- duplicated locally rather than shared since there's no
// existing utils module to put it in yet.
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

// The app's handful of top-level "screens." Not a real router -- just an
// enum used to tag each history entry so the browser back/forward buttons
// can step between Landing / Auth / Upgrade / Editor instead of leaving
// the app entirely (previously nothing ever called pushState, so there
// was only ever one history entry for the whole app).
type Screen = 'landing' | 'auth' | 'upgrade' | 'editor';

function pushScreen(screen: Screen) {
  if (window.history.state?.screen === screen) return; // already there, don't stack a duplicate entry
  window.history.pushState({ screen }, '', window.location.href);
}

// Plain-text summary of a document's content, sent as context to the AI
// chat widget so it can answer questions about what's actually on the
// page. Deliberately text-only (skips image data entirely -- base64
// image payloads would blow past the context size cap for no benefit,
// since the model can't usefully reason about raw pixel data anyway).
function buildDocumentContext(doc: PDFDocument): string {
  const lines: string[] = [`Document title: ${doc.title}`, `Pages: ${doc.pages.length}`];
  doc.pages.forEach((page, i) => {
    const textOnPage = page.objects
      .filter((o) => o.type === 'text')
      .map((o) => o.text)
      .filter((t) => t.trim())
      .join(' | ');
    if (textOnPage) {
      lines.push(`Page ${i + 1}: ${textOnPage}`);
    }
  });
  return lines.join('\n');
}

export default function App() {
  const document = useEditorStore((s) => s.document);
  const activePageIndex = useEditorStore((s) => s.activePageIndex);
  const loadDocument = useEditorStore((s) => s.loadDocument);
  const shareSession = useEditorStore((s) => s.shareSession);
  const setShareSession = useEditorStore((s) => s.setShareSession);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);

  const authUser = useAuthStore((s) => s.user);
  const t = useI18nStore((s) => s.t);
  const authStatus = useAuthStore((s) => s.status);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const verifyToken = useAuthStore((s) => s.verifyToken);
  const logout = useAuthStore((s) => s.logout);
  const [showAuthScreen, setShowAuthScreen] = useState(false);
  const [showUpgradeScreen, setShowUpgradeScreen] = useState(false);

  const isMobile = useIsMobile();
  // Mobile-only: the hamburger drawer holding File/Edit/Add/Help, the PDF
  // Upload/Merge/Split actions, save status, and the account row. On
  // desktop all of those render inline in the header instead, same as
  // before this pass.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const subscription = useSubscriptionStore((s) => s.subscription);
  // Same client-side-only caveat as Toolbar's signature gating -- this
  // just decides what the widget shows/allows in the UI. The real
  // enforcement is server-side, in POST /api/chat's own premium check.
  const isPremium =
    subscription?.status === 'active' &&
    (subscription.planId === 'pro_monthly' || subscription.planId === 'pro_yearly');

  // Show the landing screen on every fresh load, unless the URL contains a
  // share token (in which case go straight into the shared document).
  const shareToken = new URLSearchParams(window.location.search).get('share');
  // A magic-link redirect lands here as ?token=xxx (see auth.ts's
  // request-link route, which builds the link as `${APP_URL}/auth/verify?token=...`
  // — there's no react-router in this app, so "verify" isn't a real route,
  // just a query param this component checks for on load, same as `share`).
  const verifyTokenParam = new URLSearchParams(window.location.search).get('token');
  const [verifying, setVerifying] = useState(!!verifyTokenParam);
  const [showLanding, setShowLanding] = useState(!shareToken && !verifyTokenParam);
  const online = useOnlineStatus();
  const { status: saveStatus, limitMessage, hasUnsavedChanges, saveNow } = useAutoSave();
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  // Register the service worker once, on mount — production only. In dev,
  // the service worker's whole job (serve cached files instead of fetching)
  // actively fights Vite's hot-reload and makes code changes appear not to
  // apply even after a restart, which is confusing to debug. Real offline
  // support only matters for the deployed app anyway.
  useEffect(() => {
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Offline support is a nice-to-have, not load-bearing — fail silently
      });
    }
  }, []);

  // Check for an existing session on load (skipped entirely if we're about
  // to consume a magic-link token below — that flow sets the user directly).
  useEffect(() => {
    if (!verifyTokenParam) fetchMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Consume a magic-link token from the URL, then strip it so a refresh
  // doesn't try to re-verify an already-used (and now invalid) token.
  useEffect(() => {
    if (!verifyTokenParam) return;

    (async () => {
      const result = await verifyToken(verifyTokenParam);
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.history.replaceState({}, '', url.toString());
      if (!result.ok) {
        alert(result.error ?? 'This sign-in link is invalid or has expired.');
      }
      setVerifying(false);
      setShowLanding(!shareToken);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On first load: if a share token is present in the URL, resolve it and
  // skip the landing screen entirely. Otherwise the landing screen handles
  // document selection and no auto-loading is needed here.
  useEffect(() => {
    if (!shareToken) return; // landing screen will handle document selection
    if (document) return;

    (async () => {
      try {
        const { document: shared, access } = await api.getSharedDocument(shareToken);
        setShareSession({ token: shareToken, access });
        loadDocument(shared);
      } catch (err) {
        alert(err instanceof Error ? err.message : 'This share link could not be opened.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror every change into the offline cache so it's available read-only
  // the next time the user opens this without a connection.
  useEffect(() => {
    if (document) cacheDocumentForOffline(document);
  }, [document]);

  // Close the mobile drawer automatically if the viewport grows past the
  // breakpoint (e.g. rotating a tablet to landscape) so it can't get stuck
  // open behind the now-restored desktop header.
  useEffect(() => {
    if (!isMobile) setMobileMenuOpen(false);
  }, [isMobile]);

  // Tag whatever screen we land on first (once the magic-link/share-token
  // flow above has resolved) as the base history entry, so the very first
  // pushScreen() call later has something real to go "back" to instead of
  // the browser falling out of the app on the first back-press.
  useEffect(() => {
    if (verifying) return;
    if (!window.history.state?.screen) {
      const initialScreen: Screen = showAuthScreen
        ? 'auth'
        : showUpgradeScreen
          ? 'upgrade'
          : showLanding
            ? 'landing'
            : 'editor';
      window.history.replaceState({ screen: initialScreen }, '', window.location.href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifying]);

  // Sync screen state from the browser's back/forward navigation. This is
  // what makes the back button step between Landing/Auth/Upgrade/Editor
  // instead of leaving the app -- each pushScreen() call below creates an
  // entry, and this listener applies it when the user navigates through
  // history rather than clicking in-app.
  useEffect(() => {
    function onPopState(e: PopStateEvent) {
      const screen: Screen = (e.state?.screen as Screen | undefined) ?? 'landing';
      setShowAuthScreen(screen === 'auth');
      setShowUpgradeScreen(screen === 'upgrade');
      setShowLanding(screen === 'landing');
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function goHome() {
    if (hasUnsavedChanges) {
      setShowUnsavedDialog(true);
      return;
    }
    setShowLanding(true);
    pushScreen('landing');
  }

  // Every "Upgrade" trigger in this component funnels through here rather
  // than calling setShowUpgradeScreen directly -- paying for Premium
  // requires an account (Stripe/Binance checkout both need requireAuth
  // server-side), so an anonymous visitor clicking Upgrade needs to sign
  // in first, not land on a checkout screen that will just fail.
  function requestUpgrade() {
    if (authStatus !== 'authenticated') {
      setShowAuthScreen(true);
      pushScreen('auth');
      return;
    }
    setShowUpgradeScreen(true);
    pushScreen('upgrade');
  }

  // Everything below builds up `content` — whichever single screen is
  // active right now — instead of returning early from each branch, so
  // the AIChatWidget at the very end can be rendered once, wrapping
  // whichever screen is showing, and therefore actually appear on every
  // page as intended rather than needing to be duplicated into each one.
  let content: React.ReactNode;

  if (verifying) {
    content = <div style={{ padding: 24 }}>{t('editor.signingIn')}</div>;
  } else if (showAuthScreen) {
    // Uses history.back() rather than setShowAuthScreen(false) directly, so
    // this on-screen Back button and the browser's own back button land on
    // the same place (whatever screen pushed us here) instead of two
    // slightly different behaviors.
    content = <AuthScreen onBack={() => window.history.back()} />;
  } else if (showUpgradeScreen) {
    content = <UpgradeScreen onBack={() => window.history.back()} />;
  } else if (showLanding) {
    // Show landing screen on fresh loads (not share links) — must come
    // before the document null-check below, since no document is loaded
    // yet at this point (the user will pick one from the landing screen).
    content = (
      <LandingScreen
        onEnter={() => {
          setShowLanding(false);
          pushScreen('editor');
        }}
      />
    );
  } else if (!document) {
    content = <div style={{ padding: 24 }}>{t('editor.loading')}</div>;
  } else {
    const isOwner = shareSession === null;
    const isReadOnly = shareSession?.access === 'view';

    // Secondary header controls -- File/Edit/Add/Help menus, the PDF
    // Upload/Merge/Split actions, save status, and the account row. On
    // desktop these render inline in the header, same as always. On
    // mobile they're relocated into the hamburger drawer instead, since
    // there isn't room to lay all of this out inline once File/Edit/Add/
    // Help alone can already crowd a phone-width header.
    const secondaryControls = (
      <>
        {isOwner && <FileMenu />}
        {!isReadOnly && <EditMenu />}
        {!isReadOnly && <AddMenu />}
        <HelpMenu />
        {isOwner && <UploadButton />}
        {isOwner && <MergePdfsButton />}
        {isOwner && <SplitPdfButton />}
      </>
    );

    const saveStatusNode =
      saveStatus === 'limit_reached' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#dc2626' }}>
            {limitMessage ?? 'Weekly limit reached — this document is not being saved.'}
          </span>
          <button className="btn-accent" onClick={requestUpgrade} style={{ fontSize: 13, padding: '4px 12px' }}>
            Upgrade
          </button>
        </div>
      ) : (
        <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {isReadOnly ? '' : online ? saveStatusLabel(saveStatus) : 'Offline — viewing only, edits will not be saved'}
        </span>
      );

    const accountNode =
      authStatus === 'authenticated' && authUser ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{authUser.email}</span>
          <button onClick={() => logout()}>Sign out</button>
        </div>
      ) : (
        <button onClick={() => setShowAuthScreen(true)}>Sign in</button>
      );

    content = (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <header
          className="app-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
            {isOwner && (
              <button
                onClick={goHome}
                title="Home"
                aria-label="Home"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '6px 8px',
                  flexShrink: 0,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M4 11.5L12 4l8 7.5M6 9.5V20h4.5v-5.5h3V20H18V9.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}

            {/* Desktop: File/Edit/Add/Help render inline before the title,
                same as before. Mobile: they move into the drawer below,
                so only the title (and badges) sit in this row. */}
            {!isMobile && secondaryControls}

            <div style={{ minWidth: 0, overflow: 'hidden' }}>
              <EditableTitle />
            </div>
            {isReadOnly && <span className="badge badge-warning">View only</span>}
            {shareSession?.access === 'edit' && (
              <span className="badge badge-success">Editing via shared link</span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
            {!isMobile && saveStatusNode}
            <button className="btn-accent" onClick={() => setDownloadDialogOpen(true)}>
              Download PDF
            </button>
            {!isMobile && accountNode}

            {isMobile && (
              <button
                onClick={() => setMobileMenuOpen(true)}
                title="More"
                aria-label="More options"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '6px 8px',
                  minWidth: 40,
                  minHeight: 40,
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M4 6h16M4 12h16M4 18h16"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </header>

        {isMobile && mobileMenuOpen && (
          <MobileMenuDrawer onClose={() => setMobileMenuOpen(false)}>
            <DrawerSection>{secondaryControls}</DrawerSection>
            <DrawerSection>{saveStatusNode}</DrawerSection>
            <DrawerSection>{accountNode}</DrawerSection>
          </MobileMenuDrawer>
        )}

        {downloadDialogOpen && document && (
          <DownloadDialog document={document} onClose={() => setDownloadDialogOpen(false)} />
        )}

        {showUnsavedDialog && (
          <UnsavedChangesDialog
            onSave={async () => {
              const ok = await saveNow();
              if (ok) setShowUnsavedDialog(false);
              return ok;
            }}
            onDiscard={() => {
              setShowUnsavedDialog(false);
              setShowLanding(true);
            }}
            onCancel={() => setShowUnsavedDialog(false)}
          />
        )}

        {!isReadOnly && <Toolbar onRequirePremium={requestUpgrade} />}

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {isOwner && !isMobile && <PageNav onRequirePremium={requestUpgrade} />}
          <main
            className="app-canvas-area"
            style={{
              flex: 1,
              overflow: 'auto',
              display: 'flex',
              justifyContent: 'center',
              padding: 24,
              // Reserve room for the fixed mobile bottom tab strip so it
              // doesn't sit on top of the last bit of page content.
              paddingBottom: isMobile ? PAGE_NAV_MOBILE_BAR_HEIGHT + 24 : 24,
            }}
          >
            <PdfCanvas page={document.pages[activePageIndex] ?? document.pages[0]} readOnly={isReadOnly} />
          </main>
        </div>

        {/* Mobile page switcher renders as a fixed bottom bar (outside
            normal layout flow), so it's mounted here rather than inside
            the flex row above -- same component as the desktop sidebar,
            it just decides its own presentation internally. */}
        {isOwner && isMobile && <PageNav onRequirePremium={requestUpgrade} />}
      </div>
    );
  }

  return (
    <>
      {content}
      <AIChatWidget
        isPremium={isPremium}
        documentContext={document ? buildDocumentContext(document) : undefined}
        onRequirePremium={requestUpgrade}
      />
    </>
  );
}

function saveStatusLabel(status: string): string {
  switch (status) {
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved';
    case 'error':
      return 'Could not save — retrying';
    case 'offline':
      return 'Offline — changes saved locally only';
    default:
      return '';
  }
}

// Right-side slide-in drawer holding everything that doesn't fit in the
// mobile header: File/Edit/Add/Help, Upload/Merge/Split, save status, and
// the account row. Closes on backdrop tap; individual menu components
// inside keep whatever open/close behavior they already have.
function MobileMenuDrawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(300px, 84vw)',
          height: '100%',
          background: 'var(--color-surface)',
          boxShadow: '-4px 0 16px rgba(0,0,0,0.15)',
          overflowY: 'auto',
          padding: 16,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Menu</span>
          <button
            onClick={onClose}
            aria-label="Close menu"
            style={{ border: 'none', background: 'none', fontSize: 18, padding: 8 }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Groups a set of drawer controls with a divider above, and stacks them
// vertically at full width with generous spacing for touch. Any embedded
// component (FileMenu, HelpMenu, etc.) still opens its own dropdown/panel
// on top of this drawer as normal.
function DrawerSection({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        paddingTop: 12,
        borderTop: '1px solid var(--color-border)',
      }}
    >
      {children}
    </div>
  );
}