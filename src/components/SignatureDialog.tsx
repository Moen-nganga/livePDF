import { useRef, useState, useEffect } from 'react';

interface Props {
  onInsert: (dataUrl: string, width: number, height: number) => void;
  onClose: () => void;
}

const DRAW_CANVAS_WIDTH = 400;
const DRAW_CANVAS_HEIGHT = 150;

// Not one of Toolbar's normal WEB_SAFE_FONTS -- signatures deliberately
// use a script-style stack distinct from body text, and since the result
// is always rasterized to a PNG before being added to the page, there's
// no PDF font-embedding concern even though these aren't standard PDF fonts.
const SCRIPT_FONT_STACK = "'Brush Script MT', 'Segoe Script', 'Bradley Hand', cursive";

export function SignatureDialog({ onInsert, onClose }: Props) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const hasDrawnRef = useRef(false);
  const [hasDrawing, setHasDrawing] = useState(false);
  const [typedText, setTypedText] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111111';
  }, []);

  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    isDrawingRef.current = true;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasDrawnRef.current) {
      hasDrawnRef.current = true;
      setHasDrawing(true);
    }
  }

  function handlePointerUp() {
    isDrawingRef.current = false;
  }

  function clearDrawing() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawnRef.current = false;
    setHasDrawing(false);
  }

  function handleInsert() {
    if (mode === 'draw') {
      const canvas = canvasRef.current;
      if (!canvas || !hasDrawing) return;
      onInsert(canvas.toDataURL('image/png'), DRAW_CANVAS_WIDTH, DRAW_CANVAS_HEIGHT);
      return;
    }

    const trimmed = typedText.trim();
    if (!trimmed) return;

    const fontSize = 48;
    const measuringCanvas = document.createElement('canvas');
    const measureCtx = measuringCanvas.getContext('2d')!;
    measureCtx.font = `${fontSize}px ${SCRIPT_FONT_STACK}`;
    const textWidth = measureCtx.measureText(trimmed).width;

    const padding = 20;
    const width = Math.ceil(textWidth + padding * 2);
    const height = Math.ceil(fontSize * 1.6);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.font = `${fontSize}px ${SCRIPT_FONT_STACK}`;
    ctx.fillStyle = '#111111';
    ctx.textBaseline = 'middle';
    ctx.fillText(trimmed, padding, height / 2);

    onInsert(canvas.toDataURL('image/png'), width, height);
  }

  const canInsert = mode === 'draw' ? hasDrawing : typedText.trim().length > 0;

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
        style={{ padding: 24, width: 460 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Add signature</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 16, cursor: 'pointer' }}>
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button
            onClick={() => setMode('draw')}
            style={{
              flex: 1,
              padding: '6px 0',
              borderRadius: 6,
              border: mode === 'draw' ? '1.5px solid var(--color-accent)' : '1px solid var(--color-border)',
              background: mode === 'draw' ? 'var(--color-accent-bg)' : 'transparent',
            }}
          >
            Draw
          </button>
          <button
            onClick={() => setMode('type')}
            style={{
              flex: 1,
              padding: '6px 0',
              borderRadius: 6,
              border: mode === 'type' ? '1.5px solid var(--color-accent)' : '1px solid var(--color-border)',
              background: mode === 'type' ? 'var(--color-accent-bg)' : 'transparent',
            }}
          >
            Type
          </button>
        </div>

        {mode === 'draw' ? (
          <div>
            <canvas
              ref={canvasRef}
              width={DRAW_CANVAS_WIDTH}
              height={DRAW_CANVAS_HEIGHT}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              style={{
                width: '100%',
                height: DRAW_CANVAS_HEIGHT,
                border: '1.5px dashed var(--color-border)',
                borderRadius: 6,
                background: '#fff',
                cursor: 'crosshair',
                touchAction: 'none',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                Draw your signature above using your mouse, trackpad, or touchscreen.
              </span>
              <button onClick={clearDrawing} style={{ fontSize: 12 }}>
                Clear
              </button>
            </div>
          </div>
        ) : (
          <div>
            <input
              autoFocus
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              placeholder="Type your name"
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '1px solid #ccc',
                borderRadius: 4,
                fontSize: 14,
                boxSizing: 'border-box',
                marginBottom: 12,
              }}
            />
            <div
              style={{
                border: '1.5px dashed var(--color-border)',
                borderRadius: 6,
                background: '#fff',
                height: DRAW_CANVAS_HEIGHT,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                padding: 12,
              }}
            >
              <span style={{ fontFamily: SCRIPT_FONT_STACK, fontSize: 40, color: '#111' }}>
                {typedText.trim() || 'Preview'}
              </span>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose}>Cancel</button>
          <button className="btn-accent" onClick={handleInsert} disabled={!canInsert}>
            Insert signature
          </button>
        </div>
      </div>
    </div>
  );
}