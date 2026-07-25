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

/**
 * Shared helper for building simple ruled tables (header row + data rows)
 * out of rect/text primitives. Used by the list/schedule/tracker style
 * templates below so each one doesn't have to hand-place every cell.
 */
function tableGrid(opts: {
  x: number;
  y: number;
  columns: { label: string; width: number; align?: 'left' | 'center' | 'right' }[];
  rows: string[][];
  rowHeight?: number;
  headerHeight?: number;
  headerFill?: string;
  headerColor?: string;
  fontSize?: number;
  cellFontSize?: number;
  rowFill?: string;
  altRowFill?: string;
  borderColor?: string;
}): (TextObject | RectObject)[] {
  const {
    x, y, columns, rows,
    rowHeight = 24,
    headerHeight = 26,
    headerFill = '#1a73e8',
    headerColor = '#ffffff',
    fontSize = 10,
    cellFontSize = 10,
    rowFill = '#ffffff',
    altRowFill = '#f8f9fa',
    borderColor = '#dadce0',
  } = opts;

  const objects: (TextObject | RectObject)[] = [];
  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);

  // Header row
  objects.push(rect({ x, y, width: totalWidth, height: headerHeight, fill: headerFill, stroke: headerFill, strokeWidth: 0 }));
  let hx = x;
  for (const col of columns) {
    objects.push(text({
      x: hx + 6, y: y + headerHeight / 2 - 6, width: col.width - 12,
      text: col.label, fontSize, bold: true, color: headerColor, align: col.align ?? 'left',
    }));
    hx += col.width;
  }

  // Data rows
  rows.forEach((rowValues, i) => {
    const ry = y + headerHeight + i * rowHeight;
    objects.push(rect({ x, y: ry, width: totalWidth, height: rowHeight, fill: i % 2 === 0 ? rowFill : altRowFill, stroke: borderColor, strokeWidth: 1 }));
    let cx = x;
    columns.forEach((col, ci) => {
      objects.push(text({
        x: cx + 6, y: ry + rowHeight / 2 - 6, width: col.width - 12,
        text: rowValues[ci] ?? '', fontSize: cellFontSize, align: col.align ?? 'left',
      }));
      cx += col.width;
    });
  });

  return objects;
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

function toDoListPage(): Page {
  const columns = [
    { label: '✓', width: 32, align: 'center' as const },
    { label: 'Task', width: 300 },
    { label: 'Priority', width: 90, align: 'center' as const },
    { label: 'Due Date', width: W - 80 - 32 - 300 - 90, align: 'center' as const },
  ];
  const rows = Array.from({ length: 11 }, () => ['☐', 'Task description', 'Medium', 'DD/MM/YYYY']);
  return {
    id: nanoid(),
    width: W,
    height: H,
    backgroundImage: null,
    objects: [
      rect({ x: 0, y: 0, width: W, height: 90, fill: '#f4511e', stroke: '#f4511e', strokeWidth: 0 }),
      text({ x: 40, y: 22, width: 400, text: 'To Do List', fontSize: 26, bold: true, color: '#ffffff' }),
      text({ x: 40, y: 58, width: 400, text: 'List Name  ·  DD Month YYYY', fontSize: 11, color: '#fde0d5' }),
      ...tableGrid({ x: 40, y: 120, columns, rows, headerFill: '#f4511e' }),
    ],
  };
}

function projectTrackingPage(): Page {
  const columns = [
    { label: 'Project', width: 170 },
    { label: 'Owner', width: 100 },
    { label: 'Status', width: 90, align: 'center' as const },
    { label: 'Priority', width: 70, align: 'center' as const },
    { label: 'Due Date', width: W - 80 - 170 - 100 - 90 - 70, align: 'center' as const },
  ];
  const rows = Array.from({ length: 10 }, () => ['Project name', 'Owner name', 'In Progress', 'Medium', 'DD/MM/YYYY']);
  return {
    id: nanoid(),
    width: W,
    height: H,
    backgroundImage: null,
    objects: [
      rect({ x: 0, y: 0, width: W, height: 90, fill: '#00897b', stroke: '#00897b', strokeWidth: 0 }),
      text({ x: 40, y: 22, width: 400, text: 'Project Tracker', fontSize: 26, bold: true, color: '#ffffff' }),
      text({ x: 40, y: 58, width: 400, text: 'Team / Department  ·  DD Month YYYY', fontSize: 11, color: '#d3ede9' }),
      ...tableGrid({ x: 40, y: 120, columns, rows, headerFill: '#00897b' }),
    ],
  };
}

