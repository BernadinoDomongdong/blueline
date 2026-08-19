/**
 * state.js — single in-memory store for this session. Blueline keeps no
 * server-side database by design (see README); everything lives here
 * until it's exported.
 */

const EMPTY_GRAPH = { nodes: [], edges: [], metadata: { generatedAt: null, sourceFiles: [] } };

export function createStore() {
  let state = {
    sources: [], // { id, name, dialect, content }
    graph: EMPTY_GRAPH,
    selectedNodeId: null,
  };
  const listeners = new Set();

  function get() {
    return state;
  }

  function set(patch) {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { get, set, subscribe, EMPTY_GRAPH };
}
