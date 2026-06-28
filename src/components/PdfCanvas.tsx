import { useEffect, useRef } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/editorStore';
import type { Page, PageObject } from '../types/document';

const ZOOM = 1; // 1 canvas px = 1 PDF point at 100%; toolbar can scale this later

interface Props {
  page: Page;
  /** When true, disables all editing — used for view-only share sessions. */
  readOnly?: boolean;
}

/**
 * Renders one Page on a Fabric.js canvas and keeps the store in sync:
 * - On mount / page change: builds Fabric objects from the page's data.
 * - On user edit (move/resize/rotate/edit text): writes the change back
 *   into the store via updateObject, so the store stays the source of truth.
 *
 * Fabric object `id` (custom property) maps 1:1 to PageObject.id.
 */
export function PdfCanvas({ page, readOnly = false }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const updateObject = useEditorStore((s) => s.updateObject);
  const removeObject = useEditorStore((s) => s.removeObject);
  const setSelectedObjectId = useEditorStore((s) => s.setSelectedObjectId);

  // Set up the Fabric canvas once per page. We deliberately do NOT let
  // React render the <canvas> element itself (no JSX <canvas> below).
  // Fabric.js takes ownership of whatever DOM node you hand it and
  // restructures around it (wrapper div, extra overlay canvas) — if React
  // also tries to manage that same node's lifecycle (e.g. via a `key`
  // forcing a remount), React's reconciler and Fabric's dispose() fight
  // over removing the same nodes, throwing "NotFoundError: removeChild".
  // Instead: we own one stable wrapper <div> in React, and imperatively
  // create/destroy the raw <canvas> inside it ourselves on every page
  // change, fully outside React's virtual DOM bookkeeping.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const canvasEl = window.document.createElement('canvas');
    wrapper.appendChild(canvasEl);

    const canvas = new fabric.Canvas(canvasEl, {
      width: page.width * ZOOM,
      height: page.height * ZOOM,
      backgroundColor: '#ffffff',
      selection: !readOnly, // disables drag-to-select-multiple
    });
    canvas.skipTargetFind = readOnly; // disables clicking/selecting individual objects entirely
    fabricRef.current = canvas;

    canvas.on('selection:created', (e) => {
      const obj = e.selected?.[0] as (fabric.Object & { id?: string }) | undefined;
      setSelectedObjectId(obj?.id ?? null);
    });
    canvas.on('selection:cleared', () => setSelectedObjectId(null));

    canvas.on('object:modified', (e) => {
      const obj = e.target as fabric.Object & { id?: string };
      if (!obj?.id) return;
      updateObject(page.id, obj.id, {
        x: obj.left ?? 0,
        y: obj.top ?? 0,
        width: (obj.width ?? 0) * (obj.scaleX ?? 1),
        height: (obj.height ?? 0) * (obj.scaleY ?? 1),
        rotation: obj.angle ?? 0,
      });
    });

    return () => {
      canvas.dispose();
      fabricRef.current = null;
      // dispose() removes Fabric's own injected elements but, depending on
      // version, may leave the wrapper's contents inconsistent — clearing
      // wrapper.innerHTML ourselves guarantees a clean slate for the next
      // page's canvas, with no leftover nodes for React to trip over.
      wrapper.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, readOnly]);

  // Render background image (uploaded PDF page) when it changes
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    if (!page.backgroundImage) {
      canvas.backgroundImage = undefined;
      canvas.requestRenderAll();
      return;
    }

    fabric.FabricImage.fromURL(page.backgroundImage).then((img) => {
      img.set({
        scaleX: page.width / (img.width ?? page.width),
        scaleY: page.height / (img.height ?? page.height),
        selectable: false,
        evented: false,
      });
      canvas.backgroundImage = img;
      canvas.requestRenderAll();
    });
  }, [page.backgroundImage, page.width, page.height]);

  // Sync NEW objects only: when an object id appears in the store that
  // isn't on the canvas yet, add it. We deliberately do NOT react to the
  // whole page.objects array changing — that array gets a new reference on
  // every drag/resize too (since the store is immutable), which previously
  // caused this effect to re-run mid-interaction and re-add/duplicate
  // objects, fight with Fabric's own object positions, and make nothing
  // feel deletable. Only the *count* of objects matters for "should I add
  // something new" — removal is handled by removeObject below, directly
  // tied to the delete action instead of a diff.
  const objectIds = page.objects.map((o) => o.id).join(',');
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const existingIds = new Set(
      canvas.getObjects().map((o) => (o as fabric.Object & { id?: string }).id)
    );

    page.objects.forEach((obj) => {
      if (existingIds.has(obj.id)) return;

      if (obj.type === 'image') {
        fabric.FabricImage.fromURL(obj.src).then((img) => {
          img.set({
            left: obj.x,
            top: obj.y,
            scaleX: obj.width / (img.width ?? obj.width),
            scaleY: obj.height / (img.height ?? obj.height),
            angle: obj.rotation,
            opacity: obj.opacity,
          });
          (img as fabric.Object & { id?: string }).id = obj.id;
          canvas.add(img);
          canvas.setActiveObject(img);
          canvas.requestRenderAll();
        });
        return;
      }

      const fabricObj = createFabricObject(obj);
      if (fabricObj) {
        canvas.add(fabricObj);
        canvas.setActiveObject(fabricObj); // newly added object is immediately selected/draggable
      }
    });

    canvas.requestRenderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectIds]);

  // Sync REMOVALS: when an object disappears from the store (user pressed
  // delete), remove the matching Fabric object directly. This is driven by
  // the same objectIds string, so it only fires when the set of ids
  // actually changes — not on every drag.
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const idsInStore = new Set(page.objects.map((o) => o.id));
    canvas.getObjects().forEach((o) => {
      const id = (o as fabric.Object & { id?: string }).id;
      if (id && !idsInStore.has(id)) canvas.remove(o);
    });
    canvas.requestRenderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectIds]);

  // Delete the selected object with Delete/Backspace, since there's no
  // dedicated delete button yet. Fabric's own keyboard handling only
  // covers text editing, not object deletion, so we add this ourselves.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const active0 = canvas.getActiveObject();
      const isEditingText = !!active0 && 'isEditing' in active0 && (active0 as { isEditing?: boolean }).isEditing;
      if (isEditingText) return; // let backspace work normally inside text
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;

      const active = canvas.getActiveObject() as (fabric.Object & { id?: string }) | undefined;
      if (!active?.id) return;
      e.preventDefault();
      canvas.remove(active);
      canvas.requestRenderAll();
      removeObject(page.id, active.id);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [page.id, removeObject]);

  return (
    <div
      ref={wrapperRef}
      style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.15)', background: '#fff' }}
    />
  );
}

