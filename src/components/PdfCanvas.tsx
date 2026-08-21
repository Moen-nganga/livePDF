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
// How far the pointer has to move (in PDF points) before an interaction
// counts as a real drag rather than a plain click. Below this, nothing
// about the object's stored bounds is touched -- see the Interaction.moved
// comment for why this matters.
const CLICK_DRAG_THRESHOLD = 3;

function isTextObj(o: PageObject): o is Extract<PageObject, { type: 'text' }> {
  return o.type === 'text';
}

// Used alongside isTextObj to identify rects specifically -- needed so both
// the resize handler and renderHandles below can single out underline bars
// (RectObject.isUnderline) and treat them as length-only: no vertical
// resize component, and only left/right handles rather than four corners.
function isRectObj(o: PageObject): o is Extract<PageObject, { type: 'rect' }> {
  return o.type === 'rect';
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
  // When the (possibly just-shrunk) width/height still fills the entire
  // page, the "valid range" for x/y -- [0, page.width - width] -- collapses
  // to the single point 0. Previously x/y were unconditionally clamped into
  // that range, which meant an object whose stored width happened to be
  // >= page.width (this can happen for PDF-extracted text lines -- see
  // pdfUpload.ts's paddedWidth) got its x silently forced to 0 on every
  // single move/resize, with no way to ever drag it away from the left
  // edge again: the same oversized width kept re-triggering the same
  // collapse forever. There's no x that keeps a too-wide box fully
  // on-page, so in that case we leave position untouched instead of
  // picking an arbitrary (and sticky) 0 -- the SVG clipPath backstop
  // still guarantees nothing paints past the page edge either way.
  const x = width >= page.width ? b.x : Math.min(Math.max(b.x, 0), page.width - width);
  const y = height >= page.height ? b.y : Math.min(Math.max(b.y, 0), page.height - height);
  return { ...b, x, y, width, height };
}

// -- text overflow -> next page -----------------------------------------
// A lazily-created, reused, hidden div for measuring how tall a candidate
// string of text would render at a given width/font -- kept off in the
// corner of the viewport rather than inside the SVG, since a plain CSS
// pixel here means exactly the same thing a "point" does everywhere else
// in this file (foreignObject content already lays out 1 SVG user-unit =
// 1 CSS px; a detached div outside any SVG uses that same literal px
// value with no extra scaling either -- so no unit conversion is needed
// between the two).
let measureDiv: HTMLDivElement | null = null;

function getMeasureDiv(): HTMLDivElement {
  if (!measureDiv) {
    measureDiv = window.document.createElement('div');
    measureDiv.style.position = 'fixed';
    measureDiv.style.left = '-99999px';
    measureDiv.style.top = '0';
    measureDiv.style.visibility = 'hidden';
    measureDiv.style.whiteSpace = 'pre-wrap';
    measureDiv.style.overflowWrap = 'break-word';
    measureDiv.style.boxSizing = 'border-box';
    window.document.body.appendChild(measureDiv);
  }
  return measureDiv;
}

interface TextStyleForMeasure {
  width: number;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
}

function measureTextHeight(text: string, style: TextStyleForMeasure): number {
  const div = getMeasureDiv();
  div.style.width = `${style.width}px`;
  div.style.fontFamily = style.fontFamily;
  div.style.fontSize = `${style.fontSize}px`;
  div.style.fontWeight = style.bold ? 'bold' : 'normal';
  div.style.fontStyle = style.italic ? 'italic' : 'normal';
  div.textContent = text;
  return div.scrollHeight;
}

// A second, dedicated hidden div for single-line "how wide would this text
// render with no wrapping at all" measurements -- kept separate from
// getMeasureDiv() above (used for wrap/height measurement) rather than
// toggling one div's white-space back and forth, so there's no risk of one
// measurement's temporary style changes leaking into the other's result.
let measureLineDiv: HTMLDivElement | null = null;