function timetablePage(): Page {
  const dayWidth = (W - 80 - 75) / 7;
  const columns = [
    { label: 'Time', width: 75, align: 'center' as const },
    { label: 'Mon', width: dayWidth, align: 'center' as const },
    { label: 'Tue', width: dayWidth, align: 'center' as const },
    { label: 'Wed', width: dayWidth, align: 'center' as const },
    { label: 'Thu', width: dayWidth, align: 'center' as const },
    { label: 'Fri', width: dayWidth, align: 'center' as const },
    { label: 'Sat', width: dayWidth, align: 'center' as const },
    { label: 'Sun', width: dayWidth, align: 'center' as const },
  ];
  const times = ['8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM'];
  const rows = times.map((t) => [t, '', '', '', '', '', '', '']);
  return {
    id: nanoid(),
    width: W,
    height: H,
    backgroundImage: null,
    objects: [
      rect({ x: 0, y: 0, width: W, height: 90, fill: '#8e24aa', stroke: '#8e24aa', strokeWidth: 0 }),
      text({ x: 40, y: 22, width: 400, text: 'Weekly Timetable', fontSize: 26, bold: true, color: '#ffffff' }),
      text({ x: 40, y: 58, width: 400, text: 'Name / Class  ·  Week of DD Month YYYY', fontSize: 11, color: '#ecd6f2' }),
      ...tableGrid({ x: 40, y: 120, columns, rows, rowHeight: 26, headerFill: '#8e24aa', cellFontSize: 9, fontSize: 10 }),
    ],
  };
}

function shiftSchedulePage(): Page {
  const dayWidth = (W - 80 - 140) / 7;
  const columns = [
    { label: 'Employee', width: 140 },
    { label: 'Mon', width: dayWidth, align: 'center' as const },
    { label: 'Tue', width: dayWidth, align: 'center' as const },
    { label: 'Wed', width: dayWidth, align: 'center' as const },
    { label: 'Thu', width: dayWidth, align: 'center' as const },
    { label: 'Fri', width: dayWidth, align: 'center' as const },
    { label: 'Sat', width: dayWidth, align: 'center' as const },
    { label: 'Sun', width: dayWidth, align: 'center' as const },
  ];
  const rows = Array.from({ length: 8 }, () => ['Employee name', '9–5', '9–5', 'Off', '9–5', '9–5', 'Off', 'Off']);
  return {
    id: nanoid(),
    width: W,
    height: H,
    backgroundImage: null,
    objects: [
      rect({ x: 0, y: 0, width: W, height: 90, fill: '#43a047', stroke: '#43a047', strokeWidth: 0 }),
      text({ x: 40, y: 22, width: 400, text: 'Employee Shift Schedule', fontSize: 24, bold: true, color: '#ffffff' }),
      text({ x: 40, y: 58, width: 400, text: 'Team / Location  ·  Week of DD Month YYYY', fontSize: 11, color: '#dcf0dd' }),
      ...tableGrid({ x: 40, y: 120, columns, rows, rowHeight: 26, headerFill: '#43a047', cellFontSize: 9 }),
    ],
  };
}

