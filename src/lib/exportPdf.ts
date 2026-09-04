import {
  PDFDocument as PdfLibDocument,
  rgb,
  StandardFonts,
  degrees,
  PDFName,
  PDFArray,
  PDFString,
  PDFRef,
} from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import type { PDFDocument, PageObject } from '../types/document';


const FONT_BASE_MAP: Record<string, 'Helvetica' | 'TimesRoman' | 'Courier'> = {
  Arial: 'Helvetica',
  Helvetica: 'Helvetica',
  Verdana: 'Helvetica',
  'Trebuchet MS': 'Helvetica',
  'Comic Sans MS': 'Helvetica',
  Impact: 'Helvetica',
  'Times New Roman': 'TimesRoman',
  Georgia: 'TimesRoman',
  Palatino: 'TimesRoman',
  Garamond: 'TimesRoman',
  'Courier New': 'Courier',
};

interface FontSet {
  Helvetica: PDFFont;
  HelveticaBold: PDFFont;
  TimesRoman: PDFFont;
  TimesRomanBold: PDFFont;
  Courier: PDFFont;
  CourierBold: PDFFont;
}

// Standard hyperlink blue, used for any text object with a link — regardless
// of the color the person picked for it — so links are recognizable at a
// glance, the same way they are in Word/Docs/most PDF viewers.
const LINK_COLOR = '#1155CC';

function pickFont(fonts: FontSet, fontFamily: string, bold: boolean): PDFFont {
  const base = FONT_BASE_MAP[fontFamily] ?? 'Helvetica';
  if (base === 'TimesRoman') return bold ? fonts.TimesRomanBold : fonts.TimesRoman;
  if (base === 'Courier') return bold ? fonts.CourierBold : fonts.Courier;
  return bold ? fonts.HelveticaBold : fonts.Helvetica;
}

/**
 * Break `text` into lines that each fit within `maxWidth` at the given
 * font/size, the way the on-screen fabric.Textbox wraps. Respects
 * explicit newlines in the source text as paragraph breaks.
 *
 * pdf-lib's `drawText` has no built-in wrapping (it just draws one
 * literal line), which is what let long text run past the box edge in
 * the exported PDF even though the editor showed it wrapped correctly.
 */
function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }

    const words = paragraph.split(' ');
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      const candidateWidth = font.widthOfTextAtSize(candidate, fontSize);

      if (candidateWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = candidate;
      }
    }

    lines.push(currentLine);
  }

  return lines;
}

async function buildPdf(doc: PDFDocument): Promise<Uint8Array> {
  const pdf = await PdfLibDocument.create();
  const fonts: FontSet = {
    Helvetica: await pdf.embedFont(StandardFonts.Helvetica),
    HelveticaBold: await pdf.embedFont(StandardFonts.HelveticaBold),
    TimesRoman: await pdf.embedFont(StandardFonts.TimesRoman),
    TimesRomanBold: await pdf.embedFont(StandardFonts.TimesRomanBold),
    Courier: await pdf.embedFont(StandardFonts.Courier),
    CourierBold: await pdf.embedFont(StandardFonts.CourierBold),
  };

  for (const page of doc.pages) {
    const pdfPage = pdf.addPage([page.width, page.height]);

    if (page.backgroundImage) {
      const img = await embedImage(pdf, page.backgroundImage);
      pdfPage.drawImage(img, { x: 0, y: 0, width: page.width, height: page.height });
    }

    for (const obj of page.objects) {
      await drawObject(pdf, pdfPage, obj, page.height, fonts);
    }
  }

  return pdf.save();
}

export async function exportToPdf(doc: PDFDocument, filename: string): Promise<void> {
  const bytes = await buildPdf(doc);
  const safeName = filename.trim().replace(/\.pdf$/i, '') || 'document';
  await saveBytes(bytes, `${safeName}.pdf`);
}

export async function printPdf(doc: PDFDocument): Promise<void> {
  const bytes = await buildPdf(doc);
  const plainBytes = new Uint8Array(bytes); // see saveBytes below for why this copy is needed
  const blob = new Blob([plainBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  const iframe = window.document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';

  let cleanedUp = false;
  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    iframe.remove();
    URL.revokeObjectURL(url);
  }

  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    // afterprint doesn't fire reliably in every browser (especially if the
    // print dialog is cancelled), so clean up on a generous delay instead
    // of relying on it — long enough that a slow print dialog isn't cut
    // off, short enough not to leak memory indefinitely.
    setTimeout(cleanup, 60_000);
  };

  iframe.src = url;
  window.document.body.appendChild(iframe);
}

async function embedImage(pdf: PdfLibDocument, dataUrl: string) {
  const isPng = dataUrl.startsWith('data:image/png');
  const base64 = dataUrl.split(',')[1];
  const bytes = base64ToUint8Array(base64);
  return isPng ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function flipY(y: number, height: number, pageHeight: number): number {
  return pageHeight - y - height;
}

function addLinkAnnotation(
  pdfPage: PDFPage,
  url: string,
  rect: { x: number; y: number; width: number; height: number }
): void {
  const pdf = pdfPage.doc;
  const annotation = pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    Border: [0, 0, 0], // no visible box around the link — the text's own underline is the visual cue
    A: {
      Type: 'Action',
      S: 'URI',
      URI: PDFString.of(url),
    },
  });

  const annotationRef: PDFRef = pdf.context.register(annotation);

  const existingAnnots = pdfPage.node.lookup(PDFName.of('Annots'), PDFArray);
  if (existingAnnots) {
    existingAnnots.push(annotationRef);
  } else {
    pdfPage.node.set(PDFName.of('Annots'), pdf.context.obj([annotationRef]));
  }
}

