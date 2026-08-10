import '../lib/pdfjsSetup';
import { getDocument } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { nanoid } from 'nanoid';
import type { Page, TextObject } from '../types/document';

const RENDER_SCALE = 2; // render at 2x for crisper display/export quality

// Minimum on-page footprint we'll accept for an extracted text run --
// guards against stray zero-width/zero-height items some PDFs emit for
// invisible or degenerate glyphs, which would otherwise create unusable
// tiny/unclickable TextObjects.
const MIN_RUN_SIZE = 4;

// Extra width given to each extracted run beyond pdf.js's measured width.
// pdf.js measures width using the PDF's actual embedded font, but we
// render with a substituted web-safe font (Helvetica/Times/Courier),
// which is very often wider per character. Fabric's Textbox auto-wraps
// any text that doesn't fit within its set width -- without this
// padding, a run that fit on one line in the original font can overflow
// onto a second line once rendered in the substitute font, spilling down
// and visually overlapping whatever text sits below it (this was the
// "ghost text underneath" bug). 25% (with a minimum) comfortably covers
// the typical metric difference between common embedded fonts and our
// web-safe fallbacks.
//
// NOTE: this padding is sized purely to avoid *wrapping* -- it knows
// nothing about what other runs sit on the same line. See
// capLineNeighborWidths below, which trims this padding back down
// whenever it would otherwise reach into a neighboring run's space (e.g.
// a project title butting up against a tech-badge label right after it,
// or a job title colliding with a right-aligned date range).
const WIDTH_PADDING_RATIO = 0.25;
const MIN_WIDTH_PADDING = 6;

// Minimum visual breathing room (in PDF points) preserved between one
// run's right edge and the next run's left edge when they sit on the
// same line, so adjacent runs never render flush against each other.
// Used as a floor -- see DESIRED_GAP_FONT_RATIO below for the normal,
// larger reserve that scales with each run's font size.
const MIN_INTER_RUN_GAP = 4;

// The gap we'd *like* to preserve before the next run on a line, as a
// fraction of the run's own font size -- roughly the width of a real
// space character at that size, which is what actually separated these
// runs in the original PDF (e.g. "Project Name" + a tech-badge label, or
// a job title + a right-aligned date range). An earlier version of this
// cap only reserved MIN_INTER_RUN_GAP (a couple of points), which is
// enough to stop text from literally touching but let our substitute
// font -- which is very often wider per character than the PDF's real
// embedded font -- eat almost all of the original visual gap, leaving
// badge labels pressed right up against the preceding text instead of
// comfortably spaced the way the source PDF actually laid them out.
const DESIRED_GAP_FONT_RATIO = 0.35;

// A run is treated as a secondary "label" following the main text on its
// line -- e.g. a small tech-stack tag ("TypeScript", "HTML") right after
// a project title -- when its font size is under this fraction of the
// previous run's font size on the same line. Common resume/portfolio
// styling italicizes exactly this kind of label even when the source
// PDF's own font metadata doesn't mark it italic (pdf.js only reports
// italic when the embedded font itself is an italic variant), so we
// apply it as a deliberate visual heuristic rather than trusting the
// PDF's font flag alone. Chosen conservatively so a same-size run on the
// same line -- e.g. "Remote" following a job title -- is left alone.
const SECONDARY_LABEL_FONT_RATIO = 0.85;

// How close two runs' baselines need to be (in PDF points) to be treated
// as sitting on the same visual line. Grouping by baseline rather than
// by each run's own top-left y tolerates runs on the same line that use
// different font sizes (e.g. a bold heading next to a smaller gray
// label), since their top edges differ but their baselines line up.
const SAME_LINE_BASELINE_TOLERANCE = 2;

// Extra vertical coverage added above/below each run's own font-height
// when painting over the original rasterized text, expressed as a
// fraction of fontHeight. Typographic ascenders/descenders extend beyond
// the plain em box, so erasing only exactly fontHeight tall left slivers
// of the original glyphs (tops of tall letters, descenders on g/y/p)
// visible underneath the new editable text.
const ERASE_ASCENT_RATIO = 1.3;
const ERASE_DESCENT_RATIO = 0.35;

