import { useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { useEditorStore } from '../store/editorStore';
import { pdfFileToPages } from '../lib/pdfUpload';

export function UploadButton() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadDocument = useEditorStore((s) => s.loadDocument);
  const [loading, setLoading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

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
    } catch (err) {
      console.error('Failed to read PDF', err);
      alert('Could not read that PDF. It may be corrupted or password-protected.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button onClick={() => fileInputRef.current?.click()} disabled={loading}>
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
