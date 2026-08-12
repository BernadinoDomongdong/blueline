/**
 * lib/prompts.js — prompts for the optional AI features (/api/ask,
 * /api/report). Lineage extraction itself no longer goes through an
 * LLM at all — see api/_lineage_engine.py — so there is deliberately
 * no lineage-extraction prompt here anymore.
 */

'use strict';

/**
 * Builds the prompt for grounded natural-language Q&A about an already
 * -extracted lineage graph. Returns { system, userContent }.
 * @param {string} question
 * @param {Object} graph
 */
function buildAskPrompt(question, graph) {
  const system =
    'You are a data lineage assistant for a SSAS data-modernization ' +
    'project. You answer questions strictly using the lineage graph JSON ' +
    'provided below — you do not have access to the original source ' +
    'files or any information beyond this graph.\n\n' +
    'Rules:\n' +
    '- Ground every claim in the graph\'s actual nodes and edges. Refer ' +
    'to nodes by their id or label.\n' +
    '- If the graph does not contain enough information to answer, say ' +
    'so plainly rather than guessing — e.g. "That relationship isn\'t ' +
    'represented in the current lineage graph."\n' +
    '- When an edge or node has "confidence": "low" or "medium", ' +
    'mention that the lineage there is uncertain rather than stating it ' +
    'as settled fact.\n' +
    '- Answer in clear, plain prose. Keep it focused — a few sentences ' +
    'for a simple question, more only if the question genuinely needs it.\n\n' +
    `Lineage graph:\n${JSON.stringify(graph)}`;

  return { system, userContent: question };
}

/**
 * Builds the prompt for a documentation or impact-analysis report.
 * Pre-computed upstream/downstream lists are included so Claude writes
 * from real computed structure instead of re-deriving traversal itself.
 * @param {'documentation'|'impact'} reportType
 * @param {Object} graph
 * @param {Map<string, {upstream: string[], downstream: string[]}>} impact
 */
function buildReportPrompt(reportType, graph, impact) {
  const impactSummary = graph.nodes.map((node) => {
    const entry = impact.get(node.id) || { upstream: [], downstream: [] };
    return {
      id: node.id,
      label: node.label,
      type: node.type,
      upstreamCount: entry.upstream.length,
      downstreamCount: entry.downstream.length,
      upstream: entry.upstream,
      downstream: entry.downstream,
    };
  });

  const shared =
    'You are writing for a SSAS data-modernization project team. Write ' +
    'in clear, plain Markdown — headings, short paragraphs, and bullet ' +
    'lists where useful. Base every statement on the graph and impact ' +
    'data provided; do not invent tables, columns, or relationships not ' +
    'present in it. If an edge or node has low/medium confidence, note ' +
    'the uncertainty rather than stating it as settled fact.\n\n' +
    `Lineage graph:\n${JSON.stringify(graph)}\n\n` +
    `Computed upstream/downstream per node:\n${JSON.stringify(impactSummary)}`;

  const system =
    reportType === 'impact'
      ? shared +
        '\n\nWrite an IMPACT ANALYSIS report: for each table/column/' +
        'measure with at least one downstream dependent, describe what ' +
        'would break or need review if that node changed, ordered from ' +
        'highest downstream-count to lowest. Call out nodes with the ' +
        'largest blast radius up top.'
      : shared +
        '\n\nWrite a DOCUMENTATION report: for each table/column/' +
        'measure, describe its purpose in plain English, what it\'s ' +
        'derived from (its upstream sources), and how it\'s transformed ' +
        'along the way. Group related nodes under sensible headings ' +
        'rather than listing every node flatly.';

  return { system, userContent: 'Generate the report now.' };
}

module.exports = { buildAskPrompt, buildReportPrompt };
