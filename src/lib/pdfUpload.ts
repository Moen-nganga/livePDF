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

// Extra width given to each line's combined text beyond pdf.js's measured
// width. pdf.js measures width using the PDF's actual embedded font, but
// we render with a substituted web-safe font (Helvetica/Times/Courier),
// which is very often wider per character. This is used both as a margin
// on the white erase-rectangle (so the original rasterized text is fully
// painted over even if our substitute font renders a touch wider) and as
// the target width PdfCanvas.tsx shrinks a line's fontSize to fit inside,
// if the substitute-font rendering ends up wider still (e.g. running past
// the page edge).
const WIDTH_PADDING_RATIO = 0.25;
const MIN_WIDTH_PADDING = 6;

// How close two runs' baselines need to be (in PDF points) to be treated
// as sitting on the same visual line. Grouping by baseline rather than
// by each run's own top-left y tolerates runs on the same line that use
// different font sizes (e.g. a bold heading next to a smaller gray
// label), since their top edges differ but their baselines line up.
const SAME_LINE_BASELINE_TOLERANCE = 2;

// How large a horizontal gap between two runs on the same line needs to
// be (as a fraction of font size) before we treat it as an actual space
// character that should be reconstructed in the merged line's text, as
// opposed to zero/near-zero gaps that mean two runs are literally
// fragments of one unbroken word (e.g. a link annotation covering only
// part of a URL).
const WORD_GAP_FONT_RATIO = 0.12;
const WORD_GAP_MIN = 0.5;

// The largest horizontal gap between two same-baseline runs that's still
// treated as ordinary same-line spacing (a word gap, or a generous
// badge/date-range gap) rather than a column boundary in a multi-column
// layout (e.g. a resume's sidebar next to its main content). Chosen well
// above any legitimate same-line gap but well below a typical column
// gutter, which tends to be many times wider. Used as the larger of this
// absolute point value and a per-font-size multiple, so bigger headings
// (which can have proportionally bigger legitimate gaps) aren't split
// incorrectly.
const MAX_MERGE_GAP_ABSOLUTE = 60;
const MAX_MERGE_GAP_FONT_RATIO = 4;

