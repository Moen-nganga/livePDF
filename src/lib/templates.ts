import type { Page, TextObject, RectObject } from '../types/document';
import { nanoid } from 'nanoid';
import { PAGE_SIZES } from '../types/document';

// Each template returns a ready-made array of pages with pre-positioned
// objects. Page size is A4 (595.28 x 841.89 pts) throughout.

const W = PAGE_SIZES.A4.width;   // 595.28
const H = PAGE_SIZES.A4.height;  // 841.89

function text(overrides: Partial<TextObject> & { text: string; x: number; y: number; width: number }): TextObject {
  return {
    id: nanoid(),
    type: 'text',
    height: 40,
    rotation: 0,
    opacity: 1,
    fontSize: 12,
    fontFamily: 'Helvetica',
    color: '#202124',
    bold: false,
    italic: false,
    strikethrough: false,
    align: 'left',
    ...overrides,
  };
}

function rect(overrides: Partial<RectObject> & { x: number; y: number; width: number; height: number }): RectObject {
  return {
    id: nanoid(),
    type: 'rect',
    rotation: 0,
    opacity: 1,
    fill: '#f0f2f5',
    stroke: '#dadce0',
    strokeWidth: 1,
    cornerRadius: 0,
    ...overrides,
  };
}

function blankPage(): Page {
  return {
    id: nanoid(),
    width: W,
    height: H,
    backgroundImage: null,
    objects: [],
  };
}

// ─── Templates ────────────────────────────────────────────────────────────────

function resumePage(): Page {
  return {
    id: nanoid(),
    width: W,
    height: H,
    backgroundImage: null,
    objects: [
      // Header band
      rect({ x: 0, y: 0, width: W, height: 100, fill: '#1a73e8', stroke: '#1a73e8', strokeWidth: 0, cornerRadius: 0 }),
      text({ x: 40, y: 22, width: 300, text: 'Your Name', fontSize: 28, bold: true, color: '#ffffff' }),
      text({ x: 40, y: 62, width: 400, text: 'Job Title  ·  your.email@example.com  ·  +1 (555) 000-0000', fontSize: 11, color: '#d2e3fc' }),
      // Summary
      text({ x: 40, y: 120, width: 200, text: 'SUMMARY', fontSize: 10, bold: true, color: '#1a73e8' }),
      rect({ x: 40, y: 136, width: W - 80, height: 1, fill: '#dadce0', stroke: '#dadce0', strokeWidth: 0 }),
      text({ x: 40, y: 142, width: W - 80, text: 'Brief professional summary describing your experience and goals. Replace this with your own 2–3 sentence overview.', fontSize: 11, color: '#5f6368', height: 44 }),
      // Experience
      text({ x: 40, y: 202, width: 200, text: 'EXPERIENCE', fontSize: 10, bold: true, color: '#1a73e8' }),
      rect({ x: 40, y: 218, width: W - 80, height: 1, fill: '#dadce0', stroke: '#dadce0', strokeWidth: 0 }),
      text({ x: 40, y: 224, width: 320, text: 'Company Name — Job Title', fontSize: 12, bold: true }),
      text({ x: 40, y: 244, width: 200, text: 'Month 20XX – Present', fontSize: 10, italic: true, color: '#5f6368' }),
      text({ x: 40, y: 262, width: W - 80, text: '• Key achievement or responsibility\n• Key achievement or responsibility\n• Key achievement or responsibility', fontSize: 11, color: '#202124', height: 55 }),
      // Education
      text({ x: 40, y: 335, width: 200, text: 'EDUCATION', fontSize: 10, bold: true, color: '#1a73e8' }),
      rect({ x: 40, y: 351, width: W - 80, height: 1, fill: '#dadce0', stroke: '#dadce0', strokeWidth: 0 }),
      text({ x: 40, y: 357, width: 320, text: 'University Name — Degree, Field of Study', fontSize: 12, bold: true }),
      text({ x: 40, y: 377, width: 200, text: 'Graduated Month 20XX', fontSize: 10, italic: true, color: '#5f6368' }),
      // Skills
      text({ x: 40, y: 420, width: 200, text: 'SKILLS', fontSize: 10, bold: true, color: '#1a73e8' }),
      rect({ x: 40, y: 436, width: W - 80, height: 1, fill: '#dadce0', stroke: '#dadce0', strokeWidth: 0 }),
      text({ x: 40, y: 442, width: W - 80, text: 'Skill 1  ·  Skill 2  ·  Skill 3  ·  Skill 4  ·  Skill 5  ·  Skill 6', fontSize: 11 }),
    ],
  };
}

