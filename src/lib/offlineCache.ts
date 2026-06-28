import { openDB, type IDBPDatabase } from 'idb';
import type { PDFDocument } from '../types/document';

const DB_NAME = 'pdf-editor-offline-cache';
const STORE = 'documents';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

/**
 * Mirrors the last-seen version of a document into IndexedDB so it can be
 * opened in read-only mode while offline. This is a cache, not the source
 * of truth — the backend is. Called after every successful load or save.
 */
export async function cacheDocumentForOffline(doc: PDFDocument): Promise<void> {
  const db = await getDb();
  await db.put(STORE, doc);
}

export async function getCachedDocument(id: string): Promise<PDFDocument | undefined> {
  const db = await getDb();
  return db.get(STORE, id);
}

export async function listCachedDocuments(): Promise<PDFDocument[]> {
  const db = await getDb();
  return db.getAll(STORE);
}