// Extra vertical coverage added above/below a line's own font-height when
// painting over the original rasterized text, expressed as a fraction of
// fontHeight. Typographic ascenders/descenders extend beyond the plain em
// box, so erasing only exactly fontHeight tall left slivers of the
// original glyphs (tops of tall letters, descenders on g/y/p) visible
// underneath the new editable text.
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
 *     extracted line's bounding box is painted over with white on the
 *     raster background before it's exported.
 *
 * Every visual LINE in the PDF becomes exactly one TextObject, not one
 * per pdf.js text item. pdf.js splits a line into several separate items
 * whenever there's a styling change partway through it (a bolded word, an
 * italic phrase, a hyperlink covering part of a URL) -- independently
 * positioning and sizing each of those fragments next to our substituted
 * web-safe font turned out to be fundamentally unreliable, since the
 * substitute font can never guarantee it ends at exactly the pixel the
 * original embedded font did, and any mismatch shows up as either visible
 * overlap or a stray gap mid-word. Merging every run on a line into one
 * segment removes that seam entirely -- there's nothing left to
 * misalign, since the whole line is measured, laid out, and rendered as
 * a single piece of text. The trade-off is that a line can only carry one
 * font style, so a line that mixes styles (e.g. a link in the middle of
 * a sentence, rather than on its own line) will render uniformly in the
 * first run's style rather than preserving the mid-line styling change.
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

    // Extract raw pdf.js text runs first (in unscaled/point space).
    const textContent = await pdfPage.getTextContent();
    const rawRuns = extractTextRuns(textContent, unscaledViewport);

    // Attach any link the PDF itself defines to each raw run, before
    // merging -- matching against each run's own (small, precise)
    // bounding box gives a much more accurate result than matching
    // against an entire merged line would, since a link annotation often
    // covers only part of a line. See extractLinkAnnotations and
    // findLinkForRun below. PdfCanvas.tsx already knows how to render a
    // TextObject's `link` field (underlined, Ctrl/Cmd+click to open) --
    // this was just never being populated for uploaded PDFs.
    const linkRegions = await extractLinkAnnotations(pdfPage, unscaledViewport);
    for (const run of rawRuns) {
      run.link = findLinkForRun(run, linkRegions);
    }

    // Now collapse every line down to a single run -- see the function
    // comment and the doc-comment above for why.
    const lines = mergeRunsPerLine(rawRuns);

    // Hard guarantee, independent of the merge logic above: no line's
    // rendered box is allowed to reach into where any other nearby
    // content on the page starts. See capWidthsAgainstNearbyContent's own
    // comment for why this check isn't limited to same-baseline
    // neighbors the way merging is.
    capWidthsAgainstNearbyContent(lines);

    // Render the raster background at full quality.
    const renderViewport = pdfPage.getViewport({ scale: RENDER_SCALE });
    const canvas = window.document.createElement('canvas');
    canvas.width = renderViewport.width;
    canvas.height = renderViewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context for PDF render');

    await pdfPage.render({ canvasContext: ctx, viewport: renderViewport }).promise;

    // Paint over each line's footprint so the flattened original text
    // doesn't show through underneath the new editable TextObject sitting
    // at the same spot. Coordinates were computed in unscaled (scale 1)
    // space, so scale up by RENDER_SCALE to match this canvas. Erased
    // using each line's *padded* bounds (see erasePaddedBounds), not its
    // raw pdf.js-measured bounds, so the erase covers ascenders/
    // descenders and the same extra width margin the TextObject itself
    // gets -- otherwise slivers of the original glyphs peek out from
    // under the new text.
    // NOTE: this assumes a white/light page background -- a line sitting
    // on a colored panel (e.g. a colored sidebar) will show a faint white
    // patch instead of blending in.
    ctx.fillStyle = '#ffffff';
    for (const line of lines) {
      const bounds = erasePaddedBounds(line);
      ctx.fillRect(
        bounds.x * RENDER_SCALE,
        bounds.y * RENDER_SCALE,
        bounds.width * RENDER_SCALE,
        bounds.height * RENDER_SCALE
      );
    }

    const objects: TextObject[] = lines.map((line) => ({
      id: nanoid(),
      type: 'text',
      x: line.x,
      y: line.y,
      width: paddedWidth(line),
      height: line.height,
      rotation: line.rotation,
      opacity: 1,
      text: line.text,
      fontSize: line.fontSize,
      fontFamily: line.fontFamily,
      color: '#111111', // pdf.js text content doesn't expose fill color; see note above
      bold: line.bold,
      italic: line.italic,
      strikethrough: false,
      align: 'left',
      link: line.link,
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

// A line's width including WIDTH_PADDING_RATIO's margin -- used both as
// the erase-rectangle width and (via PdfCanvas.tsx's fontSize-shrink
// logic) as the ceiling a line's rendered text is allowed to reach before
// it gets shrunk to fit. Two different things can force this down below
// the padded ideal: running past the page edge, or (see
// capWidthsAgainstNearbyContent) reaching into where other nearby
// content on the page starts -- whichever is tighter wins.
function paddedWidth(line: ExtractedRun): number {
  const padded = line.width + Math.max(line.width * WIDTH_PADDING_RATIO, MIN_WIDTH_PADDING);
  if (line.maxWidthNeighbor === undefined) return padded;
  return Math.max(1, Math.min(padded, line.maxWidthNeighbor));
}

// Hard safety net, separate from and in addition to mergeRunsPerLine's
// gap-based splitting: for every line, look at every OTHER line on the
// page that starts to its right and vertically overlaps it even
// partially (not just an exact same-baseline match), and cap this line's
// width so it can never reach that neighbor's starting position.
//
// mergeRunsPerLine's gap heuristic only ever compares runs that share
// (almost) the exact same baseline -- which handles the common case
// where sidebar and main-column headings happen to align, but doesn't
// catch every case: a long line in one column and a short line in
// another can sit at very slightly different baselines (a point or two
// off) while still visually overlapping in vertical extent, especially
// once line-height/leading is accounted for. This pass is a stricter,
// content-aware guarantee that doesn't depend on baseline alignment at
// all -- no line's box can ever physically reach into space any other
// nearby text occupies, regardless of which line, column, or baseline it
// belongs to. This works even for documents like this resume, which use
// plain whitespace to separate columns rather than a drawn divider line
// -- there's no rule/border to detect here, only nearby content to avoid.
//
// O(n^2) in the number of lines on a page, which is trivial even for a
// dense multi-column document (at most a few hundred lines per page).
const CROSS_LINE_SAFETY_GAP = 4;

function capWidthsAgainstNearbyContent(lines: ExtractedRun[]): void {
  for (const line of lines) {
    if (line.rotation !== 0) continue;

    let nearestRightX: number | undefined;
    for (const other of lines) {
      if (other === line || other.rotation !== 0) continue;
      if (other.x <= line.x) continue; // only content genuinely to the right matters

      const verticalOverlap = line.y < other.y + other.height && other.y < line.y + line.height;
      if (!verticalOverlap) continue;

      if (nearestRightX === undefined || other.x < nearestRightX) {
        nearestRightX = other.x;
      }
    }

    if (nearestRightX !== undefined) {
      line.maxWidthNeighbor = Math.max(1, nearestRightX - line.x - CROSS_LINE_SAFETY_GAP);
    }
  }
}

// Groups runs into visual lines (by baseline proximity, tolerating runs
// on the same line that differ in font size) and collapses each line down
// into a single run, reconstructing normal word spacing between the
// original pdf.js items along the way.
//
// pdf.js splits a line into multiple text items wherever a styling change
// occurs partway through it -- a bolded word, an italic phrase, a
// hyperlink covering part of a URL -- not just at natural word
// boundaries. Trying to independently position and size-fit each of
// those fragments next to our substituted web-safe font is what caused
// the recurring overlap issues: the substitute font can't guarantee it
// ends at exactly the pixel the original embedded font's fragment did, so
// any mismatch reads as visible overlap or a stray gap. Merging removes
// the seam entirely -- there's one piece of text per line, laid out and
// rendered as one piece, the same way ordinary typed text would be.
//
// The merged line takes its position, font size, and style from its
// first run. Any run in the line that had a link (see findLinkForRun)
// makes the whole merged line a link -- seen in practice, links have
// always sat on their own line rather than mid-sentence, so this hasn't
// been an issue, but a line that both mixes styling *and* only partially
// contains a link will have that link's clickable area cover the entire
// line, not just the originally-linked words.
//
// Only non-rotated runs are merged this way -- rotated text (stamps,
// sidebars) is rare enough, and "same line" is a much fuzzier concept for
// it, that each rotated run is kept as its own TextObject untouched.
function mergeRunsPerLine(runs: ExtractedRun[]): ExtractedRun[] {
  const horizontal = runs.filter((r) => r.rotation === 0);
  const rotated = runs.filter((r) => r.rotation !== 0);

  const withBaseline = horizontal.map((run) => ({ run, baseline: run.y + run.fontSize }));
  withBaseline.sort((a, b) => a.baseline - b.baseline || a.run.x - b.run.x);

  const merged: ExtractedRun[] = [];

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

    // Split this baseline group into separate segments wherever the gap
    // between two consecutive runs is too large to plausibly be an
    // ordinary word or badge/date gap -- e.g. a sidebar heading and a
    // main-column heading that happen to land on the same baseline in a
    // multi-column layout, separated by the column gutter rather than by
    // a normal amount of text spacing. Without this, every run sharing a
    // baseline got fused into one line regardless of how far apart they
    // actually were, which is what fused sidebar and main-column text
    // together into nonsense like "DATABASES Full-Stack Developer...".
    //
    // This is a size-based heuristic, not true detection of the PDF's
    // actual drawn column-divider line (which would require parsing the
    // page's vector drawing operations) -- but column gutters are, in
    // practice, dramatically wider than any legitimate same-line gap
    // (a word space, or even a generous badge/date-range gap), so a
    // large-gap threshold reliably tells them apart.
    let segmentStart = 0;
    for (let i = 1; i <= line.length; i++) {
      const atEnd = i === line.length;
      if (!atEnd) {
        const prev = line[i - 1];
        const run = line[i];
        const gap = run.x - (prev.x + prev.width);
        const maxPlausibleGap = Math.max(MAX_MERGE_GAP_ABSOLUTE, prev.fontSize * MAX_MERGE_GAP_FONT_RATIO);
        if (gap <= maxPlausibleGap) continue; // still plausibly the same line -- keep extending this segment
      }

      merged.push(buildMergedSegment(line.slice(segmentStart, i)));
      segmentStart = i;
    }

    lineStart = lineEnd;
  }

  return [...merged, ...rotated];
}

// Combines a run of same-baseline, close-enough-together fragments (one
// segment, as decided by mergeRunsPerLine above) into a single run,
// reconstructing normal word spacing between the original pdf.js items
// along the way. See mergeRunsPerLine's own comment for why merging
// happens at all.
function buildMergedSegment(segment: ExtractedRun[]): ExtractedRun {
  const first = segment[0];
  const last = segment[segment.length - 1];

  let text = '';
  let link: string | undefined;

  for (let i = 0; i < segment.length; i++) {
    const run = segment[i];

    if (i > 0) {
      const prev = segment[i - 1];
      const gap = run.x - (prev.x + prev.width);
      const wordGapThreshold = Math.max(WORD_GAP_MIN, prev.fontSize * WORD_GAP_FONT_RATIO);
      // Only insert a space if there's a real gap AND neither side
      // already has one -- pdf.js sometimes includes the space in a
      // run's own trailing/leading text, and double-spacing would look
      // just as wrong as missing the space entirely.
      if (gap > wordGapThreshold && !text.endsWith(' ') && !run.text.startsWith(' ')) {
        text += ' ';
      }
    }

    text += run.text;
    if (!link && run.link) link = run.link;
  }

  return {
    text,
    x: first.x,
    y: first.y,
    width: last.x + last.width - first.x,
    height: Math.max(...segment.map((r) => r.height)),
    rotation: 0,
    fontSize: first.fontSize,
    // The tallest font size among every run merged into this segment,
    // kept separate from the rendering fontSize above (which
    // intentionally stays the first run's, so the merged segment renders
    // in one uniform style). This is only used by erasePaddedBounds -- if
    // a segment merges a smaller fragment with a taller one (e.g. a
    // slightly larger amount in an invoice row), erasing based on just
    // the first run's (possibly smaller) font size wasn't tall enough to
    // fully cover the taller fragment's original glyphs, leaving a
    // sliver of the original rasterized text visible behind/around the
    // new text -- which reads as smudged/doubled, easy to mistake for
    // "blurry."
    eraseFontSize: Math.max(...segment.map((r) => r.fontSize)),
    fontFamily: first.fontFamily,
    bold: first.bold,
    italic: first.italic,
    link,
  };
}

// The enlarged rectangle we paint white over on the raster background for
// a given line -- wider than the line's own measured width (so the erase
// always covers at least as much as the new editable text sits on top of)
// and taller than its raw font-height (to catch ascenders above and
// descenders below what a plain em-box would cover).
function erasePaddedBounds(line: ExtractedRun): { x: number; y: number; width: number; height: number } {
  const width = paddedWidth(line);
  const eraseFontSize = line.eraseFontSize ?? line.fontSize;
  const ascent = eraseFontSize * ERASE_ASCENT_RATIO;
  const descent = eraseFontSize * ERASE_DESCENT_RATIO;
  const baseline = line.y + line.fontSize; // line.y is stored as the box's top edge, one fontHeight above baseline

  return {
    x: line.x,
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
  // The URL of the link annotation this run falls inside, if any -- set
  // by findLinkForRun using the regions from extractLinkAnnotations.
  link?: string;
  // Set by mergeRunsPerLine to the tallest font size among all the
  // original runs merged into this line -- see the comment where it's
  // set for why this needs to be tracked separately from fontSize.
  eraseFontSize?: number;
  // Set by capWidthsAgainstNearbyContent to the furthest this line's box
  // is allowed to extend before it would reach another nearby piece of
  // content on the page. Undefined means no nearby content was found to
  // its right.
  maxWidthNeighbor?: number;
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