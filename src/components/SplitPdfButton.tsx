import { useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';

// Splits a single uploaded PDF into two separate PDF files at a chosen
// page boundary and downloads both. Unlike MergePdfsButton, this doesn't
// land anything on the canvas -- there's nothing to edit, the user just
// wants two files. It also doesn't go through pdfUpload.ts's "flatten to
// image" pipeline: pdf-lib's copyPages keeps the original PDF's real
// content (text, vectors, etc.) intact in both output files.
export function SplitPdfButton() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set once a file has been read and we know its page count -- presence
  // of pendingFile is what controls whether the split-point dialog shows.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [splitAfter, setSplitAfter] = useState(1);

  // Editable output names (without the .pdf extension -- that's appended
  // on save). Each starts as an auto-generated default reflecting the
  // current split point, but once the user types their own name we stop
  // regenerating it, tracked via the "auto" refs below so moving the
  // split-point slider doesn't clobber a name someone already customized.
  const [firstName, setFirstName] = useState('');
  const [secondName, setSecondName] = useState('');
  const [firstNameAuto, setFirstNameAuto] = useState(true);
  const [secondNameAuto, setSecondNameAuto] = useState(true);

  function defaultNames(baseName: string, splitAt: number, total: number) {
    return {
      first: `${baseName} (1-${splitAt})`,
      second: `${baseName} (${splitAt + 1}-${total})`,
    };
  }

  function updateSplitAfter(value: number) {
    setSplitAfter(value);
    if (!pendingFile || !pageCount) return;
    const baseName = pendingFile.name.replace(/\.pdf$/i, '');
    const defaults = defaultNames(baseName, value, pageCount);
    if (firstNameAuto) setFirstName(defaults.first);
    if (secondNameAuto) setSecondName(defaults.second);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError(null);
    setLoading(true);

    try {
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes);
      const count = doc.getPageCount();

      if (count < 2) {
        setError('This PDF only has 1 page — nothing to split.');
        return;
      }

      setPendingFile(file);
      setPageCount(count);
      const split = Math.floor(count / 2) || 1; // sensible default: roughly the middle
      setSplitAfter(split);
      const baseName = file.name.replace(/\.pdf$/i, '');
      const defaults = defaultNames(baseName, split, count);
      setFirstName(defaults.first);
      setSecondName(defaults.second);
      setFirstNameAuto(true);
      setSecondNameAuto(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not read PDF: ${err.message}`
          : 'Could not read PDF — please try again.'
      );
    } finally {
      setLoading(false);
    }
  }

  function downloadBytes(bytes: Uint8Array, filename: string) {
    // Cast needed because current lib typings describe Uint8Array as
    // ArrayBufferLike (which technically includes SharedArrayBuffer),
    // while Blob's constructor type wants a plain ArrayBuffer -- a type-
    // only mismatch, Blob accepts a Uint8Array fine at runtime either way.
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSplit() {
    if (!pendingFile || !pageCount) return;
    setLoading(true);
    setError(null);

    try {
      const bytes = await pendingFile.arrayBuffer();
      const source = await PDFDocument.load(bytes);

      const firstIndices = Array.from({ length: splitAfter }, (_, i) => i);
      const secondIndices = Array.from(
        { length: pageCount - splitAfter },
        (_, i) => i + splitAfter
      );

      const firstDoc = await PDFDocument.create();
      (await firstDoc.copyPages(source, firstIndices)).forEach((p) => firstDoc.addPage(p));

      const secondDoc = await PDFDocument.create();
      (await secondDoc.copyPages(source, secondIndices)).forEach((p) => secondDoc.addPage(p));

      const baseName = pendingFile.name.replace(/\.pdf$/i, '');
      const safeFirstName = firstName.trim() || defaultNames(baseName, splitAfter, pageCount).first;
      const safeSecondName = secondName.trim() || defaultNames(baseName, splitAfter, pageCount).second;
      downloadBytes(await firstDoc.save(), `${safeFirstName}.pdf`);
      downloadBytes(await secondDoc.save(), `${safeSecondName}.pdf`);

      setPendingFile(null);
      setPageCount(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not split PDF: ${err.message}`
          : 'Could not split PDF — please try again.'
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
        title="Select a PDF to split into two files at a chosen page"
      >
        {loading && !pendingFile ? 'Reading…' : 'Split PDF'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      {error && (
        <ErrorDialog message={error} onClose={() => setError(null)} />
      )}

      {pendingFile && pageCount && (
        <SplitPointDialog
          fileName={pendingFile.name}
          pageCount={pageCount}
          splitAfter={splitAfter}
          onSplitAfterChange={updateSplitAfter}
          firstName={firstName}
          secondName={secondName}
          onFirstNameChange={(v) => {
            setFirstName(v);
            setFirstNameAuto(false);
          }}
          onSecondNameChange={(v) => {
            setSecondName(v);
            setSecondNameAuto(false);
          }}
          loading={loading}
          onConfirm={handleSplit}
          onCancel={() => {
            setPendingFile(null);
            setPageCount(null);
          }}
        />
      )}
    </>
  );
}

function ErrorDialog({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
    >
      <div
        className="surface-card"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: '32px 28px', width: 400, textAlign: 'center' }}
      >
        <svg
          width={40}
          height={40}
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-danger)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ marginBottom: 14 }}
        >
          <circle cx="12" cy="12" r="9.25" />
          <line x1="12" y1="7.5" x2="12" y2="13" />
          <circle cx="12" cy="16.5" r="0.75" fill="var(--color-danger)" stroke="none" />
        </svg>

        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text)', marginBottom: 8 }}>
          Can't split this PDF
        </div>

        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '0 0 24px', lineHeight: 1.5 }}>
          {message}
        </p>

        <button className="btn-accent" onClick={onClose} style={{ padding: '9px 28px' }}>
          OK
        </button>
      </div>
    </div>
  );
}

