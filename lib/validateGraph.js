/**
 * lib/validateGraph.js — schema guard for the lineage graph shape.
 *
 * Claude is instructed (see lib/prompts.js) to return this shape
 * exactly, but nothing upstream should ever trust a model's raw JSON
 * output blindly. This is the one place that shape is enforced before
 * a graph is returned to a client or fed back into a later prompt.
 *
 * Graph shape:
 *   {
 *     nodes: [{ id, label, type, description?, confidence? }],
 *     edges: [{ id, source, target, transformation?, type?, confidence? }],
 *     metadata: { generatedAt, sourceFiles }
 *   }
 */

'use strict';

const NODE_TYPES = new Set(['table', 'view', 'column', 'measure']);
const EDGE_TYPES = new Set(['direct', 'derived', 'aggregated', 'filtered']);
const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low']);

const MAX_NODES = 500;
const MAX_EDGES = 1500;

class GraphValidationError extends Error {}

/**
 * @param {any} raw - Parsed JSON, not yet trusted.
 * @param {string[]} [sourceFiles]
 * @returns {{ graph: Object, warnings: string[] }}
 */
function validateAndNormalizeGraph(raw, sourceFiles = []) {
  if (!raw || typeof raw !== 'object') {
    throw new GraphValidationError('Graph must be a JSON object.');
  }
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new GraphValidationError('Graph must have "nodes" and "edges" arrays.');
  }
  if (raw.nodes.length > MAX_NODES) {
    throw new GraphValidationError(`Graph has ${raw.nodes.length} nodes; the limit is ${MAX_NODES}.`);
  }
  if (raw.edges.length > MAX_EDGES) {
    throw new GraphValidationError(`Graph has ${raw.edges.length} edges; the limit is ${MAX_EDGES}.`);
  }

  const warnings = [];
  const seenNodeIds = new Set();
  const nodes = [];

  for (const rawNode of raw.nodes) {
    if (!rawNode || typeof rawNode.id !== 'string' || !rawNode.id.trim()) {
      warnings.push('Dropped a node with a missing or invalid id.');
      continue;
    }
    if (seenNodeIds.has(rawNode.id)) {
      warnings.push(`Dropped duplicate node id "${rawNode.id}".`);
      continue;
    }
    seenNodeIds.add(rawNode.id);
    nodes.push({
      id: rawNode.id.trim(),
      label: typeof rawNode.label === 'string' && rawNode.label.trim() ? rawNode.label.trim() : rawNode.id.trim(),
      type: NODE_TYPES.has(rawNode.type) ? rawNode.type : 'table',
      description: typeof rawNode.description === 'string' ? rawNode.description.slice(0, 500) : '',
      confidence: CONFIDENCE_LEVELS.has(rawNode.confidence) ? rawNode.confidence : 'high',
    });
  }

  const seenEdgeKeys = new Set();
  const edges = [];
  let edgeCounter = 0;

  for (const rawEdge of raw.edges) {
    if (!rawEdge || typeof rawEdge.source !== 'string' || typeof rawEdge.target !== 'string') {
      warnings.push('Dropped an edge with a missing source or target.');
      continue;
    }
    if (!seenNodeIds.has(rawEdge.source) || !seenNodeIds.has(rawEdge.target)) {
      warnings.push(`Dropped edge "${rawEdge.source} → ${rawEdge.target}" — references an unknown node.`);
      continue;
    }
    const key = `${rawEdge.source}\u0000${rawEdge.target}`;
    if (seenEdgeKeys.has(key)) {
      warnings.push(`Dropped duplicate edge "${rawEdge.source} → ${rawEdge.target}".`);
      continue;
    }
    seenEdgeKeys.add(key);
    edgeCounter += 1;
    edges.push({
      id: typeof rawEdge.id === 'string' && rawEdge.id.trim() ? rawEdge.id.trim() : `e${edgeCounter}`,
      source: rawEdge.source,
      target: rawEdge.target,
      transformation: typeof rawEdge.transformation === 'string' ? rawEdge.transformation.slice(0, 300) : '',
      type: EDGE_TYPES.has(rawEdge.type) ? rawEdge.type : 'direct',
      confidence: CONFIDENCE_LEVELS.has(rawEdge.confidence) ? rawEdge.confidence : 'high',
    });
  }

  const graph = {
    nodes,
    edges,
    metadata: {
      generatedAt: new Date().toISOString(),
      sourceFiles: Array.isArray(sourceFiles) ? sourceFiles.slice(0, 50) : [],
    },
  };

  return { graph, warnings };
}

/**
 * Walks the graph to compute, per node, which nodes feed into it
 * (upstream) and which nodes it feeds (downstream). Used to ground
 * report/impact-analysis prompts in real computed structure instead of
 * asking Claude to re-derive traversal from a flat edge list.
 * @param {{nodes: Array, edges: Array}} graph
 * @returns {Map<string, { upstream: string[], downstream: string[] }>}
 */
function computeImpact(graph) {
  const upstreamOf = new Map();
  const downstreamOf = new Map();
  for (const node of graph.nodes) {
    upstreamOf.set(node.id, []);
    downstreamOf.set(node.id, []);
  }
  for (const edge of graph.edges) {
    downstreamOf.get(edge.source)?.push(edge.target);
    upstreamOf.get(edge.target)?.push(edge.source);
  }
  const impact = new Map();
  for (const node of graph.nodes) {
    impact.set(node.id, {
      upstream: upstreamOf.get(node.id) || [],
      downstream: downstreamOf.get(node.id) || [],
    });
  }
  return impact;
}

module.exports = { validateAndNormalizeGraph, computeImpact, GraphValidationError, MAX_NODES, MAX_EDGES };
