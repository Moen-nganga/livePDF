import { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import { useEditorStore } from '../store/editorStore';
import type { PageObject, TextObject, RectObject } from '../types/document';
import { WEB_SAFE_FONTS } from '../lib/fonts';
import { useImageAdd } from '../hooks/useImageAdd.tsx';

const baseDefaults = { rotation: 0, opacity: 1 };

// Each new object is offset slightly from the last, like Google Slides/
// Canva do, so adding several in a row produces a visible cascade instead
// of an exact stack. Resets per page since it's just a placement nicety.
function nextOffset(count: number): { x: number; y: number } {
  const step = 24;
  return { x: 80 + (count % 8) * step, y: 80 + (count % 8) * step };
}

export function Toolbar() {
  const document = useEditorStore((s) => s.document);
  const activePageIndex = useEditorStore((s) => s.activePageIndex);
  const addObject = useEditorStore((s) => s.addObject);
  const selectedObjectId = useEditorStore((s) => s.selectedObjectId);
  const updateObject = useEditorStore((s) => s.updateObject);
  const { triggerImagePick, fileInputElement } = useImageAdd();

  const activePage = document?.pages[activePageIndex];
  const selectedObject = activePage?.objects.find((o) => o.id === selectedObjectId);
  const selectedText: TextObject | undefined =
    selectedObject?.type === 'text' ? selectedObject : undefined;
  // A "border" is a rect with no fill — same object type as a regular
  // rectangle, just styled differently. See addBorder below.
  const selectedBorder: RectObject | undefined =
    selectedObject?.type === 'rect' && !selectedObject.fill ? selectedObject : undefined;
  // A "highlight" is a rect too — semi-transparent fill, no visible
  // stroke — tagged with isHighlight so it doesn't get confused with a
  // regular filled rectangle. See addHighlight below.
  const selectedHighlight: RectObject | undefined =
    selectedObject?.type === 'rect' && selectedObject.isHighlight ? selectedObject : undefined;

  // Drives which +Text/+Rectangle/etc button is highlighted, based on
  // what's currently selected on the canvas — not which button was last
  // clicked. Selecting nothing (or an object type with no matching
  // toolbar button, like 'line') means no add-button is highlighted.
  type ToolKind = 'text' | 'rect' | 'border' | 'highlight' | 'ellipse' | 'image' | null;
  const activeTool: ToolKind = (() => {
    if (!selectedObject) return null;
    switch (selectedObject.type) {
      case 'text':
        return 'text';
      case 'rect':
        if (selectedHighlight) return 'highlight';
        return selectedBorder ? 'border' : 'rect';
      case 'ellipse':
        return 'ellipse';
      case 'image':
        return 'image';
      default:
        return null;
    }
  })();

  // Defaults applied to the NEXT border created via "+ Border" — separate
  // from selectedBorder, which edits an already-placed one. Persists for
  // the rest of the session so picking a thickness/color once sticks for
  // subsequent borders too, similar to how most design tools remember the
  // last-used style per tool.
  const [borderDefaults, setBorderDefaults] = useState({ strokeWidth: 2, stroke: '#222222' });

  // Same "remember the last-used style" pattern as borderDefaults — picking
  // a highlight color once carries over to the next highlight you add.
  const [highlightDefaults, setHighlightDefaults] = useState({ fill: '#ffff00' });

  const [watermarkDialogOpen, setWatermarkDialogOpen] = useState(false);

  function updateSelectedText(patch: Partial<TextObject>) {
    if (!activePage || !selectedText) return;
    updateObject(activePage.id, selectedText.id, patch);
  }

  function updateSelectedBorder(patch: Partial<RectObject>) {
    if (!activePage || !selectedBorder) return;
    updateObject(activePage.id, selectedBorder.id, patch);
  }

  function updateSelectedHighlight(patch: Partial<RectObject>) {
    if (!activePage || !selectedHighlight) return;
    updateObject(activePage.id, selectedHighlight.id, patch);
  }

  function rotateSelected() {
    if (!activePage || !selectedObject) return;
    const next = (selectedObject.rotation + 90) % 360;
    updateObject(activePage.id, selectedObject.id, { rotation: next });
  }

  function addText() {
    if (!activePage) return;
    const { x, y } = nextOffset(activePage.objects.length);
    const obj: PageObject = {
      id: nanoid(),
      type: 'text',
      x,
      y,
      width: 200,
      height: 40,
      ...baseDefaults,
      text: 'Edit this text',
      fontSize: 18,
      fontFamily: 'Helvetica',
      color: '#111111',
      bold: false,
      italic: false,
      strikethrough: false,
      align: 'left',
    };
    addObject(activePage.id, obj);
  }

  function addRect() {
    if (!activePage) return;
    const { x, y } = nextOffset(activePage.objects.length);
    const obj: PageObject = {
      id: nanoid(),
      type: 'rect',
      x,
      y,
      width: 160,
      height: 100,
      ...baseDefaults,
      fill: '#cce5ff',
      stroke: '#3380cc',
      strokeWidth: 1,
      cornerRadius: 4,
    };
    addObject(activePage.id, obj);
  }

  function addBorder() {
    if (!activePage) return;
    const { x, y } = nextOffset(activePage.objects.length);
    const obj: PageObject = {
      id: nanoid(),
      type: 'rect',
      x,
      y,
      // Larger default than a regular shape — a border is meant to be
      // resized over existing content to frame it, not used at icon size.
      width: 240,
      height: 160,
      ...baseDefaults,
      fill: undefined, // outline only — no fill means nothing underneath is covered
      stroke: borderDefaults.stroke,
      strokeWidth: borderDefaults.strokeWidth,
      cornerRadius: 0,
    };
    addObject(activePage.id, obj);
  }

  function addEllipse() {
    if (!activePage) return;
    const { x, y } = nextOffset(activePage.objects.length);
    const obj: PageObject = {
      id: nanoid(),
      type: 'ellipse',
      x,
      y,
      width: 120,
      height: 120,
      ...baseDefaults,
      fill: '#ffe5b3',
      stroke: '#cc9933',
      strokeWidth: 1,
    };
    addObject(activePage.id, obj);
  }

  // Inserted as a perfectly ordinary, fully editable text object — same
  // double-click-to-edit, restyle, move, delete behavior as any other text.
  // "Editable" here just means it's pre-filled with today's date rather
  // than a fixed, locked-in field.
  function addDate() {
    if (!activePage) return;
    const { x, y } = nextOffset(activePage.objects.length);
    const today = new Date().toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const obj: PageObject = {
      id: nanoid(),
      type: 'text',
      x,
      y,
      width: 160,
      height: 32,
      ...baseDefaults,
      text: today,
      fontSize: 14,
      fontFamily: 'Helvetica',
      color: '#111111',
      bold: false,
      italic: false,
      strikethrough: false,
      align: 'left',
    };
    addObject(activePage.id, obj);
  }

  function addHighlight() {
    if (!activePage) return;
    const { x, y } = nextOffset(activePage.objects.length);
    const obj: PageObject = {
      id: nanoid(),
      type: 'rect',
      isHighlight: true,
      x,
      y,
      width: 200,
      height: 28,
      ...baseDefaults,
      opacity: 0.4, // semi-transparent so whatever's underneath still reads through
      fill: highlightDefaults.fill,
      // strokeWidth 0 makes the stroke invisible regardless of its color —
      // deliberately NOT the CSS keyword 'transparent' here, since
      // exportPdf.ts's hexToRgb only parses real "#rrggbb" hex strings.
      stroke: '#000000',
      strokeWidth: 0,
      cornerRadius: 0,
    };
    addObject(activePage.id, obj);
  }

  // Large, faint, diagonal text centered on the current page. Applies to
  // this page only (not the whole document) — once placed, it's a normal
  // text object like any other: movable, resizable, restylable, deletable.
  function addWatermark(text: string) {
    if (!activePage) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    const width = Math.min(activePage.width * 0.9, 500);
    const fontSize = 60;
    const height = fontSize * 1.3;

    const obj: PageObject = {
      id: nanoid(),
      type: 'text',
      isWatermark: true,
      x: (activePage.width - width) / 2,
      y: (activePage.height - height) / 2,
      width,
      height,
      rotation: -45,
      opacity: 0.15,
      text: trimmed,
      fontSize,
      fontFamily: 'Helvetica',
      color: '#888888',
      bold: true,
      italic: false,
      strikethrough: false,
      align: 'center',
    };
    addObject(activePage.id, obj);
    setWatermarkDialogOpen(false);
  }

  function activeToolStyle(tool: NonNullable<typeof activeTool>): React.CSSProperties {
    return activeTool === tool
      ? { background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent)' }
      : {};
  }

  return (
    <div
      className="app-toolbar"
      style={{
        display: 'flex',
        gap: 8,
        padding: '8px 16px',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <button onClick={addText} style={activeToolStyle('text')}>
        + Text
      </button>
      <button onClick={addRect} style={activeToolStyle('rect')}>
        + Rectangle
      </button>
      <button onClick={addEllipse} style={activeToolStyle('ellipse')}>
        + Ellipse
      </button>
      <button
        onClick={addBorder}
        title="Add a resizable outline to frame any content"
        style={activeToolStyle('border')}
      >
        + Border
      </button>
      <BorderThicknessPicker
        value={selectedBorder ? selectedBorder.strokeWidth : borderDefaults.strokeWidth}
        onChange={(strokeWidth) => {
          setBorderDefaults((d) => ({ ...d, strokeWidth }));
          if (selectedBorder) updateSelectedBorder({ strokeWidth });
        }}
      />
      <BorderColorPicker
        value={selectedBorder ? selectedBorder.stroke : borderDefaults.stroke}
        onChange={(stroke) => {
          setBorderDefaults((d) => ({ ...d, stroke }));
          if (selectedBorder) updateSelectedBorder({ stroke });
        }}
      />
      <button onClick={triggerImagePick} style={activeToolStyle('image')}>
        + Image
      </button>

      <button onClick={addDate} title="Insert today's date as editable text">
        + Date
      </button>

      <button
        onClick={addHighlight}
        title="Add a semi-transparent highlight overlay"
        style={activeToolStyle('highlight')}
      >
        + Highlight
      </button>
      <HighlightColorPicker
        value={selectedHighlight ? selectedHighlight.fill ?? highlightDefaults.fill : highlightDefaults.fill}
        onChange={(fill) => {
          setHighlightDefaults((d) => ({ ...d, fill }));
          if (selectedHighlight) updateSelectedHighlight({ fill });
        }}
      />

      <button onClick={() => setWatermarkDialogOpen(true)} title="Add a diagonal watermark to the current page">
        + Watermark
      </button>

      <Divider />

      <select
        value={selectedText?.fontFamily ?? ''}
        disabled={!selectedText}
        onChange={(e) => updateSelectedText({ fontFamily: e.target.value })}
        style={{ fontFamily: selectedText?.fontFamily, minWidth: 130 }}
        title={selectedText ? 'Font' : 'Select a text box to change its font'}
      >
        {!selectedText && <option value="">Font</option>}
        {WEB_SAFE_FONTS.map((font) => (
          <option key={font} value={font} style={{ fontFamily: font }}>
            {font}
          </option>
        ))}
      </select>

      <FontSizeDropdown
        value={selectedText?.fontSize}
        disabled={!selectedText}
        onChange={(size) => updateSelectedText({ fontSize: size })}
      />

      <Divider />

      <ToggleButton
        label="B"
        title="Bold"
        active={!!selectedText?.bold}
        disabled={!selectedText}
        onClick={() => updateSelectedText({ bold: !selectedText?.bold })}
        style={{ fontWeight: 'bold' }}
      />
      <ToggleButton
        label="I"
        title="Italic"
        active={!!selectedText?.italic}
        disabled={!selectedText}
        onClick={() => updateSelectedText({ italic: !selectedText?.italic })}
        style={{ fontStyle: 'italic' }}
      />
      <ToggleButton
        label="S"
        title="Strikethrough"
        active={!!selectedText?.strikethrough}
        disabled={!selectedText}
        onClick={() => updateSelectedText({ strikethrough: !selectedText?.strikethrough })}
        style={{ textDecoration: 'line-through' }}
      />

      <ColorPicker
        value={selectedText?.color}
        disabled={!selectedText}
        onChange={(color) => updateSelectedText({ color })}
      />

      <LinkButton
        value={selectedText?.link}
        disabled={!selectedText}
        onChange={(link) => updateSelectedText({ link })}
      />

      <button
        onClick={rotateSelected}
        disabled={!selectedObject}
        title="Rotate 90°"
        style={{ width: 28 }}
      >
        ⟳
      </button>

      <Divider />
      <span style={{ fontSize: 12, color: '#888', alignSelf: 'center', marginLeft: 8 }}>
        Double-click text to edit it · select an object and press Delete to remove it
      </span>
      {fileInputElement}
      {watermarkDialogOpen && (
        <WatermarkDialog onInsert={addWatermark} onClose={() => setWatermarkDialogOpen(false)} />
      )}
    </div>
  );
}

function ToggleButton({
  label,
  title,
  active,
  disabled,
  onClick,
  style,
}: {
  label: string;
  title: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 28,
        background: active ? 'var(--color-accent-bg)' : 'var(--color-surface)',
        border: active ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
        ...style,
      }}
    >
      {label}
    </button>
  );
}

// Curated set rather than a full spectrum picker, matching the reference
// screenshot's small swatch-grid approach — fast to pick from, no need to
// fiddle with a color wheel for ordinary text coloring.
const COLOR_SWATCHES = [
  '#111111', // near-black, default text color
  '#ffffff',
  '#e03131', // red
  '#f08c00', // orange
  '#ffd43b', // yellow
  '#2f9e44', // green
  '#1971c2', // blue
  '#7048e8', // purple
  '#d6336c', // pink
  '#868e96', // gray
];

function ColorPicker({
  value,
  disabled,
  onChange,
}: {
  value: string | undefined;
  disabled: boolean;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) setOpen((v) => !v);
        }}
        disabled={disabled}
        title="Text color"
        style={{ width: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2px 0' }}
      >
        <span style={{ fontSize: 12, lineHeight: 1 }}>A</span>
        <span
          style={{
            width: 16,
            height: 4,
            background: disabled ? '#ccc' : value ?? '#111111',
            marginTop: 2,
          }}
        />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            padding: 8,
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 6,
          }}
        >
          {COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              title={color}
              onClick={() => {
                onChange(color);
                setOpen(false);
              }}
              style={{
                width: 22,
                height: 22,
                background: color,
                border: color === value ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                borderRadius: 4,
                padding: 0,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LinkButton({
  value,
  disabled,
  onChange,
}: {
  value: string | undefined;
  disabled: boolean;
  onChange: (link: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => {
    if (open) setDraft(value ?? '');
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  function apply() {
    const trimmed = draft.trim();
    if (!trimmed) {
      onChange(undefined);
      setOpen(false);
      return;
    }
    // Most people type "example.com" without a scheme — PDF link
    // annotations need a full URI to be clickable, so add one if missing.
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    onChange(withScheme);
    setOpen(false);
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) setOpen((v) => !v);
        }}
        disabled={disabled}
        title={value ? `Linked to ${value}` : 'Insert link'}
        style={{
          width: 28,
          background: value ? 'var(--color-accent-bg)' : 'var(--color-surface)',
          border: value ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
        }}
      >
        🔗
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            padding: 10,
            width: 240,
          }}
        >
          <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Link URL</div>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && apply()}
            placeholder="example.com"
            style={{ width: '100%', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            {value ? (
              <button
                onClick={() => {
                  onChange(undefined);
                  setOpen(false);
                }}
                style={{ fontSize: 12, color: '#cc3333' }}
              >
                Remove link
              </button>
            ) : (
              <span />
            )}
            <button onClick={apply} style={{ fontSize: 12 }}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const BORDER_THICKNESSES = [1, 2, 4, 6, 10];

function BorderThicknessPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (thickness: number) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="Border thickness"
        style={{ width: 28 }}
      >
        ▾
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            padding: 6,
            width: 140,
          }}
        >
          {BORDER_THICKNESSES.map((thickness) => (
            <button
              key={thickness}
              onClick={() => {
                onChange(thickness);
                setOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '6px 8px',
                border: thickness === value ? '1px solid var(--color-accent)' : '1px solid transparent',
                background: thickness === value ? '#eef6ff' : 'transparent',
                borderRadius: 4,
              }}
            >
              <div style={{ flex: 1, height: thickness, background: '#222' }} />
              <span style={{ fontSize: 11, color: '#888' }}>{thickness}px</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BorderColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="Border color"
        style={{ width: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2px 0' }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            border: '1px solid #888',
            background: value,
            borderRadius: 2,
          }}
        />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            padding: 8,
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 6,
          }}
        >
          {COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              title={color}
              onClick={() => {
                onChange(color);
                setOpen(false);
              }}
              style={{
                width: 22,
                height: 22,
                background: color,
                border: color === value ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                borderRadius: 4,
                padding: 0,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, background: 'var(--color-border)', margin: '2px 4px' }} />;
}

// Native color input rather than a curated swatch grid — "any color the
// user wants" needs the full spectrum, which a fixed swatch list can't
// offer. Browsers render this as their own OS-level color picker.
function HighlightColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title="Highlight color — pick any color"
      style={{
        width: 28,
        height: 28,
        padding: 0,
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        cursor: 'pointer',
        background: 'none',
      }}
    />
  );
}

function WatermarkDialog({
  onInsert,
  onClose,
}: {
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('CONFIDENTIAL');

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
        style={{ padding: 24, width: 360 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Add watermark</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 16, cursor: 'pointer' }}>
            ✕
          </button>
        </div>

        <label style={{ display: 'block', fontSize: 13, marginBottom: 6, color: '#666' }}>
          Watermark text
        </label>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => e.key === 'Enter' && text.trim() && onInsert(text)}
          style={{
            width: '100%',
            padding: '8px 10px',
            border: '1px solid #ccc',
            borderRadius: 4,
            fontSize: 14,
            boxSizing: 'border-box',
          }}
        />

        <p style={{ fontSize: 12, color: '#888', marginTop: 10 }}>
          Added as a large, faint, diagonal overlay across the current page only. It's a normal
          text object afterward — you can move, resize, restyle, or delete it like anything else.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose}>Cancel</button>
          <button className="btn-accent" onClick={() => onInsert(text)} disabled={!text.trim()}>
            Insert watermark
          </button>
        </div>
      </div>
    </div>
  );
}

// Fixed list, 1–18 — replaces the old −/+ stepper. Deliberately NOT
// derived from lib/fonts.ts's FONT_SIZES (that preset list goes well
// beyond 18, e.g. 24/36/48 for headings) since the requirement here is
// specifically this narrower 1–18 range, picker-only, no custom typing.
const FONT_SIZE_OPTIONS = Array.from({ length: 18 }, (_, i) => i + 1);

interface FontSizeDropdownProps {
  value: number | undefined;
  disabled: boolean;
  onChange: (size: number) => void;
}

function FontSizeDropdown({ value, disabled, onChange }: FontSizeDropdownProps) {
  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      title={disabled ? 'Select a text box to change its font size' : 'Font size'}
      style={{ width: 56 }}
    >
      {/* Shown when nothing's selected, or if a document has a stored
          size outside 1–18 (e.g. from before this dropdown existed) —
          without this, the <select> would silently fall back to
          whichever option happens to be first. */}
      {(!value || value < 1 || value > 18) && (
        <option value="" disabled hidden>
          {value ?? 'Size'}
        </option>
      )}
      {FONT_SIZE_OPTIONS.map((size) => (
        <option key={size} value={size}>
          {size}
        </option>
      ))}
    </select>
  );
}