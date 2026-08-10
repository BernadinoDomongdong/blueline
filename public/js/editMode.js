/**
 * editMode.js — manual diagram editing: add/edit/delete nodes and
 * edges by hand, and a drag-to-connect "Connect" tool, as an
 * alternative (or a complement) to automatically-traced lineage.
 * Nothing here calls any LLM — this is the fully-manual path the
 * README promises:
 * "the diagram is fully hand-editable, whether or not any of it was
 * traced automatically first."
 *
 * Structural changes (add/edit/delete) are synced back into app state
 * via the onGraphSync callback so the Inspect/Ask AI/Reports tabs and
 * the node/edge counter stay accurate. Repositioning a node by
 * dragging it needs no sync — position is read live off the canvas
 * wherever it's needed (see graphView.getGraphSnapshot / ImportExport).
 */

import { NODE_TYPE_OPTIONS, EDGE_TYPE_OPTIONS, CONFIDENCE_OPTIONS } from './graphSchema.js';
import { showToast } from './toast.js';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function optionsHtml(values, selected) {
  return values.map((v) => `<option value="${v}"${v === selected ? ' selected' : ''}>${v}</option>`).join('');
}

function isTypingTarget(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export class EditMode {
  /**
   * @param {Object} deps
   * @param {import('./graphView.js').GraphView} deps.graphView
   * @param {() => void} deps.onGraphSync - called after any structural add/edit/delete so the caller can re-read graphView.getGraphSnapshot() into app state.
   */
  constructor({ graphView, onGraphSync }) {
    this.graphView = graphView;
    this.onGraphSync = onGraphSync;

    this.isEditing = false;
    this.isConnecting = false;

    this.toggleBtn = document.getElementById('editModeToggle');
    this.addNodeBtn = document.getElementById('addNodeBtn');
    this.addEdgeBtn = document.getElementById('addEdgeBtn');
    this.connectBtn = document.getElementById('connectModeBtn');
    this.deleteBtn = document.getElementById('deleteElementBtn');
    this.editHint = document.getElementById('editModeHint');
    this.emptyStateManualBtn = document.getElementById('emptyStateManualBtn');

    this.modalOverlay = document.getElementById('editModal');
    this.modalTitle = document.getElementById('editModalTitle');
    this.modalBody = document.getElementById('editModalBody');
    this.modalCloseBtn = document.getElementById('editModalClose');

    this._wire();
    this._updateToolbarState();
  }

  _wire() {
    this.toggleBtn.addEventListener('click', () => this.setEditing(!this.isEditing));
    this.addNodeBtn.addEventListener('click', () => this._openNodeForm(null));
    this.addEdgeBtn.addEventListener('click', () => this._openEdgeForm(null));
    this.connectBtn.addEventListener('click', () => this._toggleConnectMode());
    this.deleteBtn.addEventListener('click', () => this._deleteSelected());
    this.modalCloseBtn.addEventListener('click', () => this._closeModal());
    this.modalOverlay.addEventListener('click', (e) => {
      if (e.target === this.modalOverlay) this._closeModal();
    });
    this.emptyStateManualBtn?.addEventListener('click', () => {
      this.setEditing(true);
      this._openNodeForm(null);
    });

    this.graphView.onNodeDblTap((id) => {
      if (this.isEditing) this._openNodeForm(id);
      else showToast('Turn on "Edit diagram" to modify nodes.');
    });
    this.graphView.onEdgeDblTap((id) => {
      if (this.isEditing) this._openEdgeForm(id);
      else showToast('Turn on "Edit diagram" to modify edges.');
    });
    this.graphView.onEdgeCreated((id) => {
      // A drag-connected edge is created with sensible defaults
      // immediately (see graphView._initEdgehandles) — open it for
      // editing right away so type/confidence/transformation can be
      // set without a second trip to the toolbar.
      this._syncGraph();
      this._openEdgeForm(id, { justCreated: true });
    });
    this.graphView.onNodeSelect(() => this._updateToolbarState());
    this.graphView.onEdgeSelect(() => this._updateToolbarState());
    this.graphView.onSelectionCleared(() => this._updateToolbarState());

    document.addEventListener('keydown', (e) => {
      if (!this.isEditing) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isTypingTarget(document.activeElement)) {
        if (this.graphView.getSelection()) {
          e.preventDefault();
          this._deleteSelected();
        }
      }
      if (e.key === 'Escape' && !this.modalOverlay.hidden) {
        this._closeModal();
      }
    });
  }

  setEditing(on) {
    this.isEditing = on;
    if (!on) this.setConnectMode(false);
    this.toggleBtn.classList.toggle('btn--active', on);
    this.toggleBtn.setAttribute('aria-pressed', String(on));
    document.getElementById('editToolGroup').hidden = !on;
    if (this.editHint) this.editHint.hidden = !on;
    this._updateToolbarState();
  }

  _toggleConnectMode() {
    this.setConnectMode(!this.isConnecting);
  }

  setConnectMode(on) {
    this.isConnecting = on;
    this.graphView.setConnectMode(on);
    this.connectBtn.classList.toggle('btn--active', on);
    this.connectBtn.setAttribute('aria-pressed', String(on));
  }

  _updateToolbarState() {
    const nodeCount = this.graphView.listNodes().length;
    this.addEdgeBtn.disabled = nodeCount < 2;
    this.connectBtn.disabled = nodeCount < 2;
    this.deleteBtn.disabled = !this.graphView.getSelection();
  }

  _deleteSelected() {
    const sel = this.graphView.getSelection();
    if (!sel) return;
    if (sel.type === 'node') this._deleteNodeWithUndo(sel.id);
    else this._deleteEdgeWithUndo(sel.id);
    this._updateToolbarState();
  }

  /**
   * Deletes a node (and, via cytoscape's own cascade, every edge
   * touching it) and offers a one-tap Undo that restores both the
   * node and those edges — a plain "undo the node" that silently
   * dropped its connections would be a worse surprise than no undo at
   * all, so both are captured before removal and both come back.
   */
  _deleteNodeWithUndo(id) {
    const nodeData = this.graphView.getNodeData(id);
    const position = this.graphView.getNodePosition(id);
    const connectedEdges = this.graphView.getConnectedEdgesData(id);
    if (!nodeData) return;

    this.graphView.removeElement(id);
    this._syncGraph();

    showToast('Node deleted.', 'info', {
      label: 'Undo',
      onClick: () => {
        try {
          this.graphView.addNode(nodeData, position);
          for (const edgeData of connectedEdges) {
            if (this.graphView.hasElement(edgeData.source) && this.graphView.hasElement(edgeData.target)) {
              this.graphView.addEdge(edgeData);
            }
          }
          this._syncGraph();
          showToast('Node restored.');
        } catch (err) {
          showToast(`Could not undo: ${err.message}`, 'error');
        }
      },
    });
  }

  _deleteEdgeWithUndo(id) {
    const edgeData = this.graphView.getEdgeData(id);
    if (!edgeData) return;

    this.graphView.removeElement(id);
    this._syncGraph();

    showToast('Edge deleted.', 'info', {
      label: 'Undo',
      onClick: () => {
        try {
          this.graphView.addEdge(edgeData);
          this._syncGraph();
          showToast('Edge restored.');
        } catch (err) {
          showToast(`Could not undo: ${err.message}`, 'error');
        }
      },
    });
  }

  /** Reads the live canvas back into app state and refreshes the UI (counts, Inspect/Ask/Reports enablement) without re-rendering the canvas itself. */
  _syncGraph() {
    this.onGraphSync();
    this._updateToolbarState();
  }

  // ─── Node add/edit modal ────────────────────────────────────────

  _openNodeForm(nodeId) {
    const existing = nodeId ? this.graphView.getNodeData(nodeId) : null;
    this.modalTitle.textContent = existing ? 'Edit node' : 'Add node';
    this.modalBody.innerHTML = `
      <form id="nodeForm" class="modal-form">
        <label class="field">
          <span class="field__label">ID</span>
          <input type="text" id="nfId" maxlength="200" value="${escapeHtml(existing?.id || '')}" ${existing ? 'disabled' : ''} placeholder="e.g. dbo.CustomerSummary" />
        </label>
        <label class="field">
          <span class="field__label">Label</span>
          <input type="text" id="nfLabel" maxlength="200" value="${escapeHtml(existing?.label || '')}" placeholder="Defaults to ID if left blank" />
        </label>
        <label class="field">
          <span class="field__label">Type</span>
          <select id="nfType">${optionsHtml(NODE_TYPE_OPTIONS, existing?.type || 'table')}</select>
        </label>
        <label class="field">
          <span class="field__label">Confidence</span>
          <select id="nfConfidence">${optionsHtml(CONFIDENCE_OPTIONS, existing?.confidence || 'high')}</select>
        </label>
        <label class="field">
          <span class="field__label">Description</span>
          <textarea id="nfDescription" rows="3" maxlength="500" placeholder="Optional">${escapeHtml(existing?.description || '')}</textarea>
        </label>
        <div class="modal-actions">
          ${existing ? '<button type="button" id="nfDelete" class="btn btn--ghost modal-actions__delete">Delete node</button>' : '<span></span>'}
          <div class="modal-actions__right">
            <button type="button" id="nfCancel" class="btn btn--ghost">Cancel</button>
            <button type="submit" class="btn btn--primary">${existing ? 'Save' : 'Add node'}</button>
          </div>
        </div>
      </form>
    `;
    this._openModal();

    const form = document.getElementById('nodeForm');
    document.getElementById('nfCancel').addEventListener('click', () => this._closeModal());
    document.getElementById('nfDelete')?.addEventListener('click', () => {
      this._deleteNodeWithUndo(existing.id);
      this._closeModal();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._submitNodeForm(existing);
    });
    document.getElementById(existing ? 'nfLabel' : 'nfId').focus();
  }

  _submitNodeForm(existing) {
    const label = document.getElementById('nfLabel').value.trim();
    const type = document.getElementById('nfType').value;
    const confidence = document.getElementById('nfConfidence').value;
    const description = document.getElementById('nfDescription').value.trim();

    if (existing) {
      this.graphView.updateNode(existing.id, {
        label: label || existing.id,
        type,
        confidence,
        description,
      });
      showToast('Node updated.');
    } else {
      const id = document.getElementById('nfId').value.trim();
      if (!id) {
        showToast('Give the node an ID before adding it.', 'error');
        return;
      }
      if (this.graphView.hasElement(id)) {
        showToast(`A node with ID "${id}" already exists.`, 'error');
        return;
      }
      try {
        this.graphView.addNode({ id, label: label || id, type, confidence, description });
      } catch (err) {
        showToast(err.message, 'error');
        return;
      }
      showToast('Node added.');
    }
    this._syncGraph();
    this._closeModal();
  }

  // ─── Edge add/edit modal ────────────────────────────────────────

  /**
   * @param {string|null} edgeId - null for a brand-new, form-based edge.
   * @param {{justCreated?: boolean}} [opts] - justCreated=true means this edge was already added to the canvas by a drag-to-connect gesture; the modal is just there to fill in its details (Cancel here removes it rather than leaving an unset edge behind).
   */
  _openEdgeForm(edgeId, opts = {}) {
    const existing = edgeId ? this.graphView.getEdgeData(edgeId) : null;
    const nodes = this.graphView.listNodes();
    const isNewByForm = !existing && !opts.justCreated;

    this.modalTitle.textContent = opts.justCreated ? 'New edge' : existing ? 'Edit edge' : 'Add edge';
    const sourceTargetHtml = isNewByForm
      ? `
        <label class="field">
          <span class="field__label">Source</span>
          <select id="efSource">${nodes.map((n) => `<option value="${n.id}">${escapeHtml(n.label)}</option>`).join('')}</select>
        </label>
        <label class="field">
          <span class="field__label">Target</span>
          <select id="efTarget">${nodes.map((n) => `<option value="${n.id}">${escapeHtml(n.label)}</option>`).join('')}</select>
        </label>
      `
      : `<p class="modal-form__readonly">${escapeHtml(this._labelFor(existing.source))} → ${escapeHtml(this._labelFor(existing.target))}</p>`;

    this.modalBody.innerHTML = `
      <form id="edgeForm" class="modal-form">
        ${sourceTargetHtml}
        <label class="field">
          <span class="field__label">Type</span>
          <select id="efType">${optionsHtml(EDGE_TYPE_OPTIONS, existing?.type || 'direct')}</select>
        </label>
        <label class="field">
          <span class="field__label">Confidence</span>
          <select id="efConfidence">${optionsHtml(CONFIDENCE_OPTIONS, existing?.confidence || 'high')}</select>
        </label>
        <label class="field">
          <span class="field__label">Transformation</span>
          <input type="text" id="efTransformation" maxlength="300" value="${escapeHtml(existing?.transformation || '')}" placeholder="Optional — e.g. SUM(OrderTotal)" />
        </label>
        <div class="modal-actions">
          ${
            existing || opts.justCreated
              ? `<button type="button" id="efDelete" class="btn btn--ghost modal-actions__delete">Delete edge</button>`
              : '<span></span>'
          }
          <div class="modal-actions__right">
            <button type="button" id="efCancel" class="btn btn--ghost">${opts.justCreated ? 'Remove edge' : 'Cancel'}</button>
            <button type="submit" class="btn btn--primary">${existing || opts.justCreated ? 'Save' : 'Add edge'}</button>
          </div>
        </div>
      </form>
    `;
    this._openModal();

    const form = document.getElementById('edgeForm');
    const edgeIdForDelete = existing?.id || (opts.justCreated ? edgeId : null);

    document.getElementById('efCancel').addEventListener('click', () => {
      // A just-created drag-connected edge shouldn't linger half-configured if the person backs out.
      if (opts.justCreated && edgeIdForDelete) {
        this.graphView.removeElement(edgeIdForDelete);
        this._syncGraph();
      }
      this._closeModal();
    });
    document.getElementById('efDelete')?.addEventListener('click', () => {
      this._deleteEdgeWithUndo(edgeIdForDelete);
      this._closeModal();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._submitEdgeForm(existing, edgeId, opts);
    });
  }

  _submitEdgeForm(existing, edgeId, opts) {
    const type = document.getElementById('efType').value;
    const confidence = document.getElementById('efConfidence').value;
    const transformation = document.getElementById('efTransformation').value.trim();

    if (existing || opts.justCreated) {
      this.graphView.updateEdge(existing?.id || edgeId, { type, confidence, transformation });
      showToast('Edge saved.');
    } else {
      const source = document.getElementById('efSource').value;
      const target = document.getElementById('efTarget').value;
      if (source === target) {
        showToast('Source and target must be different nodes.', 'error');
        return;
      }
      try {
        this.graphView.addEdge({ source, target, type, confidence, transformation });
      } catch (err) {
        showToast(err.message, 'error');
        return;
      }
      showToast('Edge added.');
    }
    this._syncGraph();
    this._closeModal();
  }

  _labelFor(nodeId) {
    return this.graphView.getNodeData(nodeId)?.label || nodeId;
  }

  // ─── Modal plumbing ─────────────────────────────────────────────

  _openModal() {
    this.modalOverlay.hidden = false;
  }

  _closeModal() {
    this.modalOverlay.hidden = true;
    this.modalBody.innerHTML = '';
  }
}