function getMeasureLineDiv(): HTMLDivElement {
  if (!measureLineDiv) {
    measureLineDiv = window.document.createElement('div');
    measureLineDiv.style.position = 'fixed';
    measureLineDiv.style.left = '-99999px';
    measureLineDiv.style.top = '0';
    measureLineDiv.style.visibility = 'hidden';
    measureLineDiv.style.whiteSpace = 'pre';
    measureLineDiv.style.width = 'max-content';
    window.document.body.appendChild(measureLineDiv);
  }
  return measureLineDiv;
}

/** How wide `text` would render as one unbroken line, in the given font --
 * used only to decide how tightly the selection outline should hug a text
 * object's actual content (see renderHandles). Not used for anything that
 * affects layout/storage: a text object's real, wrappable width is a
 * completely separate concern this never touches. */
function measureNaturalTextWidth(text: string, style: Omit<TextStyleForMeasure, 'width'>): number {
  const div = getMeasureLineDiv();
  div.style.fontFamily = style.fontFamily;
  div.style.fontSize = `${style.fontSize}px`;
  div.style.fontWeight = style.bold ? 'bold' : 'normal';
  div.style.fontStyle = style.italic ? 'italic' : 'normal';
  div.textContent = text;
  return div.scrollWidth;
}

/** Finds how much of `text` fits within `maxHeight` at the given box style,
 * splitting on whitespace boundaries (never mid-word) so the break reads
 * naturally when the remainder continues on the next page. Binary-searches
 * over token count rather than characters -- far fewer reflows for the
 * same result, since wrapped-text height is monotonic in token count. */