function invoicePage(): Page {
  return {
    id: nanoid(),
    width: W,
    height: H,
    backgroundImage: null,
    objects: [
      text({ x: 40, y: 40, width: 200, text: 'INVOICE', fontSize: 28, bold: true, color: '#1a73e8' }),
      text({ x: 40, y: 80, width: 300, text: 'Your Business Name\nyour@email.com  ·  +1 (555) 000-0000\n123 Street, City, Country', fontSize: 11, color: '#5f6368', height: 52 }),
      text({ x: W - 200, y: 40, width: 160, text: 'Invoice #0001', fontSize: 14, bold: true, align: 'right' }),
      text({ x: W - 200, y: 62, width: 160, text: 'Date: DD/MM/YYYY', fontSize: 11, color: '#5f6368', align: 'right' }),
      text({ x: W - 200, y: 80, width: 160, text: 'Due: DD/MM/YYYY', fontSize: 11, color: '#5f6368', align: 'right' }),
      // Bill to
      text({ x: 40, y: 155, width: 150, text: 'BILL TO', fontSize: 10, bold: true, color: '#1a73e8' }),
      text({ x: 40, y: 172, width: 250, text: 'Client Name\nclient@email.com\n456 Avenue, City, Country', fontSize: 11, height: 50 }),
      // Table header
      rect({ x: 40, y: 250, width: W - 80, height: 28, fill: '#1a73e8', stroke: '#1a73e8', strokeWidth: 0 }),
      text({ x: 48, y: 258, width: 240, text: 'Description', fontSize: 11, bold: true, color: '#ffffff' }),
      text({ x: 300, y: 258, width: 70, text: 'Qty', fontSize: 11, bold: true, color: '#ffffff', align: 'center' }),
      text({ x: 380, y: 258, width: 80, text: 'Unit Price', fontSize: 11, bold: true, color: '#ffffff', align: 'right' }),
      text({ x: 468, y: 258, width: 80, text: 'Total', fontSize: 11, bold: true, color: '#ffffff', align: 'right' }),
      // Row 1
      rect({ x: 40, y: 278, width: W - 80, height: 26, fill: '#f8f9fa', stroke: '#dadce0', strokeWidth: 1 }),
      text({ x: 48, y: 284, width: 240, text: 'Service or product description', fontSize: 11 }),
      text({ x: 300, y: 284, width: 70, text: '1', fontSize: 11, align: 'center' }),
      text({ x: 380, y: 284, width: 80, text: '$0.00', fontSize: 11, align: 'right' }),
      text({ x: 468, y: 284, width: 80, text: '$0.00', fontSize: 11, align: 'right' }),
      // Row 2
      rect({ x: 40, y: 304, width: W - 80, height: 26, fill: '#ffffff', stroke: '#dadce0', strokeWidth: 1 }),
      text({ x: 48, y: 310, width: 240, text: 'Service or product description', fontSize: 11 }),
      text({ x: 300, y: 310, width: 70, text: '1', fontSize: 11, align: 'center' }),
      text({ x: 380, y: 310, width: 80, text: '$0.00', fontSize: 11, align: 'right' }),
      text({ x: 468, y: 310, width: 80, text: '$0.00', fontSize: 11, align: 'right' }),
      // Total
      rect({ x: 380, y: 340, width: W - 80 - 340, height: 28, fill: '#1a73e8', stroke: '#1a73e8', strokeWidth: 0 }),
      text({ x: 388, y: 348, width: 60, text: 'TOTAL', fontSize: 11, bold: true, color: '#ffffff' }),
      text({ x: 448, y: 348, width: 100, text: '$0.00', fontSize: 13, bold: true, color: '#ffffff', align: 'right' }),
      // Notes
      text({ x: 40, y: 400, width: 150, text: 'NOTES', fontSize: 10, bold: true, color: '#1a73e8' }),
      text({ x: 40, y: 418, width: W - 80, text: 'Payment is due within 30 days. Thank you for your business!', fontSize: 11, color: '#5f6368' }),
    ],
  };
}

