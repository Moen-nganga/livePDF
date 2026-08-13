import { useRef } from 'react';
import { nanoid } from 'nanoid';
import { useEditorStore } from '../store/editorStore';
import type { PageObject } from '../types/document';

const baseDefaults = { rotation: 0, opacity: 1 };

function nextOffset(count: number) {
  const step = 24;
  return { x: 80 + (count % 8) * step, y: 80 + (count % 8) * step };
}

/**
 * Shared image-add logic used by both Toolbar and AddMenu.
 * Call triggerImagePick() to open the file picker.
 * Render fileInputElement somewhere in your component tree.
 */
export function useImageAdd() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const document = useEditorStore((s) => s.document);
  const activePageIndex = useEditorStore((s) => s.activePageIndex);
  const addObject = useEditorStore((s) => s.addObject);

  const activePage = document?.pages[activePageIndex];

  function triggerImagePick() {
    fileInputRef.current?.click();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activePage) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;

      // A native <img> replaces fabric.FabricImage.fromURL here purely to
      // read the image's natural pixel dimensions before placing it -- no
      // canvas rendering happens in this file anymore. PdfCanvas now draws
      // the object as a real SVG <image> element directly from the store.
      const img = new Image();

      const place = (naturalW: number, naturalH: number) => {
        const maxDim = 300;
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
      };

      img.onload = () => {
        place(img.naturalWidth || 300, img.naturalHeight || 300);
      };
      img.onerror = () => {
        // Rare (corrupt/unsupported file) -- fall back to a default box
        // rather than silently dropping the add. The SVG <image> element
        // will still render at whatever intrinsic size it resolves.
        place(300, 300);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  const fileInputElement = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      style={{ display: 'none' }}
      onChange={handleChange}
    />
  );

  return { triggerImagePick, fileInputElement };
}