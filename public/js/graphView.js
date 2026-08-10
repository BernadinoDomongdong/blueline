/**
 * graphView.js — owns the cytoscape instance: rendering, layout,
 * click-to-highlight upstream/downstream, PNG export, and — for the
 * manual-editing feature — direct mutation of the live graph (add/
 * update/remove nodes and edges) plus a drag-to-connect "connector"
 * tool via the cytoscape-edgehandles extension.
 *
 * Edge line style encodes meaning, not decoration: solid = high-
 * confidence (confirmed) lineage, dashed = medium/low-confidence
 * (automatically-traced but not yet verified) — the same convention an engineer
 * uses penciling in an unconfirmed detail on a blueprint. A manually
 * added node or edge defaults to "high" confidence, since a human
 * asserted it directly rather than it being traced automatically.
 */

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function makeEdgeId() {
  return window.crypto?.randomUUID ? `e_${window.crypto.randomUUID()}` : `e_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

const NODE_SHAPES = {
  table: 'round-rectangle',
  view: 'round-rectangle',
  column: 'ellipse',
  measure: 'diamond',
};

export class GraphView {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this.cy = null;
    this.eh = null; // cytoscape-edgehandles instance, (re)built per render()
    this._connectModeActive = false;
    this.onNodeSelectCallbacks = [];
    this.onEdgeSelectCallbacks = [];
    this.onNodeDblTapCallbacks = [];
    this.onEdgeDblTapCallbacks = [];
    this.onEdgeCreatedCallbacks = [];
    this.onSelectionClearedCallbacks = [];
    this.colors = this._readColors();
  }

  /** Reads the current theme's colors from CSS custom properties (tokens.css) — called at construction and again by refreshTheme(). */
  _readColors() {
    return {
      high: cssVar('--confidence-high'),
      medium: cssVar('--confidence-medium'),
      low: cssVar('--confidence-low'),
      panelRaised: cssVar('--panel-raised'),
      panel: cssVar('--panel'),
      ink: cssVar('--ink'),
      inkDim: cssVar('--ink-dim'),
      bg: cssVar('--bg'),
      cyan: cssVar('--cyan'),
    };
  }

  /**
   * Re-reads colors from tokens.css and re-applies them to the live
   * cytoscape instance, without destroying/rebuilding it — so a
   * dark/light theme toggle (js/theme.js) updates an already-drawn
   * graph in place instead of waiting for the next full render().
   */
  refreshTheme() {
    this.colors = this._readColors();
    this.cy?.style(this._buildStyle());
  }

  onNodeSelect(cb) {
    this.onNodeSelectCallbacks.push(cb);
  }

  /** Fired when an edge is tapped directly (distinct from node selection). */
  onEdgeSelect(cb) {
    this.onEdgeSelectCallbacks.push(cb);
  }

  /** Fired on double-tap/double-click of a node — the manual-edit "open editor" gesture. */
  onNodeDblTap(cb) {
    this.onNodeDblTapCallbacks.push(cb);
  }

  /** Fired on double-tap/double-click of an edge. */
  onEdgeDblTap(cb) {
    this.onEdgeDblTapCallbacks.push(cb);
  }

  /** Fired after a drag-to-connect gesture creates a new edge. cb(edgeId). */
  onEdgeCreated(cb) {
    this.onEdgeCreatedCallbacks.push(cb);
  }

  /** Fired when the background is tapped and any prior selection is cleared. */
  onSelectionCleared(cb) {
    this.onSelectionClearedCallbacks.push(cb);
  }

  /**
   * @param {{nodes: Array, edges: Array}} graph
   * @param {{preserveViewport?: boolean}} [opts] - preserveViewport skips
   *   fit-to-view, used when re-rendering after a structural edit made
   *   while the user already has a particular pan/zoom set up.
   */
  render(graph, opts = {}) {
    const priorZoom = opts.preserveViewport ? this.cy?.zoom() : undefined;
    const priorPan = opts.preserveViewport ? this.cy?.pan() : undefined;

    if (this.cy) {
      this.cy.destroy();
    }

    // Nodes carry an optional {x,y} "position" (set for manually-arranged
    // or previously-exported diagrams) — cytoscape wants that as a
    // sibling of "data", not inside it, so it's split out here.
    const elements = [
      ...graph.nodes.map((n) => {
        const { position, ...data } = n;
        return position ? { data, position } : { data };
      }),
      ...graph.edges.map((e) => ({ data: { ...e } })),
    ];
    const allPositioned = graph.nodes.length > 0 && graph.nodes.every((n) => n.position);

    this.cy = cytoscape({
      container: this.container,
      elements,
      minZoom: 0.2,
      maxZoom: 2.5,
      style: this._buildStyle(),
    });

    if (allPositioned) {
      if (priorZoom !== undefined) {
        this.cy.zoom(priorZoom);
        this.cy.pan(priorPan);
      } else {
        this.cy.fit(undefined, 40);
      }
    } else {
      this._runLayout();
    }

    this._wireEvents();
    this._initEdgehandles();
  }

  _wireEvents() {
    this.cy.on('tap', 'node', (evt) => {
      const id = evt.target.id();
      if (this._connectModeActive) {
        // Dimming every other node (the normal "inspect" highlight)
        // would make potential connection targets hard to see and hit
        // while actively dragging a link between two nodes — keep
        // everything fully visible during Connect mode instead.
        this.cy.elements().removeClass('dim');
        this.cy.elements().removeClass('selected');
        evt.target.addClass('selected');
      } else {
        this.highlightNode(id);
      }
      for (const cb of this.onNodeSelectCallbacks) cb(id);
    });

    this.cy.on('tap', 'edge', (evt) => {
      const id = evt.target.id();
      this.highlightEdge(id);
      for (const cb of this.onEdgeSelectCallbacks) cb(id);
    });

    this.cy.on('dbltap', 'node', (evt) => {
      const id = evt.target.id();
      for (const cb of this.onNodeDblTapCallbacks) cb(id);
    });

    this.cy.on('dbltap', 'edge', (evt) => {
      const id = evt.target.id();
      for (const cb of this.onEdgeDblTapCallbacks) cb(id);
    });

    this.cy.on('tap', (evt) => {
      if (evt.target === this.cy) {
        this.clearHighlight();
        for (const cb of this.onSelectionClearedCallbacks) cb();
      }
    });
  }

  /**
   * Sets up the cytoscape-edgehandles extension (loaded via CDN in
   * index.html — it auto-registers itself on the global `cytoscape`).
   * Must be re-run after every render() since destroying `this.cy`
   * also tears down anything attached to it.
   */
  _initEdgehandles() {
    if (typeof this.cy.edgehandles !== 'function') return; // extension script not loaded — degrade quietly
    this.eh = this.cy.edgehandles({
      canConnect: (sourceNode, targetNode) =>
        !sourceNode.same(targetNode) && sourceNode.edgesTo(targetNode).length === 0,
      edgeParams: () => ({
        data: { id: makeEdgeId(), transformation: '', type: 'direct', confidence: 'high' },
      }),
      hoverDelay: 70,
      snap: true,
      snapThreshold: 50,
      snapFrequency: 15,
      noEdgeEventsInDraw: true,
      disableBrowserGestures: true,
    });
    this.eh.disableDrawMode();

    this.cy.on('ehcomplete', (_evt, _sourceNode, _targetNode, addedEdge) => {
      const id = addedEdge.id();
      for (const cb of this.onEdgeCreatedCallbacks) cb(id);
    });
  }

  /** Turns drag-to-connect ("Connect" tool) on or off. */
  setConnectMode(enabled) {
    if (!this.eh) return;
    this._connectModeActive = enabled;
    if (enabled) {
      this.eh.enableDrawMode();
      // Clear any dimming left over from before Connect was turned on,
      // so every node starts fully visible as a potential target.
      this.cy?.elements().removeClass('dim');
    } else {
      this.eh.disableDrawMode();
    }
  }

  _runLayout() {
    const duration = prefersReducedMotion() ? 0 : 500;
    // Nodes with no incoming edges are natural roots. Passed as an
    // actual collection, not an array of id strings turned into a "#id"
    // selector — node ids here routinely look like "dbo.Orders.Total",
    // and cytoscape's CSS-like selector language would parse the dots
    // in that string as class filters, silently breaking root
    // detection for exactly the id convention this app uses.
    const roots = this.cy.nodes().filter((n) => n.indegree() === 0);
    const layout = this.cy.layout({
      name: 'breadthfirst',
      directed: true,
      roots: roots.length ? roots : undefined,
      spacingFactor: 1.5,
      animate: duration > 0,
      animationDuration: duration,
    });
    layout.run();
    // Rotate the default top-to-bottom BFS layout into a left-to-right
    // flow — sources on the left, downstream consumers on the right —
    // which reads more naturally for lineage than a vertical tree.
    this.cy.nodes().positions((node) => {
      const p = node.position();
      return { x: p.y, y: p.x };
    });
    this.cy.fit(undefined, 40);
  }

  fit() {
    this.cy?.fit(undefined, 40);
  }

  highlightNode(id) {
    if (!this.cy) return;
    const node = this.cy.getElementById(id);
    if (node.empty()) return;
    const related = node.union(node.predecessors()).union(node.successors());
    this.cy.elements().addClass('dim');
    related.removeClass('dim');
    node.addClass('selected');
    this._selection = { id, type: 'node' };
  }

  highlightEdge(id) {
    if (!this.cy) return;
    const edge = this.cy.getElementById(id);
    if (edge.empty()) return;
    this.cy.elements().removeClass('dim selected');
    edge.addClass('selected');
    this._selection = { id, type: 'edge' };
  }

  clearHighlight() {
    this.cy?.elements().removeClass('dim selected');
    this._selection = null;
  }

  /** @returns {{id: string, type: 'node'|'edge'}|null} Whatever is currently highlighted/selected, for the manual-edit Delete tool. */
  getSelection() {
    return this._selection || null;
  }

  /** @returns {string} PNG data URL */
  exportPNG() {
    if (!this.cy) return '';
    return this.cy.png({ bg: this.colors.bg, full: true, scale: 2 });
  }

  isEmpty() {
    return !this.cy || this.cy.elements().length === 0;
  }

  // ─── Manual-edit mutations ──────────────────────────────────────
  // These mutate the live cytoscape instance directly rather than
  // going through render(), so every other node's position and the
  // current pan/zoom are left exactly as the user set them.

  hasElement(id) {
    return !!this.cy && !this.cy.getElementById(id).empty();
  }

  /**
   * @param {{id: string, label?: string, type?: string, description?: string, confidence?: string}} nodeData
   * @param {{x: number, y: number}} [position] - defaults to the current viewport center
   */
  addNode(nodeData, position) {
    if (!this.cy) throw new Error('The diagram has not been initialized yet.');
    if (this.hasElement(nodeData.id)) {
      throw new Error(`A node with id "${nodeData.id}" already exists.`);
    }
    const pos = position || this._viewportCenter();
    return this.cy.add({ group: 'nodes', data: { ...nodeData }, position: pos });
  }

  /** @param {{id: string, source: string, target: string, transformation?: string, type?: string, confidence?: string}} edgeData */
  addEdge(edgeData) {
    if (!this.cy) throw new Error('The diagram has not been initialized yet.');
    if (!this.hasElement(edgeData.source) || !this.hasElement(edgeData.target)) {
      throw new Error('Both the source and target node must already exist on the diagram.');
    }
    const id = edgeData.id && !this.hasElement(edgeData.id) ? edgeData.id : makeEdgeId();
    return this.cy.add({ group: 'edges', data: { ...edgeData, id } });
  }

  updateNode(id, patch) {
    const el = this.cy?.getElementById(id);
    if (!el || el.empty()) return;
    el.data({ ...patch });
  }

  updateEdge(id, patch) {
    const el = this.cy?.getElementById(id);
    if (!el || el.empty()) return;
    el.data({ ...patch });
  }

  /** Removes a node (and, via cytoscape's own cascade, any edges touching it) or a single edge. */
  removeElement(id) {
    const el = this.cy?.getElementById(id);
    if (!el || el.empty()) return;
    el.remove();
    if (this._selection?.id === id) this._selection = null;
  }

  getNodeData(id) {
    const el = this.cy?.getElementById(id);
    return el && !el.empty() && el.isNode() ? { ...el.data() } : null;
  }

  /** @returns {{x: number, y: number}|null} a node's current on-screen position, for restoring it in the same spot after an undo. */
  getNodePosition(id) {
    const el = this.cy?.getElementById(id);
    return el && !el.empty() && el.isNode() ? { ...el.position() } : null;
  }

  /** @returns {Array<Object>} plain data for every edge currently touching a node — captured before removeElement() cascades their deletion too, so an undo can restore them. */
  getConnectedEdgesData(nodeId) {
    const el = this.cy?.getElementById(nodeId);
    if (!el || el.empty()) return [];
    return el.connectedEdges().map((e) => ({ ...e.data() }));
  }

  getEdgeData(id) {
    const el = this.cy?.getElementById(id);
    return el && !el.empty() && el.isEdge() ? { ...el.data() } : null;
  }

  /** @returns {Array<{id: string, label: string}>} every node currently on the diagram, for populating a source/target picker. */
  listNodes() {
    if (!this.cy) return [];
    return this.cy
      .nodes()
      .map((n) => ({ id: n.id(), label: n.data('label') || n.id() }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Reads the live cytoscape instance back out as a plain graph object
   * — including each node's current on-screen position — so manual
   * edits and drags can be synced back into app state, and so exports
   * always reflect exactly what's on screen.
   * @returns {{nodes: Array, edges: Array}}
   */
  getGraphSnapshot() {
    if (!this.cy) return { nodes: [], edges: [] };
    const nodes = this.cy.nodes().map((n) => ({ ...n.data(), position: { ...n.position() } }));
    const edges = this.cy.edges().map((e) => ({ ...e.data() }));
    return { nodes, edges };
  }

  _viewportCenter() {
    const extent = this.cy.extent();
    return { x: (extent.x1 + extent.x2) / 2, y: (extent.y1 + extent.y2) / 2 };
  }

  /** Public wrapper for _viewportCenter, used as the drop position when a palette component is clicked rather than dragged. */
  viewportCenterModelPosition() {
    if (!this.cy) return { x: 0, y: 0 };
    return this._viewportCenter();
  }

  /** Converts a viewport-relative pointer position (e.g. a drop event's clientX/Y) into model coordinates, for palette drag-and-drop. */
  clientPositionToModel(clientX, clientY) {
    if (!this.cy) return { x: 0, y: 0 };
    const rect = this.container.getBoundingClientRect();
    const pan = this.cy.pan();
    const zoom = this.cy.zoom();
    return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom };
  }

  _buildStyle() {
    const c = this.colors;
    return [
      {
        selector: 'node',
        style: {
          shape: (el) => NODE_SHAPES[el.data('type')] || 'round-rectangle',
          label: 'data(label)',
          'font-family': 'IBM Plex Mono, monospace',
          'font-size': 11,
          color: c.ink,
          'text-valign': 'center',
          'text-halign': 'center',
          'text-wrap': 'ellipsis',
          'text-max-width': '110px',
          width: 'label',
          height: 34,
          padding: '10px',
          'background-color': c.panelRaised,
          'border-width': 2,
          'border-color': (el) => c[el.data('confidence')] || c.high,
        },
      },
      {
        selector: 'node[type = "column"], node[type = "measure"]',
        style: {
          height: 26,
          'font-size': 10,
          color: c.inkDim,
        },
      },
      {
        selector: 'edge',
        style: {
          width: 1.75,
          'curve-style': 'bezier',
          'target-arrow-shape': 'triangle',
          'target-arrow-color': (el) => c[el.data('confidence')] || c.high,
          'line-color': (el) => c[el.data('confidence')] || c.high,
          'arrow-scale': 0.9,
          'line-style': (el) => (el.data('confidence') === 'high' ? 'solid' : 'dashed'),
          opacity: 0.85,
        },
      },
      {
        selector: '.dim',
        style: { opacity: 0.12 },
      },
      {
        selector: 'node.selected',
        style: { 'border-width': 3 },
      },
      {
        selector: 'edge.selected',
        style: { width: 3, opacity: 1 },
      },
      // cytoscape-edgehandles UI — restyled to match the blueprint theme
      // instead of the extension's default red/black handles.
      {
        selector: '.eh-handle',
        style: {
          'background-color': c.cyan,
          width: 16,
          height: 16,
          shape: 'ellipse',
          'overlay-opacity': 0,
          'border-width': 3,
          'border-color': c.bg,
        },
      },
      {
        selector: '.eh-hover',
        style: { 'background-color': c.cyan },
      },
      {
        selector: '.eh-source, .eh-target',
        style: { 'border-width': 2, 'border-color': c.cyan },
      },
      {
        selector: '.eh-preview, .eh-ghost-edge',
        style: {
          'background-color': c.cyan,
          'line-color': c.cyan,
          'target-arrow-color': c.cyan,
          'source-arrow-color': c.cyan,
          'line-style': 'dashed',
        },
      },
      {
        selector: '.eh-ghost-edge.eh-preview-active',
        style: { opacity: 0 },
      },
    ];
  }
}
