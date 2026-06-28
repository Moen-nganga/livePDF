import { useEffect, useState } from 'react';
import { useEditorStore } from './store/editorStore';
import { useAutoSave } from './hooks/useAutoSave';
import { cacheDocumentForOffline, listCachedDocuments } from './lib/offlineCache';
import { api } from './lib/api';
import { Toolbar } from './components/Toolbar';
import { PdfCanvas } from './components/PdfCanvas';
import { PageNav } from './components/PageNav';
import { UploadButton } from './components/UploadButton';
import { exportToPdf } from './lib/exportPdf';

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

  // On first load: try to resume the most recent document from the backend,
  // falling back to the offline cache if there's no connection, falling
  // back to a fresh blank document if neither has anything.
  useEffect(() => {
    if (document) return;
    (async () => {
      if (navigator.onLine) {
        try {
          const docs = await api.listDocuments();
          if (docs.length > 0) {
            const full = await api.getDocument(docs[0].id);
            loadDocument(full);
            cacheDocumentForOffline(full);
            return;
          }
        } catch {
          // backend unreachable even though navigator says online; fall through
        }
      } else {
        const cached = await listMostRecentCached();
        if (cached) {
          loadDocument(cached);
          return;
        }
      }
      createBlankDocument('A4');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror every change into the offline cache so it's available read-only
  // the next time the user opens this without a connection.
  useEffect(() => {
    if (document) cacheDocumentForOffline(document);
  }, [document]);

  if (!document) {
    return <div style={{ padding: 24 }}>Loading…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          borderBottom: '1px solid #ddd',
        }}
      >
        <strong>{document.title}</strong>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#666' }}>
            {online ? saveStatusLabel(saveStatus) : 'Offline — viewing only, edits will not be saved'}
          </span>
          <UploadButton />
          <button onClick={() => exportToPdf(document)}>Download PDF</button>
        </div>
      </header>

      <Toolbar />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <PageNav />
        <main
          style={{
            flex: 1,
            overflow: 'auto',
            background: '#f3f3f3',
            display: 'flex',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <PdfCanvas page={document.pages[activePageIndex] ?? document.pages[0]} />
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