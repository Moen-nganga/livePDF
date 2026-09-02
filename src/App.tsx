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

type Screen = 'landing' | 'auth' | 'upgrade' | 'editor';

function pushScreen(screen: Screen) {
  if (window.history.state?.screen === screen) return; // already there, don't stack a duplicate entry
  window.history.pushState({ screen }, '', window.location.href);
}

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
  const logout = useAuthStore((s) => s.logout);
  const [showAuthScreen, setShowAuthScreen] = useState(false);
  const [showUpgradeScreen, setShowUpgradeScreen] = useState(false);

  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const subscription = useSubscriptionStore((s) => s.subscription);
  const isPremium =
    subscription?.status === 'active' &&
    (subscription.planId === 'pro_monthly' || subscription.planId === 'pro_yearly');
  const shareToken = new URLSearchParams(window.location.search).get('share');
  const [showLanding, setShowLanding] = useState(!shareToken);
  const online = useOnlineStatus();
  const { status: saveStatus, limitMessage, hasUnsavedChanges, saveNow } = useAutoSave();
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  useEffect(() => {
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Offline support is a nice-to-have, not load-bearing — fail silently
      });
    }
  }, []);

  useEffect(() => {
    fetchMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  useEffect(() => {
    if (!isMobile) setMobileMenuOpen(false);
  }, [isMobile]);

  useEffect(() => {
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
  }, []);

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

  function requestUpgrade() {
    if (authStatus !== 'authenticated') {
      setShowAuthScreen(true);
      pushScreen('auth');
      return;
    }
    setShowUpgradeScreen(true);
    pushScreen('upgrade');
  }

  let content: React.ReactNode;

  if (showAuthScreen) {
    content = <AuthScreen onBack={() => window.history.back()} />;
  } else if (showUpgradeScreen) {
    content = <UpgradeScreen onBack={() => window.history.back()} />;
  } else if (showLanding) {
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