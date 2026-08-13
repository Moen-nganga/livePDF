import { useState } from 'react';
import { nanoid } from 'nanoid';
import { useEditorStore } from '../store/editorStore';
import { pdfFileToPages } from '../lib/pdfUpload';

/**
 * Shared logic for turning an uploaded PDF File into pages, with two entry
 * points matching the two places a PDF gets uploaded from:
 *
 *  - uploadAsNewDocument: the File menu's "New" dialog -- the PDF becomes
 *    an entirely new document, same as before.
 *  - importIntoCurrentDocument: the toolbar's "Upload PDF" button, which
 *    only ever renders once a document is already open (see App.tsx --
 *    UploadButton lives inside the branch that requires `document` to be
 *    non-null). Every page extracted from the uploaded PDF is appended
 *    onto the end of the CURRENT document via the store's addPages, so the
 *    document already being edited is kept intact instead of being
 *    replaced outright.
 *
 * `uploadFile` is kept as an alias of uploadAsNewDocument so any existing
 * caller using the old name keeps working unchanged.
 */
export function usePdfUpload() {
  const loadDocument = useEditorStore((s) => s.loadDocument);
  const addPages = useEditorStore((s) => s.addPages);
  const [loading, setLoading] = useState(false);

  async function readPages(file: File) {
    try {
      return await pdfFileToPages(file);
    } catch (err) {
      console.error('Failed to read PDF', err);
      alert('Could not read that PDF. It may be corrupted or password-protected.');
      return null;
    }
  }

  async function uploadAsNewDocument(file: File): Promise<boolean> {
    setLoading(true);
    try {
      const pages = await readPages(file);
      if (!pages) return false;
      loadDocument({
        id: nanoid(),
        title: file.name.replace(/\.pdf$/i, ''),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pages,
      });
      return true;
    } finally {
      setLoading(false);
    }
  }

  async function importIntoCurrentDocument(file: File): Promise<boolean> {
    setLoading(true);
    try {
      const pages = await readPages(file);
      if (!pages) return false;
      addPages(pages);
      return true;
    } finally {
      setLoading(false);
    }
  }

  return {
    uploadFile: uploadAsNewDocument, // back-compat alias
    uploadAsNewDocument,
    importIntoCurrentDocument,
    loading,
  };
}