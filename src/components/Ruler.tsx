export const RULER_THICKNESS = 20;

const POINTS_PER_INCH = 72;
const MINOR_INTERVAL = 18; // quarter-inch

interface RulerProps {
  orientation: 'horizontal' | 'vertical';
  lengthPx: number;
  /**
   * Range (in the same px/point space as lengthPx) to highlight — the
   * selected object's x/x+width for the horizontal ruler, y/y+height for
   * the vertical one. null when nothing is selected.
   */
  highlightRange?: { start: number; end: number } | null;
}

export function Ruler({ orientation, lengthPx, highlightRange }: RulerProps) {
  const isHorizontal = orientation === 'horizontal';

  const majorTicks: number[] = [];
  for (let pos = 0; pos <= lengthPx; pos += POINTS_PER_INCH) {
    majorTicks.push(pos);
  }

  const minorTicks: number[] = [];
  for (let pos = 0; pos <= lengthPx; pos += MINOR_INTERVAL) {
    if (pos % POINTS_PER_INCH !== 0) minorTicks.push(pos);
  }

  const width = isHorizontal ? lengthPx : RULER_THICKNESS;
  const height = isHorizontal ? RULER_THICKNESS : lengthPx;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{
        display: 'block',
        background: '#fafafa',
        borderRight: !isHorizontal ? '1px solid #ddd' : undefined,
        borderBottom: isHorizontal ? '1px solid #ddd' : undefined,
        flexShrink: 0,
      }}
    >
      {highlightRange &&
        (isHorizontal ? (
          <g>
            <rect
              x={highlightRange.start}
              y={0}
              width={highlightRange.end - highlightRange.start}
              height={RULER_THICKNESS}
              fill="rgba(66,133,244,0.18)"
            />
            <line x1={highlightRange.start} y1={0} x2={highlightRange.start} y2={RULER_THICKNESS} stroke="#4285f4" strokeWidth={1.5} />
            <line x1={highlightRange.end} y1={0} x2={highlightRange.end} y2={RULER_THICKNESS} stroke="#4285f4" strokeWidth={1.5} />
          </g>
        ) : (
          <g>
            <rect
              x={0}
              y={highlightRange.start}
              width={RULER_THICKNESS}
              height={highlightRange.end - highlightRange.start}
              fill="rgba(66,133,244,0.18)"
            />
            <line x1={0} y1={highlightRange.start} x2={RULER_THICKNESS} y2={highlightRange.start} stroke="#4285f4" strokeWidth={1.5} />
            <line x1={0} y1={highlightRange.end} x2={RULER_THICKNESS} y2={highlightRange.end} stroke="#4285f4" strokeWidth={1.5} />
          </g>
        ))}

      {minorTicks.map((pos) =>
        isHorizontal ? (
          <line
            key={pos}
            x1={pos}
            y1={RULER_THICKNESS * 0.6}
            x2={pos}
            y2={RULER_THICKNESS}
            stroke="#ccc"
            strokeWidth={1}
          />
        ) : (
          <line
            key={pos}
            x1={RULER_THICKNESS * 0.6}
            y1={pos}
            x2={RULER_THICKNESS}
            y2={pos}
            stroke="#ccc"
            strokeWidth={1}
          />
        )
      )}

      {majorTicks.map((pos) => {
        const inch = pos / POINTS_PER_INCH;
        return isHorizontal ? (
          <g key={pos}>
            <line x1={pos} y1={RULER_THICKNESS * 0.35} x2={pos} y2={RULER_THICKNESS} stroke="#999" strokeWidth={1} />
            {inch > 0 && (
              <text x={pos + 2} y={RULER_THICKNESS * 0.5} fontSize={9} fill="#666">
                {inch}
              </text>
            )}
          </g>
        ) : (
          <g key={pos}>
            <line x1={RULER_THICKNESS * 0.35} y1={pos} x2={RULER_THICKNESS} y2={pos} stroke="#999" strokeWidth={1} />
            {inch > 0 && (
              <text x={2} y={pos + 9} fontSize={9} fill="#666">
                {inch}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}