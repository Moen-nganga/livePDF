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
  // Set right before addObject() is called for a text box committed from
  // the placement rectangle, so the "sync NEW objects" effect below knows
  // to immediately call .enterEditing() on that specific object once it
  // creates the matching Fabric Textbox — a plain ref rather than store
  // state since it's a one-shot signal purely local to this component,
  // read and cleared within the same synchronous effect pass.
  const pendingTextEditIdRef = useRef<string | null>(null);
  const updateObject = useEditorStore((s) => s.updateObject);
  const removeObject = useEditorStore((s) => s.removeObject);
  const addObject = useEditorStore((s) => s.addObject);
  const setSelectedObjectId = useEditorStore((s) => s.setSelectedObjectId);
  const setLiveObjectBounds = useEditorStore((s) => s.setLiveObjectBounds);
  const spellErrorsByObjectId = useEditorStore((s) => s.spellErrorsByObjectId);
  const textPlacementActive = useEditorStore((s) => s.textPlacementActive);
  const setTextPlacementActive = useEditorStore((s) => s.setTextPlacementActive);

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
      // Use canvas.getActiveObject() rather than e.selected[0] here — for a
      // multi-object ActiveSelection (table cells), that's the wrapper with
      // the correct aggregate left/top/width/height for the whole
      // selection, not just the first cell.
      const active = canvas.getActiveObject();
      setLiveObjectBounds(active ? getObjectBounds(active) : null);
    });
    canvas.on('selection:cleared', () => {
      setSelectedObjectId(null);
      setLiveObjectBounds(null);
    });

    // Fires continuously while dragging (unlike object:modified, which only
    // fires once on mouse-up) — this is what makes the ruler highlight and
    // position/size readout track the object live instead of only updating
    // after it's dropped.
    canvas.on('object:moving', (e) => {
      setLiveObjectBounds(getObjectBounds(e.target));
    });

    canvas.on('object:modified', (e) => {
      const target = e.target as fabric.Object & { id?: string };

      // Refresh the bounds one more time on commit — object:moving fires
      // right up until mouse-up, but a resize (as opposed to a drag) can
      // finalize scaleX/scaleY in a way that's only fully settled here.
      setLiveObjectBounds(getObjectBounds(target));

      // ActiveSelection is Fabric's multi-select wrapper — it's created
      // when we group-select all cells of a table. On drag-end, each
      // object inside it has been repositioned by Fabric relative to the
      // group's movement delta, so we update every cell in the store.
      if (target instanceof fabric.ActiveSelection) {
        target.getObjects().forEach((obj) => {
          const o = obj as fabric.Object & { id?: string };
          if (!o.id) return;
          updateObject(page.id, o.id, {
            x: o.left ?? 0,
            y: o.top ?? 0,
            width: (o.width ?? 0) * (o.scaleX ?? 1),
            height: (o.height ?? 0) * (o.scaleY ?? 1),
            rotation: o.angle ?? 0,
          });
        });
        return;
      }

      if (!target?.id) return;
      updateObject(page.id, target.id, {
        x: target.left ?? 0,
        y: target.top ?? 0,
        width: (target.width ?? 0) * (target.scaleX ?? 1),
        height: (target.height ?? 0) * (target.scaleY ?? 1),
        rotation: target.angle ?? 0,
      });
    });

    // Table group-selection: when any cell is clicked (single click),
    // find all Fabric objects sharing the same tableId and wrap them in an
    // ActiveSelection so the whole table drags as one unit. Double-clicking
    // a text cell still enters Fabric's text-edit mode (Fabric handles this
    // natively before our mouse:up fires).
    canvas.on('mouse:up', (e) => {
      const target = e.target as (fabric.Object & { id?: string; tableId?: string }) | undefined;
      if (!target?.tableId) return;

      const tableId = target.tableId;
      const siblings = canvas.getObjects().filter(
        (o) => (o as fabric.Object & { tableId?: string }).tableId === tableId
      );
      if (siblings.length <= 1) return;

      // Already a multi-selection covering this table — don't re-wrap
      const active = canvas.getActiveObject();
      if (active instanceof fabric.ActiveSelection) {
        const activeIds = new Set(
          active.getObjects().map((o) => (o as fabric.Object & { id?: string }).id)
        );
        if (siblings.every((s) => activeIds.has((s as fabric.Object & { id?: string }).id))) return;
      }

      canvas.discardActiveObject();
      const sel = new fabric.ActiveSelection(siblings, { canvas });
      canvas.setActiveObject(sel);
      canvas.requestRenderAll();
    });

    // Ctrl/Cmd+Click opens a linked text object's URL, mirroring the
    // browser convention of "modifier+click opens a link" — a plain click
    // is already used for select/drag, so it can't double as "open link"
    // without breaking normal editing.
    canvas.on('mouse:down', (e) => {
      const isModified = e.e.ctrlKey || e.e.metaKey;
      if (!isModified) return;
      const target = e.target as (fabric.Object & { link?: string }) | undefined;
      if (target?.link) {
        window.open(target.link, '_blank', 'noopener,noreferrer');
      }
    });

    // Lightweight hover hint: show a pointer cursor over a linked object,
    // independent of whether Ctrl happens to be held — simpler than
    // tracking live key state, and still communicates "this is clickable"
    // without needing to perfectly match browser link-hover semantics.
    canvas.on('mouse:over', (e) => {
      const target = e.target as (fabric.Object & { link?: string }) | undefined;
      if (target?.link) canvas.defaultCursor = 'pointer';
    });
    canvas.on('mouse:out', () => {
      canvas.defaultCursor = 'default';
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

  // "+ Text" placement rectangle: a dashed, non-committal rect the user
  // drags/resizes with Fabric's normal selection handles (nothing special
  // needed for that — it's a plain fabric.Rect), then double-clicks to
  // commit into a real, empty TextObject at whatever position/size the
  // rectangle ended up at. Escape cancels without creating anything. This
  // rectangle is NEVER part of page.objects/the store — it only becomes
  // real data at the moment of commit.
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !textPlacementActive || readOnly) return;

    const rect = new fabric.Rect({
      left: 80,
      top: 80,
      width: 200,
      height: 40,
      fill: 'rgba(66,133,244,0.08)',
      stroke: '#4285f4',
      strokeWidth: 1.5,
      strokeDashArray: [6, 4],
      strokeUniform: true,
    });
    (rect as fabric.Object & { isTextPlacementRect?: boolean }).isTextPlacementRect = true;
    canvas.add(rect);
    canvas.setActiveObject(rect);
    canvas.requestRenderAll();

    const commitPlacement = () => {
      const x = rect.left ?? 0;
      const y = rect.top ?? 0;
      const width = (rect.width ?? 0) * (rect.scaleX ?? 1);
      const height = (rect.height ?? 0) * (rect.scaleY ?? 1);

      const newId = nanoid();
      pendingTextEditIdRef.current = newId;

      // text: '' — deliberately no placeholder copy. fontSize is always
      // 14 regardless of how big the rectangle was drawn; it only changes
      // afterward if the user picks a different size manually.
      addObject(page.id, {
        id: newId,
        type: 'text',
        x,
        y,
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
      });

      canvas.remove(rect);
      setTextPlacementActive(false);
    };

    const onDblClick = (e: { target?: fabric.Object }) => {
      if (e.target === rect) commitPlacement();
    };
    canvas.on('mouse:dblclick', onDblClick);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      canvas.remove(rect);
      canvas.requestRenderAll();
      setTextPlacementActive(false);
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      canvas.off('mouse:dblclick', onDblClick);
      window.removeEventListener('keydown', onKeyDown);
      // Covers both cancel-via-page-switch and the normal cleanup after a
      // successful commit already removed it — checking first avoids
      // removing some unrelated object that happened to occupy the same
      // canvas position.
      if (canvas.getObjects().includes(rect)) {
        canvas.remove(rect);
        canvas.requestRenderAll();
      }
    };
  }, [textPlacementActive, readOnly, page.id, addObject, setTextPlacementActive]);

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
        canvas.setActiveObject(fabricObj);
        // If this is the text object just committed from the "+ Text"
        // placement rectangle, drop straight into typing — the
        // double-click that committed the rectangle should feel like it
        // both created AND opened the text for editing in one motion,
        // not require a second double-click on the brand-new empty box.
        if (obj.type === 'text' && pendingTextEditIdRef.current === obj.id) {
          (fabricObj as fabric.Textbox).enterEditing();
          pendingTextEditIdRef.current = null;
        }
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

  // Sync IN-PLACE PROPERTY EDITS for text (font family/size/style/color
  // changed via the toolbar's text controls). Deliberately separate from
  // the add/remove effects above and keyed on a narrow fingerprint of just
  // these fields — not the whole objects array — so typing in a text box
  // or dragging an object doesn't cause this to fire and fight with
  // Fabric's own live state the way the original all-in-one sync effect did.
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

      // Only touch the canvas if something actually differs — avoids
      // unnecessary re-renders and avoids clobbering in-progress text
      // editing state (cursor position) on every render.
      const fontWeight = obj.bold ? 'bold' : 'normal';
      const fontStyle = obj.italic ? 'italic' : 'normal';
      const linethrough = obj.strikethrough;
      // Underline whenever a link is set, on top of whatever the text's own
      // strikethrough state is — mirrors the universal "links are
      // underlined" convention so it's visually obvious while editing.
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
      // Not part of Fabric's own style properties, so it's set directly
      // rather than through .set() — this is what the Ctrl+Click handler
      // below reads to decide where to navigate.
      (fabricObj as fabric.Object & { link?: string }).link = obj.link;
    });

    canvas.requestRenderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textStyleFingerprint]);

  // Sync ROTATION set via the toolbar's rotate button. Applies to every
  // object type (not just text), and — like the text style effect above —
  // is kept on its own narrow fingerprint so it only fires when rotation
  // actually changes, not on every drag/resize.
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

  // Sync STROKE/STROKE WIDTH for rect and ellipse objects (this is what
  // the border thickness/color pickers edit — a border is just a rect
  // with no fill, see Toolbar.tsx's addBorder). Same narrow-fingerprint
  // pattern as the effects above, so editing a border's style doesn't
  // interfere with dragging or resizing it.
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

  // Draw red underline markers under misspelled words (see lib/spellcheck.ts
  // and Toolbar.tsx's "Spell Check" button, which populates
  // spellErrorsByObjectId). Fingerprinted on the error ranges themselves so
  // this only re-runs when a scan actually changes something, not on every
  // drag/render. On-demand only — if the text changes after a scan, the
  // underlines stay put against the old offsets until "Spell Check" runs
  // again (documented limitation, matches the on-demand design).
  const spellErrorFingerprint = page.objects
    .filter((o) => o.type === 'text')
    .map((o) => `${o.id}:${(spellErrorsByObjectId[o.id] ?? []).map((e) => `${e.start}-${e.end}`).join(',')}`)
    .join('|');
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // Simplest way to stay in sync is a full clear-and-redraw of markers
    // rather than diffing — scans are infrequent (on-demand button click),
    // so this isn't a hot path.
    canvas.getObjects().forEach((o) => {
      if ((o as fabric.Object & { isSpellcheckMarker?: boolean }).isSpellcheckMarker) {
        canvas.remove(o);
      }
    });

    page.objects.forEach((obj) => {
      if (obj.type !== 'text') return;
      const errors = spellErrorsByObjectId[obj.id];
      if (!errors || errors.length === 0) return;

      const fabricObj = canvas
        .getObjects()
        .find((o) => (o as fabric.Object & { id?: string }).id === obj.id) as fabric.Textbox | undefined;
      if (!fabricObj) return;

      errors.forEach((err) => {
        try {
          // get2DCursorLocation is public IText/Textbox API for turning a
          // flat character index into {lineIndex, charIndex}. Passing
          // `false` (or omitting the arg) is essential here — it makes
          // Fabric account for word-wrap, returning a position relative to
          // the actual rendered (wrapped) line. __charBounds below is
          // indexed per WRAPPED line too, so the two must agree; passing
          // `true` here (an earlier bug) computes the location as if
          // wrapping never happened, which only coincidentally lines up
          // for text that fits on one visual line and silently
          // misresolves (or goes out of bounds) for anything wrapped
          // across multiple lines — exactly the common case.
          const startLoc = fabricObj.get2DCursorLocation(err.start, false);
          const endLoc = fabricObj.get2DCursorLocation(err.end, false);
          // Fabric wraps at word boundaries, so a single word's start/end
          // should normally land on the same line — if they don't (most
          // likely because the text was edited since the scan ran and
          // offsets no longer line up), skip rather than draw a
          // misleading underline spanning two lines.
          if (startLoc.lineIndex !== endLoc.lineIndex) return;

          // __charBounds is populated internally by Fabric's own text
          // layout (it's what Fabric uses for cursor/selection rendering)
          // rather than public API — there's no public method exposing
          // per-character pixel positions, so this is the practical way
          // to place an underline under a specific run of characters.
          // Stable across recent Fabric versions but not guaranteed by
          // any public contract; the try/catch around this whole block is
          // deliberate in case that ever changes.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const charBounds = (fabricObj as any).__charBounds as
            | Array<Array<{ left: number; width: number; height: number }>>
            | undefined;
          const lineBounds = charBounds?.[startLoc.lineIndex];
          if (!lineBounds) return;

          const startChar = lineBounds[startLoc.charIndex];
          const endChar = lineBounds[endLoc.charIndex - 1] ?? startChar;
          if (!startChar || !endChar) return;

          // getHeightOfLine is a real (non-underscore) method on Fabric's
          // Text class, used to find each line's vertical offset — falls
          // back to a rough fontSize-based estimate if it's ever missing.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const getHeightOfLine = (fabricObj as any).getHeightOfLine as
            | ((lineIndex: number) => number)
            | undefined;
          const lineHeight = getHeightOfLine
            ? getHeightOfLine.call(fabricObj, startLoc.lineIndex)
            : (fabricObj.fontSize ?? 16) * 1.16;
          const lineTop = lineHeight * startLoc.lineIndex;

          const underlineY = (fabricObj.top ?? 0) + lineTop + (startChar.height ?? fabricObj.fontSize ?? 16);
          const x1 = (fabricObj.left ?? 0) + startChar.left;
          const x2 = (fabricObj.left ?? 0) + endChar.left + endChar.width;

          const marker = new fabric.Line([x1, underlineY, x2, underlineY], {
            stroke: '#e03131',
            strokeWidth: 1.5,
            selectable: false,
            evented: false,
          });
          (marker as fabric.Object & { isSpellcheckMarker?: boolean }).isSpellcheckMarker = true;
          canvas.add(marker);
        } catch {
          // Defensive: if any of the above internal-API assumptions ever
          // breaks (Fabric upgrade, unexpected text state), skip this one
          // underline rather than take down the whole render.
        }
      });
    });

    canvas.requestRenderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spellErrorFingerprint]);

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

      const active = canvas.getActiveObject();
      if (!active) return;
      e.preventDefault();

      // ActiveSelection = entire table selected — delete all cells
      if (active instanceof fabric.ActiveSelection) {
        active.getObjects().forEach((o) => {
          const id = (o as fabric.Object & { id?: string }).id;
          if (id) {
            canvas.remove(o);
            removeObject(page.id, id);
          }
        });
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        return;
      }

      // Single object
      const single = active as fabric.Object & { id?: string };
      if (!single.id) return;
      canvas.remove(active);
      canvas.requestRenderAll();
      removeObject(page.id, single.id);
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

