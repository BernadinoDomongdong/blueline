/**
 * sourcesPanel.js — owns the source-query list: paste/upload, add,
 * remove, and the "Infer lineage" action that calls /api/infer-lineage.
 */

import { api } from './api.js';
import { showToast } from './toast.js';

const DIALECT_BY_EXTENSION = { sql: 'sql', dax: 'dax', m: 'm' };
const MAX_SOURCES = 20;

// Custom drag MIME so main.js's canvas drop handler can tell a
// dragged source chip apart from editMode's own palette drags (which
// use plain 'text/plain' node-type strings like "table"/"column").
export const SOURCE_DRAG_MIME = 'application/x-blueline-source-id';

function makeId() {
  return window.crypto?.randomUUID ? window.crypto.randomUUID() : `src_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export class SourcesPanel {
  /**
   * @param {Object} deps
   * @param {import('./state.js').createStore extends () => infer S ? S : never} deps.store
   * @param {(graph: Object, warnings: string[]) => void} deps.onInferred
   */
  constructor({ store, onInferred }) {
    this.store = store;
    this.onInferred = onInferred;

    this.listEl = document.getElementById('sourceList');
    this.formEl = document.getElementById('sourceForm');
    this.nameEl = document.getElementById('sourceName');
    this.dialectEl = document.getElementById('sourceDialect');
    this.contentEl = document.getElementById('sourceContent');
    this.fileEl = document.getElementById('sourceFile');
    this.inferBtn = document.getElementById('inferBtn');
    this.statusEl = document.getElementById('inferStatus');

    this.formEl.addEventListener('submit', (e) => this._handleFormSubmit(e));
    this.fileEl.addEventListener('change', (e) => this._handleFileUpload(e));
    this.inferBtn.addEventListener('click', () => this._handleInfer());
  }

  _handleFormSubmit(e) {
    e.preventDefault();
    const content = this.contentEl.value.trim();
    if (!content) {
      showToast('Paste a query before adding a source.', 'error');
      return;
    }
    const name = this.nameEl.value.trim() || `source-${this.store.get().sources.length + 1}`;
    this._addSource({ id: makeId(), name, dialect: this.dialectEl.value, content });
    this.formEl.reset();
  }

  async _handleFileUpload(e) {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      try {
        const content = await file.text();
        if (!content.trim()) continue;
        const ext = file.name.split('.').pop()?.toLowerCase();
        this._addSource({
          id: makeId(),
          name: file.name,
          dialect: DIALECT_BY_EXTENSION[ext] || 'other',
          content,
        });
      } catch {
        showToast(`Could not read "${file.name}".`, 'error');
      }
    }
    this.fileEl.value = '';
  }

  _addSource(source) {
    const { sources } = this.store.get();
    if (sources.length >= MAX_SOURCES) {
      showToast(`Blueline processes up to ${MAX_SOURCES} sources at a time.`, 'error');
      return;
    }
    this.store.set({ sources: [...sources, source] });
    this._renderList();
  }

  _removeSource(id) {
    const { sources } = this.store.get();
    this.store.set({ sources: sources.filter((s) => s.id !== id) });
    this._renderList();
  }

  _renderList() {
    const { sources } = this.store.get();
    this.listEl.innerHTML = '';
    for (const source of sources) {
      const li = document.createElement('li');
      li.className = 'source-item';
      li.draggable = true;
      li.title = 'Drag onto the canvas to add just this table, or use "Infer lineage" below to trace all sources at once.';
      li.innerHTML = `
        <span class="source-item__dialect">${source.dialect}</span>
        <span class="source-item__name" title="${escapeHtml(source.name)}">${escapeHtml(source.name)}</span>
        <button type="button" class="source-item__remove" aria-label="Remove ${escapeHtml(source.name)}">✕</button>
      `;
      li.querySelector('.source-item__remove').addEventListener('click', () => this._removeSource(source.id));
      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData(SOURCE_DRAG_MIME, source.id);
        e.dataTransfer.effectAllowed = 'copy';
        li.classList.add('source-item--drag-active');
      });
      li.addEventListener('dragend', () => li.classList.remove('source-item--drag-active'));
      this.listEl.appendChild(li);
    }
    this.inferBtn.disabled = sources.length === 0;
  }

  async _handleInfer() {
    const { sources, graph } = this.store.get();
    if (sources.length === 0) return;

    if (graph.nodes.length > 0) {
      const proceed = window.confirm(
        `This will replace the current diagram (${graph.nodes.length} nodes, ${graph.edges.length} edges) with freshly-inferred lineage. Any manual edits will be lost. Continue?`
      );
      if (!proceed) return;
    }

    this.inferBtn.disabled = true;
    this._setStatus('Tracing lineage…', 'working');

    try {
      const payload = sources.map(({ name, dialect, content }) => ({ name, dialect, content }));
      const { graph, warnings } = await api.inferLineage(payload);
      this.store.set({ graph });
      this._setStatus(`Traced ${graph.nodes.length} nodes, ${graph.edges.length} edges.`, 'done');
      if (warnings?.length) {
        showToast(`Lineage traced with ${warnings.length} note(s) — check the console for details.`, 'info');
        console.warn('Blueline: graph validation notes', warnings);
      }
      this.onInferred(graph, warnings || []);
    } catch (err) {
      this._setStatus(err.message, 'error');
      showToast(err.message, 'error');
    } finally {
      this.inferBtn.disabled = false;
    }
  }

  /**
   * Traces lineage for one already-added source on its own, without
   * touching the rest of the diagram or the "this will replace
   * everything" confirm that _handleInfer uses below — this is what
   * backs dragging a single source chip onto the canvas (see
   * main.js), where the caller merges the result in alongside
   * whatever's already drawn instead of replacing it.
   * @param {string} sourceId
   * @returns {Promise<{graph: Object, warnings: string[]}>}
   */
  async inferSingleSource(sourceId) {
    const source = this.store.get().sources.find((s) => s.id === sourceId);
    if (!source) throw new Error('That source is no longer in the list.');
    const { name, dialect, content } = source;
    return api.inferLineage([{ name, dialect, content }]);
  }

  _setStatus(message, state) {
    this.statusEl.textContent = message;
    this.statusEl.dataset.state = state;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