function letterPage(): Page {
  return {
    id: nanoid(),
    width: W,
    height: H,
    backgroundImage: null,
    objects: [
      text({ x: 40, y: 40, width: 300, text: 'Your Name', fontSize: 13, bold: true }),
      text({ x: 40, y: 58, width: 300, text: '123 Your Street, City, Country', fontSize: 11, color: '#5f6368' }),
      text({ x: 40, y: 74, width: 300, text: 'your.email@example.com  ·  +1 (555) 000-0000', fontSize: 11, color: '#5f6368' }),
      text({ x: 40, y: 110, width: 200, text: 'DD Month YYYY', fontSize: 11, color: '#5f6368' }),
      text({ x: 40, y: 148, width: 300, text: 'Recipient Name', fontSize: 13, bold: true }),
      text({ x: 40, y: 166, width: 300, text: 'Recipient Title\nCompany Name\n456 Recipient Street, City, Country', fontSize: 11, color: '#5f6368', height: 52 }),
      text({ x: 40, y: 238, width: W - 80, text: 'Dear [Recipient Name],', fontSize: 12 }),
      text({ x: 40, y: 268, width: W - 80, text: 'Opening paragraph: introduce the purpose of your letter and provide context. This is where you make your first impression, so be clear and concise about why you are writing.', fontSize: 11, color: '#202124', height: 55 }),
      text({ x: 40, y: 340, width: W - 80, text: 'Body paragraph: expand on the main point of your letter with supporting details, evidence, or explanation. Keep each paragraph focused on a single idea.', fontSize: 11, color: '#202124', height: 55 }),
      text({ x: 40, y: 412, width: W - 80, text: 'Closing paragraph: summarise your key points, state any action you expect from the recipient, and express appreciation for their time and consideration.', fontSize: 11, color: '#202124', height: 55 }),
      text({ x: 40, y: 484, width: 200, text: 'Sincerely,', fontSize: 12 }),
      text({ x: 40, y: 530, width: 200, text: 'Your Name', fontSize: 13, bold: true }),
    ],
  };
}

