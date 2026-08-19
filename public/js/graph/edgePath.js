/**
 * edgePath.js — pure SVG path geometry for lineage edges. No DOM, no
 * graph traversal — just "given two boxes in model space, draw a
 * curve between them." Ports are fixed at right-middle (source) and
 * left-middle (target), which is what the left-to-right layout
 * (layout.js) is designed around.
 */

/** @param {{x: number, y: number, width: number, height: number}} rect */
function rightPort(rect) {
  return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
}

/** @param {{x: number, y: number, width: number, height: number}} rect */
function leftPort(rect) {
  return { x: rect.x, y: rect.y + rect.height / 2 };
}

/**
 * @param {{x: number, y: number, width: number, height: number}} sourceRect
 * @param {{x: number, y: number, width: number, height: number}} targetRect
 * @returns {{d: string, midpoint: {x: number, y: number}}}
 */
export function computeEdgePath(sourceRect, targetRect) {
  const p1 = rightPort(sourceRect);
  const p2 = leftPort(targetRect);
  const reach = Math.max(Math.abs(p2.x - p1.x) * 0.5, 40);
  const c1 = { x: p1.x + reach, y: p1.y };
  const c2 = { x: p2.x - reach, y: p2.y };
  const d = `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
  // Cubic bezier point at t=0.5 — used to place the small connector
  // dot partway along the line.
  const midpoint = {
    x: 0.125 * p1.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p2.x,
    y: 0.125 * p1.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p2.y,
  };
  return { d, midpoint };
}

/** Straight line, used for the live preview while drag-connecting two nodes. */
export function computeStraightPath(p1, p2) {
  return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
}
