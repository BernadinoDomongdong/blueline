/**
 * inspector.js — renders the "Inspect" tab for whichever node was last
 * clicked in the graph.
 */

import { computeImpact } from './graphSchema.js';

export class Inspector {
  /** @param {Object} deps @param {ReturnType<typeof import('./state.js').createStore>} deps.store */
  constructor({ store }) {
    this.store = store;
    this.el = document.getElementById('inspectorContent');
  }

  show(nodeId) {
    const { graph } = this.store.get();
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const impact = computeImpact(graph).get(nodeId) || { upstream: [], downstream: [] };
    const labelFor = (id) => graph.nodes.find((n) => n.id === id)?.label || id;

    const incomingEdges = graph.edges.filter((e) => e.target === nodeId);
    const outgoingEdges = graph.edges.filter((e) => e.source === nodeId);

    this.el.innerHTML = `
      <div class="inspector__node-title">${escapeHtml(node.label)}</div>
      <div class="inspector__node-type">${escapeHtml(node.type)} · ${escapeHtml(node.confidence)} confidence</div>
      ${node.description ? `<p>${escapeHtml(node.description)}</p>` : ''}

      <div class="inspector__section-title">Upstream (${impact.upstream.length})</div>
      ${
        impact.upstream.length
          ? `<ul class="inspector__list">${incomingEdges
              .map(
                (e) =>
                  `<li>${escapeHtml(labelFor(e.source))}${e.transformation ? ` — <span class="inspector__transform">${escapeHtml(e.transformation)}</span>` : ''}</li>`
              )
              .join('')}</ul>`
          : '<p class="empty-hint empty-hint--tight">Nothing feeds this node — it looks like a source.</p>'
      }

      <div class="inspector__section-title">Downstream (${impact.downstream.length})</div>
      ${
        impact.downstream.length
          ? `<ul class="inspector__list">${outgoingEdges
              .map(
                (e) =>
                  `<li>${escapeHtml(labelFor(e.target))}${e.transformation ? ` — <span class="inspector__transform">${escapeHtml(e.transformation)}</span>` : ''}</li>`
              )
              .join('')}</ul>`
          : '<p class="empty-hint empty-hint--tight">Nothing downstream — changes here have no traced impact.</p>'
      }
    `;
  }

  clear() {
    this.el.innerHTML = '<p class="empty-hint">Click a node in the graph to inspect its upstream and downstream lineage.</p>';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
