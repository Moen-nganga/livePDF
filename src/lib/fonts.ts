/**
 * Web-safe fonts only — no Google Fonts loading, no embedding. Every font
 * here is either a real OS font (renders correctly in the Fabric.js canvas
 * on most systems) or maps to one of pdf-lib's built-in StandardFonts at
 * export time, so what you see on screen matches what comes out in the
 * PDF. See exportPdf.ts's FONT_EXPORT_MAP for the on-screen → PDF mapping.
 */
export const WEB_SAFE_FONTS = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'Verdana',
  'Trebuchet MS',
  'Comic Sans MS',
  'Impact',
  'Palatino',
  'Garamond',
] as const;

export type WebSafeFont = (typeof WEB_SAFE_FONTS)[number];

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72] as const;