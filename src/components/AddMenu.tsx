import { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import { useEditorStore } from '../store/editorStore';
import { useImageAdd } from '../hooks/useImageAdd.tsx';
import type { PageObject } from '../types/document';

export function AddMenu() {
  const [open, setOpen] = useState(false);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const { triggerImagePick, fileInputElement } = useImageAdd();

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function handleImage() {
    setOpen(false);
    triggerImagePick();
  }

  function handleTable() {
    setOpen(false);
    setTableDialogOpen(true);
  }

  return (
    <>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <button onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
          Add
        </button>

        {open && (
          <div
            className="popover"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 4,
              zIndex: 1000,
              minWidth: 190,
              fontSize: 13,
              overflow: 'hidden',
            }}
          >
            <MenuItem
              label="Image"
              description="Add an image to the page"
              icon="🖼"
              onClick={handleImage}
            />
            <MenuItem
              label="Table"
              description="Insert a rows × columns grid"
              icon="⊞"
              onClick={handleTable}
            />
          </div>
        )}
      </div>

      {fileInputElement}

      {tableDialogOpen && (
        <TableDialog onClose={() => setTableDialogOpen(false)} />
      )}
    </>
  );
}

function MenuItem({
  label,
  description,
  icon,
  onClick,
}: {
  label: string;
  description: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        textAlign: 'left',
        padding: '10px 14px',
        border: 'none',
        background: 'none',
        borderRadius: 0,
        cursor: 'pointer',
        color: 'var(--color-text)',
        fontSize: 13,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
    >
      <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>{icon}</span>
      <div>
        <div style={{ fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>{description}</div>
      </div>
    </button>
  );
}

function TableDialog({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [hasHeader, setHasHeader] = useState(true);
  const [error, setError] = useState('');

  const document = useEditorStore((s) => s.document);
  const activePageIndex = useEditorStore((s) => s.activePageIndex);
  const addObjects = useEditorStore((s) => s.addObjects);

  const activePage = document?.pages[activePageIndex];

  function validate(r: number, c: number) {
    if (r < 1 || r > 20) return 'Rows must be between 1 and 20';
    if (c < 1 || c > 10) return 'Columns must be between 1 and 10';
    return '';
  }

  function handleInsert() {
    const err = validate(rows, cols);
    if (err) { setError(err); return; }
    if (!activePage) return;

    const tableId = nanoid(); // shared tag — all cells with this id move together
    const margin = 60;
    const tableWidth = Math.min(activePage.width - margin * 2, 400);
    const cellWidth = tableWidth / cols;
    const headerHeight = 36;
    const bodyHeight = 32;
    const startX = margin;
    const startY = 80;

    const objects: PageObject[] = [];

    for (let r = 0; r < rows; r++) {
      const isHeader = hasHeader && r === 0;
      const rowH = isHeader ? headerHeight : bodyHeight;
      const rowY = startY + (isHeader ? 0 : headerHeight + (r - 1) * bodyHeight);
      const localY = hasHeader ? rowY : startY + r * bodyHeight;

      for (let c = 0; c < cols; c++) {
        const cellX = startX + c * cellWidth;
        const y = hasHeader ? rowY : localY;

        // Cell background rect
        objects.push({
          id: nanoid(),
          type: 'rect',
          tableId,
          x: cellX,
          y,
          width: cellWidth,
          height: rowH,
          rotation: 0,
          opacity: 1,
          fill: isHeader ? '#1a73e8' : (r % 2 === 0 ? '#ffffff' : '#f8f9fa'),
          stroke: '#c4c7c5',
          strokeWidth: 1,
          cornerRadius: 0,
        });

        // Cell text (only create text object for every cell so it's editable)
        objects.push({
          id: nanoid(),
          type: 'text',
          tableId,
          x: cellX + 6,
          y: y + (rowH - 14) / 2,
          width: cellWidth - 12,
          height: rowH,
          rotation: 0,
          opacity: 1,
          text: isHeader ? `Column ${c + 1}` : '',
          fontSize: 11,
          fontFamily: 'Helvetica',
          color: isHeader ? '#ffffff' : '#202124',
          bold: isHeader,
          italic: false,
          strikethrough: false,
          align: 'left',
        });
      }
    }

    addObjects(activePage.id, objects);
    onClose();
  }

  // Live preview of what the table will look like
  const PREVIEW_W = 240;
  const PREVIEW_H = 120;
  const cellW = PREVIEW_W / Math.max(cols, 1);
  const cellH = PREVIEW_H / Math.max(rows, 1);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2000,
      }}
    >
      <div
        className="surface-card"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: 24, width: 380 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Insert table</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 16, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Live preview */}
        <div style={{
          width: PREVIEW_W, height: PREVIEW_H,
          border: '1px solid var(--color-border)',
          borderRadius: 4,
          overflow: 'hidden',
          margin: '0 auto 20px',
          position: 'relative',
        }}>
          {Array.from({ length: rows }).map((_, r) =>
            Array.from({ length: cols }).map((_, c) => (
              <div key={`${r}-${c}`} style={{
                position: 'absolute',
                left: c * cellW,
                top: r * cellH,
                width: cellW,
                height: cellH,
                border: '1px solid #c4c7c5',
                background: hasHeader && r === 0 ? '#e8f0fe' : 'white',
              }} />
            ))
          )}
        </div>

        {/* Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            Rows
            <input
              type="number"
              min={1} max={20}
              value={rows}
              onChange={(e) => { setRows(Number(e.target.value)); setError(''); }}
              style={{ width: '100%' }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            Columns
            <input
              type="number"
              min={1} max={10}
              value={cols}
              onChange={(e) => { setCols(Number(e.target.value)); setError(''); }}
              style={{ width: '100%' }}
            />
          </label>
        </div>

        <label style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 13, cursor: 'pointer', marginBottom: 16,
        }}>
          <input
            type="checkbox"
            checked={hasHeader}
            onChange={(e) => setHasHeader(e.target.checked)}
          />
          Style first row as a header
        </label>

        {error && (
          <div style={{ fontSize: 12, color: 'var(--color-danger)', marginBottom: 12 }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose}>Cancel</button>
          <button className="btn-accent" onClick={handleInsert}>Insert table</button>
        </div>
      </div>
    </div>
  );
}

// No buildTable function needed — table rendering is done inline in
// TableDialog.handleInsert via an offscreen HTML canvas.