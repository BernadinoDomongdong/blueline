/**
 * main.js — composition root. Queries the DOM once, wires every module
 * together. No business logic lives here.
 */

import { createStore } from './state.js';
import { GraphView } from './graphView.js';
import { SourcesPanel } from './sourcesPanel.js';
import { Inspector } from './inspector.js';
import { ChatPanel } from './chatPanel.js';
import { ReportPanel } from './reportPanel.js';
import { ImportExport } from './importExport.js';
import { initTabs } from './tabs.js';

const store = createStore();
const graphView = new GraphView(document.getElementById('graphCanvas'));
const inspector = new Inspector({ store });
const reportPanel = new ReportPanel({ store });
const tabs = initTabs();

const emptyStateEl = document.getElementById('emptyState');
const graphStampEl = document.getElementById('graphStamp');
const fitBtn = document.getElementById('fitBtn');
const clearHighlightBtn = document.getElementById('clearHighlightBtn');

function updateGraphUI(graph) {
  const hasGraph = graph.nodes.length > 0;
  emptyStateEl.style.display = hasGraph ? 'none' : '';
  fitBtn.disabled = !hasGraph;
  clearHighlightBtn.disabled = !hasGraph;
  importExport.setEnabled(hasGraph);
  reportPanel.setEnabled(hasGraph);
  graphStampEl.textContent = hasGraph ? `${graph.nodes.length} NODES · ${graph.edges.length} EDGES` : 'NO LINEAGE DRAWN';
}

function renderGraph(graph) {
  graphView.render(graph);
  inspector.clear();
  updateGraphUI(graph);
}

const sourcesPanel = new SourcesPanel({
  store,
  onInferred: (graph) => renderGraph(graph),
});

const importExport = new ImportExport({
  store,
  graphView,
  onImported: (graph) => renderGraph(graph),
});

new ChatPanel({ store });

graphView.onNodeSelect((nodeId) => {
  inspector.show(nodeId);
  tabs.activate('inspector');
});

fitBtn.addEventListener('click', () => graphView.fit());
clearHighlightBtn.addEventListener('click', () => {
  graphView.clearHighlight();
  inspector.clear();
});

updateGraphUI(store.get().graph);
