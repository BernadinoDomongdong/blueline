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
import { initAiSettings } from './aiSettings.js';
import { initTabs } from './tabs.js';
import { initTheme } from './theme.js';
import { initClock } from './clock.js';
import { initHelp } from './help.js';
import { initFullscreen } from './fullscreen.js';
import { DEMO_GRAPH } from './demoData.js';
import { normalizeGraph } from './graphSchema.js';
import { showToast } from './toast.js';

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
// GraphView.render). Used for lineage extraction and JSON import —
// cases where the incoming graph is a wholesale replacement, not an edit.
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

// Demo: drops in a small bundled sample graph so the app can be tried
// before pasting anything real. Same confirm-before-overwrite guard
// as re-running inference, since it's the same kind of destructive
// wholesale replacement.
const emptyStateDemoBtn = document.getElementById('emptyStateDemoBtn');
emptyStateDemoBtn?.addEventListener('click', () => {
  const { graph } = store.get();
  if (graph.nodes.length > 0) {
    const proceed = window.confirm(
      `This will replace the current diagram (${graph.nodes.length} nodes, ${graph.edges.length} edges) with the demo graph. Any work will be lost. Continue?`
    );
    if (!proceed) return;
  }
  try {
    renderGraph(normalizeGraph(DEMO_GRAPH));
    showToast('Demo lineage loaded — click around, or clear it and start your own.');
  } catch (err) {
    showToast(`Could not load the demo: ${err.message}`, 'error');
  }
});

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
// so "Edit diagram → + Node" works immediately without requiring
// lineage extraction or import first (the fully-manual path).
graphView.render(store.get().graph);
updateGraphUI(store.get().graph);

// Dark/light toggle — refreshes the already-drawn canvas's colors in
// place (not just new CSS) so a mid-session toggle doesn't leave a
// rendered graph on the old theme until the next full re-render.
initTheme({ onChange: () => graphView.refreshTheme() });
initClock();
initHelp();
initFullscreen(graphView);

// Bring-your-own-key settings for the optional Ask AI / Reports
// features (lineage extraction never uses this). The credential
// lives client-side only — see aiSettings.js.
initAiSettings();

// Read-only confirmation of which LLM provider/model this deployment
// itself defaults to (set via .env — see .env.example), shown for
// context even though a visitor's own AI settings (if they set any)
// take precedence for their own requests. Never exposes a key.
api
  .modelInfo()
  .then((info) => {
    if (!modelStampEl) return;
    modelStampEl.textContent = info.provider
      ? `Deployment default: ${info.provider} · ${info.model}`
      : 'No deployment-wide AI configured — bring your own key above';
  })
  .catch(() => {
    /* purely informational — a failed fetch just leaves the stamp blank */
  });