/**
 * Reads an uploaded PDF file and converts each page into a Page object.
 *
 * Two things happen per page, in order:
 *  1. The page is rasterized to an image via pdf.js (as before) and kept
 *     as backgroundImage, so layout, images, vector art, etc. all still
 *     look correct.
 *  2. The page's real text (via pdf.js's getTextContent) is extracted
 *     into actual editable TextObjects, positioned to match where the
 *     text sits on the page. To avoid the original (now-uneditable)
 *     glyphs showing through underneath the new editable text, each
 *     extracted run's bounding box is painted over with white on the
 *     raster background before it's exported.
 *
 * This replaces the previous "flatten only" behavior (which returned
 * objects: [] and left users unable to edit any text from an uploaded
 * PDF) while keeping the same rasterized-background fallback for
 * everything that isn't text (images, rules, backgrounds, etc.).
 */
export async function pdfFileToPages(file: File): Promise<Page[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;

  const pages: Page[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const pdfPage = await pdf.getPage(pageNum);

    // Page size in PDF points (unscaled) -- what our editor stores
    // object/page coordinates in, and what PdfCanvas.tsx renders at 1:1
    // before its own responsive zoom is applied.
    const unscaledViewport = pdfPage.getViewport({ scale: 1 });

    // Extract text runs first (in unscaled/point space), since we need
    // their bounding boxes both for the TextObjects themselves and for
    // knowing what to paint over on the raster canvas below.
    const textContent = await pdfPage.getTextContent();
    const runs = extractTextRuns(textContent, unscaledViewport);

    // Attach any link the PDF itself defines for a run (e.g. a URL in a
    // resume's contact/portfolio line) -- see extractLinkAnnotations and
    // findLinkForRun below. PdfCanvas.tsx already knows how to render a
    // TextObject's `link` field (underlined, Ctrl/Cmd+click to open) --
    // this was just never being populated for uploaded PDFs.
    const linkRegions = await extractLinkAnnotations(pdfPage, unscaledViewport);
    for (const run of runs) {
      run.link = findLinkForRun(run, linkRegions);
    }

    // Trim each run's width-padding allowance so it never reaches into a
    // neighboring run's space on the same line -- see the constant
    // comment above and the function itself for why this is needed.
    capLineNeighborWidths(runs);

    // Now render the raster background at full quality.
    const renderViewport = pdfPage.getViewport({ scale: RENDER_SCALE });
    const canvas = window.document.createElement('canvas');
    canvas.width = renderViewport.width;
    canvas.height = renderViewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context for PDF render');

    await pdfPage.render({ canvasContext: ctx, viewport: renderViewport }).promise;

    // Paint over each extracted run's footprint so the flattened original
    // text doesn't show through underneath the new editable TextObject
    // sitting at the same spot. Coordinates were computed in unscaled
    // (scale 1) space, so scale up by RENDER_SCALE to match this canvas.
    // Erased using each run's *padded* bounds (see erasePaddedBounds),
    // not its raw pdf.js-measured bounds, so the erase covers ascenders/
    // descenders and the same extra width margin the TextObject itself
    // gets -- otherwise slivers of the original glyphs peek out from
    // under the new text.
    // NOTE: this assumes a white/light page background -- a run sitting
    // on a colored panel (e.g. a colored sidebar) will show a faint white
    // patch instead of blending in.
    ctx.fillStyle = '#ffffff';
    for (const run of runs) {
      const bounds = erasePaddedBounds(run);
      ctx.fillRect(
        bounds.x * RENDER_SCALE,
        bounds.y * RENDER_SCALE,
        bounds.width * RENDER_SCALE,
        bounds.height * RENDER_SCALE
      );
    }

    const objects: TextObject[] = runs.map((run) => ({
      id: nanoid(),
      type: 'text',
      x: run.x,
      y: run.y,
      // Padded (and neighbor-capped -- see capLineNeighborWidths), not
      // pdf.js's raw measured width. See WIDTH_PADDING_RATIO above for
      // why padding is needed at all; without the neighbor cap on top of
      // it, that same padding is what caused adjacent runs on one line
      // (e.g. a project title and its tech-badge label) to overlap.
      width: paddedRunWidth(run),
      height: run.height,
      rotation: run.rotation,
      opacity: 1,
      text: run.text,
      fontSize: run.fontSize,
      fontFamily: run.fontFamily,
      color: '#111111', // pdf.js text content doesn't expose fill color; see note above
      bold: run.bold,
      italic: run.italic || !!run.forceItalic,
      strikethrough: false,
      align: 'left',
      link: run.link,
    }));

    pages.push({
      id: nanoid(),
      width: unscaledViewport.width,
      height: unscaledViewport.height,
      backgroundImage: canvas.toDataURL('image/png'),
      objects,
    });
  }

  return pages;
}

