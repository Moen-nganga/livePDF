import '../lib/pdfjsSetup';
import { getDocument } from 'pdfjs-dist';
import { nanoid } from 'nanoid';
import type { Page } from '../types/document';

const RENDER_SCALE = 2; // render at 2x for crisper display/export quality

/**
 * Reads an uploaded PDF file and converts each page into a Page object:
 * the original page is rasterized to an image (via pdf.js) and stored as
 * backgroundImage, with an empty objects[] ready for new annotations.
 *
 * This is the "flatten then annotate" strategy described in our plan —
 * we don't parse/mutate the original PDF's content stream, we treat it as
 * a picture and let the user draw new editable things on top of it.
 */
export async function pdfFileToPages(file: File): Promise<Page[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;

  const pages: Page[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const pdfPage = await pdf.getPage(pageNum);
    const viewport = pdfPage.getViewport({ scale: RENDER_SCALE });

    const canvas = window.document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context for PDF render');

    await pdfPage.render({ canvasContext: ctx, viewport }).promise;

    // Page size in PDF points (unscaled) — this is what our editor uses
    const unscaledViewport = pdfPage.getViewport({ scale: 1 });

    pages.push({
      id: nanoid(),
      width: unscaledViewport.width,
      height: unscaledViewport.height,
      backgroundImage: canvas.toDataURL('image/png'),
      objects: [],
    });
  }

  return pages;
}