function splitTextToFit(
  text: string,
  style: TextStyleForMeasure,
  maxHeight: number
): { fitText: string; overflowText: string } {
  if (measureTextHeight(text, style) <= maxHeight) {
    return { fitText: text, overflowText: '' };
  }

  // Odd indices are the whitespace runs themselves, so
  // tokens.slice(0, k).join('') always reconstructs an exact prefix of the
  // original string -- no information (or spacing) is lost by splitting.
  const tokens = text.split(/(\s+)/);
  let lo = 0;
  let hi = tokens.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = tokens.slice(0, mid).join('');
    if (measureTextHeight(candidate, style) <= maxHeight) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  const fitText = tokens.slice(0, lo).join('');
  // Drop the leading whitespace run the split landed on -- it was a
  // natural break point, not content the next page's box should start with.
  const overflowText = tokens.slice(lo).join('').replace(/^\s+/, '');
  return { fitText, overflowText };
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
// 'e' = text width-only handle (right edge). 'w' = underline width-only
// handle (left edge) -- underlines get both 'e' and 'w' (see renderHandles)
// so length can be adjusted from either side, instead of the four corner
// handles regular rects/ellipses/images get.
type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'e' | 'w';

interface Interaction {
  id: string;
  mode: Mode;
  handle?: Handle;
  startPointer: { x: number; y: number };
  startBounds: Bounds & { rotation: number };
  live: Bounds & { rotation: number };
  overlapping: boolean;
  // True once the pointer has moved past CLICK_DRAG_THRESHOLD since this
  // interaction began. A plain click -- pointerdown then pointerup with
  // little or no movement -- should only select the object, never touch
  // its stored position/size: without this, even a dx/dy of 0 still ran
  // through snapToGrid() unconditionally, which visibly nudged any object
  // not already sitting on a grid line (i.e. nearly every PDF-extracted
  // text object, whose real coordinates are essentially never grid-
  // aligned) on every single click.
  moved: boolean;
  // The most recent `live` bounds during this interaction that did NOT
  // overlap another text/link object. Updated every move as long as
  // `live` is currently valid. Lets onUp fall back to "the last spot
  // along this exact drag that was still fine" instead of a possibly
  // far-away, stale position -- see onUp for details.
  lastValidLive: Bounds & { rotation: number };
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

  const doc = useEditorStore((s) => s.document); // named `doc`, not `document` -- this file uses window.document.* throughout for real DOM APIs (createRange, getSelection, etc.), and shadowing the global with the store's document would make those calls easy to misread
  const activePageIndex = useEditorStore((s) => s.activePageIndex);
  const setActivePageIndex = useEditorStore((s) => s.setActivePageIndex);
  const updateObject = useEditorStore((s) => s.updateObject);
  const removeObject = useEditorStore((s) => s.removeObject);
  const addObject = useEditorStore((s) => s.addObject);
  const addPages = useEditorStore((s) => s.addPages);
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
  // Also used when text flows onto a new page mid-typing (see
  // handleTextInput below) -- there the cursor needs to land at the END
  // of the carried-over text, not select all of it, so typing continues
  // seamlessly instead of overwriting what just flowed over.
  const pendingFocusRef = useRef<{ id: string; placement: 'select-all' | 'end' } | null>(null);
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const el = textDivRefs.current.get(pending.id);
    if (el) {
      pendingFocusRef.current = null;
      el.focus();
      const range = window.document.createRange();
      range.selectNodeContents(el);
      if (pending.placement === 'end') range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  });

  // When handleTextInput below flows text onto a new page mid-keystroke,
  // the box being typed into unmounts as the view switches pages -- which
  // can (browser-dependent) fire a native blur on its way out. Without
  // this guard, handleTextBlur's own overflow check would see the same
  // already-over-the-limit content a second time and duplicate the
  // overflow text onto the new page again. Keyed by the DOM element itself
  // (not the object id) so it needs no manual cleanup -- the entry is
  // simply unreachable once the element is garbage collected after unmount.
  const liveOverflowHandledRef = useRef(new WeakSet<HTMLDivElement>());

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
      const startBounds = { x: obj.x, y: obj.y, width: obj.width, height: obj.height, rotation: obj.rotation };
      setInteraction({
        id: obj.id,
        mode,
        handle,
        startPointer: p,
        startBounds,
        live: startBounds,
        overlapping: false,
        moved: false,
        lastValidLive: startBounds,
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

        const moved = cur.moved || Math.hypot(dx, dy) >= CLICK_DRAG_THRESHOLD;
        if (!moved) {
          // Still within click-jitter range -- don't touch bounds at all
          // yet (not even via clamping/snapping), so a plain click never
          // has any visible or stored effect on the object.
          return cur.moved === moved ? cur : { ...cur, moved };
        }

        let next: Bounds & { rotation: number } = cur.startBounds;

        if (cur.mode === 'move') {
          next = {
            ...cur.startBounds,
            x: snapToGrid(cur.startBounds.x + dx),
            y: snapToGrid(cur.startBounds.y + dy),
          };
        } else if (cur.mode === 'resize') {
          const sb = cur.startBounds;
          // Underline bars (RectObject.isUnderline) are only ever meant to
          // change LENGTH -- thickness is picker-only, set from
          // Toolbar.tsx's UnderlineThicknessPicker, never from a canvas
          // drag. Regardless of which handle triggered this (renderHandles
          // only ever gives an underline 'e'/'w' handles, but this check
          // doesn't rely on that -- it holds even if a handle id it
          // doesn't recognize somehow reaches here), only the x/width
          // component is ever applied; height and y are left exactly as
          // they started.
          if (isRectObj(obj) && obj.isUnderline) {
            let { x, width } = sb;
            if (cur.handle?.includes('e')) width = Math.max(MIN_SIZE, snapToGrid(sb.width + dx));
            if (cur.handle?.includes('w')) {
              const newW = Math.max(MIN_SIZE, snapToGrid(sb.width - dx));
              x = sb.x + (sb.width - newW);
              width = newW;
            }
            next = { ...sb, x, width };
          } else if (cur.handle === 'e') {
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

        // Keep a running "last spot along this drag that was actually
        // fine" -- see the Interaction.lastValidLive field comment.
        const lastValidLive = overlapping ? cur.lastValidLive : next;

        return { ...cur, live: next, overlapping, moved, lastValidLive };
      });
    }

    function onUp() {
      setInteraction((cur) => {
        if (!cur) return null;
        const obj = page.objects.find((o) => o.id === cur.id);
        if (!obj) return null;

        if (!cur.moved) {
          // Plain click -- selection already happened on pointerdown (see
          // beginInteraction), and nothing about the object's stored
          // bounds was ever touched, so there's nothing to commit here.
          return null;
        }

        let final = cur.live;

        if (isTextObj(obj) && cur.overlapping) {
          // Land on the last position/size THIS drag actually passed
          // through without overlapping anything, rather than teleporting
          // all the way back to wherever the object started. This is what
          // makes the box feel like it "stops" right at the boundary the
          // user pushed it up against, instead of snapping back to square
          // one. Only if this drag never had a single valid moment (e.g.
          // it started already overlapping, from bad/legacy data) do we
          // fall back to the last confirmed-good bounds from a previous
          // interaction.
          final = { ...final, ...(cur.lastValidLive ?? lastGoodBoundsRef.current.get(obj.id)) };
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

  // Corrects any text object whose real rendered height doesn't match its
  // stored height, then cascades push-downs across the WHOLE page -- same
  // sweep as pushDownText above, just applied to every text object at
  // once rather than one edited object. This exists because pushDownText
  // only ever runs reactively, in response to typing (see handleTextInput
  // below) -- content that arrives already-typed, like a freshly uploaded
  // PDF, never goes through it at all. If pdfUpload.ts's extracted height
  // for even one line is slightly off (a very plausible rounding error
  // once a substitute web-safe font's metrics are close, but not
  // identical, to whatever font the PDF actually embedded), that box
  // silently overlapped whatever sat below it, with nothing to ever
  // correct it -- since nothing you do short of editing that exact object
  // would trigger a remeasure. Runs once whenever a page is loaded/
  // switched to; if everything's already consistent (the common case for
  // a page that's been interacted with) it's a fast no-op.
  const reflowAllText = useCallback(() => {
    const textObjs = page.objects.filter(isTextObj);
    if (textObjs.length === 0) return;

    const boundsById = new Map<string, Bounds>();
    let anyHeightChanged = false;

    for (const obj of textObjs) {
      const trueHeight = Math.max(
        MIN_SIZE,
        measureTextHeight(obj.text, {
          width: obj.width,
          fontFamily: obj.fontFamily,
          fontSize: obj.fontSize,
          bold: obj.bold,
          italic: obj.italic,
        })
      );
      boundsById.set(obj.id, { x: obj.x, y: obj.y, width: obj.width, height: trueHeight });
      if (Math.abs(trueHeight - obj.height) > 0.5) {
        updateObject(page.id, obj.id, { height: trueHeight });
        anyHeightChanged = true;
      }
    }

    if (!anyHeightChanged) return; // every stored height was already correct

    for (let pass = 0; pass < 8; pass++) {
      const sorted = [...textObjs].sort((a, b) => boundsById.get(a.id)!.y - boundsById.get(b.id)!.y);
      let pushedAny = false;

      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const upper = boundsById.get(sorted[i].id)!;
          const lowerId = sorted[j].id;
          const lower = boundsById.get(lowerId)!;

          const horizontallyOverlaps =
            upper.x < lower.x + lower.width + OVERLAP_PAD && upper.x + upper.width + OVERLAP_PAD > lower.x;
          if (!horizontallyOverlaps) continue;

          const overlapAmount = upper.y + upper.height + OVERLAP_PAD - lower.y;
          if (overlapAmount > 0) {
            const newTop = snapToGrid(lower.y + overlapAmount);
            boundsById.set(lowerId, { ...lower, y: newTop });
            updateObject(page.id, lowerId, { y: newTop });
            pushedAny = true;
          }
        }
      }
      if (!pushedAny) break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  useEffect(() => {
    reflowAllText();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  // Moves `overflowText` onto the next page (creating one, same size as the
  // current page, if none exists yet), inheriting `obj`'s formatting.
  // Always switches the view to that page, so the user can see where their
  // text went -- word-processor-style -- rather than having to go look for
  // it. `focusNewBox` additionally places the cursor in the new box
  // (collapsed at the end, ready to keep typing) -- used when this fires
  // live while someone is mid-keystroke, so typing continues uninterrupted
  // instead of silently going nowhere once the original box's page is no
  // longer the one being shown.
  function flowOverflowToNextPage(
    obj: Extract<PageObject, { type: 'text' }>,
    overflowText: string,
    style: TextStyleForMeasure,
    focusNewBox: boolean
  ) {
    const overflowHeight = Math.max(MIN_SIZE, measureTextHeight(overflowText, style));
    const overflowBase = {
      type: 'text' as const,
      rotation: 0,
      opacity: obj.opacity,
      fontSize: obj.fontSize,
      fontFamily: obj.fontFamily,
      color: obj.color,
      bold: obj.bold,
      italic: obj.italic,
      strikethrough: obj.strikethrough,
      align: obj.align,
      link: obj.link,
      text: overflowText,
    };

    const newId = nanoid();
    const nextPage = doc?.pages[activePageIndex + 1];

    if (nextPage) {
      // A next page already exists -- drop the overflow at its top and
      // switch to it, same as a word processor scrolling you to where
      // your text continued. Doesn't touch anything already on that page.
      const placed = clampBoundsToPage(
        { x: obj.x, y: GRID_SIZE, width: obj.width, height: overflowHeight },
        nextPage
      );
      addObject(nextPage.id, { id: newId, ...overflowBase, ...placed } as PageObject);
    } else {
      // No next page yet -- create one, same size as the current page,
      // with the overflow text already placed on it.
      const placed = clampBoundsToPage(
        { x: obj.x, y: GRID_SIZE, width: obj.width, height: overflowHeight },
        { width: page.width, height: page.height }
      );
      const newPage: Page = {
        id: nanoid(),
        width: page.width,
        height: page.height,
        backgroundImage: null,
        objects: [{ id: newId, ...overflowBase, ...placed } as PageObject],
      };
      addPages([newPage]); // also switches activePageIndex to it
    }

    if (nextPage) setActivePageIndex(activePageIndex + 1); // addPages already did this for the new-page branch
    if (focusNewBox) pendingFocusRef.current = { id: newId, placement: 'end' };
  }

  function handleTextInput(obj: PageObject, el: HTMLDivElement) {
    if (isTextObj(obj)) {
      const maxHeight = Math.max(MIN_SIZE, page.height - obj.y);
      // Cheap check first, using layout the browser already computed for
      // this render -- only pay for the offscreen-measure/binary-search
      // split below on the rare keystroke that actually crosses the line.
      if (el.scrollHeight > maxHeight) {
        const style: TextStyleForMeasure = {
          width: obj.width,
          fontFamily: obj.fontFamily,
          fontSize: obj.fontSize,
          bold: obj.bold,
          italic: obj.italic,
        };
        const fullText = el.textContent ?? '';
        const { fitText, overflowText } = splitTextToFit(fullText, style, maxHeight);
        const fitHeight = Math.max(MIN_SIZE, measureTextHeight(fitText, style));
        updateObject(page.id, obj.id, { text: fitText, height: fitHeight });

        if (overflowText) {
          liveOverflowHandledRef.current.add(el);
          flowOverflowToNextPage(obj, overflowText, style, true);
          // The view is switching to a different page this same tick --
          // this div's page no longer renders it, so there's nothing left
          // to do with it (no push-down pass, no further height sync).
          return;
        }
      }
    }

    const newHeight = Math.max(MIN_SIZE, el.scrollHeight);
    if (newHeight !== obj.height) {
      updateObject(page.id, obj.id, { height: newHeight });
    }
    pushDownText(obj.id, { x: obj.x, y: obj.y, width: obj.width, height: newHeight });
  }

  function handleTextBlur(obj: PageObject, el: HTMLDivElement) {
    // Already handled live by handleTextInput just before this box's page
    // switched out from under it -- unmounting a focused element can fire
    // a native blur on the way out, which would otherwise see the same
    // over-the-limit content again and duplicate the overflow text.
    if (liveOverflowHandledRef.current.has(el)) {
      liveOverflowHandledRef.current.delete(el);
      return;
    }

    const text = el.textContent ?? '';

    if (!isTextObj(obj)) {
      updateObject(page.id, obj.id, { text });
      return;
    }

    const style: TextStyleForMeasure = {
      width: obj.width,
      fontFamily: obj.fontFamily,
      fontSize: obj.fontSize,
      bold: obj.bold,
      italic: obj.italic,
    };

    const maxHeight = Math.max(MIN_SIZE, page.height - obj.y);
    const fullHeight = Math.max(MIN_SIZE, el.scrollHeight);

    // Fits on this page as-is -- the common case, unchanged from before.
    if (fullHeight <= maxHeight) {
      updateObject(page.id, obj.id, { text });
      return;
    }

    // Safety net for anything that grew past the limit WITHOUT going
    // through handleTextInput's live check above -- e.g. a resize handle
    // shrinking the box's width (and so growing its wrapped height) rather
    // than a keystroke. Doesn't steal focus, since the user already
    // clicked away from this box on purpose.
    const { fitText, overflowText } = splitTextToFit(text, style, maxHeight);
    const fitHeight = Math.max(MIN_SIZE, measureTextHeight(fitText, style));
    updateObject(page.id, obj.id, { text: fitText, height: fitHeight });

    if (!overflowText) return; // borderline case -- everything fit after all

    flowOverflowToNextPage(obj, overflowText, style, false);
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
        pendingFocusRef.current = { id, placement: 'select-all' };
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

    // For a single-line text object, the stored width often carries a
    // safety margin from PDF extraction (see pdfUpload.ts's
    // WIDTH_PADDING_RATIO) meant to keep the substitute web-safe font
    // from wrapping unexpectedly -- useful for layout, but it means the
    // selection outline can extend visibly past the last actual character.
    // Hugging the text's real single-line width fixes that, without
    // touching the stored width itself (still needed for correct
    // wrap/overlap/push-down behavior) or the resize handle below, which
    // stays at the true box edge. A genuinely wrapped multi-line
    // paragraph is left alone here: its unbroken natural width would
    // exceed the box (that's why it wraps), so this only ever kicks in
    // for text that isn't actually using its full box.
    let outlineWidth = width;
    if (isTextObj(obj) && !obj.text.includes('\n')) {
      const natural = measureNaturalTextWidth(obj.text, {
        fontFamily: obj.fontFamily,
        fontSize: obj.fontSize,
        bold: obj.bold,
        italic: obj.italic,
      });
      if (natural > 0 && natural < width) outlineWidth = natural;
    }

    const isUnderlineObj = isRectObj(obj) && obj.isUnderline;

    const corners: { id: Handle; cx: number; cy: number; cursor: string }[] = isTextObj(obj)
      ? [{ id: 'e', cx: x + width, cy: y + height / 2, cursor: 'ew-resize' }]
      : isUnderlineObj
      ? [
          // Left/right only -- an underline's thickness is set from the
          // toolbar picker, never dragged, so there's no top/bottom
          // handle to grab (see the isUnderline branch in onMove's resize
          // case, which this pairs with).
          { id: 'w', cx: x, cy: y + height / 2, cursor: 'ew-resize' },
          { id: 'e', cx: x + width, cy: y + height / 2, cursor: 'ew-resize' },
        ]
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
          width={outlineWidth}
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