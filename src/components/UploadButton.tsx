import { useRef } from 'react';
import { usePdfUpload } from '../hooks/usePdfUpload';

export function UploadButton() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, loading } = usePdfUpload();

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await uploadFile(file);
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