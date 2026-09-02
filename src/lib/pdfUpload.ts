import '../lib/pdfjsSetup';
import { getDocument } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { nanoid } from 'nanoid';
import type { Page, TextObject } from '../types/document';

const RENDER_SCALE = 2; // render at 2x for crisper display/export quality
const MIN_RUN_SIZE = 4;
const WIDTH_PADDING_RATIO = 0.25;
const MIN_WIDTH_PADDING = 6;
const MIN_INTER_RUN_GAP = 4;
const DESIRED_GAP_FONT_RATIO = 0.35;
const SECONDARY_LABEL_FONT_RATIO = 0.85;
const SAME_LINE_BASELINE_TOLERANCE = 2;
const ERASE_ASCENT_RATIO = 1.3;
const ERASE_DESCENT_RATIO = 0.35;

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
    const textContent = await pdfPage.getTextContent();
    const runs = extractTextRuns(textContent, unscaledViewport);
    const linkRegions = await extractLinkAnnotations(pdfPage, unscaledViewport);
    for (const run of runs) {
      run.link = findLinkForRun(run, linkRegions);
    }

    capLineNeighborWidths(runs);

    // Now render the raster background at full quality.
    const renderViewport = pdfPage.getViewport({ scale: RENDER_SCALE });
    const canvas = window.document.createElement('canvas');
    canvas.width = renderViewport.width;
    canvas.height = renderViewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context for PDF render');

    await pdfPage.render({ canvasContext: ctx, viewport: renderViewport }).promise;

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

function paddedRunWidth(run: ExtractedRun): number {
  const padded = run.width + Math.max(run.width * WIDTH_PADDING_RATIO, MIN_WIDTH_PADDING);
  if (run.maxWidthOnLine === undefined) return padded;
  return Math.max(run.width, Math.min(padded, run.maxWidthOnLine));
}

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

      run.maxWidthOnLine = next.x - run.x - desiredGap;

      if (next.fontSize < run.fontSize * SECONDARY_LABEL_FONT_RATIO) {
        next.forceItalic = true;
      }
    }
    // Last run on a line keeps maxWidthOnLine unset (unconstrained by a
    // neighbor) -- nothing to its right to collide with.

    lineStart = lineEnd;
  }
}

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
  maxWidthOnLine?: number;
  forceItalic?: boolean;
  link?: string;
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
  viewport: import('pdfjs-dist').PageViewport
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