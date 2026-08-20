import '../lib/pdfjsSetup';
import { getDocument, OPS } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { nanoid } from 'nanoid';
import type { Page, PageObject, RectObject, TextObject } from '../types/document';

// How much larger than the PDF's own point size to rasterize the page
// background at. A flat 2x oversample looks sharp on a standard 1x
// screen, but on a retina/high-DPI display (devicePixelRatio 2 or 3 --
// most modern laptops and virtually all phones) the browser has to
// stretch that same fixed-resolution bitmap further to fill the same
// physical screen space, which is what reads as "blurry" -- specifically
// in whatever part of the page is still raster background (images,
// colored panels, borders, decorative graphics) rather than extracted,
// vector-rendered text, which stays crisp at any zoom regardless of this
// constant. Scaling with the actual screen's devicePixelRatio keeps the
// background sharp on every display instead of only ever targeting 1x.
// Capped so an unusually high devicePixelRatio doesn't balloon
// rasterization time/memory for resolution beyond what's visible.
const MIN_RENDER_SCALE = 2;
const MAX_RENDER_SCALE = 4;
const RENDER_SCALE = Math.min(
  MAX_RENDER_SCALE,
  Math.max(MIN_RENDER_SCALE, (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1) * 2)
);

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
//
// NOTE: this is now a secondary/fallback signal. The primary defense
// against fusing columns together is computeGlobalGutters below -- see
// its comment for why a per-line gap size alone isn't reliable.
const MAX_MERGE_GAP_ABSOLUTE = 60;
const MAX_MERGE_GAP_FONT_RATIO = 4;

// How wide a horizontal strip of the page has to be -- and never once
// touched by any text run, anywhere on the page -- before we trust it as
// a genuine column gutter rather than coincidental whitespace. See
// computeGlobalGutters for the full reasoning.
const MIN_GUTTER_WIDTH = 14;

// Fallback extra vertical coverage above/below a line's own font-height
// when painting over the original rasterized text, expressed as a
// fraction of fontHeight -- used only if a browser's canvas TextMetrics
// doesn't expose actualBoundingBoxAscent/Descent (see measureTextMetrics
// and erasePaddedBounds, which use a real per-line measurement instead
// whenever it's available). Typographic ascenders/descenders extend
// beyond the plain em box, so erasing only exactly fontHeight tall left
// slivers of the original glyphs (tops of tall letters, descenders on
// g/y/p) visible underneath the new editable text.
const ERASE_ASCENT_RATIO = 1.3;
const ERASE_DESCENT_RATIO = 0.35;

// Fill color for ordinary extracted text. pdf.js text content doesn't
// expose the original fill color, so every non-link run gets this flat
// near-black.
const TEXT_COLOR = '#111111';

// Fill color for lines that carry a link (see findLinkForRun). Paired
// with PdfCanvas.tsx's `underline: !!obj.link`, this is what makes a
// link visually read as a link -- underlined AND a distinct light-blue
// color -- rather than just underlined near-black text that's easy to
// mistake for a stray formatting artifact.
const LINK_COLOR = '#1a73e8';

// Many PDF generators draw list bullets/markers using a symbol font
// (Wingdings, Symbol, etc.) whose glyphs live at Private-Use-Area code
// points that mean "a round bullet" or "a square bullet" only in THAT
// specific font. Our web-safe substitute fonts (Helvetica/Times/Courier)
// have no glyph at those code points at all, so the browser renders a
// "missing glyph" box (looks like a small hollow square, "tofu") instead
// of the bullet the PDF author intended. This maps the handful of code
// points that show up this way in practice onto real Unicode punctuation
// that every web-safe font actually has a glyph for. Not exhaustive --
// there's no general way to know what an arbitrary PDF's symbol font
// intended for a given code point -- but covers the common cases.
const GLYPH_SUBSTITUTIONS: Record<string, string> = {
  '\uf0b7': '\u2022', // Wingdings solid round bullet -> •
  '\uf0a7': '\u25aa', // Wingdings solid square bullet -> ▪
  '\uf0d8': '\u2192', // Wingdings arrow -> →
  '\uf06c': '\u2666', // Wingdings solid diamond -> ♦
  '\uf0fc': '\u2713', // Wingdings checkmark -> ✓
};

function normalizeGlyphs(text: string): string {
  let out = text;
  for (const [from, to] of Object.entries(GLYPH_SUBSTITUTIONS)) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  return out;
}

