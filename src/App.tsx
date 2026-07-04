import { useEffect, useState } from 'react';
import { useEditorStore } from './store/editorStore';
import { useAutoSave } from './hooks/useAutoSave';
import { cacheDocumentForOffline } from './lib/offlineCache';
import { api } from './lib/api';
import { Toolbar } from './components/Toolbar';
import { EditableTitle } from './components/EditableTitle';
import { FileMenu } from './components/FileMenu';
import { EditMenu } from './components/EditMenu';
import { ViewMenu } from './components/ViewMenu';
import { AddMenu } from './components/AddMenu';
import { HelpMenu } from './components/HelpMenu';
import { PdfCanvas, ZOOM } from './components/PdfCanvas';
import { Ruler, RULER_THICKNESS } from './components/Ruler';
import { PageNav } from './components/PageNav';
import { CommentsPanel } from './components/CommentsPanel';
import { UploadButton } from './components/UploadButton';
import { DownloadDialog } from './components/DownloadDialog';
import { LandingScreen } from './components/LandingScreen';

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

export default function App() {
  const document = useEditorStore((s) => s.document);
  const activePageIndex = useEditorStore((s) => s.activePageIndex);
  const loadDocument = useEditorStore((s) => s.loadDocument);
  const shareSession = useEditorStore((s) => s.shareSession);
  const setShareSession = useEditorStore((s) => s.setShareSession);
  const isPageNavCollapsed = useEditorStore((s) => s.isPageNavCollapsed);
  const showRuler = useEditorStore((s) => s.showRuler);
  const showComments = useEditorStore((s) => s.showComments);
  const selectedObjectId = useEditorStore((s) => s.selectedObjectId);
  const liveObjectBounds = useEditorStore((s) => s.liveObjectBounds);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  // Show the landing screen on every fresh load, unless the URL contains a
  // share token (in which case go straight into the shared document).
  const shareToken = new URLSearchParams(window.location.search).get('share');
  const [showLanding, setShowLanding] = useState(!shareToken);
  const online = useOnlineStatus();
  const saveStatus = useAutoSave();

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

  // Show landing screen on fresh loads (not share links) — must come before
  // the document null-check below, since no document is loaded yet at this
  // point (the user will pick one from the landing screen).
  if (showLanding) {
    return <LandingScreen onEnter={() => setShowLanding(false)} />;
  }

  if (!document) {
    return <div style={{ padding: 24 }}>Loading…</div>;
  }

  const isOwner = shareSession === null;
  const isReadOnly = shareSession?.access === 'view';
  const activePage = document.pages[activePageIndex] ?? document.pages[0];

  // Bounds to show on the ruler + readout badge: prefer the live value
  // (kept current during an active drag by PdfCanvas's object:moving
  // handler), falling back to the committed value in the store so the
  // readout still shows correctly after a toolbar edit (e.g. rotate) that
  // doesn't go through a Fabric drag at all.
  const selectedObject = activePage.objects.find((o) => o.id === selectedObjectId);
  const selectionBounds =
    liveObjectBounds ??
    (selectedObject
      ? { x: selectedObject.x, y: selectedObject.y, width: selectedObject.width, height: selectedObject.height }
      : null);
  const horizontalHighlight = selectionBounds
    ? { start: selectionBounds.x, end: selectionBounds.x + selectionBounds.width }
    : null;
  const verticalHighlight = selectionBounds
    ? { start: selectionBounds.y, end: selectionBounds.y + selectionBounds.height }
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header
        className="app-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
        }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {isOwner && <FileMenu />}
          {!isReadOnly && <EditMenu />}
          <ViewMenu />
          {!isReadOnly && <AddMenu />}
          <HelpMenu />
          <EditableTitle />
          {isReadOnly && <span className="badge badge-warning">View only</span>}
          {shareSession?.access === 'edit' && (
            <span className="badge badge-success">Editing via shared link</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {isReadOnly
              ? ''
              : online
                ? saveStatusLabel(saveStatus)
                : 'Offline — viewing only, edits will not be saved'}
          </span>
          {isOwner && <UploadButton />}
          <button className="btn-accent" onClick={() => setDownloadDialogOpen(true)}>
            Download PDF
          </button>
        </div>
      </header>

      {downloadDialogOpen && (
        <DownloadDialog document={document} onClose={() => setDownloadDialogOpen(false)} />
      )}

      {!isReadOnly && <Toolbar />}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {isOwner && !isPageNavCollapsed && <PageNav />}
        <main
          className="app-canvas-area"
          style={{
            flex: 1,
            overflow: 'auto',
            display: 'flex',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          {showRuler ? (
            <div
              style={{
                display: 'inline-grid',
                gridTemplateColumns: `${RULER_THICKNESS}px auto`,
                gridTemplateRows: `${RULER_THICKNESS}px auto`,
              }}
            >
              <div style={{ background: '#fafafa', borderRight: '1px solid #ddd', borderBottom: '1px solid #ddd' }} />
              <Ruler orientation="horizontal" lengthPx={activePage.width * ZOOM} highlightRange={horizontalHighlight} />
              <Ruler orientation="vertical" lengthPx={activePage.height * ZOOM} highlightRange={verticalHighlight} />
              <div style={{ position: 'relative' }}>
                <PdfCanvas page={activePage} readOnly={isReadOnly} />
                {selectionBounds && (
                  <div
                    style={{
                      position: 'absolute',
                      left: selectionBounds.x,
                      top: Math.max(0, selectionBounds.y - 20),
                      background: '#1a1a1a',
                      color: '#fff',
                      fontSize: 11,
                      padding: '2px 6px',
                      borderRadius: 3,
                      pointerEvents: 'none',
                      whiteSpace: 'nowrap',
                      zIndex: 10,
                    }}
                  >
                    {Math.round(selectionBounds.x)}, {Math.round(selectionBounds.y)} · {Math.round(selectionBounds.width)} × {Math.round(selectionBounds.height)} pt
                  </div>
                )}
              </div>
            </div>
          ) : (
            <PdfCanvas page={activePage} readOnly={isReadOnly} />
          )}
        </main>
        {showComments && <CommentsPanel page={activePage} isReadOnly={isReadOnly} />}
      </div>
    </div>
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