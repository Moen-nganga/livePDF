import { useCallback, useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { useEditorStore } from '../store/editorStore';
import type { Page, PageObject } from '../types/document';
import { GRID_SIZE, OVERLAP_PAD, snapToGrid, boundsOverlap, findFreeGridSlot, type Bounds } from '../lib/grid';

interface Props {
  page: Page;
  /** When true, disables all editing — used for view-only share sessions. */
  readOnly?: boolean;
}

// ---------------------------------------------------------------------
// Why SVG, and why this replaces the old Fabric/IText/Textbox split
// ---------------------------------------------------------------------
// The page is rendered as a single <svg viewBox="0 0 page.width page.height">.
// Object coordinates (x/y/width/height) are stored in PDF points, same as
// before, and now map 1:1 onto SVG user-space units -- the browser handles
// all the responsive scaling (see the wrapper's CSS below), so there's no
// manual canvas.setZoom/fitToContainer bookkeeping anymore.
//
// Shapes (rect/ellipse/line) and images render as native SVG elements.
// Text renders inside an SVG <foreignObject> hosting a real contentEditable
// <div>, which is what makes the old IText-vs-Textbox distinction obsolete:
// Fabric needed IText (never-wrap, single line) for PDF-extracted text
// because it could only ever *approximate* how wide a line would render in
// a substituted web-safe font, and trusting that approximation for word-wrap
// caused lines to wrap unexpectedly and grow into the next line. A real DOM
// element measures and wraps its own text exactly, in the actual rendered
// font, every time -- so every text object here is simply a wrapping,
// auto-growing box, whether it came from the placement tool or from PDF
// extraction.

const MIN_SIZE = GRID_SIZE;
const HANDLE = 7; // corner/edge handle size, in PDF points (see note below)
const ROTATE_HANDLE_OFFSET = 22;

function isTextObj(o: PageObject): o is Extract<PageObject, { type: 'text' }> {
  return o.type === 'text';
}

// -- link-paste detection --------------------------------------------
// Same "is this a bare URL" + scheme-normalizing logic as Toolbar.tsx's
// LinkButton, duplicated locally rather than shared since there's no
// existing utils module both files pull from yet.
const BARE_URL_RE = /^[a-z][a-z0-9+.-]*:\/\/\S+$|^[\w-]+(\.[\w-]+)+(\/\S*)?$/i;

function isLikelyUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  return BARE_URL_RE.test(trimmed);
}

function withUrlScheme(text: string): string {
  const trimmed = text.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function objBounds(o: { x: number; y: number; width: number; height: number }): Bounds {
  return { x: o.x, y: o.y, width: o.width, height: o.height };
}

/** Keeps a box entirely within [0, page.width] x [0, page.height] -- shrinks
 * it first if it's bigger than the page in either dimension (this can never
 * actually happen from a resize, since resize deltas are already computed
 * relative to the page, but it's a cheap safety net for anything created
 * with a hardcoded size), then slides it back inside the page if any edge
 * is past the boundary. This is the *prevention* layer: it stops a drag,
 * resize, or newly-created object from ever being written to the store
 * out of bounds in the first place. The <clipPath> on the SVG's object
 * layer (see the render section below) is the *backstop* -- it guarantees
 * nothing ever renders outside the page even if some bounds slipped through
 * uncl amped (e.g. a text box whose content grows taller than expected). */
function clampBoundsToPage<T extends Bounds>(b: T, page: { width: number; height: number }): T {
  const width = Math.min(b.width, page.width);
  const height = Math.min(b.height, page.height);
  const x = Math.min(Math.max(b.x, 0), Math.max(0, page.width - width));
  const y = Math.min(Math.max(b.y, 0), Math.max(0, page.height - height));
  return { ...b, x, y, width, height };
}

/** Converts a pointer event's client coordinates into this SVG's own
 * user-coordinate space (PDF points). Goes through the SVG's screen<->user
 * transform rather than any manual scale math, so it stays correct no
 * matter what CSS size the page is currently displayed at. */
function toSvgPoint(svg: SVGSVGElement, clientX: number, clientY: number) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: clientX, y: clientY };
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

