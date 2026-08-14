/**
 * main.js — composition root. Queries the DOM once, wires every module
 * together. No business logic lives here.
 */

import { createStore } from './state.js';
import { GraphView } from './graphView.js';
import { SourcesPanel, SOURCE_DRAG_MIME } from './sourcesPanel.js';
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
import { api } from './api.js';

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

// Drag a source chip from the Sources list onto the canvas to trace
// and merge in just that one source, alongside whatever's already
// drawn. Unlike the "Infer lineage" button above (which always
// replaces the whole diagram and confirms before doing so), this is
// purely additive: nodes/edges already on the canvas are left alone,
// and nothing already-inferred or hand-edited is at risk.
const canvasWrapEl = document.querySelector('.canvas-wrap');

function mergeInferredGraph(incoming, dropPosition) {
  let addedNodes = 0;
  let addedEdges = 0;
  const angleStep = incoming.nodes.length > 1 ? (2 * Math.PI) / incoming.nodes.length : 0;
  const radius = 70;
  incoming.nodes.forEach((n, i) => {
    if (graphView.hasElement(n.id)) return; // already on the diagram — leave it exactly as it is
    const { position, ...data } = n;
    const pos =
      position ||
      { x: dropPosition.x + radius * Math.cos(angleStep * i), y: dropPosition.y + radius * Math.sin(angleStep * i) };
    graphView.addNode(data, pos);
    addedNodes += 1;
  });
  for (const e of incoming.edges) {
    if (!graphView.hasElement(e.source) || !graphView.hasElement(e.target)) continue;
    if (graphView.hasEdgeBetween(e.source, e.target)) continue; // don't draw the same connection twice
    graphView.addEdge(e);
    addedEdges += 1;
  }
  const graph = { ...graphView.getGraphSnapshot(), metadata: store.get().graph.metadata };
  store.set({ graph });
  updateGraphUI(graph);
  return { nodes: addedNodes, edges: addedEdges };
}

if (canvasWrapEl) {
  canvasWrapEl.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes(SOURCE_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    canvasWrapEl.classList.add('canvas-wrap--drop-active');
  });

  canvasWrapEl.addEventListener('dragleave', (e) => {
    // relatedTarget is where the pointer is headed — only clear the
    // highlight once it's left canvasWrap entirely, not just crossed
    // from one child (e.g. the empty-state overlay) to another.
    if (!canvasWrapEl.contains(e.relatedTarget)) {
      canvasWrapEl.classList.remove('canvas-wrap--drop-active');
    }
  });

  canvasWrapEl.addEventListener('drop', async (e) => {
    canvasWrapEl.classList.remove('canvas-wrap--drop-active');
    const sourceId = e.dataTransfer.getData(SOURCE_DRAG_MIME);
    if (!sourceId) return;
    e.preventDefault();

    const dropPosition = graphView.clientPositionToModel(e.clientX, e.clientY);
    try {
      const { graph, warnings } = await sourcesPanel.inferSingleSource(sourceId);
      if (graph.nodes.length === 0) {
        showToast('Nothing could be traced from that source on its own.', 'error');
        return;
      }
      const added = mergeInferredGraph(graph, dropPosition);
      showToast(
        added.nodes || added.edges
          ? `Added ${added.nodes} node(s) and ${added.edges} edge(s) from this source.`
          : 'That source is already fully represented on the diagram.'
      );
      if (warnings?.length) {
        showToast(`Traced with ${warnings.length} note(s) — check the console.`, 'info');
        console.warn('Blueline: graph validation notes', warnings);
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

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