function createFabricObject(obj: PageObject): fabric.Object | null {
  const common = {
    left: obj.x,
    top: obj.y,
    angle: obj.rotation,
    opacity: obj.opacity,
  };

  switch (obj.type) {
    case 'text': {
      const t = new fabric.Textbox(obj.text, {
        ...common,
        width: obj.width,
        fontSize: obj.fontSize,
        fontFamily: obj.fontFamily,
        fill: obj.color,
        fontWeight: obj.bold ? 'bold' : 'normal',
        fontStyle: obj.italic ? 'italic' : 'normal',
        textAlign: obj.align,
      });
      (t as fabric.Object & { id?: string }).id = obj.id;
      return t;
    }
    case 'rect': {
      const r = new fabric.Rect({
        ...common,
        width: obj.width,
        height: obj.height,
        fill: obj.fill,
        stroke: obj.stroke,
        strokeWidth: obj.strokeWidth,
        rx: obj.cornerRadius,
        ry: obj.cornerRadius,
      });
      (r as fabric.Object & { id?: string }).id = obj.id;
      return r;
    }
    case 'ellipse': {
      const e = new fabric.Ellipse({
        ...common,
        rx: obj.width / 2,
        ry: obj.height / 2,
        fill: obj.fill,
        stroke: obj.stroke,
        strokeWidth: obj.strokeWidth,
      });
      (e as fabric.Object & { id?: string }).id = obj.id;
      return e;
    }
    case 'line': {
      const l = new fabric.Line([obj.x, obj.y, obj.x + obj.width, obj.y + obj.height], {
        stroke: obj.stroke,
        strokeWidth: obj.strokeWidth,
        opacity: obj.opacity,
        angle: obj.rotation,
      });
      (l as fabric.Object & { id?: string }).id = obj.id;
      return l;
    }
    case 'image': {
      // Image creation is async in Fabric v6; handled by caller awaiting
      // fabric.FabricImage.fromURL separately and adding to canvas there.
      // Returning null here keeps this function's signature synchronous;
      // see addImageObject in toolbar actions for the async add path.
      return null;
    }
    default:
      return null;
  }
}