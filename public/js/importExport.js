/**
 * importExport.js — the "output export and import data" piece: saves
 * the current lineage graph as JSON (round-trippable) or CSV (for
 * Excel/Power BI review), exports a PNG snapshot of the diagram, and
 * loads a previously exported JSON graph back in.
 */

import { normalizeGraph } from './graphSchema.js';
import { showToast } from './toast.js';

function downloadBlob(content, filename, mimeType) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/data:(.*);base64/)?.[1] || 'image/png';
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function csvEscape(value) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export class ImportExport {
  /**
   * @param {Object} deps
   * @param {ReturnType<typeof import('./state.js').createStore>} deps.store
   * @param {import('./graph/graphView.js').GraphView} deps.graphView
   * @param {(graph: Object) => void} deps.onImported
   */
  constructor({ store, graphView, onImported }) {
    this.store = store;
    this.graphView = graphView;
    this.onImported = onImported;

    document.getElementById('exportJsonBtn').addEventListener('click', () => this._exportJson());
    document.getElementById('exportCsvBtn').addEventListener('click', () => this._exportCsv());
    document.getElementById('exportPngBtn').addEventListener('click', () => this._exportPng());
    document.getElementById('importInput').addEventListener('change', (e) => this._importJson(e));
  }

  setEnabled(enabled) {
    document.getElementById('exportJsonBtn').disabled = !enabled;
    document.getElementById('exportCsvBtn').disabled = !enabled;
    document.getElementById('exportPngBtn').disabled = !enabled;
  }

  _exportJson() {
    const { graph } = this.store.get();
    if (!graph.nodes.length) return;
    // Pulled live from the canvas (not straight from state) so that any
    // manual repositioning — dragging nodes around after extraction,
    // import, or manual editing — is captured in the export too.
    const snapshot = this.graphView.getGraphSnapshot();
    const exported = { ...snapshot, metadata: graph.metadata };
    downloadBlob(JSON.stringify(exported, null, 2), `blueline-lineage-${Date.now()}.json`, 'application/json');
    showToast('Lineage graph exported as JSON.');
  }

  _exportCsv() {
    const { graph } = this.store.get();
    if (!graph.edges.length) {
      showToast('This graph has no edges to export.', 'error');
      return;
    }
    const rows = [['source', 'target', 'type', 'confidence', 'transformation']];
    for (const e of graph.edges) {
      rows.push([e.source, e.target, e.type, e.confidence, e.transformation]);
    }
    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
    downloadBlob(csv, `blueline-lineage-edges-${Date.now()}.csv`, 'text/csv');
    showToast('Lineage edges exported as CSV.');
  }

  _exportPng() {
    if (this.graphView.isEmpty()) return;
    const dataUrl = this.graphView.exportPNG();
    downloadBlob(dataUrlToBlob(dataUrl), `blueline-diagram-${Date.now()}.png`, 'image/png');
    showToast('Diagram exported as PNG.');
  }

  async _importJson(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const graph = normalizeGraph(raw);

      const current = this.store.get().graph;
      if (current.nodes.length > 0) {
        const proceed = window.confirm(
          `This will replace the current diagram (${current.nodes.length} nodes, ${current.edges.length} edges) with the imported file. Continue?`
        );
        if (!proceed) return;
      }

      this.store.set({ graph });
      this.onImported(graph);
      showToast(`Imported ${graph.nodes.length} nodes, ${graph.edges.length} edges.`);
    } catch (err) {
      showToast(`Could not import that file: ${err.message}`, 'error');
    }
  }
}
