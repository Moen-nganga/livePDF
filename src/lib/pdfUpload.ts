import '../lib/pdfjsSetup';
import { getDocument, OPS } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { nanoid } from 'nanoid';
import type { Page, PageObject, RectObject, TextObject } from '../types/document';

const MIN_RENDER_SCALE = 2;
const MAX_RENDER_SCALE = 4;
const RENDER_SCALE = Math.min(
  MAX_RENDER_SCALE,
  Math.max(MIN_RENDER_SCALE, (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1) * 2)
);

const MIN_RUN_SIZE = 4;

const WIDTH_PADDING_RATIO = 0.25;
const MIN_WIDTH_PADDING = 6;

const SAME_LINE_BASELINE_TOLERANCE = 2;

const WORD_GAP_FONT_RATIO = 0.12;
const WORD_GAP_MIN = 0.5;

const MAX_MERGE_GAP_ABSOLUTE = 60;
const MAX_MERGE_GAP_FONT_RATIO = 4;

const MIN_GUTTER_WIDTH = 14;

const ERASE_ASCENT_RATIO = 1.3;
const ERASE_DESCENT_RATIO = 0.35;

const TEXT_COLOR = '#111111';

const LINK_COLOR = '#1a73e8';

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

const MAX_UNDERLINE_RULE_HEIGHT = 4;

const MIN_UNDERLINE_ASPECT_RATIO = 6;

const MIN_UNDERLINE_RULE_WIDTH = 6;

const UNDERLINE_RULE_ROTATION_TOLERANCE_DEG = 1;

const UNDERLINE_RULE_ERASE_PADDING = 1;

interface DetectedUnderlineRule {
  x: number;
  y: number;
  width: number;
  height: number;
}


function applyMatrixToPoint(m: number[], x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}


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


    const args = argsArray[i] as [number[], number[], number[]];
    const [subOps, coords] = args;
    const isSingleRect = subOps.length === 1 && subOps[0] === OPS.rectangle;
    if (!isSingleRect) continue;

    const nextFn = fnArray[i + 1];
    const wasFilled = nextFn === OPS.fill || nextFn === OPS.eoFill;
    if (!wasFilled) continue;

    const [rx, ry, rw, rh] = coords;
    const full = combineTransforms(viewport.transform, ctm);

  
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


export async function pdfFileToPages(file: File): Promise<Page[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;

  const pages: Page[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const pdfPage = await pdf.getPage(pageNum);


    const unscaledViewport = pdfPage.getViewport({ scale: 1 });

    const opList = await pdfPage.getOperatorList();

    // Extract raw pdf.js text runs first (in unscaled/point space).
    const textContent = await pdfPage.getTextContent();
    const rawRuns = extractTextRuns(textContent, unscaledViewport, pdfPage);


    const linkRegions = await extractLinkAnnotations(pdfPage, unscaledViewport);
    for (const run of rawRuns) {
      run.link = findLinkForRun(run, linkRegions);
    }

    const gutters = computeGlobalGutters(rawRuns);

    const lines = mergeRunsPerLine(rawRuns, gutters);

    capWidthsAgainstNearbyContent(lines);

    const underlineRules = await detectUnderlineRules(opList, unscaledViewport);

    // Render the raster background at full quality.
    const renderViewport = pdfPage.getViewport({ scale: RENDER_SCALE });
    const canvas = window.document.createElement('canvas');
    canvas.width = renderViewport.width;
    canvas.height = renderViewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context for PDF render');

    await pdfPage.render({ canvasContext: ctx, viewport: renderViewport }).promise;

    ctx.fillStyle = '#ffffff';
    for (const line of lines) {
      const bounds = erasePaddedBounds(line, unscaledViewport.width);
      ctx.fillRect(
        bounds.x * RENDER_SCALE,
        bounds.y * RENDER_SCALE,
        bounds.width * RENDER_SCALE,
        bounds.height * RENDER_SCALE
      );
    }

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
      width: paddedWidth(line, unscaledViewport.width),
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


const PAGE_EDGE_SAFETY_GAP = 2;

function paddedWidth(line: ExtractedRun, pageWidth: number): number {
  const padded = line.width + Math.max(line.width * WIDTH_PADDING_RATIO, MIN_WIDTH_PADDING);
  let capped = padded;
  if (line.maxWidthNeighbor !== undefined) capped = Math.min(capped, line.maxWidthNeighbor);
  const maxAgainstPage = Math.max(1, pageWidth - line.x - PAGE_EDGE_SAFETY_GAP);
  return Math.max(1, Math.min(capped, maxAgainstPage));
}

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

function gapCrossesGutter(gapStart: number, gapEnd: number, gutters: XInterval[]): boolean {
  return gutters.some((g) => gapStart < g.end && g.start < gapEnd);
}


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

const ERASE_SAFETY_MARGIN_RATIO = 1.15;

function measureTextMetrics(
  text: string,
  fontSize: number,
  fontFamily: string,
  bold: boolean,
  italic: boolean
): { ascent: number; descent: number } | null {
  setMeasureFont(fontSize, fontFamily, bold, italic);

  if (!text.trim()) return null;

  const metrics = getMeasureCtx().measureText(text);
  const ascent = metrics.actualBoundingBoxAscent;
  const descent = metrics.actualBoundingBoxDescent;
  if (typeof ascent !== 'number' || typeof descent !== 'number' || Number.isNaN(ascent) || Number.isNaN(descent)) {
    return null;
  }
  return { ascent, descent };
}
function buildMergedSegment(segment: ExtractedRun[]): ExtractedRun {
  const first = segment[0];
  const last = segment[segment.length - 1];
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
    eraseFontSize: Math.max(...segment.map((r) => r.fontSize)),
    fontFamily: primary.fontFamily,
    bold: primary.bold,
    italic: primary.italic,
    link,
  };
}

function erasePaddedBounds(
  line: ExtractedRun,
  pageWidth: number
): { x: number; y: number; width: number; height: number } {
  const width = paddedWidth(line, pageWidth);
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
  link?: string;
  eraseFontSize?: number;
  maxWidthNeighbor?: number;
  chainedFromPrevious?: boolean;
}

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

    const tx = combineTransforms(viewport.transform, textItem.transform);

    const fontHeight = Math.hypot(tx[2], tx[3]);
    const rotation = (Math.atan2(tx[1], tx[0]) * 180) / Math.PI;

    const width = Math.max(textItem.width, MIN_RUN_SIZE);
    const height = Math.max(fontHeight * 1.15, MIN_RUN_SIZE); // small leading so descenders aren't clipped

    const x = tx[4];
    const y = tx[5] - fontHeight; // tx[5] is the text baseline; shift up to the box's top edge

    const styleName = textItem.fontName;
    const style = styleName ? textContent.styles[styleName] : undefined;
 
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