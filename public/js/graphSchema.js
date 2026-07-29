/**
 * graphSchema.js — client-side counterpart to lib/validateGraph.js.
 * AI-generated graphs are already validated server-side before they
 * reach the browser; this copy exists mainly to protect the "Import
 * JSON" feature from a malformed or hand-edited file before it's
 * handed to the graph renderer.
 */

const NODE_TYPES = new Set(['table', 'view', 'column', 'measure']);
const EDGE_TYPES = new Set(['direct', 'derived', 'aggregated', 'filtered']);
const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low']);

// Same values, as ordered arrays — for populating <select> options in
// the manual-edit forms (editMode.js) without duplicating the list.
export const NODE_TYPE_OPTIONS = Array.from(NODE_TYPES);
export const EDGE_TYPE_OPTIONS = Array.from(EDGE_TYPES);
export const CONFIDENCE_OPTIONS = Array.from(CONFIDENCE_LEVELS);

/**
 * @param {any} raw
 * @returns {{ nodes: Array, edges: Array, metadata: Object }}
 */
export function normalizeGraph(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new Error('That file does not look like a Blueline lineage graph (expected { nodes: [...], edges: [...] }).');
  }

  const seenIds = new Set();
  const nodes = [];
  for (const n of raw.nodes) {
    if (!n || typeof n.id !== 'string' || !n.id.trim() || seenIds.has(n.id)) continue;
    const id = n.id.trim();
    seenIds.add(id);
    const hasValidPosition =
      n.position && typeof n.position === 'object' && Number.isFinite(n.position.x) && Number.isFinite(n.position.y);
    nodes.push({
      id,
      label: typeof n.label === 'string' && n.label.trim() ? n.label.trim() : id,
      type: NODE_TYPES.has(n.type) ? n.type : 'table',
      description: typeof n.description === 'string' ? n.description : '',
      confidence: CONFIDENCE_LEVELS.has(n.confidence) ? n.confidence : 'high',
      ...(hasValidPosition ? { position: { x: n.position.x, y: n.position.y } } : {}),
    });
  }

  const edges = [];
  let counter = 0;
  for (const e of raw.edges) {
    if (!e || !seenIds.has(e.source) || !seenIds.has(e.target)) continue;
    counter += 1;
    edges.push({
      id: typeof e.id === 'string' && e.id.trim() ? e.id.trim() : `e${counter}`,
      source: e.source,
      target: e.target,
      transformation: typeof e.transformation === 'string' ? e.transformation : '',
      type: EDGE_TYPES.has(e.type) ? e.type : 'direct',
      confidence: CONFIDENCE_LEVELS.has(e.confidence) ? e.confidence : 'high',
    });
  }

  if (nodes.length === 0) {
    throw new Error('That file has no valid nodes.');
  }

  return {
    nodes,
    edges,
    metadata:
      raw.metadata && typeof raw.metadata === 'object'
        ? raw.metadata
        : { generatedAt: new Date().toISOString(), sourceFiles: [] },
  };
}

/**
 * @param {{nodes: Array, edges: Array}} graph
 * @returns {Map<string, {upstream: string[], downstream: string[]}>}
 */
export function computeImpact(graph) {
  const upstream = new Map();
  const downstream = new Map();
  for (const n of graph.nodes) {
    upstream.set(n.id, []);
    downstream.set(n.id, []);
  }
  for (const e of graph.edges) {
    downstream.get(e.source)?.push(e.target);
    upstream.get(e.target)?.push(e.source);
  }
  const impact = new Map();
  for (const n of graph.nodes) {
    impact.set(n.id, { upstream: upstream.get(n.id) || [], downstream: downstream.get(n.id) || [] });
  }
  return impact;
}
