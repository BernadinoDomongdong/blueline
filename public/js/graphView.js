/**
 * graphView.js — owns the cytoscape instance: rendering, layout,
 * click-to-highlight upstream/downstream, and PNG export.
 *
 * Edge line style encodes meaning, not decoration: solid = high-
 * confidence (confirmed) lineage, dashed = medium/low-confidence
 * (AI-inferred, not yet verified) — the same convention an engineer
 * uses penciling in an unconfirmed detail on a blueprint.
 */

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
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
    this.onNodeSelectCallbacks = [];
    this.colors = {
      high: cssVar('--confidence-high'),
      medium: cssVar('--confidence-medium'),
      low: cssVar('--confidence-low'),
      panelRaised: cssVar('--panel-raised'),
      ink: cssVar('--ink'),
      inkDim: cssVar('--ink-dim'),
      bg: cssVar('--bg'),
    };
  }

  onNodeSelect(cb) {
    this.onNodeSelectCallbacks.push(cb);
  }

  /** @param {{nodes: Array, edges: Array}} graph */
  render(graph) {
    if (this.cy) {
      this.cy.destroy();
    }

    const elements = [
      ...graph.nodes.map((n) => ({ data: { ...n } })),
      ...graph.edges.map((e) => ({ data: { ...e } })),
    ];

    this.cy = cytoscape({
      container: this.container,
      elements,
      minZoom: 0.2,
      maxZoom: 2.5,
      style: this._buildStyle(),
    });

    this._runLayout();

    this.cy.on('tap', 'node', (evt) => {
      const id = evt.target.id();
      this.highlightNode(id);
      for (const cb of this.onNodeSelectCallbacks) cb(id);
    });

    this.cy.on('tap', (evt) => {
      if (evt.target === this.cy) this.clearHighlight();
    });
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
  }

  clearHighlight() {
    this.cy?.elements().removeClass('dim selected');
  }

  /** @returns {string} PNG data URL */
  exportPNG() {
    if (!this.cy) return '';
    return this.cy.png({ bg: this.colors.bg, full: true, scale: 2 });
  }

  isEmpty() {
    return !this.cy || this.cy.elements().length === 0;
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
    ];
  }
}
