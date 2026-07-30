import { useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { useEditorStore } from '../store/editorStore';
import { pdfFileToPages } from '../lib/pdfUpload';

// Merges the selected PDFs (in the order they were selected) into a single
// new document loaded straight onto the canvas -- same "flatten each PDF
// page to a background image" strategy as pdfUpload.ts, just run once per
// file and concatenated. This deliberately does NOT download anything
// itself: landing on the canvas lets the user edit/reorder/delete pages
// first, then use the existing "Download PDF" button whenever they're
// ready, same as any other document in the editor.
export function MergePdfsButton() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadDocument = useEditorStore((s) => s.loadDocument);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length < 2) {
      if (files.length === 1) {
        setError('Select at least 2 PDFs to merge.');
      }
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const pagesPerFile = await Promise.all(files.map((file) => pdfFileToPages(file)));
      const pages = pagesPerFile.flat();

      loadDocument({
        id: nanoid(),
        title: 'Merged document',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pages,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not merge PDFs: ${err.message}`
          : 'Could not merge PDFs — please try again.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={loading}
        title="Select 2 or more PDFs to combine into one editable document"
      >
        {loading ? 'Merging…' : 'Merge PDF'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={handleFiles}
      />
      {error && (
        <span style={{ fontSize: 12, color: '#cc3333', marginLeft: 8 }}>{error}</span>
      )}
    </>
  );
}