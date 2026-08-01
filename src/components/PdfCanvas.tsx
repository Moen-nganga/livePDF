import { useEffect, useRef } from 'react';
import * as fabric from 'fabric';
import { nanoid } from 'nanoid';
import { useEditorStore } from '../store/editorStore';
import type { Page, PageObject } from '../types/document';

export const ZOOM = 1; // 1 canvas px = 1 PDF point at 100%; toolbar can scale this later

interface Props {
  page: Page;
  /** When true, disables all editing — used for view-only share sessions. */
  readOnly?: boolean;
}

export function PdfCanvas({ page, readOnly = false }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const updateObject = useEditorStore((s) => s.updateObject);
  const removeObject = useEditorStore((s) => s.removeObject);
  const addObject = useEditorStore((s) => s.addObject);
  const setSelectedObjectId = useEditorStore((s) => s.setSelectedObjectId);
  const textPlacementActive = useEditorStore((s) => s.textPlacementActive);
  const setTextPlacementActive = useEditorStore((s) => s.setTextPlacementActive);

  const drawingRef = useRef<{ rect: fabric.Rect; startX: number; startY: number } | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const canvasEl = window.document.createElement('canvas');
    wrapper.appendChild(canvasEl);

    const canvas = new fabric.Canvas(canvasEl, {
      width: page.width * ZOOM,
      height: page.height * ZOOM,
      backgroundColor: '#ffffff',
      selection: !readOnly,
    });
    canvas.skipTargetFind = readOnly;
    fabricRef.current = canvas;

    // Fits the canvas to whatever width is actually available (the page's
    // parent container -- typically App.tsx's <main className=
    // "app-canvas-area">) rather than always rendering at the PDF's real
    // point size. On a phone that real size (e.g. ~612px for Letter) is
    // wider than the whole viewport, which is what was pushing the canvas
    // off-screen with a blank gap next to it in the mobile screenshot.
    //
    // This uses Fabric's viewport zoom (canvas.setZoom), NOT a change to
    // stored coordinates -- every object's x/y/width/height in the store,
    // and everywhere else that reads them (autosave, PDF export, the
    // spellchecker, drag/resize math via object:modified above), stays in
    // real PDF points the whole time. Only the on-screen pixel size
    // changes. Mouse handlers already convert screen coordinates to scene
    // coordinates via canvas.getScenePoint, which accounts for zoom
    // automatically, so text placement etc. keep working unmodified.
    //
    // `container` is resolved to a definite (non-null) Element right here,
    // once, rather than referencing `wrapper.parentElement ?? wrapper`
    // inline inside fitToContainer/resizeObserver below -- TypeScript
    // stops trusting the `if (!wrapper) return` null-check for `wrapper`
    // itself once it's read inside a nested closure, so capturing an
    // already-non-null `container` instead sidesteps that entirely.
    const container: Element = wrapper.parentElement ?? wrapper;

    function fitToContainer() {
      const style = window.getComputedStyle(container);
      const paddingX = parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0');
      const available = container.clientWidth - paddingX;
      if (available <= 0) return;

      // Never upscale past the PDF's real size -- only shrink to fit a
      // narrow screen, so desktop keeps rendering at its native 1:1 size.
      const scale = Math.min(1, available / page.width);
      canvas.setDimensions({ width: page.width * scale, height: page.height * scale });
      canvas.setZoom(scale);
      canvas.requestRenderAll();
    }

    fitToContainer();

    const resizeObserver = new ResizeObserver(() => fitToContainer());
    resizeObserver.observe(container);

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

    canvas.on('mouse:down', (e) => {
      if (e.e.ctrlKey || e.e.metaKey) {
        const t = e.target as (fabric.Object & { link?: string }) | undefined;
        if (t?.link) window.open(t.link, '_blank', 'noopener,noreferrer');
      }
    });

    canvas.on('mouse:over', (e) => {
      const target = e.target as (fabric.Object & { link?: string }) | undefined;
      if (target?.link) canvas.defaultCursor = 'pointer';
    });
    canvas.on('mouse:out', () => {
      canvas.defaultCursor = 'default';
    });

    // Syncs typed text content back into the store. Fabric's Textbox
    // maintains its own internal text state while the user edits (that's
    // literally what renders on the canvas) -- nothing was writing that
    // back into the store, which is supposed to be the single source of
    // truth for autosave, PDF export, and anything else (like the
    // spellchecker) that reads an object's .text field. Committing on
    // 'text:editing:exited' (rather than on every keystroke) avoids
    // spamming the undo history with one entry per character typed. This
    // fires regardless of which path created the textbox -- whether via
    // the double-click-to-commit placeholder flow below, or via Fabric's
    // own built-in double-click-to-edit on an existing text object.
    canvas.on('text:editing:exited', (e) => {
      const obj = e.target as (fabric.Textbox & { id?: string }) | undefined;
      if (!obj?.id) return;
      updateObject(page.id, obj.id, { text: obj.text ?? '' });
    });

    // Commit a text placeholder into a real TextObject on double-click.
    // The placeholder rect drawn while textPlacementActive is true (see
    // the dedicated effect below) is tagged with isTextPlaceholder so we
    // can tell it apart from a normal border/rect object here.
    canvas.on('mouse:dblclick', (e) => {
      const target = e.target as (fabric.Object & { isTextPlaceholder?: boolean }) | undefined;
      if (!target?.isTextPlaceholder) return;

      const id = nanoid();
      const width = (target.width ?? 160) * (target.scaleX ?? 1);
      const height = (target.height ?? 32) * (target.scaleY ?? 1);
      const left = target.left ?? 0;
      const top = target.top ?? 0;
      const angle = target.angle ?? 0;

      canvas.remove(target);

      const textbox = new fabric.Textbox('', {
        left,
        top,
        width,
        angle,
        fontSize: 14,
        fontFamily: 'Helvetica',
        fill: '#111111',
        textAlign: 'left',
      });
      (textbox as fabric.Object & { id?: string }).id = id;
      canvas.add(textbox);
      canvas.setActiveObject(textbox);
      textbox.enterEditing();
      textbox.selectAll();
      canvas.requestRenderAll();

      // Same id as the Fabric object above, so the "sync NEW objects"
      // effect below sees existingIds already has it and skips re-adding.
      addObject(page.id, {
        id,
        type: 'text',
        x: left,
        y: top,
        width,
        height,
        rotation: angle,
        opacity: 1,
        text: '',
        fontSize: 14,
        fontFamily: 'Helvetica',
        color: '#111111',
        bold: false,
        italic: false,
        strikethrough: false,
        align: 'left',
      });
    });

    return () => {
      resizeObserver.disconnect();
      canvas.dispose();
      fabricRef.current = null;
      wrapper.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, readOnly]);

  useEffect(() => {
    if (!fabricRef.current || readOnly || !textPlacementActive) return;
    const canvas: fabric.Canvas = fabricRef.current;

    canvas.discardActiveObject();
    canvas.selection = false;
    canvas.defaultCursor = 'crosshair';
    canvas.requestRenderAll();

    function onMouseDown(e: fabric.TPointerEventInfo) {
      const pointer = canvas.getScenePoint(e.e);
      const rect = new fabric.Rect({
        left: pointer.x,
        top: pointer.y,
        width: 1,
        height: 1,
        fill: 'rgba(51, 128, 204, 0.08)',
        stroke: '#3380cc',
        strokeWidth: 1,
        strokeDashArray: [4, 4],
        selectable: false,
        evented: false,
      });
      (rect as fabric.Object & { isTextPlaceholder?: boolean }).isTextPlaceholder = true;
      canvas.add(rect);
      drawingRef.current = { rect, startX: pointer.x, startY: pointer.y };
    }

    function onMouseMove(e: fabric.TPointerEventInfo) {
      const drawing = drawingRef.current;
      if (!drawing) return;
      const pointer = canvas.getScenePoint(e.e);
      const { rect, startX, startY } = drawing;
      rect.set({
        left: Math.min(startX, pointer.x),
        top: Math.min(startY, pointer.y),
        width: Math.abs(pointer.x - startX),
        height: Math.abs(pointer.y - startY),
      });
      canvas.requestRenderAll();
    }

    function onMouseUp() {
      const drawing = drawingRef.current;
      drawingRef.current = null;
      if (!drawing) return;
      const { rect } = drawing;

      if ((rect.width ?? 0) < 10 || (rect.height ?? 0) < 10) {
        rect.set({ width: 160, height: 32 });
      }

      rect.set({ selectable: true, evented: true, hasControls: true, hasBorders: true });
      canvas.setActiveObject(rect);
      canvas.requestRenderAll();

      canvas.selection = true;
      canvas.defaultCursor = 'default';
      setTextPlacementActive(false);
    }

    canvas.on('mouse:down', onMouseDown);
    canvas.on('mouse:move', onMouseMove);
    canvas.on('mouse:up', onMouseUp);

    return () => {
      canvas.off('mouse:down', onMouseDown);
      canvas.off('mouse:move', onMouseMove);
      canvas.off('mouse:up', onMouseUp);
      canvas.selection = !readOnly;
      canvas.defaultCursor = 'default';
    };
  }, [textPlacementActive, readOnly, setTextPlacementActive]);

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
        canvas.setActiveObject(fabricObj);
      }
    });

    canvas.requestRenderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectIds]);

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

  const textStyleFingerprint = page.objects
    .filter((o) => o.type === 'text')
    .map(
      (o) =>
        `${o.id}:${o.fontFamily}:${o.fontSize}:${o.bold}:${o.italic}:${o.strikethrough}:${o.color}:${o.link ?? ''}`
    )
    .join(',');
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    page.objects.forEach((obj) => {
      if (obj.type !== 'text') return;
      const fabricObj = canvas
        .getObjects()
        .find((o) => (o as fabric.Object & { id?: string }).id === obj.id) as
        | fabric.Textbox
        | undefined;
      if (!fabricObj) return;

      const fontWeight = obj.bold ? 'bold' : 'normal';
      const fontStyle = obj.italic ? 'italic' : 'normal';
      const linethrough = obj.strikethrough;
      const underline = !!obj.link;

      if (
        fabricObj.fontFamily !== obj.fontFamily ||
        fabricObj.fontSize !== obj.fontSize ||
        fabricObj.fontWeight !== fontWeight ||
        fabricObj.fontStyle !== fontStyle ||
        fabricObj.linethrough !== linethrough ||
        fabricObj.underline !== underline ||
        fabricObj.fill !== obj.color
      ) {
        fabricObj.set({
          fontFamily: obj.fontFamily,
          fontSize: obj.fontSize,
          fontWeight,
          fontStyle,
          linethrough,
          underline,
          fill: obj.color,
        });
      }
      (fabricObj as fabric.Object & { link?: string }).link = obj.link;
    });

    canvas.requestRenderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textStyleFingerprint]);

  const rotationFingerprint = page.objects.map((o) => `${o.id}:${o.rotation}`).join(',');
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    page.objects.forEach((obj) => {
      const fabricObj = canvas
        .getObjects()
        .find((o) => (o as fabric.Object & { id?: string }).id === obj.id);
      if (!fabricObj) return;
      if (fabricObj.angle !== obj.rotation) {
        fabricObj.set({ angle: obj.rotation });
      }
    });

    canvas.requestRenderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotationFingerprint]);

  const shapeStyleFingerprint = page.objects
    .filter((o) => o.type === 'rect' || o.type === 'ellipse')
    .map((o) => `${o.id}:${o.stroke}:${o.strokeWidth}`)
    .join(',');
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    page.objects.forEach((obj) => {
      if (obj.type !== 'rect' && obj.type !== 'ellipse') return;
      const fabricObj = canvas
        .getObjects()
        .find((o) => (o as fabric.Object & { id?: string }).id === obj.id);
      if (!fabricObj) return;
      if (fabricObj.stroke !== obj.stroke || fabricObj.strokeWidth !== obj.strokeWidth) {
        fabricObj.set({ stroke: obj.stroke, strokeWidth: obj.strokeWidth });
      }
    });

    canvas.requestRenderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeStyleFingerprint]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const active0 = canvas.getActiveObject();
      const isEditingText = !!active0 && 'isEditing' in active0 && (active0 as { isEditing?: boolean }).isEditing;
      if (isEditingText) return;
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
        linethrough: obj.strikethrough,
        underline: !!obj.link,
        textAlign: obj.align,
      });
      (t as fabric.Object & { id?: string; link?: string }).id = obj.id;
      (t as fabric.Object & { id?: string; link?: string }).link = obj.link;
      return t;
    }
    case 'rect': {
      const r = new fabric.Rect({
        ...common,
        width: obj.width,
        height: obj.height,
        fill: obj.fill ?? 'transparent',
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
        fill: obj.fill ?? 'transparent',
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
      return null;
    }
    default:
      return null;
  }
}