// ---------------------------------------------------------------------
// Underline-rule detection
// ---------------------------------------------------------------------
// A heading's underline is very rarely a font attribute -- pdf.js's
// getTextContent() (what extractTextRuns below reads) has no "underline"
// property at all, because the vast majority of PDF generators (Word,
// Google Docs, LibreOffice) draw an underline as an actual thin filled
// rectangle in the page's own drawing commands: PDF's `re` (construct a
// rectangle path) immediately followed by `f` (fill it). Left alone,
// that rectangle just becomes part of the flattened raster
// backgroundImage -- a static pixel that doesn't move if the heading
// text above it is later edited, resized, or repositioned, and isn't
// erased by the text-erasure pass below (an all-caps heading has near-
// zero descent, so erasePaddedBounds' measured erase region often
// doesn't reach down to where the rule actually sits).
//
// This scans the page's full operator list (its literal drawing
// commands, via pdf.js's getOperatorList -- a different, lower-level API
// than getTextContent) for exactly that pattern, and converts each match
// into a real, draggable/resizable isUnderline RectObject (the same kind
// the toolbar's "+ Underline" button creates) positioned and sized to
// match the original rule exactly -- then erases that rule's footprint
// from the raster background so there's no duplicate.
//
// KNOWN LIMITATIONS (heuristic, not exhaustive):
//  - Only catches a rule drawn as ONE simple rectangle path immediately
//    followed by a fill. A double/dashed underline drawn as multiple
//    rectangles in a single path, or an underline drawn as a stroked
//    line (moveto/lineto/stroke) rather than a filled rect, won't be
//    picked up -- it'll fall back to living in the raster background as
//    before.
//  - Only non-rotated (or exactly-180°-rotated) rules are converted --
//    a genuinely angled rule is left alone rather than risk a wrong
//    bounding box.
//  - This finds every thin, wide filled rectangle on the page, not just
//    ones sitting under a heading -- an unrelated decorative divider bar
//    that happens to match the same width/height/aspect-ratio heuristic
//    would also get converted. In practice this is rare enough (real
//    decorative dividers are usually much wider/thicker, or a different
//    color region entirely) not to be a problem, but it's a heuristic,
//    not a guarantee.

// How thick a filled rectangle is allowed to be and still count as an
// underline rule rather than some other filled shape (a colored panel, a
// table cell background, a checkbox/bullet fill). Typical underline
// thickness in real documents is well under this.
const MAX_UNDERLINE_RULE_HEIGHT = 4;

// How much wider than it is tall a filled rectangle needs to be to count
// as a rule rather than a near-square fill (a checkbox, a small bullet
// square, a color swatch). Even a short underline under a 2-3 character
// word comfortably clears this.
const MIN_UNDERLINE_ASPECT_RATIO = 6;

// Guards against stray hairline-width filled rectangles some PDF
// generators emit for antialiasing/hinting purposes that aren't a real,
// visible underline at all.
const MIN_UNDERLINE_RULE_WIDTH = 6;

// How far from perfectly horizontal (0° or 180°, since a rectangle's
// "which way is up" is ambiguous under an arbitrary transform) a rule's
// computed rotation is allowed to be before we treat it as genuinely
// rotated and leave it alone rather than risk a wrong bounding box.
const UNDERLINE_RULE_ROTATION_TOLERANCE_DEG = 1;

// Extra margin (in PDF points, each side) added when erasing a detected
// rule's footprint from the raster background -- covers anti-aliased
// edges around the original fill so no thin sliver of it is left
// visible next to the new, separately-rendered RectObject sitting in
// its place.
const UNDERLINE_RULE_ERASE_PADDING = 1;