// This run's width including WIDTH_PADDING_RATIO's wrap-avoidance margin,
// capped to maxWidthOnLine when capLineNeighborWidths has set one (i.e.
// there's another run to its right on the same line closer than the raw
// padding would reach). Always at least the run's own raw measured
// width, even if that's technically tighter than the gap to the next run
// -- we never shrink below what pdf.js says the text itself occupies.
function paddedRunWidth(run: ExtractedRun): number {
  const padded = run.width + Math.max(run.width * WIDTH_PADDING_RATIO, MIN_WIDTH_PADDING);
  if (run.maxWidthOnLine === undefined) return padded;
  return Math.max(run.width, Math.min(padded, run.maxWidthOnLine));
}

// Groups runs into visual lines (by baseline proximity) and, within each
// line, caps every run's allowed padded width so it stops before the
// next run to its right -- leaving MIN_INTER_RUN_GAP of breathing room.
//
// Without this, WIDTH_PADDING_RATIO's wrap-avoidance margin (needed
// because our substituted web-safe font is often wider per character
// than the PDF's real embedded font -- see that constant's comment) has
// no awareness of what else is on the same line. A short run like a
// project title followed immediately by a small tech-badge label, or a
// job title followed by a right-aligned date range, would get padded
// with no regard for how little actual space separates it from that
// next run -- and PdfCanvas.tsx's fabric.IText rendering (which never
// wraps, by design, so it can't spill onto the line below) would then
// happily render right through that neighboring text instead.
//
// Only non-rotated runs are considered -- rotated text's "next run to
// the right" isn't a meaningful concept, and rotated runs are rare
// enough (stamps, sidebars) not to be worth the extra complexity here.
function capLineNeighborWidths(runs: ExtractedRun[]): void {
  const horizontal = runs.filter((r) => r.rotation === 0);

  const withBaseline = horizontal.map((run) => ({ run, baseline: run.y + run.fontSize }));
  withBaseline.sort((a, b) => a.baseline - b.baseline || a.run.x - b.run.x);

  let lineStart = 0;
  while (lineStart < withBaseline.length) {
    let lineEnd = lineStart + 1;
    while (
      lineEnd < withBaseline.length &&
      withBaseline[lineEnd].baseline - withBaseline[lineStart].baseline <= SAME_LINE_BASELINE_TOLERANCE
    ) {
      lineEnd++;
    }

    const line = withBaseline.slice(lineStart, lineEnd).map((entry) => entry.run);
    line.sort((a, b) => a.x - b.x);

    for (let i = 0; i < line.length - 1; i++) {
      const run = line[i];
      const next = line[i + 1];
      const desiredGap = Math.max(MIN_INTER_RUN_GAP, run.fontSize * DESIRED_GAP_FONT_RATIO);
      // Still floored at run.width itself (via paddedRunWidth's own
      // Math.max) if the next run sits closer than desiredGap allows --
      // e.g. two runs that were already tight in the source PDF -- so we
      // never shrink a run below what pdf.js says its own text occupies.
      run.maxWidthOnLine = next.x - run.x - desiredGap;

      // A secondary run (i.e. i+1, since it follows something on this
      // line) whose font is noticeably smaller than what precedes it --
      // e.g. a small tech-stack tag after a project title -- reads as a
      // label in common resume/portfolio styling and is conventionally
      // italicized. A same-size neighbor (e.g. "Remote" after a job
      // title, similar font size) is left untouched. See
      // SECONDARY_LABEL_FONT_RATIO's comment for the reasoning.
      if (next.fontSize < run.fontSize * SECONDARY_LABEL_FONT_RATIO) {
        next.forceItalic = true;
      }
    }
    // Last run on a line keeps maxWidthOnLine unset (unconstrained by a
    // neighbor) -- nothing to its right to collide with.

    lineStart = lineEnd;
  }
}

