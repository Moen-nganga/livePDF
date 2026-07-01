import { useEffect, useState } from 'react';
import { useEditorStore } from './store/editorStore';
import { useAutoSave } from './hooks/useAutoSave';
import { cacheDocumentForOffline, listCachedDocuments } from './lib/offlineCache';
import { api } from './lib/api';
import { Toolbar } from './components/Toolbar';
import { EditableTitle } from './components/EditableTitle';
import { FileMenu } from './components/FileMenu';
import { EditMenu } from './components/EditMenu';
import { HelpMenu } from './components/HelpMenu';
import { PdfCanvas } from './components/PdfCanvas';
import { PageNav } from './components/PageNav';
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
  const createBlankDocument = useEditorStore((s) => s.createBlankDocument);
  const loadDocument = useEditorStore((s) => s.loadDocument);
  const shareSession = useEditorStore((s) => s.shareSession);
  const setShareSession = useEditorStore((s) => s.setShareSession);
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
        {isOwner && <PageNav />}
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
          <PdfCanvas page={document.pages[activePageIndex] ?? document.pages[0]} readOnly={isReadOnly} />
        </main>
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

async function listMostRecentCached() {
  const all = await listCachedDocuments();
  if (all.length === 0) return undefined;
  return all.sort((a, b) => b.updatedAt - a.updatedAt)[0];
}