/**
 * Reads a Fabric object's (or ActiveSelection's — same shape) current
 * on-canvas bounding box. Used to feed the ruler's alignment highlight and
 * the position/size readout badge in App.tsx; kept as a plain function
 * rather than inline so both the live 'object:moving' handler and the
 * one-shot selection/modified handlers compute bounds identically.
 */
function getObjectBounds(obj: fabric.Object) {
  return {
    x: obj.left ?? 0,
    y: obj.top ?? 0,
    width: (obj.width ?? 0) * (obj.scaleX ?? 1),
    height: (obj.height ?? 0) * (obj.scaleY ?? 1),
  };
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
      (t as fabric.Object & { id?: string; link?: string; tableId?: string }).id = obj.id;
      (t as fabric.Object & { id?: string; link?: string; tableId?: string }).link = obj.link;
      (t as fabric.Object & { id?: string; link?: string; tableId?: string }).tableId = obj.tableId;
      return t;
    }
    case 'rect': {
      const r = new fabric.Rect({
        ...common,
        width: obj.width,
        height: obj.height,
        fill: obj.fill ?? 'transparent', // Fabric needs an explicit value; 'transparent' renders as no fill, matching the undefined-fill case in the export pipeline
        stroke: obj.stroke,
        strokeWidth: obj.strokeWidth,
        rx: obj.cornerRadius,
        ry: obj.cornerRadius,
      });
      (r as fabric.Object & { id?: string; tableId?: string }).id = obj.id;
      (r as fabric.Object & { id?: string; tableId?: string }).tableId = obj.tableId;
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
      // Image creation is async in Fabric v6; handled by caller awaiting
      // fabric.FabricImage.fromURL separately and adding to canvas there.
      // Returning null here keeps this function's signature synchronous;
      // see addImageObject in toolbar actions for the async add path.
      return null;
    }
    case 'group': {
      // Build each child synchronously. Children are in group-local
      // coordinates — Fabric Group positions them relative to the group
      // origin automatically, so we pass x/y as-is and Fabric handles it.
      const childObjects: fabric.Object[] = [];
      for (const child of obj.children) {
        if (child.type === 'image') continue; // skip async children for now
        const fabricChild = createFabricObject(child);
        if (fabricChild) childObjects.push(fabricChild);
      }

      if (childObjects.length === 0) return null;

      const g = new fabric.Group(childObjects, {
        left: obj.x,
        top: obj.y,
        angle: obj.rotation,
        opacity: obj.opacity,
      });
      (g as fabric.Object & { id?: string }).id = obj.id;
      return g;
    }
    default:
      return null;
  }
}