function attendancePage(): Page {
  const dayWidth = (W - 80 - 160 - 70) / 5;
  const columns = [
    { label: 'Name', width: 160 },
    { label: 'Mon', width: dayWidth, align: 'center' as const },
    { label: 'Tue', width: dayWidth, align: 'center' as const },
    { label: 'Wed', width: dayWidth, align: 'center' as const },
    { label: 'Thu', width: dayWidth, align: 'center' as const },
    { label: 'Fri', width: dayWidth, align: 'center' as const },
    { label: 'Total', width: 70, align: 'center' as const },
  ];
  const rows = Array.from({ length: 12 }, () => ['Name', 'P', 'P', 'P', 'P', 'P', '5/5']);
  return {
    id: nanoid(),
    width: W,
    height: H,
    backgroundImage: null,
    objects: [
      rect({ x: 0, y: 0, width: W, height: 90, fill: '#d81b60', stroke: '#d81b60', strokeWidth: 0 }),
      text({ x: 40, y: 22, width: 400, text: 'Attendance Sheet', fontSize: 26, bold: true, color: '#ffffff' }),
      text({ x: 40, y: 58, width: 400, text: 'Class / Team  ·  Week of DD Month YYYY', fontSize: 11, color: '#fad0e0' }),
      ...tableGrid({ x: 40, y: 120, columns, rows, headerFill: '#d81b60' }),
      text({ x: 40, y: H - 60, width: W - 80, text: 'P = Present   A = Absent   L = Late', fontSize: 10, color: '#5f6368' }),
    ],
  };
}

function gradeBookPage(): Page {
  const columns = [
    { label: 'Student', width: 140 },
    { label: 'Assignment 1', width: 90, align: 'center' as const },
    { label: 'Assignment 2', width: 90, align: 'center' as const },
    { label: 'Assignment 3', width: 90, align: 'center' as const },
    { label: 'Assignment 4', width: 90, align: 'center' as const },
    { label: 'Final Grade', width: W - 80 - 140 - 90 * 4, align: 'center' as const },
  ];
  const rows = Array.from({ length: 10 }, () => ['Student name', '—', '—', '—', '—', '—']);
  return {
    id: nanoid(),
    width: W,
    height: H,
    backgroundImage: null,
    objects: [
      rect({ x: 0, y: 0, width: W, height: 90, fill: '#fb8c00', stroke: '#fb8c00', strokeWidth: 0 }),
      text({ x: 40, y: 22, width: 400, text: 'Grade Book', fontSize: 26, bold: true, color: '#ffffff' }),
      text({ x: 40, y: 58, width: 400, text: 'Class / Subject  ·  Term / Semester', fontSize: 11, color: '#fde3c2' }),
      ...tableGrid({ x: 40, y: 120, columns, rows, cellFontSize: 9, fontSize: 9, headerFill: '#fb8c00' }),
    ],
  };
}

function expenseReportPage(): Page {
  const columns = [
    { label: 'Date', width: 80, align: 'center' as const },
    { label: 'Category', width: 110 },
    { label: 'Description', width: 200 },
    { label: 'Amount', width: W - 80 - 80 - 110 - 200, align: 'right' as const },
  ];
  const rows = Array.from({ length: 9 }, () => ['DD/MM/YYYY', 'Category', 'Expense description', '$0.00']);
  const tableEndY = 140 + 26 + rows.length * 24;
  return {
    id: nanoid(),
    width: W,
    height: H,
    backgroundImage: null,
    objects: [
      text({ x: 40, y: 40, width: 300, text: 'Expense Report', fontSize: 28, bold: true, color: '#3949ab' }),
      text({ x: 40, y: 80, width: 300, text: 'Employee Name\nDepartment  ·  DD Month YYYY', fontSize: 11, color: '#5f6368', height: 36 }),
      text({ x: W - 200, y: 40, width: 160, text: 'Report #0001', fontSize: 13, bold: true, align: 'right' }),
      text({ x: W - 200, y: 60, width: 160, text: 'Period: MM/YYYY', fontSize: 11, color: '#5f6368', align: 'right' }),
      ...tableGrid({ x: 40, y: 140, columns, rows, headerFill: '#3949ab' }),
      rect({ x: W - 200, y: tableEndY + 12, width: 160, height: 28, fill: '#3949ab', stroke: '#3949ab', strokeWidth: 0 }),
      text({ x: W - 192, y: tableEndY + 20, width: 60, text: 'TOTAL', fontSize: 11, bold: true, color: '#ffffff' }),
      text({ x: W - 132, y: tableEndY + 20, width: 92, text: '$0.00', fontSize: 13, bold: true, color: '#ffffff', align: 'right' }),
      text({ x: 40, y: tableEndY + 50, width: 150, text: 'APPROVED BY', fontSize: 10, bold: true, color: '#3949ab' }),
      text({ x: 40, y: tableEndY + 68, width: W - 80, text: 'Signature: ______________________        Date: __________', fontSize: 11, color: '#5f6368' }),
    ],
  };
}

