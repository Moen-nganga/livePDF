import { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import { useEditorStore } from '../store/editorStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { useI18nStore } from '../store/i18nStore';
import type { PageObject, TextObject, RectObject, ImageObject, Page } from '../types/document';
import { WEB_SAFE_FONTS } from '../lib/fonts';
import { useImageAdd } from '../hooks/useImageAdd.tsx';
import { findMisspelledWords } from '../lib/spellcheck';
import { SpellCheckPanel } from './SpellCheckPanel';
import { SignatureDialog } from './SignatureDialog';
import { PremiumRequiredDialog } from './PremiumRequiredDialog';
import { GRID_SIZE, findFreeGridSlot, type Bounds } from '../lib/grid';

const baseDefaults = { rotation: 0, opacity: 1 };

// Compact sizing shared across all toolbar buttons so everything fits on
// one line -- see Toolbar's outer container (flexWrap: 'nowrap') below.
const COMPACT_BTN: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 11,
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
};

const COMPACT_ICON_BTN: React.CSSProperties = {
  width: 22,
  height: 26,
  padding: 0,
  fontSize: 11,
  lineHeight: 1,
};

function snap(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

// Grid-snapped staggered offset used as the *starting point* for new
// objects -- each successive add nudges diagonally so a run of clicks
// doesn't stack everything in an identical spot. This alone doesn't
// guarantee no overlap (see textPlacementFor below, which does for text).
function nextOffset(count: number): { x: number; y: number } {
  const step = 24;
  return { x: snap(80 + (count % 8) * step), y: snap(80 + (count % 8) * step) };
}

// For newly added text objects (currently just the "+ Date" stamp -- the
// "+ Text" tool instead lets the user draw their own box directly on the
// canvas, which does its own grid+overlap handling there in PdfCanvas.tsx)
// find a grid-aligned spot that doesn't land on top of any text already on
// the page, so a stamp can never overlap a line of text or a link.
function textPlacementFor(page: Page, size: { width: number; height: number }): { x: number; y: number } {
  const existingText: Bounds[] = page.objects
    .filter((o): o is PageObject & { type: 'text' } => o.type === 'text')
    .map((o) => ({ x: o.x, y: o.y, width: o.width, height: o.height }));
  return findFreeGridSlot(nextOffset(page.objects.length), size, existingText, page);
}

interface SpellCheckResult {
  pageIndex: number;
  pageId: string;
  objectId: string;
  word: string;
  /** 1-indexed line within the text object's own content (split on \n), not the page as a whole. */
  line: number;
}

// Counts newlines before a given character offset to find which line (1-
// indexed) that offset falls on within a text object's own content. This
// is about line breaks *within* one text box, not a page-wide line number
// -- a page can have several separate text objects, each with their own
// internal line 1, 2, 3...
function lineNumberAt(text: string, charIndex: number): number {
  return text.slice(0, charIndex).split('\n').length;
}

// How close two text lines' y-positions (in page points) need to be to
// count as sitting on the same visual line on the page -- used to group
// separate TextObjects that happen to share a line (e.g. a job title and
// a right-aligned date range, or a project title and its tech-badge
// label) under one page-line number, rather than each getting counted
// as its own line.
//
// This matters most for PDF uploads: pdfFileToPages creates one
// TextObject per extracted PDF text run, so a page's text is usually
// spread across many single-line objects rather than one multi-line
// object. lineNumberAt above only counts '\n' characters *within* a
// single object's own text -- since most of those objects contain no
// '\n' at all, it always reports "line 1" for every single one of them,
// regardless of where they actually sit on the page. That's the "every
// result says Line 1" bug: it's counting the wrong thing. What the user
// wants when they see "Page 1, Line 4" is which visual line on the
// page they'd need to look at, not which line inside one particular
// text box -- so line numbers need to come from vertical position,
// spanning all the text on the page, not from each object in isolation.
const PAGE_LINE_GROUP_TOLERANCE = 4;

interface PageLineEntry {
  objectId: string;
  internalIndex: number;
  y: number;
}

// Builds a map from each text object's id to an array of page-wide line
// numbers, one per internal line of that object's own text (index 0 =
// the object's first line, index 1 = its second, etc. -- relevant for
// manually-typed multi-line text boxes; PDF-extracted objects normally
// only have a single internal line, so their array only has index 0).
//
// Works by turning every line of every text object on the page into a y-
// position (the object's own y, offset by however many internal lines
// come before it), sorting all of those page-wide by y, and grouping
// entries whose y falls within PAGE_LINE_GROUP_TOLERANCE of each other
// into the same page-line number -- so text that's genuinely side-by-side
// on one visual line (a title + a badge, a role + a date range) collapses
// into a single line number instead of each object inflating the count.
function computePageLineNumbers(objects: PageObject[]): Map<string, number[]> {
  const entries: PageLineEntry[] = [];

  for (const obj of objects) {
    if (obj.type !== 'text') continue;
    const lines = obj.text.split('\n');
    // Approximate the vertical space each internal line of this object
    // occupies -- for the common single-line case (nearly all PDF-
    // extracted runs) this is just the object's own height; for a
    // manually-typed multi-line box it divides the box's height evenly
    // across its lines, which is close enough to rank lines in the right
    // order relative to the rest of the page's text.
    const lineHeight = lines.length > 1 ? obj.height / lines.length : obj.height;
    lines.forEach((_, internalIndex) => {
      entries.push({ objectId: obj.id, internalIndex, y: obj.y + internalIndex * lineHeight });
    });
  }

  entries.sort((a, b) => a.y - b.y);

  const map = new Map<string, number[]>();
  let lineNumber = 0;
  let lastY: number | null = null;

  for (const entry of entries) {
    if (lastY === null || entry.y - lastY > PAGE_LINE_GROUP_TOLERANCE) {
      lineNumber++;
      lastY = entry.y;
    }
    const arr = map.get(entry.objectId) ?? [];
    arr[entry.internalIndex] = lineNumber;
    map.set(entry.objectId, arr);
  }

  return map;
}

interface ToolbarProps {
  /** Called when a free-tier user tries to use a premium-gated tool and clicks "Upgrade" in the resulting prompt. */
  onRequirePremium?: () => void;
}

export function Toolbar({ onRequirePremium }: ToolbarProps) {
  const document = useEditorStore((s) => s.document);
  const activePageIndex = useEditorStore((s) => s.activePageIndex);
  const setActivePageIndex = useEditorStore((s) => s.setActivePageIndex);
  const addObject = useEditorStore((s) => s.addObject);
  const selectedObjectId = useEditorStore((s) => s.selectedObjectId);
  const setSelectedObjectId = useEditorStore((s) => s.setSelectedObjectId);
  const updateObject = useEditorStore((s) => s.updateObject);
  const textPlacementActive = useEditorStore((s) => s.textPlacementActive);
  const setTextPlacementActive = useEditorStore((s) => s.setTextPlacementActive);
  const { triggerImagePick, fileInputElement } = useImageAdd();
  const t = useI18nStore((s) => s.t);

  // Client-side gate only -- there's no server resource being consumed by
  // adding a signature (unlike the weekly document-creation limit, which
  // is enforced server-side too), so this restricts the UI but a
  // technically determined free user could bypass it via devtools. Worth
  // revisiting with a server-side check if this ever needs to be airtight.
  // Uses the store's isPremium() selector (not an inline plan/status check)
  // so admin accounts -- which carry isAdmin: true but planId: 'free' --
  // are correctly treated as premium here too.
  const isPremium = useSubscriptionStore((s) => s.isPremium());

  const activePage = document?.pages[activePageIndex];
  const selectedObject = activePage?.objects.find((o) => o.id === selectedObjectId);
  const selectedText: TextObject | undefined =
    selectedObject?.type === 'text' ? selectedObject : undefined;
  const selectedBorder: RectObject | undefined =
    selectedObject?.type === 'rect' && !selectedObject.fill ? selectedObject : undefined;
  const selectedHighlight: RectObject | undefined =
    selectedObject?.type === 'rect' && selectedObject.isHighlight ? selectedObject : undefined;
  const selectedUnderline: RectObject | undefined =
    selectedObject?.type === 'rect' && selectedObject.isUnderline ? selectedObject : undefined;

  type ToolKind = 'text' | 'rect' | 'border' | 'highlight' | 'underline' | 'ellipse' | 'image' | null;
  const activeTool: ToolKind = (() => {
    if (!selectedObject) return null;
    switch (selectedObject.type) {
      case 'text':
        return 'text';
      case 'rect':
        if (selectedHighlight) return 'highlight';
        if (selectedUnderline) return 'underline';
        return selectedBorder ? 'border' : 'rect';
      case 'ellipse':
        return 'ellipse';
      case 'image':
        return 'image';
      default:
        return null;
    }
  })();

  const [borderDefaults, setBorderDefaults] = useState({ strokeWidth: 2, stroke: '#222222' });
  const [highlightDefaults, setHighlightDefaults] = useState({ fill: '#ffff00' });
  const [underlineDefaults, setUnderlineDefaults] = useState({ thickness: 2 });
  const [watermarkDialogOpen, setWatermarkDialogOpen] = useState(false);

  const [spellCheckOpen, setSpellCheckOpen] = useState(false);
  const [spellCheckLoading, setSpellCheckLoading] = useState(false);
  const [spellCheckError, setSpellCheckError] = useState<string | null>(null);
  const [spellCheckResults, setSpellCheckResults] = useState<SpellCheckResult[]>([]);

  const [signatureDialogOpen, setSignatureDialogOpen] = useState(false);
  const [premiumPromptOpen, setPremiumPromptOpen] = useState(false);

  function updateSelectedText(patch: Partial<TextObject>) {
    if (!activePage || !selectedText) return;
    updateObject(activePage.id, selectedText.id, patch);
  }

  function updateSelectedBorder(patch: Partial<RectObject>) {
    if (!activePage || !selectedBorder) return;
    updateObject(activePage.id, selectedBorder.id, patch);
  }

  function updateSelectedHighlight(patch: Partial<RectObject>) {
    if (!activePage || !selectedHighlight) return;
    updateObject(activePage.id, selectedHighlight.id, patch);
  }

  function updateSelectedUnderline(patch: Partial<RectObject>) {
    if (!activePage || !selectedUnderline) return;
    updateObject(activePage.id, selectedUnderline.id, patch);
  }

  function rotateSelected() {
    if (!activePage || !selectedObject) return;
    const next = (selectedObject.rotation + 90) % 360;
    updateObject(activePage.id, selectedObject.id, { rotation: next });
  }

  function addText() {
    setTextPlacementActive(true);
  }

  function addRect() {
    if (!activePage) return;
    const { x, y } = nextOffset(activePage.objects.length);
    const obj: PageObject = {
      id: nanoid(),
      type: 'rect',
      x,
      y,
      width: 160,
      height: 100,
      ...baseDefaults,
      fill: '#cce5ff',
      stroke: '#3380cc',
      strokeWidth: 1,
      cornerRadius: 4,
    };
    addObject(activePage.id, obj);
  }

  function addBorder() {
    if (!activePage) return;
    const { x, y } = nextOffset(activePage.objects.length);
    const obj: PageObject = {
      id: nanoid(),
      type: 'rect',
      x,
      y,
      width: 240,
      height: 160,
      ...baseDefaults,
      fill: undefined,
      stroke: borderDefaults.stroke,
      strokeWidth: borderDefaults.strokeWidth,
      cornerRadius: 0,
    };
    addObject(activePage.id, obj);
  }

  function addEllipse() {
    if (!activePage) return;
    const { x, y } = nextOffset(activePage.objects.length);
    const obj: PageObject = {
      id: nanoid(),
      type: 'ellipse',
      x,
      y,
      width: 120,
      height: 120,
      ...baseDefaults,
      fill: '#ffe5b3',
      stroke: '#cc9933',
      strokeWidth: 1,
    };
    addObject(activePage.id, obj);
  }

  function addDate() {
    if (!activePage) return;
    const today = new Date().toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    // Grid-aligned and guaranteed not to land on top of existing text --
    // see textPlacementFor's own comment.
    const size = { width: 160, height: 32 };
    const { x, y } = textPlacementFor(activePage, size);
    const obj: PageObject = {
      id: nanoid(),
      type: 'text',
      x,
      y,
      width: size.width,
      height: size.height,
      ...baseDefaults,
      text: today,
      fontSize: 14,
      fontFamily: 'Helvetica',
      color: '#111111',
      bold: false,
      italic: false,
      strikethrough: false,
      align: 'left',
    };
    addObject(activePage.id, obj);
  }

  function addHighlight() {
    if (!activePage) return;
    const { x, y } = nextOffset(activePage.objects.length);
    const obj: PageObject = {
      id: nanoid(),
      type: 'rect',
      isHighlight: true,
      x,
      y,
      width: 200,
      height: 28,
      ...baseDefaults,
      opacity: 0.4,
      fill: highlightDefaults.fill,
      stroke: '#000000',
      strokeWidth: 0,
      cornerRadius: 0,
    };
    addObject(activePage.id, obj);
  }

  // Drops a thin, full-opacity black bar onto the page -- the user then
  // drags it into place under whatever text they want and stretches it
  // with the existing resize handles, same generic drag/resize interaction
  // every other rect already gets in PdfCanvas.tsx. No special rendering
  // is needed: isUnderline is purely an identification tag, same as
  // isHighlight -- an underline draws exactly like any other thin filled
  // rect (see RectObject.isUnderline's own comment in types/document.ts).
  function addUnderline(thickness: number) {
    if (!activePage) return;
    const { x, y } = nextOffset(activePage.objects.length);
    const obj: PageObject = {
      id: nanoid(),
      type: 'rect',
      isUnderline: true,
      x,
      y,
      width: 200,
      height: thickness,
      ...baseDefaults,
      fill: '#111111',
      stroke: '#111111',
      strokeWidth: 0,
      cornerRadius: 0,
    };
    addObject(activePage.id, obj);
  }

  function addWatermark(text: string) {
    if (!activePage) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    const width = Math.min(activePage.width * 0.9, 500);
    const fontSize = 60;
    const height = fontSize * 1.3;

    const obj: PageObject = {
      id: nanoid(),
      type: 'text',
      isWatermark: true,
      x: (activePage.width - width) / 2,
      y: (activePage.height - height) / 2,
      width,
      height,
      rotation: -45,
      opacity: 0.15,
      text: trimmed,
      fontSize,
      fontFamily: 'Helvetica',
      color: '#888888',
      bold: true,
      italic: false,
      strikethrough: false,
      align: 'center',
    };
    addObject(activePage.id, obj);
    setWatermarkDialogOpen(false);
  }

  async function runSpellCheck() {
    if (!document) return;
    setSpellCheckOpen(true);
    setSpellCheckLoading(true);
    setSpellCheckError(null);
    setSpellCheckResults([]);

    try {
      const results: SpellCheckResult[] = [];
      // Sequential rather than Promise.all -- keeps things simple and the
      // dictionary is memoized after the first call anyway, so there's no
      // real perf cost to awaiting one page at a time.
      for (let pageIndex = 0; pageIndex < document.pages.length; pageIndex++) {
        const page = document.pages[pageIndex];
        // Page-wide line numbers, keyed by object id -- see
        // computePageLineNumbers above for why this has to be derived
        // from vertical position across the whole page rather than from
        // each text object's own '\n' count. Computed once per page
        // (not per object) since it needs every text object on the page
        // to rank lines correctly relative to each other.
        const pageLineNumbers = computePageLineNumbers(page.objects);
        for (const obj of page.objects) {
          if (obj.type !== 'text') continue;
          const misspelled = await findMisspelledWords(obj.text);
          // One entry per unique word per text object -- jumping just
          // selects the whole object anyway, so listing the same word
          // twice because it appears twice in one box adds noise, not value.
          const seen = new Set<string>();
          for (const m of misspelled) {
            const key = m.word.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            // Which internal line of this object (0-indexed) the match
            // falls on -- normally 0 for PDF-extracted single-line runs,
            // but can be >0 for a manually-typed multi-line text box.
            const internalLine = lineNumberAt(obj.text, m.index) - 1;
            const line = pageLineNumbers.get(obj.id)?.[internalLine] ?? internalLine + 1;
            results.push({
              pageIndex,
              pageId: page.id,
              objectId: obj.id,
              word: m.word,
              line,
            });
          }
        }
      }
      setSpellCheckResults(results);
    } catch (err) {
      setSpellCheckError(
        err instanceof Error ? err.message : 'Could not check spelling — please try again.'
      );
    } finally {
      setSpellCheckLoading(false);
    }
  }

  function jumpToSpellCheckResult(pageIndex: number, objectId: string) {
    setActivePageIndex(pageIndex);
    setSelectedObjectId(objectId);
  }

  function handleSignatureClick() {
    if (!isPremium) {
      setPremiumPromptOpen(true);
      return;
    }
    setSignatureDialogOpen(true);
  }

  // Both draw and typed signatures arrive here as a plain PNG data URL --
  // placed as a normal ImageObject, same as an uploaded image, so it needs
  // no special handling anywhere else (export, dragging, resizing, delete
  // all already work for images).
  function insertSignature(dataUrl: string, width: number, height: number) {
    if (!activePage) return;
    const { x, y } = nextOffset(activePage.objects.length);
    // Signatures are typically placed at a modest, readable size regardless
    // of how large the source canvas was -- cap the placed width so a
    // wide typed name doesn't dominate the page, keeping aspect ratio.
    const maxWidth = 220;
    const scale = width > maxWidth ? maxWidth / width : 1;
    const obj: ImageObject = {
      id: nanoid(),
      type: 'image',
      x,
      y,
      width: width * scale,
      height: height * scale,
      ...baseDefaults,
      src: dataUrl,
    };
    addObject(activePage.id, obj);
    setSignatureDialogOpen(false);
  }

  function activeToolStyle(tool: NonNullable<typeof activeTool>): React.CSSProperties {
    return activeTool === tool
      ? { background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent)' }
      : {};
  }

  return (
    <div
      className="app-toolbar"
      style={{
        display: 'flex',
        gap: 4,
        padding: '6px 10px',
        alignItems: 'center',
        flexWrap: 'nowrap',
        overflow: 'visible',
        fontSize: 11,
      }}
    >
      <button
        onClick={addText}
        style={
          activeTool === 'text' || textPlacementActive
            ? { ...COMPACT_BTN, background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent)' }
            : COMPACT_BTN
        }
      >
        {t('toolbar.addText')}
      </button>
      <button onClick={addRect} style={{ ...COMPACT_BTN, ...activeToolStyle('rect') }}>
        {t('toolbar.addRectangle')}
      </button>
      <button onClick={addEllipse} style={{ ...COMPACT_BTN, ...activeToolStyle('ellipse') }}>
        {t('toolbar.addEllipse')}
      </button>
      <button
        onClick={addBorder}
        title={t('toolbar.addBorderTitle')}
        style={{ ...COMPACT_BTN, ...activeToolStyle('border') }}
      >
        {t('toolbar.addBorder')}
      </button>
      <BorderThicknessPicker
        value={selectedBorder ? selectedBorder.strokeWidth : borderDefaults.strokeWidth}
        onChange={(strokeWidth) => {
          setBorderDefaults((d) => ({ ...d, strokeWidth }));
          if (selectedBorder) updateSelectedBorder({ strokeWidth });
        }}
      />
      <BorderColorPicker
        value={selectedBorder ? selectedBorder.stroke : borderDefaults.stroke}
        onChange={(stroke) => {
          setBorderDefaults((d) => ({ ...d, stroke }));
          if (selectedBorder) updateSelectedBorder({ stroke });
        }}
      />
      <button onClick={triggerImagePick} style={{ ...COMPACT_BTN, ...activeToolStyle('image') }}>
        {t('toolbar.addImage')}
      </button>

      <button onClick={addDate} title={t('toolbar.addDateTitle')} style={COMPACT_BTN}>
        {t('toolbar.addDate')}
      </button>

      <button
        onClick={addHighlight}
        title={t('toolbar.addHighlightTitle')}
        style={{ ...COMPACT_BTN, ...activeToolStyle('highlight') }}
      >
        {t('toolbar.addHighlight')}
      </button>
      <HighlightColorPicker
        value={selectedHighlight ? selectedHighlight.fill ?? highlightDefaults.fill : highlightDefaults.fill}
        onChange={(fill) => {
          setHighlightDefaults((d) => ({ ...d, fill }));
          if (selectedHighlight) updateSelectedHighlight({ fill });
        }}
      />

      <UnderlineButton
        selected={!!selectedUnderline}
        selectedThickness={selectedUnderline?.height}
        defaultThickness={underlineDefaults.thickness}
        active={activeTool === 'underline'}
        onPick={(thickness) => {
          setUnderlineDefaults((d) => ({ ...d, thickness }));
          if (selectedUnderline) {
            updateSelectedUnderline({ height: thickness });
          } else {
            addUnderline(thickness);
          }
        }}
      />

      <button onClick={() => setWatermarkDialogOpen(true)} title={t('toolbar.addWatermarkTitle')} style={COMPACT_BTN}>
        {t('toolbar.addWatermark')}
      </button>

      <button
        onClick={handleSignatureClick}
        title={isPremium ? t('toolbar.addSignatureTitle') : t('toolbar.addSignatureTitlePremium')}
        style={COMPACT_BTN}
      >
        {isPremium ? t('toolbar.addSignature') : t('toolbar.addSignaturePremium')}
      </button>

      <Divider />

      <button onClick={runSpellCheck} title={t('toolbar.checkSpellingTitle')} style={COMPACT_BTN}>
        {t('toolbar.checkSpelling')}
      </button>

      <Divider />

      <select
        value={selectedText?.fontFamily ?? ''}
        disabled={!selectedText}
        onChange={(e) => updateSelectedText({ fontFamily: e.target.value })}
        style={{ fontFamily: selectedText?.fontFamily, minWidth: 90, fontSize: 11, padding: '3px 4px' }}
        title={selectedText ? t('toolbar.fontTitle') : t('toolbar.fontTitleDisabled')}
      >
        {!selectedText && <option value="">{t('toolbar.font')}</option>}
        {WEB_SAFE_FONTS.map((font) => (
          <option key={font} value={font} style={{ fontFamily: font }}>
            {font}
          </option>
        ))}
      </select>

      <FontSizeDropdown
        value={selectedText?.fontSize}
        disabled={!selectedText}
        onChange={(size) => updateSelectedText({ fontSize: size })}
      />

      <Divider />

      <ToggleButton
        label="B"
        title={t('toolbar.bold')}
        active={!!selectedText?.bold}
        disabled={!selectedText}
        onClick={() => updateSelectedText({ bold: !selectedText?.bold })}
        style={{ fontWeight: 'bold' }}
      />
      <ToggleButton
        label="I"
        title={t('toolbar.italic')}
        active={!!selectedText?.italic}
        disabled={!selectedText}
        onClick={() => updateSelectedText({ italic: !selectedText?.italic })}
        style={{ fontStyle: 'italic' }}
      />
      <ToggleButton
        label="S"
        title={t('toolbar.strikethrough')}
        active={!!selectedText?.strikethrough}
        disabled={!selectedText}
        onClick={() => updateSelectedText({ strikethrough: !selectedText?.strikethrough })}
        style={{ textDecoration: 'line-through' }}
      />

      <ColorPicker
        value={selectedText?.color}
        disabled={!selectedText}
        onChange={(color) => updateSelectedText({ color })}
      />

      <LinkButton
        value={selectedText?.link}
        disabled={!selectedText}
        onChange={(link) => updateSelectedText({ link })}
      />

      <button
        onClick={rotateSelected}
        disabled={!selectedObject}
        title={t('toolbar.rotate')}
        style={COMPACT_ICON_BTN}
      >
        ⟳
      </button>

      <Divider />
      <span
        style={{
          fontSize: 8,
          color: '#888',
          alignSelf: 'center',
          marginLeft: 2,
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {t('toolbar.hint')}
      </span>
      {fileInputElement}
      {watermarkDialogOpen && (
        <WatermarkDialog onInsert={addWatermark} onClose={() => setWatermarkDialogOpen(false)} />
      )}
      {signatureDialogOpen && (
        <SignatureDialog onInsert={insertSignature} onClose={() => setSignatureDialogOpen(false)} />
      )}
      {premiumPromptOpen && (
        <PremiumRequiredDialog
          featureName={t('toolbar.signaturesFeatureName')}
          onClose={() => setPremiumPromptOpen(false)}
          onUpgrade={() => {
            setPremiumPromptOpen(false);
            onRequirePremium?.();
          }}
        />
      )}
      {spellCheckOpen && (
        <SpellCheckPanel
          loading={spellCheckLoading}
          error={spellCheckError}
          results={spellCheckResults}
          onJumpTo={jumpToSpellCheckResult}
          onClose={() => setSpellCheckOpen(false)}
        />
      )}
    </div>
  );
}

function ToggleButton({
  label,
  title,
  active,
  disabled,
  onClick,
  style,
}: {
  label: string;
  title: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...COMPACT_ICON_BTN,
        background: active ? 'var(--color-accent-bg)' : 'var(--color-surface)',
        border: active ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
        ...style,
      }}
    >
      {label}
    </button>
  );
}

const COLOR_SWATCHES = [
  '#111111',
  '#ffffff',
  '#e03131',
  '#f08c00',
  '#ffd43b',
  '#2f9e44',
  '#1971c2',
  '#7048e8',
  '#d6336c',
  '#868e96',
];

function ColorPicker({
  value,
  disabled,
  onChange,
}: {
  value: string | undefined;
  disabled: boolean;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const t = useI18nStore((s) => s.t);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) setOpen((v) => !v);
        }}
        disabled={disabled}
        title={t('toolbar.textColor')}
        style={{ ...COMPACT_ICON_BTN, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2px 0' }}
      >
        <span style={{ fontSize: 10, lineHeight: 1 }}>A</span>
        <span
          style={{
            width: 14,
            height: 3,
            background: disabled ? '#ccc' : value ?? '#111111',
            marginTop: 2,
          }}
        />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            padding: 8,
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 6,
          }}
        >
          {COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              title={color}
              onClick={() => {
                onChange(color);
                setOpen(false);
              }}
              style={{
                width: 22,
                height: 22,
                background: color,
                border: color === value ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                borderRadius: 4,
                padding: 0,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LinkButton({
  value,
  disabled,
  onChange,
}: {
  value: string | undefined;
  disabled: boolean;
  onChange: (link: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const t = useI18nStore((s) => s.t);

  useEffect(() => {
    if (open) setDraft(value ?? '');
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  function apply() {
    const trimmed = draft.trim();
    if (!trimmed) {
      onChange(undefined);
      setOpen(false);
      return;
    }
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    onChange(withScheme);
    setOpen(false);
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) setOpen((v) => !v);
        }}
        disabled={disabled}
        title={value ? t('toolbar.linkedTo', { url: value }) : t('toolbar.insertLink')}
        style={{
          ...COMPACT_ICON_BTN,
          background: value ? 'var(--color-accent-bg)' : 'var(--color-surface)',
          border: value ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
        }}
      >
        🔗
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            padding: 10,
            width: 240,
          }}
        >
          <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>{t('toolbar.linkUrl')}</div>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && apply()}
            placeholder={t('toolbar.linkPlaceholder')}
            style={{ width: '100%', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            {value ? (
              <button
                onClick={() => {
                  onChange(undefined);
                  setOpen(false);
                }}
                style={{ fontSize: 12, color: '#cc3333' }}
              >
                {t('toolbar.removeLink')}
              </button>
            ) : (
              <span />
            )}
            <button onClick={apply} style={{ fontSize: 12 }}>
              {t('toolbar.apply')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const BORDER_THICKNESSES = [1, 2, 4, 6, 10];

function BorderThicknessPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (thickness: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const t = useI18nStore((s) => s.t);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title={t('toolbar.borderThickness')}
        style={COMPACT_ICON_BTN}
      >
        ▾
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            padding: 6,
            width: 140,
          }}
        >
          {BORDER_THICKNESSES.map((thickness) => (
            <button
              key={thickness}
              onClick={() => {
                onChange(thickness);
                setOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '6px 8px',
                border: thickness === value ? '1px solid var(--color-accent)' : '1px solid transparent',
                background: thickness === value ? '#eef6ff' : 'transparent',
                borderRadius: 4,
              }}
            >
              <div style={{ flex: 1, height: thickness, background: '#222' }} />
              <span style={{ fontSize: 11, color: '#888' }}>{thickness}px</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// 3 fixed presets rather than the Border tool's 5-step range -- an
// underline is meant to be a quick, consistent mark under text, not a
// tunable stroke, so keeping the choice small (thin/medium/thick) matches
// the "give them the option to add a draggable line" request without
// turning it into another full style picker. This is the ONLY place an
// underline's thickness can be changed -- see PdfCanvas.tsx's resize
// handling, where an isUnderline rect's height is deliberately held fixed
// during a drag so users can only ever adjust its length on the canvas.
const UNDERLINE_THICKNESSES: { label: string; value: number }[] = [
  { label: 'Thin', value: 2 },
  { label: 'Medium', value: 4 },
  { label: 'Thick', value: 6 },
];

// Clicking the button itself opens the size dropdown -- there's no
// separate "add" click and "pick a size" click. Picking a size either adds
// a brand-new underline at that thickness (nothing selected) or updates
// the currently-selected underline's thickness (something is selected),
// so the same three options work for both creating and adjusting one.
function UnderlineButton({
  selected,
  selectedThickness,
  defaultThickness,
  active,
  onPick,
}: {
  selected: boolean;
  selectedThickness: number | undefined;
  defaultThickness: number;
  active: boolean;
  onPick: (thickness: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentValue = selected ? selectedThickness ?? defaultThickness : defaultThickness;

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="Add or resize an underline bar — drag it under any text"
        style={{ ...COMPACT_BTN, ...(active ? activeToolStyleShared : {}) }}
      >
        + Underline ▾
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            padding: 6,
            width: 150,
          }}
        >
          {UNDERLINE_THICKNESSES.map(({ label, value: thickness }) => (
            <button
              key={thickness}
              onClick={() => {
                onPick(thickness);
                setOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '6px 8px',
                border: thickness === currentValue ? '1px solid var(--color-accent)' : '1px solid transparent',
                background: thickness === currentValue ? '#eef6ff' : 'transparent',
                borderRadius: 4,
              }}
            >
              <div style={{ flex: 1, height: thickness, background: '#222' }} />
              <span style={{ fontSize: 11, color: '#888' }}>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const activeToolStyleShared: React.CSSProperties = {
  background: 'var(--color-accent-bg)',
  border: '1px solid var(--color-accent)',
};

function BorderColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const t = useI18nStore((s) => s.t);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title={t('toolbar.borderColor')}
        style={{ ...COMPACT_ICON_BTN, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2px 0' }}
      >
        <span
          style={{
            width: 14,
            height: 14,
            border: '1px solid #888',
            background: value,
            borderRadius: 2,
          }}
        />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            padding: 8,
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 6,
          }}
        >
          {COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              title={color}
              onClick={() => {
                onChange(color);
                setOpen(false);
              }}
              style={{
                width: 22,
                height: 22,
                background: color,
                border: color === value ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                borderRadius: 4,
                padding: 0,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--color-border)', margin: '2px 2px' }} />;
}

function HighlightColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const t = useI18nStore((s) => s.t);
  return (
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={t('toolbar.highlightColor')}
      style={{
        width: 22,
        height: 26,
        padding: 0,
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        cursor: 'pointer',
        background: 'none',
      }}
    />
  );
}

function WatermarkDialog({
  onInsert,
  onClose,
}: {
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const t = useI18nStore((s) => s.t);
  const [text, setText] = useState('CONFIDENTIAL');

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
    >
      <div
        className="surface-card"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: 24, width: 360 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{t('toolbar.watermarkDialogTitle')}</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 16, cursor: 'pointer' }}>
            ✕
          </button>
        </div>

        <label style={{ display: 'block', fontSize: 13, marginBottom: 6, color: '#666' }}>
          {t('toolbar.watermarkTextLabel')}
        </label>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => e.key === 'Enter' && text.trim() && onInsert(text)}
          style={{
            width: '100%',
            padding: '8px 10px',
            border: '1px solid #ccc',
            borderRadius: 4,
            fontSize: 14,
            boxSizing: 'border-box',
          }}
        />

        <p style={{ fontSize: 12, color: '#888', marginTop: 10 }}>
          {t('toolbar.watermarkDescription')}
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn-accent" onClick={() => onInsert(text)} disabled={!text.trim()}>
            {t('toolbar.insertWatermark')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Typographic scale rather than a flat 1..N count -- steps start tight at
// the small end (where a couple points makes a visible difference) and
// widen out at the large end (where headings/titles live), matching how
// Word/Docs/Illustrator size pickers are laid out instead of just listing
// consecutive integers.
const FONT_SIZE_OPTIONS = [6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 80, 96];

interface FontSizeDropdownProps {
  value: number | undefined;
  disabled: boolean;
  onChange: (size: number) => void;
}

function FontSizeDropdown({ value, disabled, onChange }: FontSizeDropdownProps) {
  const t = useI18nStore((s) => s.t);
  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      title={disabled ? t('toolbar.fontSizeTitleDisabled') : t('toolbar.fontSizeTitle')}
      style={{ width: 44, fontSize: 11, padding: '3px 2px' }}
    >
      {(!value || !FONT_SIZE_OPTIONS.includes(value)) && (
        // FIX: this option's value used to be "" (empty string). The
        // <select> above is controlled by `value ?? ''` -- when the
        // selected object's real font size (e.g. 13.9, straight from an
        // extracted PDF) isn't one of the round numbers in
        // FONT_SIZE_OPTIONS, that controlled value had nothing to match:
        // this placeholder's own value was "" rather than the real
        // number, so it didn't count as a match either. With no <option>
        // matching, the browser silently fell back to selecting whichever
        // <option> is first in the list -- FONT_SIZE_OPTIONS[0], i.e. 6 --
        // which is why a 13.9pt line of extracted text was displaying as
        // "6" in this dropdown. Giving this option the actual value makes
        // it a real match, so the dropdown now shows the true size.
        <option value={value ?? ''} disabled hidden>
          {value ?? t('toolbar.fontSize')}
        </option>
      )}
      {FONT_SIZE_OPTIONS.map((size) => (
        <option key={size} value={size}>
          {size}
        </option>
      ))}
    </select>
  );
}