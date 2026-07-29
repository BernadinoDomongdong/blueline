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
import { EditMode } from './editMode.js';
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
const modelStampEl = document.getElementById('modelStamp');

function updateGraphUI(graph) {
  const hasGraph = graph.nodes.length > 0;
  emptyStateEl.style.display = hasGraph ? 'none' : '';
  fitBtn.disabled = !hasGraph;
  clearHighlightBtn.disabled = !hasGraph;
  importExport.setEnabled(hasGraph);
  reportPanel.setEnabled(hasGraph);
  graphStampEl.textContent = hasGraph ? `${graph.nodes.length} NODES · ${graph.edges.length} EDGES` : 'NO LINEAGE DRAWN';
}

// Full re-render: destroys and rebuilds the canvas, running an
// auto-layout unless the graph already carries positions (see
// GraphView.render). Used for AI inference and JSON import — cases
// where the incoming graph is a wholesale replacement, not an edit.
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

// Manual editing: add/edit/delete nodes and edges by hand, and
// drag-to-connect. Structural changes come back through onGraphSync
// rather than renderGraph(), so the canvas isn't destroyed/rebuilt
// (and positions/pan/zoom aren't disturbed) on every small edit.
new EditMode({
  graphView,
  onGraphSync: () => {
    const snapshot = graphView.getGraphSnapshot();
    const graph = { ...snapshot, metadata: store.get().graph.metadata };
    store.set({ graph });
    updateGraphUI(graph);
  },
});

// Initialize the canvas once at startup — even with an empty graph —
// so "Edit diagram → + Node" works immediately without requiring an
// AI inference or import first (the fully-manual path).
graphView.render(store.get().graph);
updateGraphUI(store.get().graph);

// Read-only confirmation of which LLM provider/model this deployment
// is configured to use (set via .env — see .env.example). Never
// exposes a key, just the provider + model id.
fetch('/api/model-info')
  .then((res) => (res.ok ? res.json() : null))
  .then((info) => {
    if (info && modelStampEl) modelStampEl.textContent = `Model: ${info.provider} · ${info.model}`;
  })
  .catch(() => {
    /* purely informational — a failed fetch just leaves the stamp blank */
  });