async function drawObject(
  pdf: PdfLibDocument,
  pdfPage: import('pdf-lib').PDFPage,
  obj: PageObject,
  pageHeight: number,
  fonts: FontSet
) {
  const rotate = obj.rotation ? degrees(-obj.rotation) : undefined; // pdf-lib rotates counter-clockwise

  switch (obj.type) {
    case 'text': {
      const font = pickFont(fonts, obj.fontFamily, obj.bold);

      // 1.16 matches fabric.js's default lineHeight factor, so wrapped
      // lines land at roughly the same vertical spacing as the editor.
      const lineHeight = obj.fontSize * 1.16;
      const lines = wrapText(obj.text, font, obj.fontSize, obj.width);

      // Baseline of the first line, measured down from the top of the
      // box. fontSize * 0.8 approximates the font's ascent so glyph caps
      // land near the top edge, similar to how the canvas renders it.
      const boxTop = pageHeight - obj.y;
      let lineY = boxTop - obj.fontSize * 0.8;

      // Linked text always renders in the standard hyperlink blue rather
      // than the object's own color — the color property itself is left
      // untouched so it's still there if the link is ever removed.
      const textColor = hexToRgb(obj.link ? LINK_COLOR : obj.color);

      for (const line of lines) {
        const lineWidth = font.widthOfTextAtSize(line, obj.fontSize);
        let lineX = obj.x;
        if (obj.align === 'center') {
          lineX = obj.x + (obj.width - lineWidth) / 2;
        } else if (obj.align === 'right') {
          lineX = obj.x + (obj.width - lineWidth);
        }

        pdfPage.drawText(line, {
          x: lineX,
          y: lineY,
          size: obj.fontSize,
          font,
          color: textColor,
          opacity: obj.opacity,
          rotate,
        });

        if (obj.strikethrough && line.length > 0) {
          // pdf-lib has no built-in strikethrough — draw a line manually
          // at roughly the text's visual midline (~30% up from the
          // baseline works well across typical font metrics).
          const strikeY = lineY + obj.fontSize * 0.3;
          pdfPage.drawLine({
            start: { x: lineX, y: strikeY },
            end: { x: lineX + lineWidth, y: strikeY },
            thickness: Math.max(1, obj.fontSize * 0.06),
            color: textColor,
            opacity: obj.opacity,
          });
        }

        if (obj.link && line.length > 0) {
          // pdf-lib has no built-in underline either. Without this, a
          // link annotation is still clickable but looks exactly like
          // plain text on the page — draw a line just below the
          // baseline so links are visually recognizable, matching the
          // underline the editor already shows for linked text.
          const underlineY = lineY - obj.fontSize * 0.12;
          pdfPage.drawLine({
            start: { x: lineX, y: underlineY },
            end: { x: lineX + lineWidth, y: underlineY },
            thickness: Math.max(1, obj.fontSize * 0.05),
            color: textColor,
            opacity: obj.opacity,
          });
        }

        lineY -= lineHeight;
      }

      if (obj.link) {
        // Clickable area covers the text box's full bounding rectangle,
        // not just the rendered glyphs — simpler to compute and matches
        // how most PDF tools size link hit-areas anyway.
        addLinkAnnotation(pdfPage, obj.link, {
          x: obj.x,
          y: flipY(obj.y, obj.height, pageHeight),
          width: obj.width,
          height: obj.height,
        });
      }
      break;
    }
    case 'rect': {
      pdfPage.drawRectangle({
        x: obj.x,
        y: flipY(obj.y, obj.height, pageHeight),
        width: obj.width,
        height: obj.height,
        ...(obj.fill ? { color: hexToRgb(obj.fill) } : {}),
        borderColor: hexToRgb(obj.stroke),
        borderWidth: obj.strokeWidth,
        opacity: obj.opacity,
        rotate,
      });
      break;
    }
    case 'ellipse': {
      pdfPage.drawEllipse({
        x: obj.x + obj.width / 2,
        y: flipY(obj.y, obj.height, pageHeight) + obj.height / 2,
        xScale: obj.width / 2,
        yScale: obj.height / 2,
        ...(obj.fill ? { color: hexToRgb(obj.fill) } : {}),
        borderColor: hexToRgb(obj.stroke),
        borderWidth: obj.strokeWidth,
        opacity: obj.opacity,
        rotate,
      });
      break;
    }
    case 'line': {
      const y1 = flipY(obj.y, 0, pageHeight);
      const y2 = flipY(obj.y + obj.height, 0, pageHeight);
      pdfPage.drawLine({
        start: { x: obj.x, y: y1 },
        end: { x: obj.x + obj.width, y: y2 },
        thickness: obj.strokeWidth,
        color: hexToRgb(obj.stroke),
        opacity: obj.opacity,
      });
      break;
    }
    case 'image': {
      const img = await embedImage(pdf, obj.src);
      pdfPage.drawImage(img, {
        x: obj.x,
        y: flipY(obj.y, obj.height, pageHeight),
        width: obj.width,
        height: obj.height,
        opacity: obj.opacity,
        rotate,
      });
      break;
    }
  }
}

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return rgb(r, g, b);
}

declare global {
  interface Window {
    showSaveFilePicker?: (options: {
      suggestedName?: string;
      types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<{
      createWritable: () => Promise<{
        write: (data: Uint8Array) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  }
}

async function saveBytes(bytes: Uint8Array, filename: string): Promise<void> {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return;
    } catch (err) {
      // AbortError means the person cancelled the save dialog — respect
      // that silently rather than falling back to a surprise auto-download.
      if (err instanceof Error && err.name === 'AbortError') return;
      // Any other failure (e.g. permission issue) falls through to the
      // simpler download method below instead of leaving the user stuck.
    }
  }

  const plainBytes = new Uint8Array(bytes);
  const blob = new Blob([plainBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}