function rotateAttr(o: { x: number; y: number; width: number; height: number; rotation: number }) {
  if (!o.rotation) return undefined;
  const cx = o.x + o.width / 2;
  const cy = o.y + o.height / 2;
  return `rotate(${o.rotation} ${cx} ${cy})`;
}

type Mode = 'move' | 'resize' | 'rotate';
type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'e'; // 'e' = text width-only handle

interface Interaction {
  id: string;
  mode: Mode;
  handle?: Handle;
  startPointer: { x: number; y: number };
  startBounds: Bounds & { rotation: number };
  live: Bounds & { rotation: number };
  overlapping: boolean;
}

interface Drawing {
  startX: number;
  startY: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function PdfCanvas({ page, readOnly = false }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const updateObject = useEditorStore((s) => s.updateObject);
  const removeObject = useEditorStore((s) => s.removeObject);
  const addObject = useEditorStore((s) => s.addObject);
  const selectedObjectId = useEditorStore((s) => s.selectedObjectId);
  const setSelectedObjectId = useEditorStore((s) => s.setSelectedObjectId);
  const textPlacementActive = useEditorStore((s) => s.textPlacementActive);
  const setTextPlacementActive = useEditorStore((s) => s.setTextPlacementActive);

  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);

  // -- fit the whole page inside whatever space is actually available -----
  // A pure-CSS `width: min(100%, page.width)` + `aspect-ratio` only caps by
  // the container's WIDTH -- it never checks whether the resulting height
  // fits too. On a shorter/lower-resolution screen that let a page's full
  // (correct, uncapped) width render, the page could still run taller than
  // the visible area, forcing a scroll or a browser zoom-out to see the
  // bottom of the page -- which is exactly what showed up as "the whole
  // PDF isn't visible until I zoom." Fitting both axes at once -- and never
  // upscaling past the page's real point size -- needs the actual pixel
  // dimensions of the surrounding container, which only JS can measure.
  const [fitSize, setFitSize] = useState({ width: page.width, height: page.height });

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const container = wrapper.parentElement ?? wrapper;

    function recompute() {
      const style = window.getComputedStyle(container);
      const paddingX = parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0');
      const paddingY = parseFloat(style.paddingTop || '0') + parseFloat(style.paddingBottom || '0');
      const availableW = container.clientWidth - paddingX;
      const availableH = container.clientHeight - paddingY;
      if (availableW <= 0 || availableH <= 0) return;

      // Never upscale past the page's real size -- only shrink to fit,
      // same rule the old Fabric fitToContainer used, just now checking
      // height as well as width.
      const scale = Math.min(1, availableW / page.width, availableH / page.height);
      setFitSize({ width: page.width * scale, height: page.height * scale });
    }