function purchaseOrderPage(): Page {
  const columns = [
    { label: 'Item', width: 240 },
    { label: 'Qty', width: 60, align: 'center' as const },
    { label: 'Unit Cost', width: 90, align: 'right' as const },
    { label: 'Total', width: W - 80 - 240 - 60 - 90, align: 'right' as const },
  ];
  const rows = [
    ['Item description', '1', '$0.00', '$0.00'],
    ['Item description', '1', '$0.00', '$0.00'],
    ['Item description', '1', '$0.00', '$0.00'],
  ];
  const tableEndY = 250 + 26 + rows.length * 24;
  return {
    id: nanoid(),
    width: W,
    height: H,
    backgroundImage: null,
    objects: [
      text({ x: 40, y: 40, width: 250, text: 'PURCHASE ORDER', fontSize: 24, bold: true, color: '#6d4c41' }),
      text({ x: 40, y: 78, width: 300, text: 'Your Business Name\nyour@email.com  ·  +1 (555) 000-0000\n123 Street, City, Country', fontSize: 11, color: '#5f6368', height: 52 }),
      text({ x: W - 200, y: 40, width: 160, text: 'PO #0001', fontSize: 14, bold: true, align: 'right' }),
      text({ x: W - 200, y: 62, width: 160, text: 'Date: DD/MM/YYYY', fontSize: 11, color: '#5f6368', align: 'right' }),
      text({ x: W - 200, y: 80, width: 160, text: 'Needed by: DD/MM/YYYY', fontSize: 11, color: '#5f6368', align: 'right' }),
      text({ x: 40, y: 155, width: 150, text: 'VENDOR', fontSize: 10, bold: true, color: '#6d4c41' }),
      text({ x: 40, y: 172, width: 250, text: 'Vendor Name\nvendor@email.com\n456 Avenue, City, Country', fontSize: 11, height: 50 }),
      text({ x: 320, y: 155, width: 150, text: 'SHIP TO', fontSize: 10, bold: true, color: '#6d4c41' }),
      text({ x: 320, y: 172, width: 235, text: 'Your Business Name\n123 Street, City, Country', fontSize: 11, height: 36 }),
      ...tableGrid({ x: 40, y: 250, columns, rows, headerFill: '#6d4c41' }),
      rect({ x: 380, y: tableEndY + 12, width: W - 80 - 340, height: 28, fill: '#6d4c41', stroke: '#6d4c41', strokeWidth: 0 }),
      text({ x: 388, y: tableEndY + 20, width: 60, text: 'TOTAL', fontSize: 11, bold: true, color: '#ffffff' }),
      text({ x: 448, y: tableEndY + 20, width: 100, text: '$0.00', fontSize: 13, bold: true, color: '#ffffff', align: 'right' }),
      text({ x: 40, y: tableEndY + 52, width: 150, text: 'TERMS', fontSize: 10, bold: true, color: '#6d4c41' }),
      text({ x: 40, y: tableEndY + 70, width: W - 80, text: 'Please deliver by the date above and reference this PO number on your invoice.', fontSize: 11, color: '#5f6368' }),
      text({ x: 40, y: tableEndY + 112, width: 300, text: 'Authorized by: ______________________', fontSize: 11, color: '#202124' }),
    ],
  };
}

