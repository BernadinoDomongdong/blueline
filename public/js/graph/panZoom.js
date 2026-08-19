/**
 * panZoom.js — pointer-driven pan and wheel/button zoom for a single
 * CSS-transformed layer. Knows nothing about nodes, edges, or
 * lineage — it just maps pointer/wheel events on a viewport element
 * into a translate+scale transform on a target element. Reusable
 * anywhere a pannable/zoomable surface is needed.
 */

import { ZOOM_MIN, ZOOM_MAX } from './constants.js';

export class PanZoom {
  /**
   * @param {HTMLElement} viewportEl - receives pointer/wheel events
   * @param {HTMLElement} transformEl - gets the CSS transform applied
   * @param {Object} [opts]
   * @param {(state: {x: number, y: number, scale: number}) => void} [opts.onChange]
   * @param {string} [opts.ignoreSelector] - pointerdown targets matching this never start a pan (e.g. a node card, so dragging a node doesn't also pan the canvas)
   */
  constructor(viewportEl, transformEl, opts = {}) {
    this.viewportEl = viewportEl;
    this.transformEl = transformEl;
    this.onChange = opts.onChange;
    this.ignoreSelector = opts.ignoreSelector || null;

    this.x = 0;
    this.y = 0;
    this.scale = 1;
    this.enabled = true;

    this._dragging = false;
    this._start = { x: 0, y: 0, panX: 0, panY: 0 };

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._wire();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  _wire() {
    this.viewportEl.addEventListener('pointerdown', this._onPointerDown);
    this.viewportEl.addEventListener('pointermove', this._onPointerMove);
    this.viewportEl.addEventListener('pointerup', this._onPointerUp);
    this.viewportEl.addEventListener('pointercancel', this._onPointerUp);
    this.viewportEl.addEventListener('wheel', this._onWheel, { passive: false });
  }

  _onPointerDown(e) {
    if (!this.enabled) return;
    if (this.ignoreSelector && e.target.closest(this.ignoreSelector)) return;
    if (e.button !== undefined && e.button !== 0) return;
    this._dragging = true;
    this._start = { x: e.clientX, y: e.clientY, panX: this.x, panY: this.y };
    this.viewportEl.setPointerCapture(e.pointerId);
    this.viewportEl.classList.add('is-panning');
  }

  _onPointerMove(e) {
    if (!this._dragging) return;
    this.x = this._start.panX + (e.clientX - this._start.x);
    this.y = this._start.panY + (e.clientY - this._start.y);
    this._apply();
  }

  _onPointerUp() {
    this._dragging = false;
    this.viewportEl.classList.remove('is-panning');
  }

  _onWheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    const rect = this.viewportEl.getBoundingClientRect();
    this._zoomAt(this.scale + (e.deltaY < 0 ? 0.08 : -0.08), e.clientX - rect.left, e.clientY - rect.top);
  }

  /** Zooms while keeping the given viewport-relative point visually fixed under the cursor. */
  _zoomAt(nextScale, px, py) {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, nextScale));
    const modelX = (px - this.x) / this.scale;
    const modelY = (py - this.y) / this.scale;
    this.scale = clamped;
    this.x = px - modelX * this.scale;
    this.y = py - modelY * this.scale;
    this._apply();
  }

  setZoom(next) {
    const rect = this.viewportEl.getBoundingClientRect();
    this._zoomAt(next, rect.width / 2, rect.height / 2);
  }

  zoomIn(step = 0.1) {
    this.setZoom(this.scale + step);
  }

  zoomOut(step = 0.1) {
    this.setZoom(this.scale - step);
  }

  /** Positions & scales so `bounds` (model space) fits inside the viewport, with padding. */
  fit(bounds, padding = 40) {
    const rect = this.viewportEl.getBoundingClientRect();
    if (!bounds || rect.width === 0 || rect.height === 0) return;
    const w = Math.max(bounds.width, 1);
    const h = Math.max(bounds.height, 1);
    const scale = Math.max(
      ZOOM_MIN,
      Math.min(ZOOM_MAX, Math.min((rect.width - padding * 2) / w, (rect.height - padding * 2) / h))
    );
    this.scale = scale;
    this.x = rect.width / 2 - (bounds.x + w / 2) * scale;
    this.y = rect.height / 2 - (bounds.y + h / 2) * scale;
    this._apply();
  }

  /** Viewport-relative client coordinates → model coordinates (for click/drop positioning). */
  clientToModel(clientX, clientY) {
    const rect = this.viewportEl.getBoundingClientRect();
    return { x: (clientX - rect.left - this.x) / this.scale, y: (clientY - rect.top - this.y) / this.scale };
  }

  /** Model coordinates for the point currently at the center of the viewport. */
  centerModelPosition() {
    const rect = this.viewportEl.getBoundingClientRect();
    return this.clientToModel(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  _apply() {
    this.transformEl.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.scale})`;
    this.onChange?.({ x: this.x, y: this.y, scale: this.scale });
  }
}
