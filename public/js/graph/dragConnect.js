/**
 * dragConnect.js — the "Connect" tool: press-drag from a node's
 * connector handle to another node to create an edge, with a live
 * preview line while dragging. Stands in for cytoscape-edgehandles
 * (a dependency this rewrite drops along with cytoscape itself),
 * implemented directly against plain pointer events — no new
 * dependency added in its place.
 */

import { computeStraightPath } from './edgePath.js';

export class DragConnect {
  /**
   * @param {Object} deps
   * @param {HTMLElement} deps.viewportEl - the pannable/zoomable viewport; pointer coordinates are read relative to it
   * @param {SVGSVGElement} deps.svgEl - the edges layer; the live preview path is appended here
   * @param {() => {x: number, y: number, scale: number}} deps.getTransform
   * @param {(id: string) => {x: number, y: number, width: number, height: number} | undefined} deps.getNodeRect - model-space rect for a node id
   * @param {(sourceId: string, targetId: string) => boolean} deps.canConnect
   * @param {(sourceId: string, targetId: string) => void} deps.onComplete
   */
  constructor({ viewportEl, svgEl, getTransform, getNodeRect, canConnect, onComplete }) {
    this.viewportEl = viewportEl;
    this.svgEl = svgEl;
    this.getTransform = getTransform;
    this.getNodeRect = getNodeRect;
    this.canConnect = canConnect;
    this.onComplete = onComplete;

    this.enabled = false;
    this._sourceId = null;
    this._previewPath = null;
    this._targetEl = null;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this.viewportEl.addEventListener('pointerdown', this._onPointerDown);
    this.viewportEl.addEventListener('pointermove', this._onPointerMove);
    this.viewportEl.addEventListener('pointerup', this._onPointerUp);
    this.viewportEl.addEventListener('pointercancel', () => this._cancel());
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.viewportEl.classList.toggle('is-connecting', enabled);
    if (!enabled) this._cancel();
  }

  _onPointerDown(e) {
    if (!this.enabled) return;
    const handle = e.target.closest('.lineage-node__handle');
    const nodeEl = handle?.closest('.lineage-node');
    if (!nodeEl) return;
    e.stopPropagation();
    e.preventDefault();
    this._sourceId = nodeEl.dataset.id;
    this._previewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this._previewPath.setAttribute('class', 'lineage-edge lineage-edge--preview');
    this.svgEl.appendChild(this._previewPath);
    this.viewportEl.setPointerCapture(e.pointerId);
  }

  _onPointerMove(e) {
    if (!this._sourceId) return;
    const sourceRect = this.getNodeRect(this._sourceId);
    if (!sourceRect) return;
    const { x, y, scale } = this.getTransform();
    const rect = this.viewportEl.getBoundingClientRect();
    const p1 = { x: sourceRect.x + sourceRect.width, y: sourceRect.y + sourceRect.height / 2 };
    const p2 = { x: (e.clientX - rect.left - x) / scale, y: (e.clientY - rect.top - y) / scale };
    this._previewPath.setAttribute('d', computeStraightPath(p1, p2));

    const hoverEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.lineage-node') || null;
    if (this._targetEl && this._targetEl !== hoverEl) this._targetEl.classList.remove('is-connect-target');
    this._targetEl = null;
    if (hoverEl && hoverEl.dataset.id !== this._sourceId && this.canConnect(this._sourceId, hoverEl.dataset.id)) {
      hoverEl.classList.add('is-connect-target');
      this._targetEl = hoverEl;
    }
  }

  _onPointerUp(e) {
    if (!this._sourceId) return;
    const targetEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.lineage-node');
    const sourceId = this._sourceId;
    this._cancel();
    if (targetEl && targetEl.dataset.id !== sourceId && this.canConnect(sourceId, targetEl.dataset.id)) {
      this.onComplete(sourceId, targetEl.dataset.id);
    }
  }

  _cancel() {
    this._sourceId = null;
    this._targetEl?.classList.remove('is-connect-target');
    this._targetEl = null;
    this._previewPath?.remove();
    this._previewPath = null;
  }
}