function annualBudgetPage(): Page {
  const columns = [
    { label: 'Category', width: 155 },
    { label: 'Q1', width: 80, align: 'right' as const },
    { label: 'Q2', width: 80, align: 'right' as const },
    { label: 'Q3', width: 80, align: 'right' as const },
    { label: 'Q4', width: 80, align: 'right' as const },
    { label: 'Total', width: W - 80 - 155 - 80 * 4, align: 'right' as const },
  ];
  const rows = [
    ['Revenue', '$0', '$0', '$0', '$0', '$0'],
    ['Salaries', '$0', '$0', '$0', '$0', '$0'],
    ['Marketing', '$0', '$0', '$0', '$0', '$0'],
    ['Operations', '$0', '$0', '$0', '$0', '$0'],
    ['Software & Tools', '$0', '$0', '$0', '$0', '$0'],
    ['Travel', '$0', '$0', '$0', '$0', '$0'],
    ['Other', '$0', '$0', '$0', '$0', '$0'],
  ];
  const tableEndY = 130 + 26 + rows.length * 24;
  return {
    id: nanoid(),
    width: W,
    height: H,
    backgroundImage: null,
    objects: [
      rect({ x: 0, y: 0, width: W, height: 90, fill: '#f9a825', stroke: '#f9a825', strokeWidth: 0 }),
      text({ x: 40, y: 22, width: 400, text: 'Annual Budget', fontSize: 26, bold: true, color: '#ffffff' }),
      text({ x: 40, y: 58, width: 400, text: 'Department / Company  ·  Fiscal Year YYYY', fontSize: 11, color: '#fdecc0' }),
      ...tableGrid({ x: 40, y: 130, columns, rows, headerFill: '#f9a825', headerColor: '#202124' }),
      rect({ x: 40, y: tableEndY + 10, width: W - 80, height: 28, fill: '#202124', stroke: '#202124', strokeWidth: 0 }),
      text({ x: 48, y: tableEndY + 18, width: 155, text: 'NET TOTAL', fontSize: 11, bold: true, color: '#ffffff' }),
      text({ x: W - 200, y: tableEndY + 18, width: 152, text: '$0', fontSize: 13, bold: true, color: '#ffffff', align: 'right' }),
    ],
  };
}

function teamRosterPage(): Page {
  const columns = [
    { label: 'Name', width: 140 },
    { label: 'Role', width: 120 },
    { label: 'Email', width: 160 },
    { label: 'Phone', width: W - 80 - 140 - 120 - 160 },
  ];
  const rows = Array.from({ length: 10 }, () => ['Full name', 'Role / Title', 'name@email.com', '+1 (555) 000-0000']);
  return {
    id: nanoid(),
    width: W,
    height: H,
    backgroundImage: null,
    objects: [
      rect({ x: 0, y: 0, width: W, height: 90, fill: '#1e88e5', stroke: '#1e88e5', strokeWidth: 0 }),
      text({ x: 40, y: 22, width: 400, text: 'Team Roster', fontSize: 26, bold: true, color: '#ffffff' }),
      text({ x: 40, y: 58, width: 400, text: 'Team / Department  ·  Updated DD Month YYYY', fontSize: 11, color: '#d3e6fb' }),
      ...tableGrid({ x: 40, y: 120, columns, rows, headerFill: '#1e88e5' }),
    ],
  };
}

function timeShiftsPage(): Page {
  const columns = [
    { label: 'Day', width: 90 },
    { label: 'Clock In', width: 100, align: 'center' as const },
    { label: 'Clock Out', width: 100, align: 'center' as const },
    { label: 'Break', width: 75, align: 'center' as const },
    { label: 'Total Hours', width: W - 80 - 90 - 100 - 100 - 75, align: 'center' as const },
  ];
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const rows = days.map((d) => [d, '9:00 AM', '5:00 PM', '30 min', '7.5']);
  const tableEndY = 140 + 26 + rows.length * 24;
  return {
    id: nanoid(),
    width: W,
    height: H,
    backgroundImage: null,
    objects: [
      text({ x: 40, y: 40, width: 300, text: 'Time Sheet', fontSize: 28, bold: true, color: '#5e35b1' }),
      text({ x: 40, y: 80, width: 300, text: 'Employee Name  ·  Week of DD Month YYYY', fontSize: 11, color: '#5f6368' }),
      ...tableGrid({ x: 40, y: 140, columns, rows, headerFill: '#5e35b1' }),
      rect({ x: W - 200, y: tableEndY + 12, width: 160, height: 28, fill: '#5e35b1', stroke: '#5e35b1', strokeWidth: 0 }),
      text({ x: W - 192, y: tableEndY + 20, width: 80, text: 'TOTAL', fontSize: 11, bold: true, color: '#ffffff' }),
      text({ x: W - 132, y: tableEndY + 20, width: 92, text: '37.5 hrs', fontSize: 12, bold: true, color: '#ffffff', align: 'right' }),
      text({ x: 40, y: tableEndY + 60, width: 300, text: 'Employee signature: ______________________', fontSize: 11, color: '#202124' }),
      text({ x: 40, y: tableEndY + 84, width: 300, text: 'Manager signature: ______________________', fontSize: 11, color: '#202124' }),
    ],
  };
}

