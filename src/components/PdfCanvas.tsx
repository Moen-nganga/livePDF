import { useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';
import { nanoid } from 'nanoid';
import { useEditorStore } from '../store/editorStore';
import type { Page, PageObject } from '../types/document';
import { Ruler, RULER_THICKNESS } from './Ruler';

export const ZOOM = 1; // 1 canvas px = 1 PDF point at 100%; toolbar can scale this later

// Standard hyperlink blue, used for any text object with a link — regardless
// of the color the person picked for it — so links are recognizable at a
// glance, and to match exportPdf.ts's rendering of the same text.
const LINK_COLOR = '#1155CC';

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

  const [canvasDims, setCanvasDims] = useState({ width: page.width, height: page.height });

  const [selectionBounds, setSelectionBounds] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    setSelectionBounds(null);

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

    function syncSelectionBounds() {
      const active = canvas.getActiveObject();
      if (!active) {
        setSelectionBounds(null);
        return;
      }
      const rect = active.getBoundingRect();
      setSelectionBounds({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    }

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
      setCanvasDims({ width: page.width * scale, height: page.height * scale });
      // The canvas' own pixel size just changed under the active object,
      // so refresh its highlighted extent on the rulers to match.
      syncSelectionBounds();
    }

    fitToContainer();

    const resizeObserver = new ResizeObserver(() => fitToContainer());
    resizeObserver.observe(container);

    canvas.on('selection:created', (e) => {
      const obj = e.selected?.[0] as (fabric.Object & { id?: string }) | undefined;
      setSelectedObjectId(obj?.id ?? null);
      syncSelectionBounds();
    });
    canvas.on('selection:updated', () => syncSelectionBounds());
    canvas.on('selection:cleared', () => {
      setSelectedObjectId(null);
      setSelectionBounds(null);
    });
    // Keep the ruler highlight tracking live while the user drags/resizes,
    // not just after the change is committed on mouse-up.
    canvas.on('object:moving', () => syncSelectionBounds());
    canvas.on('object:scaling', () => syncSelectionBounds());
    canvas.on('object:rotating', () => syncSelectionBounds());

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
      syncSelectionBounds();
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

    canvas.on('text:editing:exited', (e) => {
      const obj = e.target as (fabric.IText & { id?: string }) | undefined;
      if (!obj?.id) return;
      updateObject(page.id, obj.id, { text: obj.text ?? '' });
    });

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
        | fabric.IText
        | undefined;
      if (!fabricObj) return;

      const fontWeight = obj.bold ? 'bold' : 'normal';
      const fontStyle = obj.italic ? 'italic' : 'normal';
      const linethrough = obj.strikethrough;
      const underline = !!obj.link;
      // Linked text always displays in link-blue, independent of the
      // color property stored on the object — that property is left
      // alone so it's still there if the link is later removed.
      const effectiveColor = obj.link ? LINK_COLOR : obj.color;

      if (
        fabricObj.fontFamily !== obj.fontFamily ||
        fabricObj.fontSize !== obj.fontSize ||
        fabricObj.fontWeight !== fontWeight ||
        fabricObj.fontStyle !== fontStyle ||
        fabricObj.linethrough !== linethrough ||
        fabricObj.underline !== underline ||
        fabricObj.fill !== effectiveColor
      ) {
        fabricObj.set({
          fontFamily: obj.fontFamily,
          fontSize: obj.fontSize,
          fontWeight,
          fontStyle,
          linethrough,
          underline,
          fill: effectiveColor,
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

  const hRange = selectionBounds
    ? { start: selectionBounds.left, end: selectionBounds.left + selectionBounds.width }
    : null;
  const vRange = selectionBounds
    ? { start: selectionBounds.top, end: selectionBounds.top + selectionBounds.height }
    : null;

  return (
    <div
      style={{
        display: 'inline-grid',
        gridTemplateColumns: `${RULER_THICKNESS}px ${canvasDims.width}px`,
        gridTemplateRows: `${RULER_THICKNESS}px ${canvasDims.height}px`,
      }}
    >
      {/* Corner square where the two rulers meet. */}
      <div
        style={{
          width: RULER_THICKNESS,
          height: RULER_THICKNESS,
          background: '#fafafa',
          borderRight: '1px solid #ddd',
          borderBottom: '1px solid #ddd',
        }}
      />
      <Ruler orientation="horizontal" lengthPx={canvasDims.width} highlightRange={hRange} />
      <Ruler orientation="vertical" lengthPx={canvasDims.height} highlightRange={vRange} />
      <div
        ref={wrapperRef}
        style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.15)', background: '#fff' }}
      />
    </div>
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
      // Use a Textbox (not IText) so the object wraps to obj.width every
      // time it's rebuilt — e.g. when re-synced onto the canvas after a
      // store update — not just at the moment it was first typed. IText
      // never wraps at all, which is what let long text overflow its box
      // once the object round-tripped through the store.
      const t = new fabric.Textbox(obj.text, {
        ...common,
        width: obj.width,
        fontSize: obj.fontSize,
        fontFamily: obj.fontFamily,
        fill: obj.link ? LINK_COLOR : obj.color,
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