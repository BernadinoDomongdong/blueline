/**
 * constants.js — shared, dependency-free constants for the lineage
 * canvas. Nothing here touches the DOM or reads CSS, so it's safe to
 * import from any layer (rendering, layout, geometry) without
 * creating a coupling to the browser or to each other.
 */

export const NODE_TYPES = Object.freeze({
  TABLE: 'table',
  VIEW: 'view',
  COLUMN: 'column',
  MEASURE: 'measure',
});

// One glyph per node type, in the same "IBM Plex Mono unicode glyph"
// visual language already used for the app's own icons (⌗ ✎ ⤳ ⛶) —
// a new node type only needs an entry here, not a new icon asset.
export const NODE_TYPE_GLYPH = Object.freeze({
  [NODE_TYPES.TABLE]: '▦',
  [NODE_TYPES.VIEW]: '▨',
  [NODE_TYPES.COLUMN]: '●',
  [NODE_TYPES.MEASURE]: '◆',
});

// Node types whose card renders as a single-line compact pill rather
// than the full header+badge+metrics card (see nodeCard.js).
export const COMPACT_NODE_TYPES = Object.freeze(new Set([NODE_TYPES.COLUMN, NODE_TYPES.MEASURE]));

// A table/view node with more traced columns than this shows a
// "+N more" line instead of listing every one — an unbounded column
// list would otherwise produce an unreadably tall card.
export const EXPANDED_COLUMN_LIMIT = 60;

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 2.5;
export const ZOOM_STEP = 0.1;
export const ZOOM_FIT_PADDING = 48;

export const CARD_WIDTH = 196;

export const LAYOUT_COLUMN_SPACING = 260;
export const LAYOUT_ROW_SPACING = 56;

// Class toggled on connected elements (nodes + edges) that are NOT
// part of the current selection's upstream/downstream closure.
export const DIMMED_CLASS = 'is-dimmed';
