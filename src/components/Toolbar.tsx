import { useRef } from 'react';
import { nanoid } from 'nanoid';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/editorStore';
import type { PageObject, TextObject } from '../types/document';
import { WEB_SAFE_FONTS, FONT_SIZES } from '../lib/fonts';

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activePage = document?.pages[activePageIndex];
  const selectedObject = activePage?.objects.find((o) => o.id === selectedObjectId);
  const selectedText: TextObject | undefined =
    selectedObject?.type === 'text' ? selectedObject : undefined;

  function updateSelectedText(patch: Partial<TextObject>) {
    if (!activePage || !selectedText) return;
    updateObject(activePage.id, selectedText.id, patch);
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

  function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activePage) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Read natural size so the placed object starts at a sane aspect ratio
      fabric.FabricImage.fromURL(dataUrl).then((img) => {
        const maxDim = 300;
        const naturalW = img.width ?? maxDim;
        const naturalH = img.height ?? maxDim;
        const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));

        const { x, y } = nextOffset(activePage.objects.length);
        const obj: PageObject = {
          id: nanoid(),
          type: 'image',
          x,
          y,
          width: naturalW * scale,
          height: naturalH * scale,
          ...baseDefaults,
          src: dataUrl,
        };
        addObject(activePage.id, obj);
      });
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // allow picking the same file again later
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: '8px 16px',
        borderBottom: '1px solid #ddd',
        background: '#fafafa',
      }}
    >
      <button onClick={addText}>+ Text</button>
      <button onClick={addRect}>+ Rectangle</button>
      <button onClick={addEllipse}>+ Ellipse</button>
      <button onClick={() => fileInputRef.current?.click()}>+ Image</button>

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

      <FontSizeStepper
        value={selectedText?.fontSize}
        disabled={!selectedText}
        onChange={(size) => updateSelectedText({ fontSize: size })}
      />

      <Divider />
      <span style={{ fontSize: 12, color: '#888', alignSelf: 'center', marginLeft: 8 }}>
        Double-click text to edit it · select an object and press Delete to remove it
      </span>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleImagePick}
      />
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, background: '#ddd', margin: '2px 4px' }} />;
}

interface FontSizeStepperProps {
  value: number | undefined;
  disabled: boolean;
  onChange: (size: number) => void;
}

/**
 * Mirrors the −  [number]  + control from the reference screenshot. Typing
 * a custom value directly into the number field is also supported, not
 * just stepping through the preset list, since locking people into only
 * the preset sizes is more restrictive than the reference UI actually is.
 */
function FontSizeStepper({ value, disabled, onChange }: FontSizeStepperProps) {
  function step(direction: 1 | -1) {
    if (value === undefined) return;
    const sizes = FONT_SIZES as readonly number[];
    const currentIndex = sizes.indexOf(value);
    if (currentIndex === -1) {
      // Custom value not in the preset list — just nudge by 1 instead of
      // jumping to a preset, so stepping feels predictable either way.
      onChange(Math.max(1, value + direction));
      return;
    }
    const nextIndex = Math.min(sizes.length - 1, Math.max(0, currentIndex + direction));
    onChange(sizes[nextIndex]);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <button onClick={() => step(-1)} disabled={disabled} title="Decrease font size" style={{ width: 28 }}>
        −
      </button>
      <input
        type="number"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (!Number.isNaN(next) && next > 0) onChange(next);
        }}
        style={{ width: 44, textAlign: 'center' }}
      />
      <button onClick={() => step(1)} disabled={disabled} title="Increase font size" style={{ width: 28 }}>
        +
      </button>
    </div>
  );
}