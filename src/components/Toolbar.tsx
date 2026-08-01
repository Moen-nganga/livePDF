import { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import { useEditorStore } from '../store/editorStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import type { PageObject, TextObject, RectObject, ImageObject } from '../types/document';
import { WEB_SAFE_FONTS } from '../lib/fonts';
import { useImageAdd } from '../hooks/useImageAdd.tsx';
import { findMisspelledWords } from '../lib/spellcheck';
import { SpellCheckPanel } from './SpellCheckPanel';
import { SignatureDialog } from './SignatureDialog';
import { PremiumRequiredDialog } from './PremiumRequiredDialog';

const baseDefaults = { rotation: 0, opacity: 1 };

// Scoped responsive rules for the toolbar. Inline React styles can't express
// media queries on their own, so breakpoint-specific behavior (horizontal
// scrolling, bigger tap targets, bottom-sheet popovers) lives here instead.
// Rendered once as a plain <style> tag alongside the toolbar markup.
const TOOLBAR_RESPONSIVE_CSS = `
  .app-toolbar {
    -webkit-overflow-scrolling: touch;
  }

  .toolbar-hint-mobile {
    display: none;
  }

  @media (max-width: 640px) {
    .app-toolbar {
      flex-wrap: nowrap;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
      padding: 8px 12px;
    }
    .app-toolbar::-webkit-scrollbar {
      display: none;
    }
    .app-toolbar > button,
    .app-toolbar > select {
      flex-shrink: 0;
      min-height: 40px;
    }
    .app-toolbar button {
      min-width: 40px;
    }
    .app-toolbar select {
      min-width: 64px;
    }
    .app-toolbar input[type='color'] {
      width: 40px !important;
      height: 40px !important;
      flex-shrink: 0;
    }

    .toolbar-hint-desktop {
      display: none;
    }
    .toolbar-hint-mobile {
      display: inline;
    }

    /* Popovers become bottom sheets on mobile instead of tiny absolutely
       positioned panels that can clip off the edge of a phone screen. */
    .toolbar-popover {
      position: fixed !important;
      left: 50% !important;
      top: auto !important;
      bottom: 12px !important;
      transform: translateX(-50%);
      width: min(340px, calc(100vw - 24px)) !important;
      max-height: 60vh;
      overflow-y: auto;
    }
    .toolbar-popover-backdrop {
      display: block !important;
    }
  }
`;

function nextOffset(count: number): { x: number; y: number } {
  const step = 24;
  return { x: 80 + (count % 8) * step, y: 80 + (count % 8) * step };
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

  const subscription = useSubscriptionStore((s) => s.subscription);
  // Client-side gate only -- there's no server resource being consumed by
  // adding a signature (unlike the weekly document-creation limit, which
  // is enforced server-side too), so this restricts the UI but a
  // technically determined free user could bypass it via devtools. Worth
  // revisiting with a server-side check if this ever needs to be airtight.
  const isPremium =
    subscription?.status === 'active' &&
    (subscription.planId === 'pro_monthly' || subscription.planId === 'pro_yearly');

  const activePage = document?.pages[activePageIndex];
  const selectedObject = activePage?.objects.find((o) => o.id === selectedObjectId);
  const selectedText: TextObject | undefined =
    selectedObject?.type === 'text' ? selectedObject : undefined;
  const selectedBorder: RectObject | undefined =
    selectedObject?.type === 'rect' && !selectedObject.fill ? selectedObject : undefined;
  const selectedHighlight: RectObject | undefined =
    selectedObject?.type === 'rect' && selectedObject.isHighlight ? selectedObject : undefined;

  type ToolKind = 'text' | 'rect' | 'border' | 'highlight' | 'ellipse' | 'image' | null;
  const activeTool: ToolKind = (() => {
    if (!selectedObject) return null;
    switch (selectedObject.type) {
      case 'text':
        return 'text';
      case 'rect':
        if (selectedHighlight) return 'highlight';
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
    const { x, y } = nextOffset(activePage.objects.length);
    const today = new Date().toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const obj: PageObject = {
      id: nanoid(),
      type: 'text',
      x,
      y,
      width: 160,
      height: 32,
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
            results.push({
              pageIndex,
              pageId: page.id,
              objectId: obj.id,
              word: m.word,
              line: lineNumberAt(obj.text, m.index),
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
        gap: 8,
        padding: '8px 16px',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <style>{TOOLBAR_RESPONSIVE_CSS}</style>

      <button
        onClick={addText}
        style={
          activeTool === 'text' || textPlacementActive
            ? { background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent)' }
            : {}
        }
      >
        + Text
      </button>
      <button onClick={addRect} style={activeToolStyle('rect')}>
        + Rectangle
      </button>
      <button onClick={addEllipse} style={activeToolStyle('ellipse')}>
        + Ellipse
      </button>
      <button
        onClick={addBorder}
        title="Add a resizable outline to frame any content"
        style={activeToolStyle('border')}
      >
        + Border
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
      <button onClick={triggerImagePick} style={activeToolStyle('image')}>
        + Image
      </button>

      <button onClick={addDate} title="Insert today's date as editable text">
        + Date
      </button>

      <button
        onClick={addHighlight}
        title="Add a semi-transparent highlight overlay"
        style={activeToolStyle('highlight')}
      >
        + Highlight
      </button>
      <HighlightColorPicker
        value={selectedHighlight ? selectedHighlight.fill ?? highlightDefaults.fill : highlightDefaults.fill}
        onChange={(fill) => {
          setHighlightDefaults((d) => ({ ...d, fill }));
          if (selectedHighlight) updateSelectedHighlight({ fill });
        }}
      />

      <button onClick={() => setWatermarkDialogOpen(true)} title="Add a diagonal watermark to the current page">
        + Watermark
      </button>

      <button onClick={handleSignatureClick} title={isPremium ? 'Add a signature' : 'Add a signature (Premium)'}>
        {isPremium ? '+ Signature' : '⭐ Signature'}
      </button>

      <Divider />

      <button onClick={runSpellCheck} title="Check spelling across the whole document">
        ✓ Check Spelling
      </button>

      <Divider />

      <select
        value={selectedText?.fontFamily ?? ''}
        disabled={!selectedText}
        onChange={(e) => updateSelectedText({ fontFamily: e.target.value })}
        style={{ fontFamily: selectedText?.fontFamily, minWidth: 130 }}
        title={selectedText ? 'Font' : 'Select a text box to change its font'}
      >
        {!selectedText && <option value="">Font</option>}
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
        title="Bold"
        active={!!selectedText?.bold}
        disabled={!selectedText}
        onClick={() => updateSelectedText({ bold: !selectedText?.bold })}
        style={{ fontWeight: 'bold' }}
      />
      <ToggleButton
        label="I"
        title="Italic"
        active={!!selectedText?.italic}
        disabled={!selectedText}
        onClick={() => updateSelectedText({ italic: !selectedText?.italic })}
        style={{ fontStyle: 'italic' }}
      />
      <ToggleButton
        label="S"
        title="Strikethrough"
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
        title="Rotate 90°"
        style={{ width: 28 }}
      >
        ⟳
      </button>

      <Divider />
      <span style={{ fontSize: 12, color: '#888', alignSelf: 'center', marginLeft: 8 }}>
        <span className="toolbar-hint-desktop">
          Double-click text to edit it · select an object and press Delete to remove it
        </span>
        <span className="toolbar-hint-mobile">Tap text to edit it · tap an object to select it</span>
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
          featureName="Signatures"
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
        width: 28,
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

// Shared dimmed backdrop shown behind popovers once they become mobile
// bottom sheets. Hidden by default (desktop keeps the lightweight
// click-outside-to-close behavior); TOOLBAR_RESPONSIVE_CSS reveals it
// under the mobile breakpoint.
function PopoverBackdrop({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="toolbar-popover-backdrop"
      onClick={onClose}
      style={{
        display: 'none',
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        zIndex: 999,
      }}
    />
  );
}

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
        title="Text color"
        style={{ width: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2px 0' }}
      >
        <span style={{ fontSize: 12, lineHeight: 1 }}>A</span>
        <span
          style={{
            width: 16,
            height: 4,
            background: disabled ? '#ccc' : value ?? '#111111',
            marginTop: 2,
          }}
        />
      </button>

      {open && (
        <>
          <PopoverBackdrop onClose={() => setOpen(false)} />
          <div
            className="toolbar-popover"
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
        </>
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
        title={value ? `Linked to ${value}` : 'Insert link'}
        style={{
          width: 28,
          background: value ? 'var(--color-accent-bg)' : 'var(--color-surface)',
          border: value ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
        }}
      >
        🔗
      </button>

      {open && (
        <>
          <PopoverBackdrop onClose={() => setOpen(false)} />
          <div
            className="toolbar-popover"
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
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Link URL</div>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && apply()}
              placeholder="example.com"
              style={{
                width: '100%',
                padding: '10px 8px',
                border: '1px solid #ccc',
                borderRadius: 4,
                boxSizing: 'border-box',
                fontSize: 16, // 16px prevents iOS Safari from auto-zooming on focus
              }}
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
                  Remove link
                </button>
              ) : (
                <span />
              )}
              <button onClick={apply} style={{ fontSize: 12 }}>
                Apply
              </button>
            </div>
          </div>
        </>
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
        title="Border thickness"
        style={{ width: 28 }}
      >
        ▾
      </button>

      {open && (
        <>
          <PopoverBackdrop onClose={() => setOpen(false)} />
          <div
            className="toolbar-popover"
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
                  padding: '10px 8px',
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
        </>
      )}
    </div>
  );
}

function BorderColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);

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
        title="Border color"
        style={{ width: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2px 0' }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            border: '1px solid #888',
            background: value,
            borderRadius: 2,
          }}
        />
      </button>

      {open && (
        <>
          <PopoverBackdrop onClose={() => setOpen(false)} />
          <div
            className="toolbar-popover"
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
        </>
      )}
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, background: 'var(--color-border)', margin: '2px 4px' }} />;
}

function HighlightColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title="Highlight color — pick any color"
      style={{
        width: 28,
        height: 28,
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
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      <div
        className="surface-card"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: 24, width: 'min(360px, 92vw)', boxSizing: 'border-box' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Add watermark</h3>
          <button
            onClick={onClose}
            style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', padding: 8 }}
          >
            ✕
          </button>
        </div>

        <label style={{ display: 'block', fontSize: 13, marginBottom: 6, color: '#666' }}>
          Watermark text
        </label>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => e.key === 'Enter' && text.trim() && onInsert(text)}
          style={{
            width: '100%',
            padding: '10px 10px',
            border: '1px solid #ccc',
            borderRadius: 4,
            fontSize: 16, // 16px prevents iOS Safari from auto-zooming on focus
            boxSizing: 'border-box',
          }}
        />

        <p style={{ fontSize: 12, color: '#888', marginTop: 10 }}>
          Added as a large, faint, diagonal overlay across the current page only. It's a normal
          text object afterward — you can move, resize, restyle, or delete it like anything else.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '10px 14px' }}>
            Cancel
          </button>
          <button
            className="btn-accent"
            onClick={() => onInsert(text)}
            disabled={!text.trim()}
            style={{ padding: '10px 14px' }}
          >
            Insert watermark
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
  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      title={disabled ? 'Select a text box to change its font size' : 'Font size'}
      style={{ width: 56 }}
    >
      {(!value || !FONT_SIZE_OPTIONS.includes(value)) && (
        <option value="" disabled hidden>
          {value ?? 'Size'}
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