interface DetectedUnderlineRule {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Applies a PDF affine transform matrix [a,b,c,d,e,f] to a single POINT
// (x,y) -- distinct from combineTransforms below, which composes two
// matrices together rather than transforming a coordinate. PDF content
// streams give constructPath's rectangle coordinates in the *local*
// space active when that path was drawn (verified against pdf.js's own
// getOperatorList output -- a rectangle's coordinates and bounding box
// are NOT pre-adjusted for any `cm` transform that was active when it
// was drawn), so this is what turns those local numbers into real,
// absolute page-point coordinates once combined with the accumulated
// CTM (see detectUnderlineRules below).
function applyMatrixToPoint(m: number[], x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

// Scans this page's raw drawing commands for thin filled rectangles that
// look like underline rules -- see the file-level comment above this
// section for the full reasoning and known limitations.
//
// pdf.js's operator list gives every path's coordinates in the LOCAL
// coordinate space active at the moment it was drawn -- it does NOT
// pre-multiply them by whatever `cm` (transform) was in effect, the way
// a naive read of getOperatorList's output might suggest. So this walks
// the operator list itself, maintaining its own copy of the content
// stream's transform stack (mirroring `q`/`Q`/`cm`, i.e. OPS.save /
// OPS.restore / OPS.transform), the same bookkeeping the PDF spec itself
// requires a renderer to do -- then applies the accumulated transform
// (combined with the page's own viewport transform, exactly like
// extractTextRuns and extractLinkAnnotations already do for glyphs and
// link rectangles) to each candidate rectangle's corners to land in the
// same top-left-origin point space every other extracted object here
// uses.
//
// Takes the operator list as a parameter rather than fetching it itself
// -- pdfFileToPages needs to call getOperatorList() early regardless
// (see its own comment), since that's also what loads real font
// bold/italic metadata into commonObjs for extractTextRuns to read, so
// this reuses that same call instead of fetching the whole operator list
// from scratch a second time.
async function detectUnderlineRules(
  opList: { fnArray: number[]; argsArray: unknown[] },
  viewport: import('pdfjs-dist').PageViewport
): Promise<DetectedUnderlineRule[]> {
  const { fnArray, argsArray } = opList;
  const results: DetectedUnderlineRule[] = [];

  let ctm: number[] = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];

    if (fn === OPS.save) {
      stack.push(ctm);
      continue;
    }
    if (fn === OPS.restore) {
      ctm = stack.pop() ?? ctm;
      continue;
    }
    if (fn === OPS.transform) {
      const m = argsArray[i] as number[];
      ctm = combineTransforms(ctm, m);
      continue;
    }
    if (fn !== OPS.constructPath) continue;

    // args shape verified directly against pdf.js's actual output:
    // [subPathOpCodes, flatCoords, minMax]. We only recognize the
    // simplest, overwhelmingly common case a text-editor-exported PDF
    // uses to draw an underline: a path that's just ONE rectangle
    // subpath (`re`), immediately painted (`f`/`f*`) rather than used as
    // a clip region or left unpainted.
    const args = argsArray[i] as [number[], number[], number[]];
    const [subOps, coords] = args;
    const isSingleRect = subOps.length === 1 && subOps[0] === OPS.rectangle;
    if (!isSingleRect) continue;

    const nextFn = fnArray[i + 1];
    const wasFilled = nextFn === OPS.fill || nextFn === OPS.eoFill;
    if (!wasFilled) continue;

    const [rx, ry, rw, rh] = coords;
    const full = combineTransforms(viewport.transform, ctm);

    // Only trust this as a genuine horizontal rule if the combined
    // transform is (within tolerance) unrotated -- otherwise the
    // corner-based bounding box below wouldn't represent the rule's
    // actual shape, and we'd rather leave a rotated rule in the raster
    // background than convert it into a wrong-shaped object.
    const rotation = (Math.atan2(full[1], full[0]) * 180) / Math.PI;
    const normalizedRotation = ((rotation % 180) + 180) % 180;
    const isAxisAligned =
      normalizedRotation <= UNDERLINE_RULE_ROTATION_TOLERANCE_DEG ||
      normalizedRotation >= 180 - UNDERLINE_RULE_ROTATION_TOLERANCE_DEG;
    if (!isAxisAligned) continue;

    const corners = [
      applyMatrixToPoint(full, rx, ry),
      applyMatrixToPoint(full, rx + rw, ry),
      applyMatrixToPoint(full, rx, ry + rh),
      applyMatrixToPoint(full, rx + rw, ry + rh),
    ];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(...xs) - x;
    const height = Math.max(...ys) - y;

    if (width <= 0 || height <= 0) continue;
    if (width < MIN_UNDERLINE_RULE_WIDTH) continue;
    if (height > MAX_UNDERLINE_RULE_HEIGHT) continue;
    if (width / height < MIN_UNDERLINE_ASPECT_RATIO) continue;

    results.push({ x, y, width, height });
  }

  return results;
}

