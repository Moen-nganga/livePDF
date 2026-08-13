import { useRef } from 'react';
import { usePdfUpload } from '../hooks/usePdfUpload';

// This button only ever renders once a document is already open (see
// App.tsx), so uploading here means "add this PDF's pages to what I'm
// already editing," not "start over" -- hence importIntoCurrentDocument,
// not uploadFile/uploadAsNewDocument. The File menu's "New" dialog is the
// separate flow that replaces the whole document.
export function UploadButton() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { importIntoCurrentDocument, loading } = usePdfUpload();

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await importIntoCurrentDocument(file);
  }

  return (
    <>
      <button onClick={() => fileInputRef.current?.click()} disabled={loading} title="Add all pages from a PDF to this document">
        {loading ? 'Reading PDF…' : 'Upload PDF'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
    </>
  );
}