function analyticsDashboardPage(): Page {
  const cardWidth = (W - 80 - 3 * 14) / 4;
  const cardData = [
    { label: 'Total Revenue', value: '$0' },
    { label: 'Active Users', value: '0' },
    { label: 'Conversion Rate', value: '0%' },
    { label: 'Avg. Order Value', value: '$0' },
  ];
  const cards = cardData.flatMap((c, i) => {
    const cx = 40 + i * (cardWidth + 14);
    return [
      rect({ x: cx, y: 120, width: cardWidth, height: 78, fill: '#ffffff', stroke: '#dadce0', strokeWidth: 1, cornerRadius: 8 }),
      rect({ x: cx, y: 120, width: 4, height: 78, fill: '#0097a7', stroke: '#0097a7', strokeWidth: 0, cornerRadius: 2 }),
      text({ x: cx + 14, y: 132, width: cardWidth - 24, text: c.value, fontSize: 20, bold: true, color: '#202124' }),
      text({ x: cx + 14, y: 160, width: cardWidth - 24, text: c.label, fontSize: 10, color: '#5f6368' }),
    ];
  });

  const barValues1 = [40, 70, 55, 90, 65, 100, 75];
  const barLabels1 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];
  const chart1Y = 240;
  const chart1H = 200;
  const chart1X = 40;
  const chart1W = (W - 80 - 20) / 2;
  const barW1 = (chart1W - 40) / barValues1.length - 8;
  const bars1 = barValues1.flatMap((v, i) => {
    const bh = (v / 100) * (chart1H - 60);
    const bx = chart1X + 20 + i * (barW1 + 8);
    const by = chart1Y + chart1H - 40 - bh;
    return [
      rect({ x: bx, y: by, width: barW1, height: bh, fill: '#0097a7', stroke: '#0097a7', strokeWidth: 0, cornerRadius: 2 }),
      text({ x: bx - 4, y: chart1Y + chart1H - 32, width: barW1 + 8, text: barLabels1[i], fontSize: 8, color: '#5f6368', align: 'center' }),
    ];
  });

  const barValues2 = [80, 45, 30, 60];
  const barLabels2 = ['Organic', 'Paid', 'Social', 'Referral'];
  const chart2X = chart1X + chart1W + 20;
  const chart2W = chart1W;
  const barW2 = (chart2W - 40) / barValues2.length - 12;
  const bars2 = barValues2.flatMap((v, i) => {
    const bh = (v / 100) * (chart1H - 60);
    const bx = chart2X + 20 + i * (barW2 + 12);
    const by = chart1Y + chart1H - 40 - bh;
    return [
      rect({ x: bx, y: by, width: barW2, height: bh, fill: '#3949ab', stroke: '#3949ab', strokeWidth: 0, cornerRadius: 2 }),
      text({ x: bx - 6, y: chart1Y + chart1H - 32, width: barW2 + 12, text: barLabels2[i], fontSize: 8, color: '#5f6368', align: 'center' }),
    ];
  });

  return {
    id: nanoid(),
    width: W,
    height: H,
    backgroundImage: null,
    objects: [
      rect({ x: 0, y: 0, width: W, height: 90, fill: '#0097a7', stroke: '#0097a7', strokeWidth: 0 }),
      text({ x: 40, y: 22, width: 400, text: 'Analytics Dashboard', fontSize: 26, bold: true, color: '#ffffff' }),
      text({ x: 40, y: 58, width: 400, text: 'Project / Product  ·  DD Month YYYY', fontSize: 11, color: '#cdeef0' }),
      ...cards,
      rect({ x: chart1X, y: chart1Y, width: chart1W, height: chart1H, fill: '#f8f9fa', stroke: '#dadce0', strokeWidth: 1, cornerRadius: 8 }),
      text({ x: chart1X + 14, y: chart1Y + 12, width: chart1W - 28, text: 'Monthly Revenue', fontSize: 11, bold: true, color: '#202124' }),
      ...bars1,
      rect({ x: chart2X, y: chart1Y, width: chart2W, height: chart1H, fill: '#f8f9fa', stroke: '#dadce0', strokeWidth: 1, cornerRadius: 8 }),
      text({ x: chart2X + 14, y: chart1Y + 12, width: chart2W - 28, text: 'Traffic by Channel', fontSize: 11, bold: true, color: '#202124' }),
      ...bars2,
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
    description: 'One-page resume',
    color: '#e8f0fe',
    icon: '👤',
    buildPages: () => [resumePage()],
  },
  {
    id: 'invoice',
    label: 'Invoice',
    description: 'Clean client invoice',
    color: '#e6f4ea',
    icon: '🧾',
    buildPages: () => [invoicePage()],
  },
  {
    id: 'letter',
    label: 'Letter',
    description: 'Business or personal',
    color: '#fce8e6',
    icon: '✉️',
    buildPages: () => [letterPage()],
  },
  {
    id: 'meeting',
    label: 'Meeting notes',
    description: 'Agendas and notes',
    color: '#fef7e0',
    icon: '📋',
    buildPages: () => [meetingNotesPage()],
  },
  {
    id: 'report',
    label: 'Report cover page',
    description: 'Polished cover for reports',
    color: '#e8f0fe',
    icon: '📊',
    buildPages: () => [reportCoverPage()],
  },
  {
    id: 'certificate',
    label: 'Certificate',
    description: 'Achievement certificates',
    color: '#fef7e0',
    icon: '🏆',
    buildPages: () => [certificatePage()],
  },
  {
    id: 'todo',
    label: 'To do list',
    description: 'Track tasks and priorities',
    color: '#fbe4da',
    icon: '✅',
    buildPages: () => [toDoListPage()],
  },
  {
    id: 'project-tracking',
    label: 'Project tracking',
    description: 'Status board for projects',
    color: '#daece9',
    icon: '📁',
    buildPages: () => [projectTrackingPage()],
  },
  {
    id: 'timetable',
    label: 'Timetable',
    description: 'Weekly schedule grid',
    color: '#ede0f0',
    icon: '🗓️',
    buildPages: () => [timetablePage()],
  },
  {
    id: 'shift-schedule',
    label: 'Employee shift schedule',
    description: 'Weekly shifts by employee',
    color: '#dcefdd',
    icon: '🕒',
    buildPages: () => [shiftSchedulePage()],
  },
  {
    id: 'attendance',
    label: 'Attendance',
    description: 'Track daily attendance',
    color: '#f9dbe6',
    icon: '📝',
    buildPages: () => [attendancePage()],
  },
  {
    id: 'gradebook',
    label: 'Grade book',
    description: 'Student grades by assignment',
    color: '#fde3c2',
    icon: '🎓',
    buildPages: () => [gradeBookPage()],
  },
  {
    id: 'expense-report',
    label: 'Expense Report',
    description: 'Itemised expenses and totals',
    color: '#dee1f2',
    icon: '💰',
    buildPages: () => [expenseReportPage()],
  },
  {
    id: 'purchase-order',
    label: 'Purchase Order',
    description: 'Vendor purchase order',
    color: '#e5ddda',
    icon: '📦',
    buildPages: () => [purchaseOrderPage()],
  },
  {
    id: 'annual-budget',
    label: 'Annual Budget',
    description: 'Quarterly budget by category',
    color: '#fdecc0',
    icon: '💵',
    buildPages: () => [annualBudgetPage()],
  },
  {
    id: 'team-roster',
    label: 'Team Roster',
    description: 'Contact list for your team',
    color: '#d3e6fb',
    icon: '👥',
    buildPages: () => [teamRosterPage()],
  },
  {
    id: 'time-shifts',
    label: 'Time shifts',
    description: 'Weekly clock in/out sheet',
    color: '#e3ddf3',
    icon: '⏱️',
    buildPages: () => [timeShiftsPage()],
  },
  {
    id: 'analytics-dashboard',
    label: 'Analytics dashboard',
    description: 'KPI cards and charts',
    color: '#dcedee',
    icon: '📈',
    buildPages: () => [analyticsDashboardPage()],
  },
];