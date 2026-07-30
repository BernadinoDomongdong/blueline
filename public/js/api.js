/**
 * api.js — thin fetch wrapper for /api/infer-lineage, /api/ask, /api/report.
 */

const REQUEST_TIMEOUT_MS = 60 * 1000;

async function postJSON(url, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('The request timed out. Try again, or with a smaller amount of source text.');
    }
    throw new Error(`Network error: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON error body — fall through with empty data */
  }

  if (!res.ok) {
    const message = data.error || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function getJSON(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('The request timed out.');
    }
    throw new Error(`Network error: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON error body — fall through with empty data */
  }

  if (!res.ok) {
    const message = data.error || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  inferLineage(sources, model) {
    return postJSON('/api/infer-lineage', { sources, model });
  },
  ask(question, graph, model) {
    return postJSON('/api/ask', { question, graph, model });
  },
  report(graph, reportType, model) {
    return postJSON('/api/report', { graph, reportType, model });
  },
  models() {
    return getJSON('/api/models');
  },
};
