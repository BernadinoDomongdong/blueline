/**
 * sourcesPanel.js — owns the source-query list: paste/upload, add,
 * remove, and the "Infer lineage" action that calls /api/infer-lineage.
 */

import { api } from './api.js';
import { showToast } from './toast.js';

const DIALECT_BY_EXTENSION = { sql: 'sql', dax: 'dax', m: 'm' };
const MAX_SOURCES = 20;

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
      li.innerHTML = `
        <span class="source-item__dialect">${source.dialect}</span>
        <span class="source-item__name" title="${escapeHtml(source.name)}">${escapeHtml(source.name)}</span>
        <button type="button" class="source-item__remove" aria-label="Remove ${escapeHtml(source.name)}">✕</button>
      `;
      li.querySelector('.source-item__remove').addEventListener('click', () => this._removeSource(source.id));
      this.listEl.appendChild(li);
    }
    this.inferBtn.disabled = sources.length === 0;
  }

  async _handleInfer() {
    const { sources } = this.store.get();
    if (sources.length === 0) return;

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
