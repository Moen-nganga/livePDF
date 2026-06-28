import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { api } from '../lib/api';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

/**
 * Watches the active document and saves it to the backend a short moment
 * after the user stops editing (debounced, like Sheets/Docs autosave).
 * If the browser is offline, saving is skipped and status reflects that —
 * editing still works locally, it just won't persist until back online.
 */
export function useAutoSave(delayMs = 1200) {
  const document = useEditorStore((s) => s.document);
  const shareSession = useEditorStore((s) => s.shareSession);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!document) return;

    // A view-only share session has nothing to save — the visitor can
    // look but the canvas itself is also set read-only (see App.tsx), so
    // this path mainly guards against any stray store updates.
    if (shareSession?.access === 'view') {
      setStatus('idle');
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      if (!navigator.onLine) {
        setStatus('offline');
        return;
      }
      setStatus('saving');
      try {
        if (shareSession?.access === 'edit') {
          await api.saveSharedDocument(shareSession.token, document);
        } else {
          await api.saveDocument(document);
        }
        setStatus('saved');
      } catch {
        setStatus('error');
      }
    }, delayMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, delayMs, shareSession]);

  // Reflect connectivity changes immediately, not just on next edit
  useEffect(() => {
    const goOffline = () => setStatus('offline');
    const goOnline = () => setStatus('idle');
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  return status;
}