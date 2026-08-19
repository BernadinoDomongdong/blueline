/**
 * reachability.js — pure graph traversal for the "highlight this
 * node's full upstream/downstream lineage" feature. No DOM.
 *
 * Mirrors what cytoscape's `node.predecessors()` / `node.successors()`
 * gave the old renderer for free: not just direct neighbors, but every
 * node and edge transitively reachable in either direction.
 */

/**
 * @param {string} nodeId
 * @param {Array<{id: string, source: string, target: string}>} edges
 * @returns {{ relatedNodes: Set<string>, relatedEdges: Set<string> }}
 */
export function computeRelated(nodeId, edges) {
  const outgoing = new Map(); // source id -> edges leaving it
  const incoming = new Map(); // target id -> edges arriving at it
  for (const e of edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source).push(e);
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target).push(e);
  }

  const relatedNodes = new Set([nodeId]);
  const relatedEdges = new Set();

  const walk = (startId, adjacency, endpointOf) => {
    let frontier = [startId];
    while (frontier.length) {
      const next = [];
      for (const id of frontier) {
        for (const edge of adjacency.get(id) || []) {
          relatedEdges.add(edge.id);
          const endpoint = endpointOf(edge);
          if (!relatedNodes.has(endpoint)) {
            relatedNodes.add(endpoint);
            next.push(endpoint);
          }
        }
      }
      frontier = next;
    }
  };

  walk(nodeId, outgoing, (e) => e.target); // downstream
  walk(nodeId, incoming, (e) => e.source); // upstream

  return { relatedNodes, relatedEdges };
}
