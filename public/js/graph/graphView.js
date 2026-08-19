/**
 * graphView.js — GraphView: the public facade over the lineage
 * canvas. This is the one file the rest of the app imports
 * (main.js, editMode.js, importExport.js, fullscreen.js) and its API
 * is the contract between them and however the diagram happens to
 * be drawn underneath.
 *
 * That indirection is what makes swapping the rendering engine here
 * — cytoscape.js out, a custom DOM+SVG canvas (canvas.js) in — a
 * contained change: every consumer keeps calling the exact same
 * methods (render, addNode, highlightNode, exportPNG, ...) and
 * neither knows nor needs to know cytoscape is gone.
 *
 * Edge line style still encodes meaning, not decoration: solid =
 * high-confidence (confirmed) lineage, dashed = medium/low-confidence
 * (automatically-traced but not yet verified) — the same convention
 * an engineer uses penciling in an unconfirmed detail on a blueprint.
 * A manually added node or edge defaults to "high" confidence, since
 * a human asserted it directly rather than it being traced
 * automatically. See graph/canvas.js and graph.css for where that
 * convention is actually drawn.
 */

import { LineageCanvas } from './canvas.js';

export class GraphView {
  /** @param {HTMLElement} container */
  constructor(container) {
    this._canvas = new LineageCanvas(container);
  }

  refreshTheme() {
    this._canvas.refreshTheme();
  }

  onNodeSelect(cb) {
    this._canvas.onNodeSelect(cb);
  }
  /** Fired when an edge is tapped directly (distinct from node selection). */
  onEdgeSelect(cb) {
    this._canvas.onEdgeSelect(cb);
  }
  /** Fired on double-tap/double-click of a node — the manual-edit "open editor" gesture. */
  onNodeDblTap(cb) {
    this._canvas.onNodeDblTap(cb);
  }
  /** Fired on double-tap/double-click of an edge. */
  onEdgeDblTap(cb) {
    this._canvas.onEdgeDblTap(cb);
  }
  /** Fired after a drag-to-connect gesture creates a new edge. cb(edgeId). */
  onEdgeCreated(cb) {
    this._canvas.onEdgeCreated(cb);
  }
  /** Fired when the background is tapped and any prior selection is cleared. */
  onSelectionCleared(cb) {
    this._canvas.onSelectionCleared(cb);
  }

  /**
   * @param {{nodes: Array, edges: Array}} graph
   * @param {{preserveViewport?: boolean}} [opts] - preserveViewport skips
   *   fit-to-view, used when re-rendering after a structural edit made
   *   while the user already has a particular pan/zoom set up.
   */
  render(graph, opts = {}) {
    this._canvas.render(graph, opts);
  }

  isEmpty() {
    return this._canvas.isEmpty();
  }

  fit() {
    this._canvas.fit();
  }

  highlightNode(id) {
    this._canvas.highlightNode(id);
  }

  highlightEdge(id) {
    this._canvas.highlightEdge(id);
  }

  clearHighlight() {
    this._canvas.clearHighlight();
  }

  getSelection() {
    return this._canvas.getSelection();
  }

  setConnectMode(enabled) {
    this._canvas.setConnectMode(enabled);
  }

  // ─── Manual-edit mutations ──────────────────────────────────────

  hasElement(id) {
    return this._canvas.hasElement(id);
  }

  /** Whether an edge already connects these two node ids, regardless of edge id. */
  hasEdgeBetween(source, target) {
    return this._canvas.hasEdgeBetween(source, target);
  }

  /**
   * @param {{id: string, label?: string, type?: string, description?: string, confidence?: string}} nodeData
   * @param {{x: number, y: number}} [position] - defaults to the current viewport center
   */
  addNode(nodeData, position) {
    return this._canvas.addNode(nodeData, position);
  }

  /** @param {{id: string, source: string, target: string, transformation?: string, type?: string, confidence?: string}} edgeData */
  addEdge(edgeData) {
    return this._canvas.addEdge(edgeData);
  }

  updateNode(id, patch) {
    this._canvas.updateNode(id, patch);
  }

  updateEdge(id, patch) {
    this._canvas.updateEdge(id, patch);
  }

  /** Removes a node (and every edge touching it) or a single edge. */
  removeElement(id) {
    this._canvas.removeElement(id);
  }

  getNodeData(id) {
    return this._canvas.getNodeData(id);
  }

  /** @returns {{x: number, y: number}|null} a node's current position, for restoring it in the same spot after an undo. */
  getNodePosition(id) {
    return this._canvas.getNodePosition(id);
  }

  /** @returns {Array<Object>} plain data for every edge currently touching a node — captured before removeElement() cascades their deletion too, so an undo can restore them. */
  getConnectedEdgesData(nodeId) {
    return this._canvas.getConnectedEdgesData(nodeId);
  }

  getEdgeData(id) {
    return this._canvas.getEdgeData(id);
  }

  /** @returns {Array<{id: string, label: string}>} every node currently on the diagram, for populating a source/target picker. */
  listNodes() {
    return this._canvas.listNodes();
  }

  /** Reads the live diagram back out as a plain graph object — including each node's current on-screen position — so manual edits and drags can be synced back into app state, and so exports always reflect exactly what's on screen. */
  getGraphSnapshot() {
    return this._canvas.getGraphSnapshot();
  }

  /** The model-space point currently at the center of the viewport — used as the drop position when a palette component is clicked rather than dragged. */
  viewportCenterModelPosition() {
    return this._canvas.viewportCenterModelPosition();
  }

  /** Converts a viewport-relative pointer position (e.g. a drop event's clientX/Y) into model coordinates, for palette drag-and-drop. */
  clientPositionToModel(clientX, clientY) {
    return this._canvas.clientPositionToModel(clientX, clientY);
  }

  /** @returns {string} a PNG data URL of the current diagram. */
  exportPNG() {
    return this._canvas.exportPNG();
  }
}