// The enlarged rectangle we paint white over on the raster background for
// a given run -- wider than the run's own measured width (same margin,
// including the same neighbor cap, used for the TextObject itself, so
// the erase always covers at least as much as the new editable text sits
// on top of) and taller than its raw font-height (to catch ascenders
// above and descenders below what a plain em-box would cover).
function erasePaddedBounds(run: ExtractedRun): { x: number; y: number; width: number; height: number } {
  const width = paddedRunWidth(run);
  const ascent = run.fontSize * ERASE_ASCENT_RATIO;
  const descent = run.fontSize * ERASE_DESCENT_RATIO;
  const baseline = run.y + run.fontSize; // run.y is stored as the box's top edge, one fontHeight above baseline

  return {
    x: run.x,
    y: baseline - ascent,
    width,
    height: ascent + descent,
  };
}

interface ExtractedRun {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  // Set by capLineNeighborWidths for any run that has another run to its
  // right on the same visual line -- the furthest paddedRunWidth is
  // allowed to reach before it would start overlapping that neighbor.
  // Undefined means unconstrained (last/only run on its line).
  maxWidthOnLine?: number;
  // Set by capLineNeighborWidths when this run reads as a secondary
  // label following larger text on the same line -- see
  // SECONDARY_LABEL_FONT_RATIO. Combined with the PDF's own italic font
  // flag (run.italic) when building the final TextObject.
  forceItalic?: boolean;
  // The URL of the link annotation this run falls inside, if any -- set
  // by findLinkForRun using the regions from extractLinkAnnotations.
  link?: string;
}

