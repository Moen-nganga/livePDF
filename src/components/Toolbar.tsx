import { useRef } from 'react';
import { nanoid } from 'nanoid';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/editorStore';
import type { PageObject } from '../types/document';

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activePage = document?.pages[activePageIndex];

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