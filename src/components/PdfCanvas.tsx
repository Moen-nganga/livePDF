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

function objBounds(o: { x: number; y: number; width: number; height: number }): Bounds {
  return { x: o.x, y: o.y, width: o.width, height: o.height };
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
        const placed = findFreeGridSlot(
          { x: d.x, y: d.y },
          { width, height },
          existingText,
          { width: page.width, height: page.height }
        );

        const id = nanoid();
        pendingFocusIdRef.current = id;
        addObject(page.id, {
          id,
          type: 'text',
          x: placed.x,
          y: placed.y,
          width,
          height,
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
        lastGoodBoundsRef.current.set(id, { x: placed.x, y: placed.y, width, height });
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
          {renderHandles(obj, bounds)}
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
          {renderHandles(obj, bounds)}
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
          {renderHandles(obj, bounds)}
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
            onInput={(e) => handleTextInput(t, e.currentTarget)}
            onBlur={(e) => handleTextBlur(t, e.currentTarget)}
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
        {renderHandles(t, bounds)}
      </g>
    );
  }

  return (
    <div
      ref={wrapperRef}
      style={{
        width: `min(100%, ${page.width}px)`,
        aspectRatio: `${page.width} / ${page.height}`,
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

        {page.objects.map(renderObject)}

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