// Combines two PDF transform matrices, same formula pdf.js itself uses
// internally (and in its text-layer builder) to go from PDF text space to
// viewport pixel space. Implemented locally rather than importing
// pdfjs-dist's `Util.transform` since that helper isn't reliably exported
// across pdfjs-dist versions/bundling setups.
function combineTransforms(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function extractTextRuns(
  textContent: Awaited<ReturnType<import('pdfjs-dist').PDFPageProxy['getTextContent']>>,
  viewport: import('pdfjs-dist').PageViewport
): ExtractedRun[] {
  const runs: ExtractedRun[] = [];

  for (const item of textContent.items) {
    if (!('str' in item)) continue; // skip TextMarkedContent entries
    const textItem = item as TextItem;
    if (!textItem.str.trim()) continue;

    // Combine the item's own text-space matrix with the viewport's
    // transform to land in the same top-left-origin, y-down point space
    // our editor already uses for page/object coordinates -- this is the
    // exact technique pdf.js's own text layer builder uses to position
    // its (invisible, selectable) text divs over a rendered page.
    const tx = combineTransforms(viewport.transform, textItem.transform);

    const fontHeight = Math.hypot(tx[2], tx[3]);
    const rotation = (Math.atan2(tx[1], tx[0]) * 180) / Math.PI;

    const width = Math.max(textItem.width, MIN_RUN_SIZE);
    const height = Math.max(fontHeight * 1.15, MIN_RUN_SIZE); // small leading so descenders aren't clipped

    const x = tx[4];
    const y = tx[5] - fontHeight; // tx[5] is the text baseline; shift up to the box's top edge

    const styleName = textItem.fontName;
    const style = styleName ? textContent.styles[styleName] : undefined;
    const { fontFamily, bold, italic } = mapFont(style?.fontFamily, styleName);

    runs.push({
      text: textItem.str,
      x,
      y,
      width,
      height,
      rotation,
      fontSize: Math.max(Math.round(fontHeight * 10) / 10, MIN_RUN_SIZE),
      fontFamily,
      bold,
      italic,
    });
  }

  return runs;
}

// pdf.js gives generic CSS-style family hints (e.g. "sans-serif",
// "serif", "monospace") plus the PDF's internal font name, rather than
// the embedded font itself -- so this is a best-effort approximation
// mapped onto our editor's existing web-safe font list, not an exact
// match to the original PDF's typeface.
function mapFont(
  cssFamily: string | undefined,
  pdfFontName: string | undefined
): { fontFamily: string; bold: boolean; italic: boolean } {
  const hint = `${cssFamily ?? ''} ${pdfFontName ?? ''}`.toLowerCase();

  let fontFamily = 'Helvetica';
  if (hint.includes('mono')) fontFamily = 'Courier New';
  else if (hint.includes('serif') && !hint.includes('sans')) fontFamily = 'Times New Roman';

  const bold = /bold|black|heavy/.test(hint);
  const italic = /italic|oblique/.test(hint);

  return { fontFamily, bold, italic };
}

interface LinkRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  url: string;
}

// Reads this page's link annotations (the clickable rectangles a PDF
// viewer would normally hotspot, e.g. over a "moen-portfolio.vercel.app"
// line in a resume) and converts each one's rectangle into the same
// top-left-origin point space our text runs use, via the same viewport
// used for text positioning above -- annotation.rect comes in raw PDF
// user space (bottom-left origin), so this conversion is required for
// the coordinates to line up with run.x/run.y at all.
//
// Only external URI links carry a `url` -- internal links (e.g. "jump to
// page 3") report a `dest` instead and are skipped, since there's
// nowhere meaningful in our editor for those to navigate to.
async function extractLinkAnnotations(
  pdfPage: import('pdfjs-dist').PDFPageProxy,
  viewport: import('pdfjs-dist').PageViewport
): Promise<LinkRegion[]> {
  const annotations = await pdfPage.getAnnotations();
  const regions: LinkRegion[] = [];

  for (const annotation of annotations as Array<{
    subtype?: string;
    url?: string;
    rect?: number[];
  }>) {
    if (annotation.subtype !== 'Link' || !annotation.url || !annotation.rect) continue;

    const [rx1, ry1, rx2, ry2] = viewport.convertToViewportRectangle(annotation.rect);
    regions.push({
      x: Math.min(rx1, rx2),
      y: Math.min(ry1, ry2),
      width: Math.abs(rx2 - rx1),
      height: Math.abs(ry2 - ry1),
      url: annotation.url,
    });
  }

  return regions;
}

// Attributes a link region to a run when the run's own center point
// falls inside that region's rectangle. PDF link annotations are
// normally drawn to closely hug the text they cover, so this is enough
// to correctly match without needing full rectangle-overlap math -- and
// it naturally leaves a run untouched (returns undefined) when no link
// region covers it, which is the common case for most of a page's text.
function findLinkForRun(run: ExtractedRun, regions: LinkRegion[]): string | undefined {
  const midX = run.x + run.width / 2;
  const midY = run.y + run.height / 2;

  for (const region of regions) {
    if (
      midX >= region.x &&
      midX <= region.x + region.width &&
      midY >= region.y &&
      midY <= region.y + region.height
    ) {
      return region.url;
    }
  }

  return undefined;
}