function meetingNotesPage(): Page {
  return {
    id: nanoid(),
    width: W,
    height: H,
    backgroundImage: null,
    objects: [
      rect({ x: 0, y: 0, width: W, height: 80, fill: '#1a73e8', stroke: '#1a73e8', strokeWidth: 0 }),
      text({ x: 40, y: 16, width: 400, text: 'Meeting Notes', fontSize: 26, bold: true, color: '#ffffff' }),
      text({ x: 40, y: 52, width: 400, text: 'Project / Team Name  ·  DD Month YYYY', fontSize: 11, color: '#d2e3fc' }),
      // Meta
      rect({ x: 40, y: 96, width: W - 80, height: 60, fill: '#f8f9fa', stroke: '#dadce0', strokeWidth: 1 }),
      text({ x: 52, y: 104, width: 120, text: 'Attendees:', fontSize: 11, bold: true }),
      text({ x: 52, y: 122, width: 460, text: 'Name 1, Name 2, Name 3, Name 4', fontSize: 11, color: '#5f6368' }),
      text({ x: 52, y: 140, width: 120, text: 'Facilitator:', fontSize: 11, bold: true }),
      text({ x: 160, y: 140, width: 300, text: 'Name', fontSize: 11, color: '#5f6368' }),
      // Agenda
      text({ x: 40, y: 180, width: 200, text: 'AGENDA', fontSize: 10, bold: true, color: '#1a73e8' }),
      rect({ x: 40, y: 196, width: W - 80, height: 1, fill: '#dadce0', stroke: '#dadce0', strokeWidth: 0 }),
      text({ x: 40, y: 202, width: W - 80, text: '1. Agenda item one\n2. Agenda item two\n3. Agenda item three', fontSize: 11, height: 50 }),
      // Discussion
      text({ x: 40, y: 268, width: 200, text: 'DISCUSSION & DECISIONS', fontSize: 10, bold: true, color: '#1a73e8' }),
      rect({ x: 40, y: 284, width: W - 80, height: 1, fill: '#dadce0', stroke: '#dadce0', strokeWidth: 0 }),
      text({ x: 40, y: 290, width: W - 80, text: '• Discussion point or decision made\n• Discussion point or decision made\n• Discussion point or decision made', fontSize: 11, height: 55 }),
      // Action items
      text({ x: 40, y: 362, width: 200, text: 'ACTION ITEMS', fontSize: 10, bold: true, color: '#1a73e8' }),
      rect({ x: 40, y: 378, width: W - 80, height: 1, fill: '#dadce0', stroke: '#dadce0', strokeWidth: 0 }),
      text({ x: 40, y: 384, width: W - 80, text: '☐  Action item — Owner — Due date\n☐  Action item — Owner — Due date\n☐  Action item — Owner — Due date', fontSize: 11, height: 55 }),
      // Next meeting
      text({ x: 40, y: 456, width: 200, text: 'NEXT MEETING', fontSize: 10, bold: true, color: '#1a73e8' }),
      rect({ x: 40, y: 472, width: W - 80, height: 1, fill: '#dadce0', stroke: '#dadce0', strokeWidth: 0 }),
      text({ x: 40, y: 478, width: W - 80, text: 'Date: DD Month YYYY  ·  Time: 00:00  ·  Location / Link: TBC', fontSize: 11, color: '#5f6368' }),
    ],
  };
}

function reportCoverPage(): Page {
  return {
    id: nanoid(),
    width: W,
    height: H,
    backgroundImage: null,
    objects: [
      rect({ x: 0, y: 0, width: W, height: H / 2.2, fill: '#1a73e8', stroke: '#1a73e8', strokeWidth: 0 }),
      rect({ x: 0, y: H / 2.2, width: W, height: 6, fill: '#fbbc04', stroke: '#fbbc04', strokeWidth: 0 }),
      text({ x: 40, y: 80, width: W - 80, text: 'Report Title', fontSize: 36, bold: true, color: '#ffffff', align: 'left' }),
      text({ x: 40, y: 132, width: W - 80, text: 'Report Subtitle or Department Name', fontSize: 16, color: '#d2e3fc' }),
      text({ x: 40, y: H / 2.2 + 30, width: 200, text: 'Prepared by:', fontSize: 11, bold: true, color: '#5f6368' }),
      text({ x: 40, y: H / 2.2 + 48, width: 300, text: 'Author Name / Team Name', fontSize: 13, color: '#202124' }),
      text({ x: 40, y: H / 2.2 + 80, width: 200, text: 'Date:', fontSize: 11, bold: true, color: '#5f6368' }),
      text({ x: 40, y: H / 2.2 + 98, width: 200, text: 'DD Month YYYY', fontSize: 13, color: '#202124' }),
      text({ x: 40, y: H / 2.2 + 130, width: 200, text: 'Version:', fontSize: 11, bold: true, color: '#5f6368' }),
      text({ x: 40, y: H / 2.2 + 148, width: 200, text: '1.0', fontSize: 13, color: '#202124' }),
      rect({ x: 40, y: H - 80, width: W - 80, height: 1, fill: '#dadce0', stroke: '#dadce0', strokeWidth: 0 }),
      text({ x: 40, y: H - 66, width: W - 80, text: 'Confidential  ·  For internal use only', fontSize: 10, color: '#9aa0a6' }),
    ],
  };
}

