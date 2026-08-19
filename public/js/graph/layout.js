/**
 * layout.js — pure auto-layout for lineage graphs. No DOM, no
 * rendering — given nodes and edges, returns where each node should
 * sit. Replaces cytoscape's `breadthfirst` layout (previously run
 * top-to-bottom, then rotated 90° in graphView.js to read left-to-
 * right) with a layout that's left-to-right natively.
 *
 * Sources (no incoming edge) form column 0; every other node's column
 * is its shortest hop-count from a source — i.e. plain breadth-first
 * search, matching what cytoscape's `breadthfirst` layout actually
 * computed under the hood (the name is literal). A node is placed the
 * first time BFS reaches it and never revisited, which is also what
 * makes this safe on cyclic graphs: a longest-path version of this
 * (revisit a node whenever a deeper route to it is found) never
 * terminates on a cycle, since each trip around it strictly increases
 * the "longest" depth found so far.
 */

import { LAYOUT_COLUMN_SPACING, LAYOUT_ROW_SPACING } from './constants.js';

/**
 * @param {Array<{id: string}>} nodes
 * @param {Array<{source: string, target: string}>} edges
 * @returns {Map<string, {x: number, y: number}>}
 */
export function computeLayout(nodes, edges) {
  if (nodes.length === 0) return new Map();

  const outgoing = new Map(nodes.map((n) => [n.id, []]));
  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    if (!outgoing.has(e.source) || !indegree.has(e.target)) continue;
    outgoing.get(e.source).push(e.target);
    indegree.set(e.target, (indegree.get(e.target) || 0) + 1);
  }

  const depth = new Map();
  let frontier = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  // No zero-indegree node at all (every node has an incoming edge —
  // an all-cycle graph) — seed with the first node so layering still
  // terminates instead of leaving everything unplaced.
  if (frontier.length === 0) frontier = [nodes[0].id];
  for (const id of frontier) depth.set(id, 0);

  while (frontier.length) {
    const next = [];
    for (const id of frontier) {
      const d = depth.get(id);
      for (const target of outgoing.get(id) || []) {
        if (!depth.has(target)) {
          depth.set(target, d + 1);
          next.push(target);
        }
      }
    }
    frontier = next;
  }
  // Anything BFS never reached (disconnected from every root) still
  // needs a column — place it at column 0 alongside the other sources.
  for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, 0);

  const columns = new Map();
  for (const n of nodes) {
    const d = depth.get(n.id);
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d).push(n.id);
  }

  const positions = new Map();
  for (const [d, ids] of columns) {
    const totalHeight = (ids.length - 1) * LAYOUT_ROW_SPACING;
    ids.forEach((id, i) => {
      positions.set(id, {
        x: d * LAYOUT_COLUMN_SPACING,
        y: i * LAYOUT_ROW_SPACING - totalHeight / 2,
      });
    });
  }
  return positions;
}
