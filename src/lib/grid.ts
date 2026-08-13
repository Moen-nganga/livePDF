// Shared grid + collision utilities used by the live editing canvas
// (PdfCanvas.tsx) and by toolbar object-placement (Toolbar.tsx).
//
// The "grid" here is intentionally invisible -- nothing is drawn on the
// page for it. It exists purely as a snap increment (so dragged/resized
// objects land on tidy, consistent coordinates instead of arbitrary
// sub-pixel positions) and as the step size used when hunting for a free
// spot to drop a newly-added object. All coordinates are in the same real
// PDF-point space the rest of the editor already stores objects in (see
// PdfCanvas.tsx's zoom comments) -- this file has no concept of on-screen
// pixels or canvas zoom, so it works the same regardless of how the
// canvas is currently scaled to fit the viewport.

/** Grid increment, in PDF points, that dragging/resizing/new-object placement snaps to. */
export const GRID_SIZE = 8;

/**
 * Minimum gap, in points, kept between two text objects' bounding boxes.
 * Matches pdfUpload.ts's CROSS_LINE_SAFETY_GAP so imported PDFs and
 * manually edited documents apply the same "how close is too close"
 * threshold for text/link overlap.
 */
export const OVERLAP_PAD = 4;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

/**
 * Axis-aligned overlap test, with an optional safety margin `pad` added
 * around `b`. Rotation is intentionally ignored -- consistent with
 * pdfUpload.ts's own capWidthsAgainstNearbyContent, which only applies
 * its cross-line check to unrotated text -- since rotated text (stamps,
 * watermarks) is rare enough, and exact axis-aligned overlap math for it
 * complex enough, that this approximation is the pragmatic choice.
 */
export function boundsOverlap(a: Bounds, b: Bounds, pad = 0): boolean {
  return (
    a.x < b.x + b.width + pad &&
    a.x + a.width + pad > b.x &&
    a.y < b.y + b.height + pad &&
    a.y + a.height + pad > b.y
  );
}

/**
 * Searches an expanding ring of grid cells around `preferred` for a spot
 * where a box of `size` doesn't overlap (by more than OVERLAP_PAD) any of
 * `obstacles`, while staying within the page bounds. Falls back to
 * `preferred` itself (grid-snapped) if nothing free turns up within
 * `maxRings` -- better to place a new object slightly overlapping than to
 * silently refuse to place it at all.
 *
 * Walks each ring's perimeter rather than every cell inside it, so this
 * stays cheap even on a page with a few hundred existing text objects.
 */
export function findFreeGridSlot(
  preferred: { x: number; y: number },
  size: { width: number; height: number },
  obstacles: Bounds[],
  page: { width: number; height: number },
  maxRings = 12
): { x: number; y: number } {
  const startX = snapToGrid(preferred.x);
  const startY = snapToGrid(preferred.y);

  const fits = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x + size.width > page.width || y + size.height > page.height) {
      return false;
    }
    const candidate: Bounds = { x, y, width: size.width, height: size.height };
    return !obstacles.some((o) => boundsOverlap(candidate, o, OVERLAP_PAD));
  };

  if (fits(startX, startY)) return { x: startX, y: startY };

  for (let ring = 1; ring <= maxRings; ring++) {
    const offset = ring * GRID_SIZE;

    // Top and bottom edges of the ring.
    for (let dx = -offset; dx <= offset; dx += GRID_SIZE) {
      for (const dy of [-offset, offset]) {
        const x = startX + dx;
        const y = startY + dy;
        if (fits(x, y)) return { x, y };
      }
    }
    // Left and right edges of the ring (excluding corners, already checked above).
    for (let dy = -offset + GRID_SIZE; dy <= offset - GRID_SIZE; dy += GRID_SIZE) {
      for (const dx of [-offset, offset]) {
        const x = startX + dx;
        const y = startY + dy;
        if (fits(x, y)) return { x, y };
      }
    }
  }

  return { x: startX, y: startY };
}