/**
 * pngExport.js — rasterizes the current lineage diagram straight onto
 * an offscreen 2D canvas and returns it as a PNG data URL.
 *
 * The live diagram is plain DOM + SVG now, not a single <canvas> like
 * cytoscape's, so there's no built-in `.png()` to call. The
 * alternative to a purpose-built drawer here would be screenshotting
 * the live DOM (SVG <foreignObject> + Image()) — that route depends
 * on webfonts being available to a rasterized foreignObject, which is
 * inconsistent across browsers. A couple dozen fillRect/fillText
 * calls have no such dependency and stay synchronous, matching the
 * exportPNG() contract every caller already expects. The tradeoff:
 * this is a faithful but simplified rendering of the on-screen cards,
 * not a pixel-for-pixel screenshot.
 */

const FONT_MONO = "'IBM Plex Mono', ui-monospace, monospace";
const CARD_RADIUS = 7;

function readColor(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncateToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

/**
 * @param {Object} args
 * @param {{nodes: Array<{id: string, label?: string, type?: string, confidence?: string}>, edges: Array<{source: string, target: string, confidence?: string}>}} args.graph
 * @param {Map<string, {x: number, y: number, width: number, height: number}>} args.rects - model-space rect per node id
 * @param {number} [args.padding]
 * @param {number} [args.pixelDensity] - output pixel density multiplier
 * @returns {string} PNG data URL
 */
export function exportDiagramToPng({ graph, rects, padding = 48, pixelDensity = 2 }) {
  const colors = {
    bg: readColor('--bg', '#0b2338'),
    panel: readColor('--panel-raised', '#163a59'),
    ink: readColor('--ink', '#e7f1f9'),
    inkDim: readColor('--ink-dim', '#86a0b8'),
    high: readColor('--confidence-high', '#5fc3e0'),
    medium: readColor('--confidence-medium', '#cf9752'),
    low: readColor('--confidence-low', '#d97862'),
  };
  const confidenceColor = (level) => colors[level] || colors.high;

  const allRects = [...rects.values()];
  const minX = Math.min(...allRects.map((r) => r.x));
  const maxX = Math.max(...allRects.map((r) => r.x + r.width));
  const minY = Math.min(...allRects.map((r) => r.y));
  const maxY = Math.max(...allRects.map((r) => r.y + r.height));
  const width = maxX - minX + padding * 2;
  const height = maxY - minY + padding * 2;
  const offsetX = padding - minX;
  const offsetY = padding - minY;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * pixelDensity));
  canvas.height = Math.max(1, Math.ceil(height * pixelDensity));
  const ctx = canvas.getContext('2d');
  ctx.scale(pixelDensity, pixelDensity);

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);

  // Edges first, so node cards paint over their endpoints.
  for (const edge of graph.edges) {
    const s = rects.get(edge.source);
    const t = rects.get(edge.target);
    if (!s || !t) continue;
    const p1 = { x: s.x + s.width + offsetX, y: s.y + s.height / 2 + offsetY };
    const p2 = { x: t.x + offsetX, y: t.y + t.height / 2 + offsetY };
    const reach = Math.max(Math.abs(p2.x - p1.x) * 0.5, 40);
    ctx.strokeStyle = confidenceColor(edge.confidence);
    ctx.lineWidth = 1.75;
    ctx.setLineDash(edge.confidence === 'high' ? [] : [6, 4]);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.bezierCurveTo(p1.x + reach, p1.y, p2.x - reach, p2.y, p2.x, p2.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Node cards.
  ctx.textBaseline = 'middle';
  for (const node of graph.nodes) {
    const r = rects.get(node.id);
    if (!r) continue;
    const x = r.x + offsetX;
    const y = r.y + offsetY;

    ctx.fillStyle = colors.panel;
    ctx.strokeStyle = confidenceColor(node.confidence);
    ctx.lineWidth = 2;
    roundRectPath(ctx, x, y, r.width, r.height, CARD_RADIUS);
    ctx.fill();
    ctx.stroke();

    ctx.font = `600 11px ${FONT_MONO}`;
    ctx.fillStyle = colors.ink;
    ctx.fillText(truncateToWidth(ctx, node.label || node.id, r.width - 16), x + 10, y + 16);

    ctx.font = `10px ${FONT_MONO}`;
    ctx.fillStyle = colors.inkDim;
    ctx.fillText(`${node.type || 'table'} · ${node.confidence || 'high'}`, x + 10, y + r.height - 12);
  }

  return canvas.toDataURL('image/png');
}
