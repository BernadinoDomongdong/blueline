/**
 * canvas.js — LineageCanvas: the engine behind the lineage diagram.
 * Owns the viewport DOM (grid, SVG edge layer, node card layer),
 * pan/zoom, click-to-highlight upstream/downstream, table/view
 * inline expansion, drag-to-reposition, drag-to-connect, and the
 * manual-edit mutation API (add/update/remove node or edge).
 *
 * This replaces the cytoscape instance the previous renderer built —
 * plain DOM elements and an SVG overlay instead of a single canvas
 * bitmap. Colors are never computed here: every visual state (type,
 * confidence, selected, dimmed, expanded) is expressed as a class or
 * `data-*` attribute, and tokens.css does the rest — so a dark/light
 * theme change needs no code path here at all.
 *
 * GraphView (graphView.js) wraps this in the stable public API the
 * rest of the app already depends on; nothing outside this file
 * (and the small render helpers it composes: nodeCard, edgePath,
 * layout, reachability, panZoom, dragConnect) knows how a node is
 * actually drawn.
 */

import { computeLayout } from './layout.js';
import { computeRelated } from './reachability.js';
import { computeEdgePath } from './edgePath.js';
import { PanZoom } from './panZoom.js';
import { DragConnect } from './dragConnect.js';
import { createNodeCard, updateNodeCard, setNodeCardPosition, setNodeCardSelected, setNodeCardDimmed } from './nodeCard.js';
import { exportDiagramToPng } from './pngExport.js';
import { CARD_WIDTH, ZOOM_FIT_PADDING, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from './constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TAP_MOVE_THRESHOLD = 4; // px — beyond this, a pointerdown→up is a drag, not a tap
const DOUBLE_TAP_WINDOW_MS = 350;

function makeEdgeId() {
  return window.crypto?.randomUUID ? `e_${window.crypto.randomUUID()}` : `e_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export class LineageCanvas {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    /** @type {Map<string, {data: Object, position: {x:number,y:number}, expanded: boolean, el: HTMLElement}>} */
    this.nodes = new Map();
    /** @type {Map<string, {data: Object, pathEl: SVGPathElement, hitEl: SVGPathElement, dotEl: SVGCircleElement}>} */
    this.edges = new Map();
    this._selection = null; // {id, type: 'node'|'edge'} | null
    this._connectModeActive = false;
    this._lastTap = null; // {id, type, time}

    this.onNodeSelectCallbacks = [];
    this.onEdgeSelectCallbacks = [];
    this.onNodeDblTapCallbacks = [];
    this.onEdgeDblTapCallbacks = [];
    this.onEdgeCreatedCallbacks = [];
    this.onSelectionClearedCallbacks = [];

    this._buildDom();
    this._wireBackgroundInteraction();
    this._wireNodeInteraction();

    this.panZoom = new PanZoom(this.viewportEl, this.transformEl, { ignoreSelector: '.lineage-node' });
    this.dragConnect = new DragConnect({
      viewportEl: this.viewportEl,
      svgEl: this.svgEl,
      getTransform: () => ({ x: this.panZoom.x, y: this.panZoom.y, scale: this.panZoom.scale }),
      getNodeRect: (id) => this._rectFor(id),
      canConnect: (sourceId, targetId) => this._canConnect(sourceId, targetId),
      onComplete: (sourceId, targetId) => this._completeConnect(sourceId, targetId),
    });

    this._wireZoomControls();
  }

  // ─── DOM setup ──────────────────────────────────────────────────

  _buildDom() {
    this.viewportEl = document.createElement('div');
    this.viewportEl.className = 'lineage-viewport';

    this.transformEl = document.createElement('div');
    this.transformEl.className = 'lineage-transform';

    this.gridEl = document.createElement('div');
    this.gridEl.className = 'lineage-grid';

    this.svgEl = document.createElementNS(SVG_NS, 'svg');
    this.svgEl.setAttribute('class', 'lineage-edges');
    this.svgEl.innerHTML = `
      <defs>
        <marker id="lineage-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
        </marker>
      </defs>
    `;

    this.nodesLayerEl = document.createElement('div');
    this.nodesLayerEl.className = 'lineage-nodes';

    this.transformEl.append(this.gridEl, this.svgEl, this.nodesLayerEl);
    this.viewportEl.append(this.transformEl);

    this.zoomControlsEl = document.createElement('div');
    this.zoomControlsEl.className = 'lineage-zoom-controls';
    this.zoomControlsEl.innerHTML = `
      <button type="button" class="lineage-zoom-controls__btn" data-action="out" title="Zoom out">−</button>
      <span class="lineage-zoom-controls__label">100%</span>
      <button type="button" class="lineage-zoom-controls__btn" data-action="in" title="Zoom in">+</button>
      <button type="button" class="lineage-zoom-controls__btn" data-action="fit" title="Fit to view">⌗</button>
    `;

    // Insert before any existing children (the component palette markup
    // already lives in this container in index.html) so the palette
    // stays layered on top.
    this.container.prepend(this.zoomControlsEl);
    this.container.prepend(this.viewportEl);
  }

  _wireZoomControls() {
    this.panZoom.onChange = ({ scale }) => {
      this.zoomControlsEl.querySelector('.lineage-zoom-controls__label').textContent = `${Math.round(scale * 100)}%`;
    };
    this.zoomControlsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.action === 'in') this.panZoom.zoomIn(ZOOM_STEP);
      else if (btn.dataset.action === 'out') this.panZoom.zoomOut(ZOOM_STEP);
      else if (btn.dataset.action === 'fit') this.fit();
    });
  }

  // ─── Public: lifecycle & theming ────────────────────────────────

  /** No-op: every visual (confidence color, selection, dimming) is CSS-driven via tokens.css, so a theme switch needs no rendering work here. Kept for API compatibility with the dark/light toggle (js/theme.js). */
  refreshTheme() {}

  onNodeSelect(cb) {
    this.onNodeSelectCallbacks.push(cb);
  }
  onEdgeSelect(cb) {
    this.onEdgeSelectCallbacks.push(cb);
  }
  onNodeDblTap(cb) {
    this.onNodeDblTapCallbacks.push(cb);
  }
  onEdgeDblTap(cb) {
    this.onEdgeDblTapCallbacks.push(cb);
  }
  onEdgeCreated(cb) {
    this.onEdgeCreatedCallbacks.push(cb);
  }
  onSelectionCleared(cb) {
    this.onSelectionClearedCallbacks.push(cb);
  }

  /**
   * @param {{nodes: Array, edges: Array}} graph
   * @param {{preserveViewport?: boolean}} [opts] - preserveViewport skips fit-to-view when every node already carries a position (an exported/imported diagram); ignored when any position is missing, since a fresh auto-layout always frames itself.
   */
  render(graph, opts = {}) {
    this.nodesLayerEl.replaceChildren();
    this.svgEl.querySelectorAll('path.lineage-edge, path.lineage-edge__hit, circle.lineage-edge-dot').forEach((el) => el.remove());
    this.nodes.clear();
    this.edges.clear();
    this._selection = null;

    const allPositioned = graph.nodes.length > 0 && graph.nodes.every((n) => n.position);
    const layout = allPositioned ? null : computeLayout(graph.nodes, graph.edges);

    for (const n of graph.nodes) {
      const { position, ...data } = n;
      this._createNode(data, allPositioned ? position : layout.get(n.id));
    }
    for (const e of graph.edges) {
      this._createEdge({ ...e });
    }

    if (allPositioned && opts.preserveViewport) {
      // Keep the pan/zoom exactly as the user left it.
    } else {
      this.fit();
    }
  }

  isEmpty() {
    return this.nodes.size === 0;
  }

  fit() {
    this.panZoom.fit(this._bounds(), ZOOM_FIT_PADDING);
  }

  // ─── Public: selection & highlighting ───────────────────────────

  highlightNode(id) {
    const node = this.nodes.get(id);
    if (!node) return;
    const edgeList = [...this.edges.values()].map((e) => e.data);
    const { relatedNodes, relatedEdges } = computeRelated(id, edgeList);
    for (const [nid, n] of this.nodes) setNodeCardDimmed(n.el, !relatedNodes.has(nid));
    for (const [eid, e] of this.edges) this._setEdgeDimmed(e, !relatedEdges.has(eid));
    for (const [, n] of this.nodes) setNodeCardSelected(n.el, false);
    setNodeCardSelected(node.el, true);
    this._selection = { id, type: 'node' };
  }

  highlightEdge(id) {
    const edge = this.edges.get(id);
    if (!edge) return;
    for (const [, n] of this.nodes) setNodeCardDimmed(n.el, false);
    for (const [, e] of this.edges) {
      this._setEdgeDimmed(e, false);
      this._setEdgeSelected(e, false);
    }
    for (const [, n] of this.nodes) setNodeCardSelected(n.el, false);
    this._setEdgeSelected(edge, true);
    this._selection = { id, type: 'edge' };
  }

  clearHighlight() {
    for (const [, n] of this.nodes) {
      setNodeCardDimmed(n.el, false);
      setNodeCardSelected(n.el, false);
    }
    for (const [, e] of this.edges) {
      this._setEdgeDimmed(e, false);
      this._setEdgeSelected(e, false);
    }
    this._selection = null;
  }

  getSelection() {
    return this._selection;
  }

  setConnectMode(enabled) {
    this._connectModeActive = enabled;
    this.dragConnect.setEnabled(enabled);
    if (enabled) this.clearHighlight();
  }

  // ─── Public: manual-edit mutation API ───────────────────────────
  // These mutate the live diagram directly rather than going through
  // render(), so every other node's position and the current pan/zoom
  // are left exactly as the user set them.

  hasElement(id) {
    return this.nodes.has(id) || this.edges.has(id);
  }

  /** Whether an edge already connects these two node ids, regardless of edge id — used when merging freshly-inferred lineage onto an existing diagram so the same connection isn't drawn twice in parallel. */
  hasEdgeBetween(source, target) {
    for (const { data } of this.edges.values()) {
      if (data.source === source && data.target === target) return true;
    }
    return false;
  }

  /**
   * @param {{id: string, label?: string, type?: string, description?: string, confidence?: string}} nodeData
   * @param {{x: number, y: number}} [position] - defaults to the current viewport center
   */
  addNode(nodeData, position) {
    if (this.hasElement(nodeData.id)) {
      throw new Error(`A node with id "${nodeData.id}" already exists.`);
    }
    const pos = position || this.viewportCenterModelPosition();
    return this._createNode({ ...nodeData }, pos);
  }

  /** @param {{id?: string, source: string, target: string, transformation?: string, type?: string, confidence?: string}} edgeData */
  addEdge(edgeData) {
    if (!this.nodes.has(edgeData.source) || !this.nodes.has(edgeData.target)) {
      throw new Error('Both the source and target node must already exist on the diagram.');
    }
    const id = edgeData.id && !this.hasElement(edgeData.id) ? edgeData.id : makeEdgeId();
    return this._createEdge({ ...edgeData, id });
  }

  updateNode(id, patch) {
    const node = this.nodes.get(id);
    if (!node) return;
    node.data = { ...node.data, ...patch };
    this._refreshNode(id);
  }

  updateEdge(id, patch) {
    const edge = this.edges.get(id);
    if (!edge) return;
    edge.data = { ...edge.data, ...patch };
    this._applyEdgeConfidence(edge);
  }

  /** Removes a node (and every edge touching it) or a single edge. */
  removeElement(id) {
    if (this.nodes.has(id)) {
      for (const [eid, e] of [...this.edges]) {
        if (e.data.source === id || e.data.target === id) this._removeEdge(eid);
      }
      this._removeNode(id);
    } else if (this.edges.has(id)) {
      this._removeEdge(id);
    } else {
      return;
    }
    if (this._selection?.id === id) this._selection = null;
  }

  getNodeData(id) {
    const node = this.nodes.get(id);
    return node ? { ...node.data } : null;
  }

  /** @returns {{x: number, y: number}|null} a node's current model position, for restoring it in the same spot after an undo. */
  getNodePosition(id) {
    const node = this.nodes.get(id);
    return node ? { ...node.position } : null;
  }

  /** @returns {Array<Object>} plain data for every edge currently touching a node — captured before removeElement() cascades their deletion too, so an undo can restore them. */
  getConnectedEdgesData(nodeId) {
    return [...this.edges.values()].filter((e) => e.data.source === nodeId || e.data.target === nodeId).map((e) => ({ ...e.data }));
  }

  getEdgeData(id) {
    const edge = this.edges.get(id);
    return edge ? { ...edge.data } : null;
  }

  /** @returns {Array<{id: string, label: string}>} every node currently on the diagram, for populating a source/target picker. */
  listNodes() {
    return [...this.nodes.entries()]
      .map(([id, n]) => ({ id, label: n.data.label || id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /** Reads the live diagram back out as a plain graph object, including each node's current on-screen position, so manual edits/drags can be synced back into app state and exports always reflect exactly what's on screen. */
  getGraphSnapshot() {
    const nodes = [...this.nodes.entries()].map(([id, n]) => ({ id, ...n.data, position: { ...n.position } }));
    const edges = [...this.edges.values()].map((e) => ({ ...e.data }));
    return { nodes, edges };
  }

  viewportCenterModelPosition() {
    return this.panZoom.centerModelPosition();
  }

  clientPositionToModel(clientX, clientY) {
    return this.panZoom.clientToModel(clientX, clientY);
  }

  exportPNG() {
    const rects = new Map();
    for (const [id] of this.nodes) rects.set(id, this._rectFor(id));
    return exportDiagramToPng({ graph: this.getGraphSnapshot(), rects });
  }

  // ─── Node/edge creation & removal ────────────────────────────────

  _createNode(data, position) {
    const el = createNodeCard(data.id);
    this.nodesLayerEl.appendChild(el);
    const record = { data, position: { ...position }, expanded: false, el };
    this.nodes.set(data.id, record);
    setNodeCardPosition(el, position.x - CARD_WIDTH / 2, position.y);
    el.style.width = `${CARD_WIDTH}px`;
    this._refreshNode(data.id);
    return record;
  }

  _removeNode(id) {
    const node = this.nodes.get(id);
    if (!node) return;
    node.el.remove();
    this.nodes.delete(id);
  }

  _createEdge(data) {
    const pathEl = document.createElementNS(SVG_NS, 'path');
    pathEl.setAttribute('class', 'lineage-edge');
    pathEl.setAttribute('marker-end', 'url(#lineage-arrow)');

    const hitEl = document.createElementNS(SVG_NS, 'path');
    hitEl.setAttribute('class', 'lineage-edge__hit');

    const dotEl = document.createElementNS(SVG_NS, 'circle');
    dotEl.setAttribute('class', 'lineage-edge-dot');
    dotEl.setAttribute('r', '3');

    this.svgEl.append(hitEl, pathEl, dotEl);
    const record = { data, pathEl, hitEl, dotEl };
    this.edges.set(data.id, record);
    this._applyEdgeConfidence(record);
    this._redrawEdge(record);
    return record;
  }

  _removeEdge(id) {
    const edge = this.edges.get(id);
    if (!edge) return;
    edge.pathEl.remove();
    edge.hitEl.remove();
    edge.dotEl.remove();
    this.edges.delete(id);
  }

  /** Rebuilds a node's card content/size after a data or expansion change, then redraws every edge (cheap at lineage-diagram scale, and correct regardless of which node's size changed). */
  _refreshNode(id) {
    const node = this.nodes.get(id);
    if (!node) return;
    const columns = this._columnsForTable(id);
    updateNodeCard(node.el, node.data, { expanded: node.expanded, columns });
    this._redrawAllEdges();
  }

  /**
   * Table/view nodes carry no explicit "contains these columns" edge —
   * a column node's own id is namespaced as "<tableId>.<columnName>"
   * (see api/_lineage_engine.py), so a table's columns are whatever
   * column-typed nodes share that id prefix.
   */
  _columnsForTable(tableId) {
    const prefix = `${tableId}.`;
    const columns = [];
    for (const [id, n] of this.nodes) {
      if (n.data.type === 'column' && id.startsWith(prefix)) columns.push({ id, label: n.data.label || id });
    }
    return columns;
  }

  // ─── Geometry ────────────────────────────────────────────────────

  /** @returns {{x: number, y: number, width: number, height: number}} a node's current rect in model space, independent of pan/zoom (CSS transform scale doesn't affect offsetWidth/offsetHeight). */
  _rectFor(id) {
    const node = this.nodes.get(id);
    if (!node) return undefined;
    return { x: node.position.x - CARD_WIDTH / 2, y: node.position.y, width: node.el.offsetWidth || CARD_WIDTH, height: node.el.offsetHeight || 0 };
  }

  _bounds() {
    if (this.nodes.size === 0) return { x: 0, y: 0, width: 0, height: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [id] of this.nodes) {
      const r = this._rectFor(id);
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  _redrawAllEdges() {
    for (const edge of this.edges.values()) this._redrawEdge(edge);
  }

  _redrawEdge(edge) {
    const sourceRect = this._rectFor(edge.data.source);
    const targetRect = this._rectFor(edge.data.target);
    if (!sourceRect || !targetRect) return;
    const { d, midpoint } = computeEdgePath(sourceRect, targetRect);
    edge.pathEl.setAttribute('d', d);
    edge.hitEl.setAttribute('d', d);
    edge.dotEl.setAttribute('cx', String(midpoint.x));
    edge.dotEl.setAttribute('cy', String(midpoint.y));
  }

  _applyEdgeConfidence(edge) {
    const confidence = edge.data.confidence || 'high';
    edge.pathEl.dataset.confidence = confidence;
    edge.dotEl.dataset.confidence = confidence;
  }

  _setEdgeDimmed(edge, dimmed) {
    edge.pathEl.classList.toggle('is-dimmed', dimmed);
    edge.dotEl.classList.toggle('is-dimmed', dimmed);
  }

  _setEdgeSelected(edge, selected) {
    edge.pathEl.classList.toggle('is-selected', selected);
  }

  // ─── Connect ("drag to link two nodes") ─────────────────────────

  _canConnect(sourceId, targetId) {
    return sourceId !== targetId && !this.hasEdgeBetween(sourceId, targetId);
  }

  _completeConnect(sourceId, targetId) {
    const edge = this.addEdge({ source: sourceId, target: targetId, transformation: '', type: 'direct', confidence: 'high' });
    for (const cb of this.onEdgeCreatedCallbacks) cb(edge.data.id);
  }

  // ─── Interaction wiring ──────────────────────────────────────────

  /** Background pan-vs-click and edge clicks — anything not on a node card. */
  _wireBackgroundInteraction() {
    let down = null;
    this.viewportEl.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, target: e.target };
    });
    this.viewportEl.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_MOVE_THRESHOLD;
      const startTarget = down.target;
      down = null;
      if (moved) return;

      const edgeHit = startTarget.closest?.('.lineage-edge__hit');
      if (edgeHit) {
        const id = this._edgeIdForHitEl(edgeHit);
        if (!id) return;
        this._onEdgeTap(id);
        return;
      }
      if (startTarget.closest?.('.lineage-node')) return; // handled by _wireNodeInteraction
      this.clearHighlight();
      for (const cb of this.onSelectionClearedCallbacks) cb();
    });
  }

  _edgeIdForHitEl(hitEl) {
    for (const [id, e] of this.edges) if (e.hitEl === hitEl) return id;
    return null;
  }

  _onEdgeTap(id) {
    this.highlightEdge(id);
    for (const cb of this.onEdgeSelectCallbacks) cb(id);
    this._registerTap(id, 'edge', () => {
      for (const cb of this.onEdgeDblTapCallbacks) cb(id);
    });
  }

  /** Node drag-to-reposition, tap-to-select/expand, and double-tap-to-edit. */
  _wireNodeInteraction() {
    let dragId = null;
    let dragStart = null;
    let moved = false;

    this.nodesLayerEl.addEventListener('pointerdown', (e) => {
      const nodeEl = e.target.closest('.lineage-node');
      if (!nodeEl) return;
      if (this._connectModeActive && e.target.closest('.lineage-node__handle')) return; // DragConnect owns this gesture
      if (e.target.closest('.lineage-node__columns')) return; // let the expanded column list scroll natively instead of dragging the card
      dragId = nodeEl.dataset.id;
      const node = this.nodes.get(dragId);
      dragStart = { pointerX: e.clientX, pointerY: e.clientY, nodeX: node.position.x, nodeY: node.position.y };
      moved = false;
      this.nodesLayerEl.setPointerCapture(e.pointerId);
    });

    this.nodesLayerEl.addEventListener('pointermove', (e) => {
      if (!dragId) return;
      const dxClient = e.clientX - dragStart.pointerX;
      const dyClient = e.clientY - dragStart.pointerY;
      if (!moved && Math.hypot(dxClient, dyClient) <= TAP_MOVE_THRESHOLD) return;
      moved = true;
      const node = this.nodes.get(dragId);
      if (!node) return;
      const scale = this.panZoom.scale;
      node.position = { x: dragStart.nodeX + dxClient / scale, y: dragStart.nodeY + dyClient / scale };
      setNodeCardPosition(node.el, node.position.x - CARD_WIDTH / 2, node.position.y);
      this._redrawAllEdges();
    });

    const endDrag = (e) => {
      if (!dragId) return;
      const id = dragId;
      dragId = null;
      if (!moved) this._onNodeTap(id);
    };
    this.nodesLayerEl.addEventListener('pointerup', endDrag);
    this.nodesLayerEl.addEventListener('pointercancel', endDrag);
  }

  _onNodeTap(id) {
    if (this._connectModeActive) {
      for (const [, n] of this.nodes) setNodeCardDimmed(n.el, false);
      for (const [, n] of this.nodes) setNodeCardSelected(n.el, false);
      for (const [, e] of this.edges) this._setEdgeSelected(e, false);
      const node = this.nodes.get(id);
      setNodeCardSelected(node.el, true);
      this._selection = { id, type: 'node' };
    } else {
      this.highlightNode(id);
      const node = this.nodes.get(id);
      const canExpand = (node.data.type === 'table' || node.data.type === 'view') && this._columnsForTable(id).length > 0;
      if (canExpand) {
        node.expanded = !node.expanded;
        this._refreshNode(id);
      }
    }
    for (const cb of this.onNodeSelectCallbacks) cb(id);
    this._registerTap(id, 'node', () => {
      for (const cb of this.onNodeDblTapCallbacks) cb(id);
    });
  }

  _registerTap(id, type, onDoubleTap) {
    const now = Date.now();
    const isDouble = this._lastTap && this._lastTap.id === id && this._lastTap.type === type && now - this._lastTap.time < DOUBLE_TAP_WINDOW_MS;
    this._lastTap = { id, type, time: now };
    if (isDouble) {
      this._lastTap = null;
      onDoubleTap();
    }
  }
}

export { ZOOM_MIN, ZOOM_MAX };
