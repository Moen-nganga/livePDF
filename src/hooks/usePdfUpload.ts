import { useState } from 'react';
import { nanoid } from 'nanoid';
import { useEditorStore } from '../store/editorStore';
import { pdfFileToPages } from '../lib/pdfUpload';

/**
 * Shared logic for turning a File (a .pdf the user picked) into a loaded
 * document. Used by both the toolbar's "Upload PDF" button and the File
 * menu's "New" dialog, so there's exactly one place that knows how to
 * read a PDF and hand it to the store.
 */
export function usePdfUpload() {
  const loadDocument = useEditorStore((s) => s.loadDocument);
  const [loading, setLoading] = useState(false);

  async function uploadFile(file: File): Promise<boolean> {
    setLoading(true);
    try {
      const pages = await pdfFileToPages(file);
      loadDocument({
        id: nanoid(),
        title: file.name.replace(/\.pdf$/i, ''),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pages,
      });
      return true;
    } catch (err) {
      console.error('Failed to read PDF', err);
      alert('Could not read that PDF. It may be corrupted or password-protected.');
      return false;
    } finally {
      setLoading(false);
    }
  }

  return { uploadFile, loading };
}