    recompute();
    const resizeObserver = new ResizeObserver(recompute);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [page.width, page.height]);

  // Per-object refs to the live contentEditable div, so input/blur handlers
  // and the resize-triggered remeasure effect can read real rendered size
  // without waiting for a store round-trip.
  const textDivRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Last bounds a text/link object sat at *without* overlapping another
  // text/link object -- used to snap a drop back to safety if the drag/
  // resize the user just released would overlap something. Mirrors the
  // original Fabric implementation's revert-on-overlap behavior.
  const lastGoodBoundsRef = useRef<Map<string, Bounds>>(new Map());
  useEffect(() => {
    for (const obj of page.objects) {
      if (!lastGoodBoundsRef.current.has(obj.id)) {
        lastGoodBoundsRef.current.set(obj.id, objBounds(obj));
      }
    }
    for (const id of [...lastGoodBoundsRef.current.keys()]) {
      if (!page.objects.some((o) => o.id === id)) lastGoodBoundsRef.current.delete(id);
    }
  }, [page.objects]);

  // A newly-drawn text box should be focused and ready to type into
  // immediately, same as the old double-click-to-commit placeholder flow.
  const pendingFocusIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingFocusIdRef.current;
    if (!id) return;
    const el = textDivRefs.current.get(id);
    if (el) {
      pendingFocusIdRef.current = null;
      el.focus();
      const range = window.document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  });

  // -- live-preview bounds for whichever object is currently being
  // dragged/resized/rotated -- everything else renders straight from the
  // store.
  function liveBoundsFor(obj: PageObject) {
    if (interaction && interaction.id === obj.id) return interaction.live;
    return { x: obj.x, y: obj.y, width: obj.width, height: obj.height, rotation: obj.rotation };
  }

  // ---------------------------------------------------------------------
  // Move / resize / rotate
  // ---------------------------------------------------------------------

  const beginInteraction = useCallback(
    (obj: PageObject, mode: Mode, handle: Handle | undefined, clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg || readOnly) return;
      const p = toSvgPoint(svg, clientX, clientY);
      setSelectedObjectId(obj.id);
      setInteraction({
        id: obj.id,
        mode,
        handle,
        startPointer: p,
        startBounds: { x: obj.x, y: obj.y, width: obj.width, height: obj.height, rotation: obj.rotation },
        live: { x: obj.x, y: obj.y, width: obj.width, height: obj.height, rotation: obj.rotation },
        overlapping: false,
      });
    },
    [readOnly, setSelectedObjectId]
  );

  useEffect(() => {
    if (!interaction) return;
    const svg = svgRef.current;
    if (!svg) return;

    function onMove(e: PointerEvent) {
      setInteraction((cur) => {
        if (!cur) return cur;
        const p = toSvgPoint(svg!, e.clientX, e.clientY);
        const dx = p.x - cur.startPointer.x;
        const dy = p.y - cur.startPointer.y;
        const obj = page.objects.find((o) => o.id === cur.id);
        if (!obj) return cur;

        let next: Bounds & { rotation: number } = cur.startBounds;

        if (cur.mode === 'move') {
          next = {
            ...cur.startBounds,
            x: snapToGrid(cur.startBounds.x + dx),
            y: snapToGrid(cur.startBounds.y + dy),
          };
        } else if (cur.mode === 'resize') {
          const sb = cur.startBounds;
          if (cur.handle === 'e') {
            // Text width-only handle -- height stays content-driven.
            const w = Math.max(MIN_SIZE, snapToGrid(sb.width + dx));
            next = { ...sb, width: w };
          } else {
            let { x, y, width, height } = sb;
            if (cur.handle?.includes('e')) width = Math.max(MIN_SIZE, snapToGrid(sb.width + dx));
            if (cur.handle?.includes('s')) height = Math.max(MIN_SIZE, snapToGrid(sb.height + dy));
            if (cur.handle?.includes('w')) {
              const newW = Math.max(MIN_SIZE, snapToGrid(sb.width - dx));
              x = sb.x + (sb.width - newW);
              width = newW;
            }
            if (cur.handle?.includes('n')) {
              const newH = Math.max(MIN_SIZE, snapToGrid(sb.height - dy));
              y = sb.y + (sb.height - newH);
              height = newH;
            }
            next = { ...sb, x, y, width, height };
          }
        } else if (cur.mode === 'rotate') {
          const cx = cur.startBounds.x + cur.startBounds.width / 2;
          const cy = cur.startBounds.y + cur.startBounds.height / 2;
          const angle = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
          next = { ...cur.startBounds, rotation: Math.round(angle) };
        }

        // Move/resize can never leave the page -- rotation is left alone
        // here (rotating in place doesn't change x/y/width/height), any
        // visual overflow a rotation causes is caught by the clip backstop.
        if (cur.mode === 'move' || cur.mode === 'resize') {
          next = { ...clampBoundsToPage(next, page), rotation: next.rotation };
        }

        let overlapping = false;
        if (isTextObj(obj)) {
          const candidate = { x: next.x, y: next.y, width: next.width, height: next.height };
          overlapping = page.objects.some(
            (o) => o.id !== obj.id && isTextObj(o) && boundsOverlap(candidate, objBounds(o), OVERLAP_PAD)
          );
        }

        return { ...cur, live: next, overlapping };
      });
    }

    function onUp() {
      setInteraction((cur) => {
        if (!cur) return null;
        const obj = page.objects.find((o) => o.id === cur.id);
        if (!obj) return null;

        let final = cur.live;

        if (isTextObj(obj) && cur.overlapping) {
          // Revert to the last position/size this object had without
          // overlapping anything, rather than committing an overlapping drop.
          const fallback = lastGoodBoundsRef.current.get(obj.id);
          if (fallback) final = { ...final, ...fallback };
        }

        final = { ...clampBoundsToPage(final, page), rotation: final.rotation };

        lastGoodBoundsRef.current.set(obj.id, {
          x: final.x,
          y: final.y,
          width: final.width,
          height: final.height,
        });

        updateObject(page.id, obj.id, {
          x: final.x,
          y: final.y,
          width: final.width,
          height: final.height,
          rotation: final.rotation,
        });

        return null;
      });
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interaction !== null]);

  // ---------------------------------------------------------------------
  // Text: live height + push-down reflow while typing
  // ---------------------------------------------------------------------
  // A contentEditable div's scrollHeight, measured here, comes out already
  // in PDF-point units: foreignObject content is laid out in the SVG's own
  // user-coordinate system (1 unit == 1 point), and that layout is
  // untouched by whatever CSS scale the outer <svg> is displayed at. So no
  // unit conversion is needed before writing it back into the store.
  const pushDownText = useCallback(
    (editedId: string, editedBounds: Bounds) => {
      const others = page.objects.filter((o) => o.id !== editedId && isTextObj(o));
      const boundsById = new Map<string, Bounds>();
      boundsById.set(editedId, editedBounds);
      for (const o of others) boundsById.set(o.id, objBounds(o));

      for (let pass = 0; pass < 5; pass++) {
        const sorted = [editedId, ...others.map((o) => o.id)].sort(
          (a, b) => boundsById.get(a)!.y - boundsById.get(b)!.y
        );
        let pushedAny = false;

        for (let i = 0; i < sorted.length; i++) {
          for (let j = i + 1; j < sorted.length; j++) {
            const upper = boundsById.get(sorted[i])!;
            const lowerId = sorted[j];
            const lower = boundsById.get(lowerId)!;

            const horizontallyOverlaps =
              upper.x < lower.x + lower.width + OVERLAP_PAD && upper.x + upper.width + OVERLAP_PAD > lower.x;
            if (!horizontallyOverlaps) continue;

            const overlapAmount = upper.y + upper.height + OVERLAP_PAD - lower.y;
            if (overlapAmount > 0) {
              const newTop = snapToGrid(lower.y + overlapAmount);
              boundsById.set(lowerId, { ...lower, y: newTop });
              if (lowerId !== editedId) updateObject(page.id, lowerId, { y: newTop });
              pushedAny = true;
            }
          }
        }
        if (!pushedAny) break;
      }
    },
    [page.id, page.objects, updateObject]
  );

  function handleTextInput(obj: PageObject, el: HTMLDivElement) {
    const newHeight = Math.max(MIN_SIZE, el.scrollHeight);
    if (newHeight !== obj.height) {
      updateObject(page.id, obj.id, { height: newHeight });
    }
    pushDownText(obj.id, { x: obj.x, y: obj.y, width: obj.width, height: newHeight });
  }

  function handleTextBlur(obj: PageObject, el: HTMLDivElement) {
    const text = el.textContent ?? '';
    updateObject(page.id, obj.id, { text });
  }

  // Pasting into a text box always inserts plain text (never whatever rich
  // HTML formatting the source page/app put on the clipboard, e.g. pasting
  // from a Google Doc) -- and as a special case, pasting a bare URL into a
  // box that's still empty turns that box into an actual link: styled and
  // clickable, not just URL-shaped text. A URL pasted into a box that
  // already has other text just inserts as plain text instead, since a
  // text object only carries one `link` for its entire contents (same
  // model PDF extraction uses -- see pdfUpload.ts) -- setting the whole
  // box's link when the paste only replaces part of it would incorrectly
  // make surrounding, unrelated text clickable too.
  function handleTextPaste(obj: PageObject, el: HTMLDivElement, e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text/plain');
    if (!pasted) return;

    const isEmpty = el.textContent === '' || el.textContent === null;
    if (isEmpty && isLikelyUrl(pasted)) {
      const url = withUrlScheme(pasted);
      el.textContent = pasted.trim();
      updateObject(page.id, obj.id, { text: pasted.trim(), link: url });
      // Move the caret to the end of the inserted text, matching where a
      // normal paste would leave it.
      const range = window.document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      return;
    }

    // Plain-text insert at the current caret position -- fires a normal
    // 'input' event, so handleTextInput's height/reflow logic still runs.
    window.document.execCommand('insertText', false, pasted);
  }

  // Remeasure height after a width-resize (re-wrapping can change how many
  // lines the text takes).
  useEffect(() => {
    for (const obj of page.objects) {
      if (!isTextObj(obj)) continue;
      const el = textDivRefs.current.get(obj.id);
      if (!el || window.document.activeElement === el) continue;
      const h = Math.max(MIN_SIZE, el.scrollHeight);
      if (h !== obj.height) updateObject(page.id, obj.id, { height: h });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.objects.map((o) => `${o.id}:${o.width}`).join(',')]);

  // Sync textContent when it changes externally (undo, programmatic edits)
  // -- never while the user is actively editing that element, to avoid
  // yanking the cursor mid-type.
  useEffect(() => {
    for (const obj of page.objects) {
      if (!isTextObj(obj)) continue;
      const el = textDivRefs.current.get(obj.id);
      if (!el || window.document.activeElement === el) continue;
      if (el.textContent !== obj.text) el.textContent = obj.text;
    }
  }, [page.objects]);

  // ---------------------------------------------------------------------
  // Text placement tool: drag out a box on empty canvas, then type
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!textPlacementActive || readOnly) return;
    const svg = svgRef.current;
    if (!svg) return;

    function onDown(e: PointerEvent) {
      if (e.target !== svg) return; // only start on empty canvas, not on an object
      const p = toSvgPoint(svg!, e.clientX, e.clientY);
      setDrawing({ startX: p.x, startY: p.y, x: p.x, y: p.y, width: 0, height: 0 });
    }
    function onMove(e: PointerEvent) {
      setDrawing((d) => {
        if (!d) return d;
        const p = toSvgPoint(svg!, e.clientX, e.clientY);
        return {
          ...d,
          x: Math.min(d.startX, p.x),
          y: Math.min(d.startY, p.y),
          width: Math.abs(p.x - d.startX),
          height: Math.abs(p.y - d.startY),
        };
      });
    }
    function onUp() {
      setDrawing((d) => {
        if (!d) return null;
        let width = d.width < 10 ? 160 : d.width;
        let height = d.height < 10 ? 32 : d.height;
        width = Math.max(MIN_SIZE, snapToGrid(width));
        height = Math.max(MIN_SIZE, snapToGrid(height));

        const existingText = page.objects.filter(isTextObj).map(objBounds);
        const placedRaw = findFreeGridSlot(
          { x: d.x, y: d.y },
          { width, height },
          existingText,
          { width: page.width, height: page.height }
        );
        const placed = clampBoundsToPage({ ...placedRaw, width, height }, page);

        const id = nanoid();
        pendingFocusIdRef.current = id;
        addObject(page.id, {
          id,
          type: 'text',
          x: placed.x,
          y: placed.y,
          width: placed.width,
          height: placed.height,
          rotation: 0,
          opacity: 1,
          text: '',
          fontSize: 14,
          fontFamily: 'Helvetica',
          color: '#111111',
          bold: false,
          italic: false,
          strikethrough: false,
          align: 'left',
        } as PageObject);
        lastGoodBoundsRef.current.set(id, { x: placed.x, y: placed.y, width: placed.width, height: placed.height });
        setSelectedObjectId(id);
        setTextPlacementActive(false);
        return null;
      });
    }

    svg.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      svg.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textPlacementActive, readOnly, page.id, page.objects, page.width, page.height]);

  // ---------------------------------------------------------------------
  // Delete key
  // ---------------------------------------------------------------------

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const active = window.document.activeElement;
      const isEditingText = !!active && (active as HTMLElement).isContentEditable;
      if (isEditingText) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!selectedObjectId) return;
      e.preventDefault();
      removeObject(page.id, selectedObjectId);
      textDivRefs.current.delete(selectedObjectId);
      setSelectedObjectId(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [page.id, selectedObjectId, removeObject, setSelectedObjectId]);

  // ---------------------------------------------------------------------
  // Paste a URL onto the canvas itself (nothing focused) -- drops a new,
  // ready-made link text object rather than doing nothing. Pasting into an
  // already-focused text box is handled locally by handleTextPaste above;
  // this only fires when that's NOT the case, so a paste never gets
  // handled twice.
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (readOnly) return;

    function onPaste(e: ClipboardEvent) {
      const active = window.document.activeElement;
      const isEditingText = !!active && (active as HTMLElement).isContentEditable;
      if (isEditingText) return; // handleTextPaste already owns this case

      const pasted = e.clipboardData?.getData('text/plain');
      if (!pasted || !isLikelyUrl(pasted)) return;

      e.preventDefault();
      const url = withUrlScheme(pasted);
      const size = { width: Math.min(200, page.width), height: Math.min(24, page.height) };
      const existingText = page.objects.filter(isTextObj).map(objBounds);
      const placedRaw = findFreeGridSlot(
        { x: 80, y: 80 },
        size,
        existingText,
        { width: page.width, height: page.height }
      );
      const placed = clampBoundsToPage({ ...placedRaw, ...size }, page);

      const id = nanoid();
      addObject(page.id, {
        id,
        type: 'text',
        x: placed.x,
        y: placed.y,
        width: placed.width,
        height: placed.height,
        rotation: 0,
        opacity: 1,
        text: pasted.trim(),
        fontSize: 14,
        fontFamily: 'Helvetica',
        color: '#1a73e8',
        bold: false,
        italic: false,
        strikethrough: false,
        align: 'left',
        link: url,
      } as PageObject);
      lastGoodBoundsRef.current.set(id, { x: placed.x, y: placed.y, width: placed.width, height: placed.height });
      setSelectedObjectId(id);
    }

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [readOnly, page.id, page.objects, page.width, page.height, addObject, setSelectedObjectId]);

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  function renderHandles(obj: PageObject, bounds: Bounds & { rotation: number }) {
    if (readOnly || selectedObjectId !== obj.id || interaction) return null;
    const { x, y, width, height } = bounds;
    const corners: { id: Handle; cx: number; cy: number; cursor: string }[] = isTextObj(obj)
      ? [{ id: 'e', cx: x + width, cy: y + height / 2, cursor: 'ew-resize' }]
      : [
          { id: 'nw', cx: x, cy: y, cursor: 'nwse-resize' },
          { id: 'ne', cx: x + width, cy: y, cursor: 'nesw-resize' },
          { id: 'sw', cx: x, cy: y + height, cursor: 'nesw-resize' },
          { id: 'se', cx: x + width, cy: y + height, cursor: 'nwse-resize' },
        ];

    return (
      <g transform={rotateAttr(bounds)}>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill="none"
          stroke="#3380cc"
          strokeWidth={1}
          pointerEvents="none"
        />
        {corners.map((c) => (
          <rect
            key={c.id}
            x={c.cx - HANDLE / 2}
            y={c.cy - HANDLE / 2}
            width={HANDLE}
            height={HANDLE}
            fill="#fff"
            stroke="#3380cc"
            strokeWidth={1}
            style={{ cursor: c.cursor }}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.target as Element).setPointerCapture(e.pointerId);
              beginInteraction(obj, 'resize', c.id, e.clientX, e.clientY);
            }}
          />
        ))}
        {!isTextObj(obj) && (
          <circle
            cx={x + width / 2}
            cy={y - ROTATE_HANDLE_OFFSET}
            r={HANDLE / 2 + 1}
            fill="#fff"
            stroke="#3380cc"
            strokeWidth={1}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.target as Element).setPointerCapture(e.pointerId);
              beginInteraction(obj, 'rotate', undefined, e.clientX, e.clientY);
            }}
          />
        )}
      </g>
    );
  }

  function renderObject(obj: PageObject) {
    const bounds = liveBoundsFor(obj);
    const overlapWarn = interaction?.id === obj.id && interaction.overlapping;

    const commonPointerDown = (e: React.PointerEvent) => {
      if (readOnly) return;
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        const link = isTextObj(obj) ? obj.link : undefined;
        if (link) {
          window.open(link, '_blank', 'noopener,noreferrer');
          return;
        }
      }
      (e.target as Element).setPointerCapture(e.pointerId);
      beginInteraction(obj, 'move', undefined, e.clientX, e.clientY);
    };

    if (obj.type === 'image') {
      return (
        <g key={obj.id} transform={rotateAttr(bounds)}>
          <image
            href={obj.src}
            x={bounds.x}
            y={bounds.y}
            width={bounds.width}
            height={bounds.height}
            opacity={obj.opacity}
            style={{ cursor: readOnly ? 'default' : 'move' }}
            onPointerDown={commonPointerDown}
            onClick={() => !readOnly && setSelectedObjectId(obj.id)}
          />
        </g>
      );
    }

    if (obj.type === 'rect') {
      return (
        <g key={obj.id} transform={rotateAttr(bounds)}>
          <rect
            x={bounds.x}
            y={bounds.y}
            width={bounds.width}
            height={bounds.height}
            rx={obj.cornerRadius}
            ry={obj.cornerRadius}
            fill={obj.fill ?? 'transparent'}
            stroke={obj.stroke}
            strokeWidth={obj.strokeWidth}
            opacity={obj.opacity}
            style={{ cursor: readOnly ? 'default' : 'move' }}
            onPointerDown={commonPointerDown}
            onClick={() => !readOnly && setSelectedObjectId(obj.id)}
          />
        </g>
      );
    }

    if (obj.type === 'ellipse') {
      const cx = bounds.x + bounds.width / 2;
      const cy = bounds.y + bounds.height / 2;
      return (
        <g key={obj.id} transform={rotateAttr(bounds)}>
          <ellipse
            cx={cx}
            cy={cy}
            rx={bounds.width / 2}
            ry={bounds.height / 2}
            fill={obj.fill ?? 'transparent'}
            stroke={obj.stroke}
            strokeWidth={obj.strokeWidth}
            opacity={obj.opacity}
            style={{ cursor: readOnly ? 'default' : 'move' }}
            onPointerDown={commonPointerDown}
            onClick={() => !readOnly && setSelectedObjectId(obj.id)}
          />
        </g>
      );
    }

    if (obj.type === 'line') {
      return (
        <g key={obj.id}>
          <line
            x1={obj.x}
            y1={obj.y}
            x2={obj.x + obj.width}
            y2={obj.y + obj.height}
            stroke={obj.stroke}
            strokeWidth={obj.strokeWidth}
            opacity={obj.opacity}
            style={{ cursor: readOnly ? 'default' : 'move' }}
            onPointerDown={commonPointerDown}
            onClick={() => !readOnly && setSelectedObjectId(obj.id)}
          />
        </g>
      );
    }

    if (!isTextObj(obj)) {
      // Anything that isn't image/rect/ellipse/line/text (e.g. a group
      // object) isn't wired up yet. Skip it rather than error, so the rest
      // of the page still renders -- send over the shape of that variant
      // and I'll add real support for it.
      return null;
    }

    // text
    const t = obj;
    return (
      <g key={t.id}>
        <foreignObject
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={Math.max(bounds.height, MIN_SIZE)}
          transform={rotateAttr(bounds)}
          style={{ overflow: 'visible' }}
        >
          <div
            ref={(el) => {
              if (el) textDivRefs.current.set(t.id, el);
              else textDivRefs.current.delete(t.id);
            }}
            contentEditable={!readOnly}
            suppressContentEditableWarning
            onPointerDown={(e) => {
              // A single pointerdown both selects/starts a potential drag
              // AND has to let normal text-caret placement/typing work when
              // the box is already focused -- only hijack it into a drag
              // when the element isn't already being edited.
              if (readOnly) return;
              if (e.ctrlKey || e.metaKey) {
                if (t.link) {
                  e.preventDefault();
                  window.open(t.link, '_blank', 'noopener,noreferrer');
                }
                return;
              }
              if (window.document.activeElement === e.currentTarget) return;
              e.preventDefault();
              setSelectedObjectId(t.id);
              beginInteraction(t, 'move', undefined, e.clientX, e.clientY);
            }}
            onDoubleClick={(e) => {
              // pointerdown above calls preventDefault() to stop a click
              // from focusing the div (so a single click drags instead of
              // editing) -- that also suppresses the browser's native
              // double-click-to-focus/select-word behavior, so entering
              // edit mode has to be done by hand here: focus the div, then
              // drop the caret at the point that was actually clicked
              // (falling back to the end of the text if the browser
              // doesn't support caret-from-point).
              if (readOnly) return;
              e.stopPropagation();
              const el = e.currentTarget;
              setSelectedObjectId(t.id);
              el.focus();

              const sel = window.getSelection();
              const docWithCaret = window.document as Document & {
                caretRangeFromPoint?: (x: number, y: number) => Range | null;
                caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
              };

              let range: Range | null = null;
              if (docWithCaret.caretRangeFromPoint) {
                range = docWithCaret.caretRangeFromPoint(e.clientX, e.clientY);
              } else if (docWithCaret.caretPositionFromPoint) {
                const pos = docWithCaret.caretPositionFromPoint(e.clientX, e.clientY);
                if (pos) {
                  range = window.document.createRange();
                  range.setStart(pos.offsetNode, pos.offset);
                  range.collapse(true);
                }
              }
              if (!range) {
                range = window.document.createRange();
                range.selectNodeContents(el);
                range.collapse(false); // fall back to caret at the end
              }
              sel?.removeAllRanges();
              sel?.addRange(range);
            }}
            onInput={(e) => handleTextInput(t, e.currentTarget)}
            onBlur={(e) => handleTextBlur(t, e.currentTarget)}
            onPaste={(e) => handleTextPaste(t, e.currentTarget, e)}
            style={{
              width: '100%',
              minHeight: MIN_SIZE,
              boxSizing: 'border-box',
              fontFamily: t.fontFamily,
              fontSize: t.fontSize,
              fontWeight: t.bold ? 'bold' : 'normal',
              fontStyle: t.italic ? 'italic' : 'normal',
              textDecoration: [t.strikethrough && 'line-through', t.link && 'underline']
                .filter(Boolean)
                .join(' '),
              color: t.color,
              textAlign: t.align as React.CSSProperties['textAlign'],
              cursor: t.link ? 'pointer' : readOnly ? 'default' : 'text',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'break-word',
              outline: overlapWarn ? '1px solid #cc3333' : 'none',
              background: 'transparent',
            }}
          />
        </foreignObject>
      </g>
    );
  }

  const selectedObj = page.objects.find((o) => o.id === selectedObjectId);
  // Unique per page (not per object) since a clip only needs to describe
  // the page rectangle once -- ids must be unique in the document, and
  // page.id already is.
  const clipId = `page-clip-${page.id}`;

  return (
    <div
      ref={wrapperRef}
      style={{
        width: fitSize.width,
        height: fitSize.height,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        background: '#fff',
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${page.width} ${page.height}`}
        width="100%"
        height="100%"
        style={{ display: 'block', cursor: textPlacementActive ? 'crosshair' : 'default' }}
        onPointerDown={(e) => {
          if (e.target === svgRef.current) setSelectedObjectId(null);
        }}
      >
        <defs>
          {/* The hard guarantee: no matter what bounds an object ends up
              with -- a drag/resize that somehow slipped past the
              clampBoundsToPage prevention above, a text box that grew
              taller than the remaining space on the page while someone
              was typing, a rotated shape whose corner swings past an
              edge -- nothing inside the clipped group below can ever
              paint outside this rectangle. This is what makes "text can
              never go past the border" actually true rather than just
              usually true. */}
          <clipPath id={clipId}>
            <rect x={0} y={0} width={page.width} height={page.height} />
          </clipPath>
        </defs>

        {page.backgroundImage && (
          <image
            href={page.backgroundImage}
            x={0}
            y={0}
            width={page.width}
            height={page.height}
            preserveAspectRatio="none"
            pointerEvents="none"
          />
        )}

        <g clipPath={`url(#${clipId})`}>{page.objects.map(renderObject)}</g>

        {/* Selection handles render outside the clip, deliberately --
            otherwise a handle on an object sitting flush against an edge
            (or the rotate handle, which sits above the object) would get
            cropped away and become impossible to grab. */}
        {selectedObj && !interaction && renderHandles(selectedObj, liveBoundsFor(selectedObj))}

        {drawing && (
          <rect
            x={drawing.x}
            y={drawing.y}
            width={drawing.width}
            height={drawing.height}
            fill="rgba(51, 128, 204, 0.08)"
            stroke="#3380cc"
            strokeWidth={1}
            strokeDasharray="4,4"
            pointerEvents="none"
          />
        )}
      </svg>
    </div>
  );
}