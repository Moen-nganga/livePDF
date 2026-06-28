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

export type ObjectType = 'text' | 'rect' | 'ellipse' | 'image' | 'line';

export interface BaseObject {
  id: string;
  type: ObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
  opacity: number; // 0-1
}

export interface TextObject extends BaseObject {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string; // hex
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
}

export interface RectObject extends BaseObject {
  type: 'rect';
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
}

export interface EllipseObject extends BaseObject {
  type: 'ellipse';
  fill: string;
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

export type PageObject =
  | TextObject
  | RectObject
  | EllipseObject
  | ImageObject
  | LineObject;

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

export interface PDFDocument {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pages: Page[];
}

// Standard page sizes in points, for the "blank canvas" flow
export const PAGE_SIZES = {
  A4: { width: 595.28, height: 841.89 },
  LETTER: { width: 612, height: 792 },
  LEGAL: { width: 612, height: 1008 },
} as const;

export type PageSizeName = keyof typeof PAGE_SIZES;