/**
 * Reads an uploaded PDF file and converts each page into a Page object.
 *
 * Three things happen per page, in order:
 *  1. The page is rasterized to an image via pdf.js (as before) and kept
 *     as backgroundImage, so layout, images, vector art, etc. all still
 *     look correct.
 *  2. The page's real text (via pdf.js's getTextContent) is extracted
 *     into actual editable TextObjects, positioned to match where the
 *     text sits on the page. To avoid the original (now-uneditable)
 *     glyphs showing through underneath the new editable text, each
 *     extracted line's bounding box is painted over with white on the
 *     raster background before it's exported.
 *  3. The page's raw drawing commands are scanned for thin filled
 *     rectangles that look like underline rules (see
 *     detectUnderlineRules above) and each one is converted into a real,
 *     draggable/resizable isUnderline RectObject rather than being left
 *     as a static pixel in the raster background.
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
 * a sentence, rather than on its own line) will render uniformly in one
 * run's style rather than preserving the mid-line styling change -- see
 * buildMergedSegment for which run's style that ends up being and why.
 *
 * Multi-column layouts (e.g. a resume with a sidebar) add a second
 * wrinkle: two runs that happen to share a baseline can belong to two
 * completely different columns rather than the same sentence. See
 * computeGlobalGutters and mergeRunsPerLine for how that's detected and
 * kept from being fused into nonsense like "MongoDB) Highly experienced...".
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

    // Fetched early and deliberately -- getOperatorList() is what
    // actually loads each font used on this page into pdfPage.commonObjs
    // with its real, authoritative bold/italic flags (parsed by pdf.js
    // itself from the font's own FontDescriptor), which extractTextRuns
    // below needs. Without this call first, commonObjs.has() for any
    // font on the page returns false and pdf.js throws if you try to
    // .get() it anyway -- see mapFont's own comment for why this matters
    // and what it replaces. This same result also feeds
    // detectUnderlineRules further down, so it isn't fetched twice.
    const opList = await pdfPage.getOperatorList();

    // Extract raw pdf.js text runs first (in unscaled/point space).
    const textContent = await pdfPage.getTextContent();
    const rawRuns = extractTextRuns(textContent, unscaledViewport, pdfPage);

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

    // Work out this page's real column structure -- if it has one --
    // BEFORE any merging happens, from every raw run on the page. See
    // computeGlobalGutters's own comment for why this has to run first
    // and be page-wide rather than a per-line gap check.
    const gutters = computeGlobalGutters(rawRuns);

    // Now collapse every line down to a single run -- see the function
    // comment and the doc-comment above for why. Column gutters detected
    // above are treated as hard boundaries here: two runs never get
    // fused together across one, no matter how narrow their gap looks on
    // that particular row.
    const lines = mergeRunsPerLine(rawRuns, gutters);

    // Hard guarantee, independent of the merge logic above: no line's
    // rendered box is allowed to reach into where any other nearby
    // content on the page starts. See capWidthsAgainstNearbyContent's own
    // comment for why this check isn't limited to same-baseline
    // neighbors the way merging is. This remains a second, independent
    // layer -- it catches near-miss baseline alignment between columns
    // that computeGlobalGutters's page-wide analysis wasn't needed for,
    // it just stops the box from visually reaching too far, whereas the
    // gutter check above stops the wrong text from being fused into one
    // object in the first place.
    capWidthsAgainstNearbyContent(lines);

    // Find any underline rules drawn on this page -- see
    // detectUnderlineRules's own comment for the full reasoning. Reuses
    // the operator list already fetched above (see its own comment).
    const underlineRules = await detectUnderlineRules(opList, unscaledViewport);

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
    // Same erase pass, extended to also blank out every detected
    // underline rule's footprint -- each one is becoming its own real,
    // separately-rendered RectObject below, so the static pixels it used
    // to occupy in the raster background need to go, or the page would
    // show both the new draggable bar AND the old fixed one underneath.
    for (const rule of underlineRules) {
      const x = rule.x - UNDERLINE_RULE_ERASE_PADDING;
      const y = rule.y - UNDERLINE_RULE_ERASE_PADDING;
      const width = rule.width + UNDERLINE_RULE_ERASE_PADDING * 2;
      const height = rule.height + UNDERLINE_RULE_ERASE_PADDING * 2;
      ctx.fillRect(x * RENDER_SCALE, y * RENDER_SCALE, width * RENDER_SCALE, height * RENDER_SCALE);
    }

    const textObjects: TextObject[] = lines.map((line) => ({
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
      color: line.link ? LINK_COLOR : TEXT_COLOR,
      bold: line.bold,
      italic: line.italic,
      strikethrough: false,
      align: 'left',
      link: line.link,
    }));

    // Each detected rule becomes a real underline object -- same shape
    // the toolbar's "+ Underline" button creates (see Toolbar.tsx's
    // addUnderline), so it's draggable/resizable (length-only, per
    // PdfCanvas.tsx's isUnderline resize handling) exactly like a
    // manually-added one, just pre-populated at the position/length the
    // original PDF actually drew it at.
    const underlineObjects: RectObject[] = underlineRules.map((rule) => ({
      id: nanoid(),
      type: 'rect',
      isUnderline: true,
      x: rule.x,
      y: rule.y,
      width: rule.width,
      height: rule.height,
      rotation: 0,
      opacity: 1,
      fill: '#111111',
      stroke: '#111111',
      strokeWidth: 0,
      cornerRadius: 0,
    }));

    const objects: PageObject[] = [...textObjects, ...underlineObjects];

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
// gap-based and gutter-based splitting: for every line, look at every
// OTHER line on the page that starts to its right and vertically
// overlaps it even partially (not just an exact same-baseline match),
// and cap this line's width so it can never reach that neighbor's
// starting position.
//
// mergeRunsPerLine's heuristics only ever compare runs that share
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

// A horizontal (x-axis only) range in PDF point space.
interface XInterval {
  start: number;
  end: number;
}

// Finds this page's real column gutters -- vertical strips of horizontal
// space that NO text run anywhere on the page ever touches -- by
// projecting every run's x-extent onto a single axis and looking at what's
// left uncovered, page-wide.
//
// This exists because a per-line gap-size check (the original approach,
// still kept below as MAX_MERGE_GAP_ABSOLUTE/MAX_MERGE_GAP_FONT_RATIO) is
// fundamentally unreliable for detecting column boundaries: it only ever
// looks at ONE row in isolation. A two-column resume's sidebar and main
// column can easily have a narrower-than-usual local gap on any single
// row -- e.g. a long sidebar line ("MySQL, PostgreSQL, MongoDB)") ending
// close to where that row's main-column text happens to start -- and a
// per-line check has no way to tell that apart from a legitimate,
// if generous, same-line gap. That's exactly what caused sidebar and
// main-column text to fuse into nonsense like "MongoDB) Highly
// experienced...": the wrong decision only had to be made once, on one
// row, for the columns to bleed into each other on that line.
//
// Looking at the WHOLE page fixes this: a genuine column gutter is, by
// definition, a strip of x-space that's never used by text on either
// side across every row of the document -- if it were ever crossed
// anywhere, it wouldn't be a column boundary, it'd just be a line that
// happens to span both "columns" (e.g. a full-width paragraph). That
// makes gutters detectable independent of any single row's local gap
// size, and immune to the coincidentally-narrow-row problem above.
//
// Only non-rotated runs are considered, matching mergeRunsPerLine's own
// scope (rotated text like stamps/sidebars is handled separately and
// never merged).
function computeGlobalGutters(runs: ExtractedRun[]): XInterval[] {
  const horizontal = runs.filter((r) => r.rotation === 0);
  if (horizontal.length < 2) return [];

  const occupied = horizontal
    .map((r) => ({ start: r.x, end: r.x + r.width }))
    .sort((a, b) => a.start - b.start);

  // Merge overlapping/touching occupied x-ranges into a minimal set of
  // "text lives here somewhere on the page" intervals.
  const merged: XInterval[] = [];
  for (const iv of occupied) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }

  // Whatever's left between consecutive occupied intervals -- if wide
  // enough to plausibly be a deliberate gutter rather than ordinary
  // kerning noise -- is a candidate column boundary.
  const gutters: XInterval[] = [];
  for (let i = 1; i < merged.length; i++) {
    const start = merged[i - 1].end;
    const end = merged[i].start;
    if (end - start >= MIN_GUTTER_WIDTH) {
      gutters.push({ start, end });
    }
  }

  return gutters;
}

// True if the horizontal gap [gapStart, gapEnd) between two consecutive
// same-baseline runs overlaps any detected column gutter -- meaning
// those two runs sit on opposite sides of a real column boundary and
// must never be fused into one line, regardless of how small this
// particular gap looks.
function gapCrossesGutter(gapStart: number, gapEnd: number, gutters: XInterval[]): boolean {
  return gutters.some((g) => gapStart < g.end && g.start < gapEnd);
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
// The merged line takes its position from its first run and its style
// from whichever run buildMergedSegment picks as "primary" (see that
// function's own comment -- normally the first run too, except for
// bulleted lines, where the bullet glyph itself is usually the first
// run and picking it would give the entire line the wrong font). Any
// run in the line that had a link (see findLinkForRun) makes the whole
// merged line a link -- seen in practice, links have always sat on their
// own line rather than mid-sentence, so this hasn't been an issue, but a
// line that both mixes styling *and* only partially contains a link will
// have that link's clickable area cover the entire line, not just the
// originally-linked words.
//
// Only non-rotated runs are merged this way -- rotated text (stamps,
// sidebars) is rare enough, and "same line" is a much fuzzier concept for
// it, that each rotated run is kept as its own TextObject untouched.
function mergeRunsPerLine(runs: ExtractedRun[], gutters: XInterval[]): ExtractedRun[] {
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

    // Split this baseline group into separate segments wherever any of:
    //  (a) the gap between two consecutive runs crosses a page-wide
    //      column gutter (see computeGlobalGutters) -- checked first,
    //      since it's the reliable signal; or
    //  (b) as a fallback for pages with no detected gutter structure
    //      (e.g. genuinely single-column documents), the gap is just too
    //      large to plausibly be an ordinary word or badge/date gap; or
    //  (c) the run's link status changes -- one run has a link and its
    //      neighbor doesn't (or they have two different links).
    //
    // (c) matters because buildMergedSegment applies a single run's link
    // (if any) to the ENTIRE merged segment -- see its own comment. If a
    // line reads "A collection of development work — moen-portfolio.
    // vercel.app" and only the URL itself is an actual link annotation,
    // merging the whole line into one segment would make the descriptive
    // sentence in front of it clickable and blue too, when only the URL
    // should be. Splitting at the link boundary keeps the plain-text part
    // and the linked part as two separate TextObjects, so only the
    // actually-linked one gets the link's styling.
    //
    // Without (a)/(b), every run sharing a baseline got fused into one
    // line regardless of how far apart they actually were, which is what
    // fused sidebar and main-column text together into nonsense like
    // "DATABASES Full-Stack Developer...".
    //
    // A (c)-only split (no gutter, gap not too large -- i.e. two chunks
    // of what's really one continuous sentence, just forced apart to
    // isolate the link) is flagged via chainedFromPrevious so the
    // repositioning pass below can re-anchor the second piece to where
    // the first piece will *actually* render, rather than trusting the
    // small original PDF gap -- see that pass's own comment for why.
    let segmentStart = 0;
    let pendingChain = false;
    for (let i = 1; i <= line.length; i++) {
      const atEnd = i === line.length;
      let splitHere = atEnd;
      let isChainSplit = false;
      if (!atEnd) {
        const prev = line[i - 1];
        const run = line[i];
        const gapStart = prev.x + prev.width;
        const gapEnd = run.x;

        const crossesGutter = gapCrossesGutter(gapStart, gapEnd, gutters);
        const maxPlausibleGap = Math.max(MAX_MERGE_GAP_ABSOLUTE, prev.fontSize * MAX_MERGE_GAP_FONT_RATIO);
        const gapTooLarge = gapEnd - gapStart > maxPlausibleGap;
        const linkChanges = prev.link !== run.link;

        splitHere = crossesGutter || gapTooLarge || linkChanges;
        isChainSplit = linkChanges && !crossesGutter && !gapTooLarge;
      }

      if (!splitHere) continue; // still plausibly the same line -- keep extending this segment

      const segment = buildMergedSegment(line.slice(segmentStart, i));
      segment.chainedFromPrevious = pendingChain;
      merged.push(segment);
      pendingChain = isChainSplit;
      segmentStart = i;
    }

    lineStart = lineEnd;
  }

  // Re-anchor every chainedFromPrevious segment (see above) to sit right
  // after where the PRECEDING segment will actually render, rather than
  // at its own original pdf.js x. This matters because the two segments
  // were, before this link-driven split, one continuous piece of prose
  // separated only by an ordinary word-sized gap in the original PDF's
  // (often narrower) embedded font -- there's no column-sized headroom
  // to absorb the fact that our substituted web-safe font frequently
  // renders wider per character (see the file-level notes on
  // WIDTH_PADDING_RATIO). Trusting the original small gap for BOTH
  // segments' positions, like a genuine multi-column split can, was
  // exactly what let the plain-text part visually run into/under the
  // link part once its substitute-font width exceeded that gap.
  // Measuring the preceding segment's real rendered width in the same
  // font it'll actually be drawn in -- rather than pdf.js's own
  // (possibly narrower) measurement -- and placing this segment right
  // after it removes that gap entirely: there's no longer a fixed x for
  // the second segment to be wrong about, it's always exactly as far
  // right as the first segment actually reaches, plus the original PDF's
  // own gap width preserved as the visual word-space between them.
  for (let i = 1; i < merged.length; i++) {
    const segment = merged[i];
    if (!segment.chainedFromPrevious) continue;

    const prev = merged[i - 1];
    const prevRenderedWidth = measureTextWidth(prev.text, prev.fontSize, prev.fontFamily, prev.bold, prev.italic);
    const originalGap = Math.max(segment.x - (prev.x + prev.width), 0);
    segment.x = prev.x + prevRenderedWidth + originalGap;
  }

  return [...merged, ...rotated];
}

// Measures how wide a piece of text will actually render, and how far its
// glyphs actually extend above/below the baseline, using the exact same
// (substituted, web-safe) font Fabric will draw it in -- via a throwaway
// canvas 2D context. Canvas text measurement is the same mechanism
// Fabric's own text rendering is built on, so this tracks real on-screen
// geometry far more closely than either trusting pdf.js's measurement of
// the original embedded font (measureTextWidth's caller), or a flat
// fudge-factor guess at ascender/descender height (measureTextMetrics's
// caller, erasePaddedBounds, replacing what used to be a fixed multiple
// of font size). Every OTHER width in this file intentionally stays in
// pdf.js's own measured space, since that's what PdfCanvas.tsx's
// shrink-to-fit ceiling logic expects -- only the two callers below need
// actual substitute-font geometry.
let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const canvas = window.document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context for text measurement');
    measureCtx = ctx;
  }
  return measureCtx;
}

function setMeasureFont(fontSize: number, fontFamily: string, bold: boolean, italic: boolean): void {
  const style = italic ? 'italic' : 'normal';
  const weight = bold ? 'bold' : 'normal';
  getMeasureCtx().font = `${style} ${weight} ${fontSize}px "${fontFamily}"`;
}

function measureTextWidth(text: string, fontSize: number, fontFamily: string, bold: boolean, italic: boolean): number {
  setMeasureFont(fontSize, fontFamily, bold, italic);
  return getMeasureCtx().measureText(text).width;
}

// Extra headroom added on top of the exact measured glyph extents below,
// to tolerate the small amount of cross-browser/font-hinting variance in
// where exactly a font renders its glyph edges -- the measurement is
// taken in this same browser session right before erasing, but isn't
// guaranteed to be pixel-identical to how Fabric's own renderer draws it
// a moment later.
const ERASE_SAFETY_MARGIN_RATIO = 1.15;

// Real measured ascent/descent (distance above/below the baseline the
// text's glyphs actually reach) for a specific string in a specific
// substitute font, via canvas TextMetrics.actualBoundingBox{Ascent,
// Descent} -- the same values the browser itself computed to lay the
// glyphs out, rather than a flat estimate. Returns null if the browser's
// TextMetrics doesn't expose these (very old browsers), so the caller
// can fall back to the fixed-ratio estimate.
function measureTextMetrics(
  text: string,
  fontSize: number,
  fontFamily: string,
  bold: boolean,
  italic: boolean
): { ascent: number; descent: number } | null {
  setMeasureFont(fontSize, fontFamily, bold, italic);
  // measureText on an empty/whitespace-only string reports a degenerate
  // (near-zero) bounding box -- fall back to a single space's own metrics
  // isn't meaningfully better, so just let the caller's fixed-ratio path
  // handle that case instead of pretending there's nothing to erase.
  if (!text.trim()) return null;

  const metrics = getMeasureCtx().measureText(text);
  const ascent = metrics.actualBoundingBoxAscent;
  const descent = metrics.actualBoundingBoxDescent;
  if (typeof ascent !== 'number' || typeof descent !== 'number' || Number.isNaN(ascent) || Number.isNaN(descent)) {
    return null;
  }
  return { ascent, descent };
}

// Combines a run of same-baseline, close-enough-together fragments (one
// segment, as decided by mergeRunsPerLine above) into a single run,
// reconstructing normal word spacing between the original pdf.js items
// along the way. See mergeRunsPerLine's own comment for why merging
// happens at all.
function buildMergedSegment(segment: ExtractedRun[]): ExtractedRun {
  const first = segment[0];
  const last = segment[segment.length - 1];

  // Choose the run whose actual text is LONGEST as the style source for
  // the whole merged line, rather than always `first`. PDF bullet lists
  // very often draw the bullet glyph itself (•, ▪, etc.) as its own
  // separate run in a symbol font (Wingdings/Symbol) immediately before
  // the sentence text that follows it. normalizeGlyphs (see above) fixes
  // up the *character* pdf.js reports for that run, but the run's own
  // font metadata is still whatever symbol font drew it -- mapFont has
  // no way to know that font was only ever meant to draw one bullet
  // character, so it falls back to Helvetica. Blindly taking `first`'s
  // font for the ENTIRE merged segment (what this used to do) meant a
  // bulleted line's single-character bullet run overrode the font for
  // the rest of that whole sentence too, even though the sentence text
  // itself uses the exact same serif font as every other paragraph on
  // the page -- exactly the "bullet list font looks different" bug. The
  // bullet run is always by far the shortest piece of text in the
  // segment, so picking the longest run's style instead reliably lands
  // on the real sentence font. For any ordinary (non-bulleted, unsplit)
  // line this is still just `first`, since there's only one run to pick
  // from -- so nothing changes for normal paragraphs/headings.
  let primary = first;
  for (const run of segment) {
    if (run.text.trim().length > primary.text.trim().length) primary = run;
  }

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
    fontSize: primary.fontSize,
    // The tallest font size among every run merged into this segment,
    // kept separate from the rendering fontSize above (which
    // intentionally stays the primary run's, so the merged segment
    // renders in one uniform style). This is only used by
    // erasePaddedBounds -- if a segment merges a smaller fragment with a
    // taller one (e.g. a slightly larger amount in an invoice row),
    // erasing based on just the primary run's (possibly smaller) font
    // size wasn't tall enough to fully cover the taller fragment's
    // original glyphs, leaving a sliver of the original rasterized text
    // visible behind/around the new text -- which reads as
    // smudged/doubled, easy to mistake for "blurry."
    eraseFontSize: Math.max(...segment.map((r) => r.fontSize)),
    fontFamily: primary.fontFamily,
    bold: primary.bold,
    italic: primary.italic,
    link,
  };
}

// The enlarged rectangle we paint white over on the raster background for
// a given line -- wider than the line's own measured width (so the erase
// always covers at least as much as the new editable text sits on top of)
// and taller than its raw font-height (to catch ascenders above and
// descenders below what a plain em-box would cover).
//
// Ascent/descent are taken from a REAL measurement of this line's own
// text in its actual substitute font (see measureTextMetrics) -- e.g. an
// all-caps heading with no descenders gets a tight bottom edge, while a
// line full of "gjpqy" gets the extra room it actually needs -- rather
// than a flat ERASE_ASCENT_RATIO/ERASE_DESCENT_RATIO guess applied
// uniformly to every line regardless of what it actually contains. The
// fixed ratios are kept only as a fallback for the rare case a browser's
// TextMetrics doesn't expose actualBoundingBox{Ascent,Descent}.
function erasePaddedBounds(line: ExtractedRun): { x: number; y: number; width: number; height: number } {
  const width = paddedWidth(line);
  const eraseFontSize = line.eraseFontSize ?? line.fontSize;
  const measured = measureTextMetrics(line.text, eraseFontSize, line.fontFamily, line.bold, line.italic);
  const ascent = measured ? measured.ascent * ERASE_SAFETY_MARGIN_RATIO : eraseFontSize * ERASE_ASCENT_RATIO;
  const descent = measured ? measured.descent * ERASE_SAFETY_MARGIN_RATIO : eraseFontSize * ERASE_DESCENT_RATIO;
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
  // Set by mergeRunsPerLine when this segment was split off from the
  // immediately preceding one purely because a link boundary was crossed
  // (not a real column gutter, not an oversized gap) -- i.e. the two
  // segments are really one continuous piece of prose that got split
  // just to isolate the link's styling. Consumed by mergeRunsPerLine's
  // own repositioning pass right after -- see that pass's comment for
  // why these segments can't just trust their original pdf.js x.
  chainedFromPrevious?: boolean;
}

// Combines two PDF transform matrices, same formula pdf.js itself uses
// internally (and in its text-layer builder) to go from PDF text space to
// viewport pixel space. Implemented locally rather than importing
// pdfjs-dist's `Util.transform` since that helper isn't reliably exported
// across pdfjs-dist versions/bundling setups. Composes two MATRICES --
// see applyMatrixToPoint above for the distinct operation of applying a
// matrix to a single coordinate.
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
  viewport: import('pdfjs-dist').PageViewport,
  pdfPage: import('pdfjs-dist').PDFPageProxy
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
    // The font actually loaded for this run, if pdf.js has resolved it
    // yet -- see mapFont's own comment for why this, not
    // style/styleName, is the real source of truth for bold/italic.
    // commonObjs.has() must be checked first: calling .get() on a font
    // id that hasn't been resolved throws rather than returning
    // undefined (confirmed against pdf.js's actual behavior). By the
    // time this runs, pdfFileToPages has already awaited
    // getOperatorList() once for the whole page specifically so every
    // font used on it is resolved by now -- this check is a defensive
    // fallback for the rare font pdf.js couldn't resolve at all (e.g. a
    // malformed embedded font), not the expected common case.
    const fontObj = styleName && pdfPage.commonObjs.has(styleName) ? pdfPage.commonObjs.get(styleName) : undefined;
    const { fontFamily, bold, italic } = mapFont(style?.fontFamily, styleName, fontObj);

    runs.push({
      // Normalize symbol-font bullet/marker glyphs to real Unicode
      // punctuation -- see GLYPH_SUBSTITUTIONS's own comment for why.
      text: normalizeGlyphs(textItem.str),
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
// the embedded font itself -- so fontFamily below is still a best-effort
// approximation mapped onto our editor's existing web-safe font list,
// not an exact match to the original PDF's typeface.
//
// bold/italic, however, no longer come from a name-string guess at all
// when a loaded font object is available (the common case -- see
// extractTextRuns' own comment on commonObjs). `pdfFontName` here is
// USELESS for bold/italic detection: for a genuinely bold PDF standard
// font ("Helvetica-Bold"), pdf.js's getTextContent() reports fontName as
// its own internal, opaque object id (something like "g_d0_f1"), not
// the font's real name -- verified directly against pdf.js's actual
// output. That id never contains "bold" or "italic" no matter what the
// underlying font actually is, so the old bold/italic regex against it
// was, in practice, blind to the overwhelming majority of real bold
// text -- which is why headings that were genuinely bold in the source
// PDF were rendering at regular weight here. `fontObj` (pdf.js's loaded
// font object, see extractTextRuns) instead exposes `.bold`/`.black`/
// `.italic` as real booleans, parsed by pdf.js itself from the font's
// actual FontDescriptor (its ForceBold flag, weight class, etc.) -- the
// authoritative source, not a guess. The name-string regex is kept only
// as a fallback for the rare case no font object could be resolved.
function mapFont(
  cssFamily: string | undefined,
  pdfFontName: string | undefined,
  fontObj?: { name?: string; fallbackName?: string; bold?: boolean; black?: boolean; italic?: boolean }
): { fontFamily: string; bold: boolean; italic: boolean } {
  const hint = `${cssFamily ?? ''} ${pdfFontName ?? ''} ${fontObj?.name ?? ''} ${fontObj?.fallbackName ?? ''}`.toLowerCase();

  let fontFamily = 'Helvetica';
  if (hint.includes('mono')) fontFamily = 'Courier New';
  else if (hint.includes('serif') && !hint.includes('sans')) fontFamily = 'Times New Roman';

  const bold = fontObj ? !!(fontObj.bold || fontObj.black) : /bold|black|heavy/.test(hint);
  const italic = fontObj ? !!fontObj.italic : /italic|oblique/.test(hint);

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