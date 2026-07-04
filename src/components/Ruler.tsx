/**
 * A single ruler strip (horizontal or vertical), drawn to sit flush against
 * the top or left edge of PdfCanvas. Ticks are in PDF points (1pt = 1/72in,
 * matching Page.width/height in types/document.ts), with major ticks and
 * inch labels every 72pt and minor ticks every 18pt (quarter-inch).
 *
 * `lengthPx` should already be in the canvas's own pixel space (i.e.
 * page.width or page.height multiplied by PdfCanvas's ZOOM), so the ruler
 * lines up exactly with the canvas regardless of zoom level.
 */

export const RULER_THICKNESS = 20;

const POINTS_PER_INCH = 72;
const MINOR_INTERVAL = 18; // quarter-inch

interface RulerProps {
  orientation: 'horizontal' | 'vertical';
  lengthPx: number;
}

export function Ruler({ orientation, lengthPx }: RulerProps) {
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