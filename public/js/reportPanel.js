/**
 * reportPanel.js — the "Reports" tab. Calls /api/report, renders the
 * returned Markdown (via the marked CDN library loaded in index.html),
 * and offers a .md download.
 */

import { api } from './api.js';
import { showToast } from './toast.js';
import { getCredential } from './aiSettings.js';

export class ReportPanel {
  /** @param {Object} deps @param {ReturnType<typeof import('./state.js').createStore>} deps.store */
  constructor({ store }) {
    this.store = store;
    this.docBtn = document.getElementById('docReportBtn');
    this.impactBtn = document.getElementById('impactReportBtn');
    this.statusEl = document.getElementById('reportStatus');
    this.outputEl = document.getElementById('reportOutput');
    this.downloadBtn = document.getElementById('downloadReportBtn');

    this.lastMarkdown = '';
    this.lastType = '';

    this.docBtn.addEventListener('click', () => this._generate('documentation'));
    this.impactBtn.addEventListener('click', () => this._generate('impact'));
    this.downloadBtn.addEventListener('click', () => this._download());
  }

  setEnabled(enabled) {
    this.docBtn.disabled = !enabled;
    this.impactBtn.disabled = !enabled;
  }

  async _generate(reportType) {
    const { graph } = this.store.get();
    if (graph.nodes.length === 0) {
      showToast('Infer or import a lineage graph before generating a report.', 'error');
      return;
    }

    this.docBtn.disabled = true;
    this.impactBtn.disabled = true;
    this.downloadBtn.hidden = true;
    this._setStatus(`Writing ${reportType === 'impact' ? 'impact analysis' : 'documentation'}…`, 'working');
    this.outputEl.innerHTML = '';

    try {
      const { markdown } = await api.report(graph, reportType, getCredential());
      this.lastMarkdown = markdown;
      this.lastType = reportType;
      this.outputEl.innerHTML = window.marked ? window.marked.parse(markdown) : escapeHtml(markdown);
      this.downloadBtn.hidden = false;
      this._setStatus('Report ready.', 'done');
    } catch (err) {
      this._setStatus(err.message, 'error');
      showToast(err.message, 'error');
    } finally {
      this.docBtn.disabled = false;
      this.impactBtn.disabled = false;
    }
  }

  _download() {
    if (!this.lastMarkdown) return;
    const blob = new Blob([this.lastMarkdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blueline-${this.lastType || 'report'}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
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
