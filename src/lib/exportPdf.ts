import { PDFDocument as PdfLibDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import type { PDFDocument, PageObject } from '../types/document';

/**
 * Builds a real PDF from our document model and triggers a browser
 * download. Each Page becomes one PDF page: the backgroundImage (if any)
 * is drawn first covering the whole page, then each PageObject is drawn
 * on top in order (later objects render above earlier ones, matching the
 * editor's layering).
 */
export async function exportToPdf(doc: PDFDocument): Promise<void> {
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
  downloadBlob(bytes, `${doc.title || 'document'}.pdf`);
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

function downloadBlob(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
