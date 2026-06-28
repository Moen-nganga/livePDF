import { PDFDocument as PdfLibDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import type { PDFDocument, PageObject } from '../types/document';

/**
 * Builds a real PDF from our document model and saves it, letting the
 * user choose the filename (and, on supported browsers, the destination
 * folder too via the native Save dialog).
 */
export async function exportToPdf(doc: PDFDocument, filename: string): Promise<void> {
  const pdf = await PdfLibDocument.create();
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  for (const page of doc.pages) {
    const pdfPage = pdf.addPage([page.width, page.height]);

    if (page.backgroundImage) {
      const img = await embedImage(pdf, page.backgroundImage);
      pdfPage.drawImage(img, { x: 0, y: 0, width: page.width, height: page.height });
    }

    for (const obj of page.objects) {
      await drawObject(pdf, pdfPage, obj, page.height, helvetica, helveticaBold);
    }
  }

  const bytes = await pdf.save();
  const safeName = filename.trim().replace(/\.pdf$/i, '') || 'document';
  await saveBytes(bytes, `${safeName}.pdf`);
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

/**
 * Our editor uses a top-left origin (y grows downward, matches screen/CSS
 * convention, and Fabric.js's own coordinate system). PDF uses a bottom-left
 * origin (y grows upward). Every draw call must flip y using the page height.
 */
function flipY(y: number, height: number, pageHeight: number): number {
  return pageHeight - y - height;
}

async function drawObject(
  pdf: PdfLibDocument,
  pdfPage: import('pdf-lib').PDFPage,
  obj: PageObject,
  pageHeight: number,
  helvetica: import('pdf-lib').PDFFont,
  helveticaBold: import('pdf-lib').PDFFont
) {
  const rotate = obj.rotation ? degrees(-obj.rotation) : undefined; // pdf-lib rotates counter-clockwise

  switch (obj.type) {
    case 'text': {
      const font = obj.bold ? helveticaBold : helvetica;
      pdfPage.drawText(obj.text, {
        x: obj.x,
        y: flipY(obj.y, obj.fontSize, pageHeight) - (obj.height - obj.fontSize), // align to top of box
        size: obj.fontSize,
        font,
        color: hexToRgb(obj.color),
        opacity: obj.opacity,
        rotate,
      });
      break;
    }
    case 'rect': {
      pdfPage.drawRectangle({
        x: obj.x,
        y: flipY(obj.y, obj.height, pageHeight),
        width: obj.width,
        height: obj.height,
        color: hexToRgb(obj.fill),
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
        color: hexToRgb(obj.fill),
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

// The File System Access API (showSaveFilePicker) isn't in TypeScript's
// built-in DOM types yet, despite shipping in Chromium browsers for
// several years — this minimal ambient type covers just what we use here.
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
  // Preferred path: native "Save As" dialog, lets the person pick both the
  // filename and the destination folder. Only available in Chromium-based
  // browsers (Chrome, Edge, Opera) as of writing — Firefox and Safari have
  // not implemented this API.
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

  // Fallback for browsers without the File System Access API: a normal
  // browser download using the chosen filename. The destination folder
  // isn't choosable this way, but the browser's own download prompt
  // still lets the person rename the file if their browser is configured
  // to ask where to save downloads.
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}