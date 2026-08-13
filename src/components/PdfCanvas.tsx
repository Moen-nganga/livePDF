import { useEffect, useRef } from 'react';
import * as fabric from 'fabric';
import { nanoid } from 'nanoid';
import { useEditorStore } from '../store/editorStore';
import type { Page, PageObject } from '../types/document';
import { GRID_SIZE, OVERLAP_PAD, snapToGrid, boundsOverlap, findFreeGridSlot, type Bounds } from '../lib/grid';

export const ZOOM = 1; // 1 canvas px = 1 PDF point at 100%; toolbar can scale this later

// Real (PDF-point-space) bounding box for a fabric object -- since the
// canvas is only ever scaled via canvas.setZoom for responsive fit (see
// the fitToContainer comment below), obj.left/top/getScaledWidth/
// getScaledHeight are already in the same point space the store uses,
// with no zoom-unwinding math needed.
function fabricBounds(obj: fabric.Object): Bounds {
  return {
    x: obj.left ?? 0,
    y: obj.top ?? 0,
    width: obj.getScaledWidth(),
    height: obj.getScaledHeight(),
  };
}

function isTextLikeObject(obj: fabric.Object): boolean {
  return obj.type === 'i-text' || obj.type === 'textbox';
}

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

  // Last known bounds for each object that DIDN'T overlap another text
  // object -- used by the object:modified handler below to snap a drop
  // back to safety if the position the user just released it at would
  // overlap something. Keyed by object id, populated both when an object
  // is first added to the canvas and whenever a modify is accepted.
  const lastGoodBoundsRef = useRef<Map<string, Bounds>>(new Map());

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const canvasEl = window.document.createElement('canvas');
    wrapper.appendChild(canvasEl);

    // TEMP verification marker -- confirms in devtools that this exact
    // build of PdfCanvas.tsx (with the grid/scaleY fixes) is the one
    // actually running. Safe to delete once confirmed.
    // eslint-disable-next-line no-console
    console.log('[PdfCanvas] grid+scaleY-fix build loaded, page', page.id);

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

    // Live grid-snap + overlap warning while an object is being dragged.
    // This is feedback only -- it doesn't refuse to move the object, it
    // just snaps its position to the invisible grid on every frame and,
    // for text/link objects, shows a red outline when the current
    // position would overlap another line of text. The actual guarantee
    // (never letting an overlapping drop stick) happens in
    // object:modified below, once the mouse is released.
    canvas.on('object:moving', (e) => {
      const obj = e.target as fabric.Object & { isTextPlaceholder?: boolean };
      if (obj.isTextPlaceholder) return; // the "draw a text box" tool handles its own placement on mouse-up

      obj.set({ left: snapToGrid(obj.left ?? 0), top: snapToGrid(obj.top ?? 0) });

      if (isTextLikeObject(obj)) {
        const candidate = fabricBounds(obj);
        const overlapping = canvas
          .getObjects()
          .some((o) => o !== obj && isTextLikeObject(o) && boundsOverlap(candidate, fabricBounds(o), OVERLAP_PAD));
        obj.set({ stroke: overlapping ? '#cc3333' : undefined, strokeWidth: overlapping ? 1 : 0 });
      }
    });

    canvas.on('object:modified', (e) => {
      const obj = e.target as fabric.Object & { id?: string };
      if (!obj?.id) return;

      // Clear any red "would overlap" warning stroke set by object:moving
      // above before deciding whether to keep or revert this drop.
      obj.set({ stroke: undefined, strokeWidth: 0 });

      // Snap the dropped position to the invisible grid -- keeps
      // manually placed/moved objects landing on tidy, consistent
      // coordinates instead of wherever the mouse happened to release.
      obj.set({ left: snapToGrid(obj.left ?? 0), top: snapToGrid(obj.top ?? 0) });

      if (isTextLikeObject(obj)) {
        // Text objects must NEVER be resized via a scale transform.
        // Fabric renders a scaled object by stretching/squishing the
        // already-drawn glyphs rather than reflowing them -- so any
        // leftover scaleY (e.g. from a previous corner-handle drag) kept
        // compressing the box's *real*, correctly-growing height back
        // down on screen every time more text wrapped or a newline was
        // typed. That's what made new lines look like they were
        // overlapping the ones above them (or like Enter "did nothing"):
        // the line was really being added, just visually squashed flat.
        // Locking this to 1 -- paired with `lockScalingY: true` set on
        // the Textbox at creation below, so the corner handles can't
        // reintroduce it -- lets `.height` alone represent the box's
        // true size, which is how Fabric's own auto-growing Textbox is
        // designed to be used.
        if ((obj.scaleY ?? 1) !== 1) {
          obj.set({ scaleY: 1 });
        }

        // Keep the box's right edge from ever passing the page's right
        // edge -- this is what guarantees Fabric's own built-in word-wrap
        // kicks in before any word could run off the page, rather than
        // the box (and its un-wrapped tail of text) drifting past the
        // visible canvas.
        if (obj.type === 'textbox' && (obj.left ?? 0) + (obj.width ?? 0) > page.width) {
          obj.set({ width: Math.max(GRID_SIZE, page.width - (obj.left ?? 0)) });
        }
      } else if (obj.width || obj.height) {
        // Non-text objects (rects, ellipses, images) are fine to resize
        // via scale -- just snap the resulting rendered size to the grid.
        if (obj.width) {
          const snappedW = Math.max(GRID_SIZE, snapToGrid((obj.width ?? 0) * (obj.scaleX ?? 1)));
          obj.set({ scaleX: snappedW / obj.width });
        }
        if (obj.height) {
          const snappedH = Math.max(GRID_SIZE, snapToGrid((obj.height ?? 0) * (obj.scaleY ?? 1)));
          obj.set({ scaleY: snappedH / obj.height });
        }
      }
      obj.setCoords();

      // Text objects (including links, which render as text with `link`
      // set -- see createFabricObject below) are the things we guarantee
      // don't overlap each other. Shapes/highlights are frequently
      // layered over text on purpose, so they're excluded from this check.
      if (isTextLikeObject(obj)) {
        const candidate = fabricBounds(obj);
        const others = canvas
          .getObjects()
          .filter((o) => o !== obj && isTextLikeObject(o))
          .map(fabricBounds);

        if (others.some((o) => boundsOverlap(candidate, o, OVERLAP_PAD))) {
          // Revert to the last position this object sat at without
          // overlapping anything, rather than committing a spot that
          // overlaps another line of text/a link.
          const fallback = lastGoodBoundsRef.current.get(obj.id);
          if (fallback) {
            obj.set({ left: fallback.x, top: fallback.y });
            obj.setCoords();
          }
        }
      }

      const finalBounds = fabricBounds(obj);
      lastGoodBoundsRef.current.set(obj.id, finalBounds);
      canvas.requestRenderAll();

      updateObject(page.id, obj.id, {
        x: finalBounds.x,
        y: finalBounds.y,
        width: finalBounds.width,
        height: finalBounds.height,
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
    // Also fires for fabric.IText objects (the PDF-extracted text runs
    // below), since this is a Canvas-level event tied to any editable
    // text-type object, not something specific to Textbox.
    canvas.on('text:editing:exited', (e) => {
      const obj = e.target as (fabric.IText & { id?: string }) | undefined;
      if (!obj?.id) return;
      // Persist fontSize/height alongside text -- the shrink-to-fit
      // handler below (text:changed) can have adjusted both while the
      // user was typing, and the store needs to reflect whatever
      // actually ended up on screen, not just the final text content.
      updateObject(page.id, obj.id, { text: obj.text ?? '', fontSize: obj.fontSize, height: obj.height });
    });

    // Fires on every keystroke while editing a Textbox (the freely-typed,
    // wrapping kind created by the double-click placeholder flow below --
    // IText objects, used for single-line PDF-extracted runs, are
    // intentionally excluded, see createFabricObject's comment on why
    // they never wrap).
    //
    // Fabric recalculates a Textbox's own wrapped lines and real `.height`
    // automatically as content changes -- that recalculation is correct
    // and doesn't need to be redone here. What DOES need handling every
    // keystroke is guarding against exactly the scaleY-squish problem
    // described in object:modified above: if this object has any
    // leftover scaleY from an earlier resize, every newly wrapped or
    // Enter-created line renders compressed toward the ones above it
    // instead of appearing as a proper new line, which is what read as
    // "pressing Enter doesn't do anything." Resetting it on every
    // keystroke (not just on drop) means it's already correct while
    // you're mid-edit, not just after you click away.
    canvas.on('text:changed', (e) => {
      const obj = e.target as fabric.Textbox & { id?: string };
      if (!obj?.id || obj.type !== 'textbox') return;

      if ((obj.scaleY ?? 1) !== 1) {
        obj.set({ scaleY: 1 });
      }

      obj.dirty = true;
      obj.setCoords();

      // Push down every text/link object this box's growth now overlaps
      // -- the gap this closes is between SEPARATE objects, not lines
      // within this one box. A cover letter/resume built from several
      // stacked text blocks (one per paragraph/section) has no mechanism
      // anywhere else that reacts to one block growing taller as the
      // user types into it -- the block below just sat at whatever y it
      // was originally placed at, so a growing paragraph above it simply
      // overlapped it once it got tall enough. This sweeps every pair of
      // text objects top-to-bottom and shoves the lower one down by
      // however much the upper one is currently overlapping it, and
      // repeats a few passes so a push can itself cascade into whatever
      // sits below THAT object, the way a word processor reflows
      // everything below an edit point.
      const textObjects = canvas.getObjects().filter(isTextLikeObject) as (fabric.Object & { id?: string })[];
      for (let pass = 0; pass < 5; pass++) {
        const sorted = [...textObjects].sort((a, b) => (a.top ?? 0) - (b.top ?? 0));
        let pushedAny = false;

        for (let i = 0; i < sorted.length; i++) {
          for (let j = i + 1; j < sorted.length; j++) {
            const upper = sorted[i];
            const lower = sorted[j];

            const upperLeft = upper.left ?? 0;
            const upperRight = upperLeft + upper.getScaledWidth();
            const lowerLeft = lower.left ?? 0;
            const lowerRight = lowerLeft + lower.getScaledWidth();
            const horizontallyOverlaps = upperLeft < lowerRight + OVERLAP_PAD && upperRight + OVERLAP_PAD > lowerLeft;
            if (!horizontallyOverlaps) continue;

            const upperBottom = (upper.top ?? 0) + upper.getScaledHeight();
            const overlapAmount = upperBottom + OVERLAP_PAD - (lower.top ?? 0);
            if (overlapAmount > 0) {
              const newTop = snapToGrid((lower.top ?? 0) + overlapAmount);
              lower.set({ top: newTop });
              lower.setCoords();
              if (lower.id) updateObject(page.id, lower.id, { y: newTop });
              pushedAny = true;
            }
          }
        }

        if (!pushedAny) break;
      }

      canvas.renderAll();
    });

    // Commit a text placeholder into a real TextObject on double-click.
    // The placeholder rect drawn while textPlacementActive is true (see
    // the dedicated effect below) is tagged with isTextPlaceholder so we
    // can tell it apart from a normal border/rect object here.
    //
    // This one intentionally stays a fabric.Textbox (not IText): the user
    // drew a box of a specific width and reasonably expects freshly-typed
    // text to wrap inside it, unlike the fixed single-line runs extracted
    // from an uploaded PDF (see createFabricObject below).
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
        // Clamp so the box can't start out already extending past the
        // page's right edge -- keeps Fabric's own word-wrap the thing
        // that decides where a line breaks, rather than letting text run
        // off the visible page.
        width: Math.min(width, Math.max(GRID_SIZE, page.width - left)),
        angle,
        fontSize: 14,
        fontFamily: 'Helvetica',
        fill: '#111111',
        textAlign: 'left',
        // Textbox already has its own special resize behavior for the
        // side handles (dragging them changes `width`, which re-wraps
        // the text -- exactly what we want). The top/bottom and corner
        // handles have no such special handling and just apply a scaleY
        // transform instead, which stretches/squishes the rendered
        // glyphs rather than reflowing them -- the root cause of wrapped
        // and Enter-created lines rendering overlapped. Locking scaleY
        // means every resize handle either re-wraps correctly or does
        // nothing, never squishes.
        lockScalingY: true,
        // Belt-and-suspenders alongside the text:changed handler's hard
        // redraw -- a live-typed, constantly-resizing Textbox is exactly
        // the kind of object where Fabric's render cache is most likely
        // to serve a stale bitmap for a frame. It's cheap to skip caching
        // for a single actively-edited text box.
        objectCaching: false,
      });
      (textbox as fabric.Object & { id?: string }).id = id;
      canvas.add(textbox);
      lastGoodBoundsRef.current.set(id, fabricBounds(textbox));
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
      lastGoodBoundsRef.current.clear();
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

      // Snap the drawn box to the invisible grid, then make sure it
      // doesn't land on top of any existing text/link -- findFreeGridSlot
      // walks outward from where the user drew it until it finds a spot
      // that clears every other text object on the page by OVERLAP_PAD,
      // falling back to the drawn (snapped) position if the page is too
      // crowded to find one nearby.
      const existingText = canvas
        .getObjects()
        .filter(isTextLikeObject)
        .map(fabricBounds);
      const size = {
        width: Math.max(GRID_SIZE, snapToGrid(rect.width ?? 160)),
        height: Math.max(GRID_SIZE, snapToGrid(rect.height ?? 32)),
      };
      const placed = findFreeGridSlot(
        { x: rect.left ?? 0, y: rect.top ?? 0 },
        size,
        existingText,
        { width: page.width, height: page.height }
      );
      rect.set({ left: placed.x, top: placed.y, width: size.width, height: size.height });

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
  }, [textPlacementActive, readOnly, setTextPlacementActive, page.width, page.height]);

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

    const newObjects = page.objects.filter((obj) => !existingIds.has(obj.id));

    // Only auto-select when exactly one new object showed up -- that's
    // the genuine "user just placed/drew/dropped a single thing, select
    // it so they can immediately move/resize/style it" case. A PDF
    // import adds dozens of TextObjects in this same effect run, and
    // calling setActiveObject once per object left whichever run
    // happened to be extracted LAST sitting selected right after import,
    // for no reason connected to anything the person did. Bulk adds now
    // leave selection alone entirely.
    const shouldAutoSelect = newObjects.length === 1;

    newObjects.forEach((obj) => {
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
          lastGoodBoundsRef.current.set(obj.id, fabricBounds(img));
          if (shouldAutoSelect) canvas.setActiveObject(img);
          canvas.requestRenderAll();
        });
        return;
      }

      const fabricObj = createFabricObject(obj);
      if (fabricObj) {
        canvas.add(fabricObj);
        lastGoodBoundsRef.current.set(obj.id, fabricBounds(fabricObj));
        if (shouldAutoSelect) canvas.setActiveObject(fabricObj);
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
      if (id && !idsInStore.has(id)) {
        canvas.remove(o);
        lastGoodBoundsRef.current.delete(id);
      }
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
      // Using fabric.IText here rather than fabric.Textbox is deliberate.
      // Every text object that comes out of pdfUpload.ts is a single line
      // lifted directly from the PDF's own content stream, already
      // positioned (x/y) exactly where that line sits on the page. The
      // `width` stored on it is only pdfUpload.ts's *estimate* of how
      // wide that line will render in our substituted web-safe font
      // (padded 25% over pdf.js's measured width, since embedded PDF
      // fonts are frequently narrower than Helvetica/Times/Courier,
      // especially at bold weight) -- it is not a hard layout constraint.
      //
      // fabric.Textbox treats `width` as a hard wrap boundary and grows
      // its own height whenever content doesn't fit -- so any case where
      // the real substituted-font width exceeds that estimate (common for
      // bold headings) caused the line to wrap and its box to grow
      // taller, spilling down into the *next* line's fixed y-position
      // from the original PDF and visually overlapping it. That's the
      // "overlapping text" bug: it shows up right at heading/next-line
      // boundaries because headings are exactly where the width estimate
      // is most often wrong.
      //
      // fabric.IText never wraps -- it always renders at its natural
      // single-line width -- so it can't grow into the line below no
      // matter how far off the width estimate is. This matches what
      // these objects actually are (independently positioned single
      // lines, not a reflowable paragraph), and IText still supports
      // double-click-to-edit like Textbox did.
      // Every text object here is a single line lifted directly from the
      // PDF's own content stream, positioned (x/y) exactly where that
      // line sits on the page. `obj.width` (from pdfUpload.ts) is the
      // ceiling for how wide this run is allowed to render -- enough to
      // avoid wrapping, and capped so it doesn't reach into whatever run
      // sits next to it on the same line (e.g. a tech-badge label right
      // after a project title). It is not a hard truth about how wide
      // the text actually is in our substituted web-safe font, since
      // pdf.js measured the original embedded font, which is often
      // narrower per character than Helvetica/Times/Courier.
      //
      // fabric.IText never wraps, so it can't grow taller and spill onto
      // the line below (the original bug this whole approach fixes) --
      // but if the substitute font renders wider than obj.width allows,
      // something still has to give. An earlier version of this fit the
      // text by applying scaleX to compress it horizontally after the
      // fact -- but canvas doesn't re-render/re-hint glyphs under a
      // non-uniform scale transform, it just stretches the already-drawn
      // raster, which is what produced the blurry/smeared text. Shrinking
      // fontSize instead re-renders the glyphs natively at the smaller
      // size, so it stays crisp -- the trade-off is the run appears
      // slightly smaller than its neighbors in that (rare, now that
      // pdfUpload.ts's neighbor-gap cap is generous) case, which reads
      // far better than either blur or overlap.
      const buildIText = (fontSize: number) =>
        new fabric.IText(obj.text, {
          ...common,
          fontSize,
          fontFamily: obj.fontFamily,
          fill: obj.color,
          fontWeight: obj.bold ? 'bold' : 'normal',
          fontStyle: obj.italic ? 'italic' : 'normal',
          linethrough: obj.strikethrough,
          underline: !!obj.link,
          textAlign: obj.align,
        });

      let t = buildIText(obj.fontSize);
      const measuredWidth = t.width ?? 0;
      if (measuredWidth > obj.width && measuredWidth > 0) {
        // Floor how far we'll shrink a run -- an extreme mismatch (very
        // long text in a very tight neighbor-capped box) should render a
        // touch wide rather than become illegibly small.
        const MIN_FONT_SHRINK_RATIO = 0.7;
        const targetFontSize = Math.max(
          obj.fontSize * MIN_FONT_SHRINK_RATIO,
          obj.fontSize * (obj.width / measuredWidth)
        );
        t = buildIText(targetFontSize);
      }

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