function certificatePage(): Page {
  return {
    id: nanoid(),
    width: W,
    height: H,
    backgroundImage: null,
    objects: [
      // Outer border
      rect({ x: 20, y: 20, width: W - 40, height: H - 40, fill: undefined, stroke: '#1a73e8', strokeWidth: 3, cornerRadius: 4 }),
      rect({ x: 28, y: 28, width: W - 56, height: H - 56, fill: undefined, stroke: '#fbbc04', strokeWidth: 1, cornerRadius: 2 }),
      // Header
      text({ x: 40, y: 70, width: W - 80, text: 'Certificate of Achievement', fontSize: 30, bold: true, color: '#1a73e8', align: 'center' }),
      rect({ x: W / 2 - 120, y: 112, width: 240, height: 2, fill: '#fbbc04', stroke: '#fbbc04', strokeWidth: 0 }),
      text({ x: 40, y: 130, width: W - 80, text: 'This is to certify that', fontSize: 13, color: '#5f6368', align: 'center', italic: true }),
      // Name
      text({ x: 40, y: 176, width: W - 80, text: 'Recipient Full Name', fontSize: 26, bold: true, color: '#202124', align: 'center' }),
      rect({ x: 80, y: 216, width: W - 160, height: 1, fill: '#dadce0', stroke: '#dadce0', strokeWidth: 0 }),
      // Body
      text({ x: 40, y: 240, width: W - 80, text: 'has successfully completed', fontSize: 13, color: '#5f6368', align: 'center', italic: true }),
      text({ x: 40, y: 272, width: W - 80, text: 'Course / Program / Achievement Name', fontSize: 18, bold: true, color: '#202124', align: 'center' }),
      text({ x: 40, y: 310, width: W - 80, text: 'with distinction on DD Month YYYY', fontSize: 13, color: '#5f6368', align: 'center', italic: true }),
      // Signatures
      rect({ x: 80, y: H - 160, width: 160, height: 1, fill: '#202124', stroke: '#202124', strokeWidth: 0 }),
      text({ x: 80, y: H - 148, width: 160, text: 'Signature', fontSize: 10, color: '#5f6368', align: 'center' }),
      text({ x: 80, y: H - 134, width: 160, text: 'Name, Title', fontSize: 11, bold: true, align: 'center' }),
      rect({ x: W - 240, y: H - 160, width: 160, height: 1, fill: '#202124', stroke: '#202124', strokeWidth: 0 }),
      text({ x: W - 240, y: H - 148, width: 160, text: 'Signature', fontSize: 10, color: '#5f6368', align: 'center' }),
      text({ x: W - 240, y: H - 134, width: 160, text: 'Name, Title', fontSize: 11, bold: true, align: 'center' }),
    ],
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface TemplateDefinition {
  id: string;
  label: string;
  description: string;
  color: string; // accent color for the thumbnail preview
  icon: string;  // emoji used in the thumbnail
  buildPages: () => Page[];
}

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: 'blank',
    label: 'Blank document',
    description: 'Start with an empty page',
    color: '#f0f2f5',
    icon: '📄',
    buildPages: () => [blankPage()],
  },
  {
    id: 'resume',
    label: 'Resume / CV',
    description: 'Professional one-page resume',
    color: '#e8f0fe',
    icon: '👤',
    buildPages: () => [resumePage()],
  },
  {
    id: 'invoice',
    label: 'Invoice',
    description: 'Clean client invoice with line items',
    color: '#e6f4ea',
    icon: '🧾',
    buildPages: () => [invoicePage()],
  },
  {
    id: 'letter',
    label: 'Letter',
    description: 'Formal business or personal letter',
    color: '#fce8e6',
    icon: '✉️',
    buildPages: () => [letterPage()],
  },
  {
    id: 'meeting',
    label: 'Meeting notes',
    description: 'Structured agenda and action items',
    color: '#fef7e0',
    icon: '📋',
    buildPages: () => [meetingNotesPage()],
  },
  {
    id: 'report',
    label: 'Report cover page',
    description: 'Polished cover for any report',
    color: '#e8f0fe',
    icon: '📊',
    buildPages: () => [reportCoverPage()],
  },
  {
    id: 'certificate',
    label: 'Certificate',
    description: 'Achievement or completion certificate',
    color: '#fef7e0',
    icon: '🏆',
    buildPages: () => [certificatePage()],
  },
];