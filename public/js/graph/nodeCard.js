/**
 * nodeCard.js — builds and updates the DOM for a single lineage node
 * "card." Purely presentational: given node data and a little
 * rendering state (selected? dimmed? expanded, with which columns?),
 * it fills in an element. It never positions itself, never touches
 * pan/zoom, and never decides *when* to expand — LineageCanvas
 * (canvas.js) owns positioning, wiring, and state.
 *
 * Colors are never computed here. Every color — confidence, type
 * accent, selection — comes from a CSS custom property selected via a
 * `data-*` attribute (see graph.css / tokens.css), so a dark/light
 * theme switch needs no JavaScript at all: it's just a CSS cascade
 * change on `<html data-theme>`, same as every other themed element
 * in this app.
 */

import { NODE_TYPE_GLYPH, COMPACT_NODE_TYPES, EXPANDED_COLUMN_LIMIT } from './constants.js';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

/** Creates the (empty) card shell — call once per node, then keep it in sync with updateNodeCard(). */
export function createNodeCard(nodeId) {
  const el = document.createElement('div');
  el.className = 'lineage-node';
  el.dataset.id = nodeId;
  el.setAttribute('role', 'group');
  el.innerHTML = `
    <div class="lineage-node__header">
      <span class="lineage-node__glyph" aria-hidden="true"></span>
      <span class="lineage-node__title"></span>
      <span class="lineage-node__expand" aria-hidden="true">▸</span>
    </div>
    <div class="lineage-node__body">
      <span class="lineage-node__badge"></span>
      <div class="lineage-node__metric">
        <span>confidence</span><b class="lineage-node__confidence-value"></b>
      </div>
      <div class="lineage-node__metric lineage-node__metric--columns">
        <span>columns</span><b></b>
      </div>
    </div>
    <div class="lineage-node__columns" hidden></div>
    <span class="lineage-node__handle" title="Drag to connect"></span>
  `;
  return el;
}

/**
 * @param {HTMLElement} el - from createNodeCard()
 * @param {{id: string, label?: string, type?: string, confidence?: string, description?: string}} node
 * @param {{expanded: boolean, columns: Array<{id: string, label: string}>}} state
 */
export function updateNodeCard(el, node, state) {
  const type = node.type || 'table';
  const isCompact = COMPACT_NODE_TYPES.has(type);
  const label = node.label || node.id;
  const confidence = node.confidence || 'high';
  const canExpand = !isCompact && state.columns.length > 0;
  const isExpanded = canExpand && state.expanded;

  el.dataset.type = type;
  el.dataset.confidence = confidence;
  el.classList.toggle('lineage-node--compact', isCompact);
  el.classList.toggle('is-expanded', isExpanded);
  el.title = node.description ? `${label} — ${node.description}` : label;

  el.querySelector('.lineage-node__glyph').textContent = NODE_TYPE_GLYPH[type] || NODE_TYPE_GLYPH.table;
  el.querySelector('.lineage-node__title').textContent = label;

  const expandEl = el.querySelector('.lineage-node__expand');
  expandEl.hidden = !canExpand;
  expandEl.textContent = isExpanded ? '▾' : '▸';

  el.querySelector('.lineage-node__badge').textContent = type;
  el.querySelector('.lineage-node__confidence-value').textContent = confidence;

  const columnsMetricEl = el.querySelector('.lineage-node__metric--columns');
  columnsMetricEl.hidden = isCompact;
  if (!isCompact) columnsMetricEl.querySelector('b').textContent = String(state.columns.length);

  const columnsEl = el.querySelector('.lineage-node__columns');
  if (!isExpanded) {
    columnsEl.hidden = true;
    columnsEl.innerHTML = '';
  } else {
    columnsEl.hidden = false;
    const sorted = [...state.columns].sort((a, b) => a.label.localeCompare(b.label));
    const shown = sorted.slice(0, EXPANDED_COLUMN_LIMIT);
    const remaining = sorted.length - shown.length;
    columnsEl.innerHTML =
      shown.map((c) => `<div class="lineage-node__column">${escapeHtml(c.label)}</div>`).join('') +
      (remaining > 0 ? `<div class="lineage-node__column lineage-node__column--more">+${remaining} more</div>` : '');
  }
}

export function setNodeCardPosition(el, x, y) {
  el.style.transform = `translate(${x}px, ${y}px)`;
}

export function setNodeCardSelected(el, selected) {
  el.classList.toggle('is-selected', selected);
}

export function setNodeCardDimmed(el, dimmed) {
  el.classList.toggle('is-dimmed', dimmed);
}
