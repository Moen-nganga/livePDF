/**
 * Core data model for the PDF editor.
 *
 * A PDFDocument is a list of Pages. Each Page has a size, an optional
 * background image (used when a page came from an uploaded PDF, rendered
 * once via pdf.js), and a list of editable objects layered on top.
 *
 * This model is intentionally independent of Fabric.js and pdf-lib.
 * - Fabric.js reads/writes this model while the user edits a page.
 * - pdf-lib reads this model when exporting to a real .pdf file.
 * - idb reads/writes this model for local persistence.
 *
 * Keeping the model "dumb" (plain data, no library instances) means we can
 * swap the canvas library or export library later without touching state.
 */

export type ObjectType = 'text' | 'rect' | 'ellipse' | 'image' | 'line' | 'group';

export interface BaseObject {
  id: string;
  type: ObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
  opacity: number; // 0-1
  /** When set, this object belongs to a table group. All objects sharing
   *  the same tableId are selected and moved together as one unit. */
  tableId?: string;
}

export interface TextObject extends BaseObject {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string; // hex
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  align: 'left' | 'center' | 'right';
  /** When set, this text becomes a clickable hyperlink in the exported PDF. */
  link?: string;
  /**
   * Set on text created via the "+ Watermark" toolbar button. Purely a
   * UI/identification tag, same reasoning as RectObject.isHighlight — a
   * watermark is just a rotated, low-opacity text object; nothing in
   * rendering or PDF export treats it specially.
   */
  isWatermark?: boolean;
}

export interface RectObject extends BaseObject {
  type: 'rect';
  /** Omit for no fill — used by the border/frame tool, which is just an outline. */
  fill?: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
  /**
   * Set on rects created via the "+ Highlight" toolbar button — a plain
   * rect with a semi-transparent fill and no visible stroke, used to mark
   * up existing content. Purely a UI/identification tag (so the toolbar
   * knows to show the highlight color picker and active-tool state for
   * it); rendering and PDF export don't check this at all, since a
   * highlight draws exactly like any other rect with fill+opacity set.
   */
  isHighlight?: boolean;
  /**
   * Set on rects created via the "+ Underline" toolbar button — a thin,
   * full-opacity rect meant to be dragged/resized under a line of text.
   * Same reasoning as isHighlight: purely a UI/identification tag (so the
   * toolbar knows to show active-tool state for it); rendering and PDF
   * export don't check this at all, since an underline draws exactly like
   * any other thin filled rect.
   */
  isUnderline?: boolean;
}

export interface EllipseObject extends BaseObject {
  type: 'ellipse';
  fill?: string;
  stroke: string;
  strokeWidth: number;
}

export interface ImageObject extends BaseObject {
  type: 'image';
  /** Data URL (base64) — kept self-contained so the doc serializes as one JSON blob */
  src: string;
}

export interface LineObject extends BaseObject {
  type: 'line';
  stroke: string;
  strokeWidth: number;
}

/**
 * A group of objects treated as a single draggable/selectable unit on the
 * canvas. Used for tables (all cells move together) and any other case where
 * multiple objects need to behave as one.
 *
 * Children are stored in group-local coordinates (origin = group top-left).
 * When exporting to PDF, each child's absolute position is computed by adding
 * the group's own x/y offset — see exportPdf.ts's drawObject 'group' case.
 */
export interface GroupObject extends BaseObject {
  type: 'group';
  /** Child objects in group-local coordinates (origin = top-left of the group). */
  children: PageObject[];
}

export type PageObject =
  | TextObject
  | RectObject
  | EllipseObject
  | ImageObject
  | LineObject
  | GroupObject;

export interface Page {
  id: string;
  /** Optional custom label shown in the page sidebar. Falls back to "Page N" when unset. */
  name?: string;
  /** Page size in points (1pt = 1/72 inch, matches PDF units) */
  width: number;
  height: number;
  /**
   * Data URL of the rendered original PDF page, if this page came from an
   * upload. Null for pages created from a blank canvas. This image is
   * flattened into the export as a background — it is not itself editable.
   */
  backgroundImage: string | null;
  objects: PageObject[];
}

/**
 * A comment attached to a page, optionally anchored to a specific object on
 * that page. When `objectId` is omitted, it's a general comment about the
 * page as a whole (shown in CommentsPanel as "General comment").
 *
 * There's no canvas marker/pin for these — CommentsPanel lists them
 * separately from the canvas rather than rendering an anchor on top of the
 * object itself. `objectId` can end up pointing at an object that's since
 * been deleted (we don't cascade-delete comments when an object is
 * removed); consumers should handle a missing lookup gracefully rather than
 * assuming the id always resolves.
 */
export interface Comment {
  id: string;
  pageId: string;
  objectId?: string;
  text: string;
  createdAt: number;
  resolved: boolean;
}

export interface PDFDocument {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pages: Page[];
  /**
   * Optional so documents saved before this field existed still load
   * correctly — always read as `document.comments ?? []`, never assume
   * it's present.
   */
  comments?: Comment[];
}

// Standard page sizes in points, for the "blank canvas" flow
export const PAGE_SIZES = {
  A4: { width: 595.28, height: 841.89 },
  LETTER: { width: 612, height: 792 },
  LEGAL: { width: 612, height: 1008 },
} as const;

export type PageSizeName = keyof typeof PAGE_SIZES;