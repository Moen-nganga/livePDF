import { useEffect, useRef, useState, useCallback } from 'react';
import { useEditorStore } from '../store/editorStore';
import { api, WeeklyLimitError } from '../lib/api';
import type { PDFDocument } from '../types/document';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'error' | 'limit_reached';

export interface AutoSaveResult {
  status: SaveStatus;
  // Set when status is 'limit_reached' -- the exact message from the
  // server, since it includes the actual configured limit number rather
  // than us hardcoding it a second time on the frontend.
  limitMessage: string | null;
  // True whenever the in-memory document has changes not yet confirmed
  // saved to the backend -- distinct from `status`, which can say "saved"
  // for a moment after an edit even though a new debounce timer is about
  // to fire (status reflects the *last* save attempt, not "is everything
  // saved right now"). Compares document.updatedAt against the updatedAt
  // of the last document we actually persisted, since editorStore bumps
  // updatedAt on every mutating action.
  hasUnsavedChanges: boolean;
  // Bypasses the debounce and saves immediately -- used by anything that
  // needs a definite "saved" moment to act on, e.g. a "save before you
  // leave" prompt, rather than waiting out the normal delay.
  saveNow: () => Promise<boolean>;
}

/**
 * Watches the active document and saves it to the backend a short moment
 * after the user stops editing (debounced, like Sheets/Docs autosave).
 * If the browser is offline, saving is skipped and status reflects that —
 * editing still works locally, it just won't persist until back online.
 */
export function useAutoSave(delayMs = 1200): AutoSaveResult {
  const document = useEditorStore((s) => s.document);
  const shareSession = useEditorStore((s) => s.shareSession);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tracks the updatedAt of the last document we successfully persisted.
  // null means "nothing saved yet this session" (a brand-new document is
  // therefore correctly treated as having unsaved changes until its first
  // save completes).
  const lastSavedUpdatedAtRef = useRef<number | null>(null);

  // Once a document has hit the weekly limit, further edits shouldn't keep
  // re-attempting the same doomed save on every debounce tick -- that would
  // just hammer the server with the same 403 forever. This flag short-
  // circuits persist() until the document changes to one that might
  // actually be allowed to save (e.g. after upgrading and reloading).
  const limitReachedRef = useRef(false);

  const persist = useCallback(async (doc: PDFDocument): Promise<boolean> => {
    if (limitReachedRef.current) {
      setStatus('limit_reached');
      return false;
    }
    if (!navigator.onLine) {
      setStatus('offline');
      return false;
    }
    setStatus('saving');
    try {
      if (shareSession?.access === 'edit') {
        await api.saveSharedDocument(shareSession.token, doc);
      } else {
        await api.saveDocument(doc);
      }
      lastSavedUpdatedAtRef.current = doc.updatedAt;
      setStatus('saved');
      return true;
    } catch (err) {
      if (err instanceof WeeklyLimitError) {
        limitReachedRef.current = true;
        setLimitMessage(err.message);
        setStatus('limit_reached');
      } else {
        setStatus('error');
      }
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareSession]);

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

    timerRef.current = setTimeout(() => {
      persist(document);
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

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (!document) return true; // nothing to save
    if (shareSession?.access === 'view') return true; // read-only, nothing to save
    if (timerRef.current) clearTimeout(timerRef.current); // supersede the pending debounced save
    return persist(document);
  }, [document, shareSession, persist]);

  const hasUnsavedChanges =
    !!document &&
    shareSession?.access !== 'view' &&
    document.updatedAt !== lastSavedUpdatedAtRef.current;

  return { status, limitMessage, hasUnsavedChanges, saveNow };
}