function SplitPointDialog({
  fileName,
  pageCount,
  splitAfter,
  onSplitAfterChange,
  firstName,
  secondName,
  onFirstNameChange,
  onSecondNameChange,
  loading,
  onConfirm,
  onCancel,
}: {
  fileName: string;
  pageCount: number;
  splitAfter: number;
  onSplitAfterChange: (value: number) => void;
  firstName: string;
  secondName: string;
  onFirstNameChange: (value: string) => void;
  onSecondNameChange: (value: string) => void;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
    >
      <div
        className="surface-card"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: 24, width: 360 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Split PDF</h3>
          <button onClick={onCancel} style={{ border: 'none', background: 'none', fontSize: 16, cursor: 'pointer' }}>
            ✕
          </button>
        </div>

        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 0, marginBottom: 12 }}>
          <strong>{fileName}</strong> has {pageCount} pages. Choose where to split it into two files.
        </p>

        <label style={{ display: 'block', fontSize: 13, marginBottom: 6, color: 'var(--color-text-secondary)' }}>
          Split after page
        </label>
        <input
          type="number"
          min={1}
          max={pageCount - 1}
          value={splitAfter}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) {
              onSplitAfterChange(Math.min(Math.max(n, 1), pageCount - 1));
            }
          }}
          onKeyDown={(e) => e.key === 'Enter' && !loading && onConfirm()}
          style={{
            width: '100%',
            padding: '8px 10px',
            border: '1.5px solid var(--color-border)',
            borderRadius: 6,
            fontSize: 14,
            boxSizing: 'border-box',
          }}
        />

        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 10, marginBottom: 14 }}>
          File 1: pages 1–{splitAfter} · File 2: pages {splitAfter + 1}–{pageCount}
        </p>

        <label style={{ display: 'block', fontSize: 13, marginBottom: 6, color: 'var(--color-text-secondary)' }}>
          File 1 name
        </label>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <input
            type="text"
            value={firstName}
            onChange={(e) => onFirstNameChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !loading && onConfirm()}
            style={{
              flex: 1,
              padding: '8px 10px',
              border: '1.5px solid var(--color-border)',
              borderRadius: '6px 0 0 6px',
              fontSize: 14,
              boxSizing: 'border-box',
            }}
          />
          <span
            style={{
              padding: '8px 10px',
              border: '1.5px solid var(--color-border)',
              borderLeft: 'none',
              borderRadius: '0 6px 6px 0',
              fontSize: 13,
              color: 'var(--color-text-muted)',
              background: 'var(--color-bg)',
            }}
          >
            .pdf
          </span>
        </div>

        <label style={{ display: 'block', fontSize: 13, marginBottom: 6, color: 'var(--color-text-secondary)' }}>
          File 2 name
        </label>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <input
            type="text"
            value={secondName}
            onChange={(e) => onSecondNameChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !loading && onConfirm()}
            style={{
              flex: 1,
              padding: '8px 10px',
              border: '1.5px solid var(--color-border)',
              borderRadius: '6px 0 0 6px',
              fontSize: 14,
              boxSizing: 'border-box',
            }}
          />
          <span
            style={{
              padding: '8px 10px',
              border: '1.5px solid var(--color-border)',
              borderLeft: 'none',
              borderRadius: '0 6px 6px 0',
              fontSize: 13,
              color: 'var(--color-text-muted)',
              background: 'var(--color-bg)',
            }}
          >
            .pdf
          </span>
        </div>

        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 0 }}>
          Both download to your device — nothing is added to the canvas.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button className="btn-accent" onClick={onConfirm} disabled={loading}>
            {loading ? 'Splitting…' : 'Split & Download'}
          </button>
        </div>
      </div>
    </div>
  );
}