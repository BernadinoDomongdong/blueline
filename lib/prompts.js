/**
 * lib/prompts.js — every prompt Blueline sends to Claude, in one place.
 * Keeping these together makes it obvious what the model is and isn't
 * being asked to do, and is the single place to tune extraction quality.
 */

'use strict';

const GRAPH_SCHEMA_EXAMPLE = JSON.stringify(
  {
    nodes: [
      { id: 'dbo.Orders', label: 'dbo.Orders', type: 'table', description: 'Raw orders table.', confidence: 'high' },
      { id: 'dbo.Orders.OrderTotal', label: 'OrderTotal', type: 'column', description: 'Order line total.', confidence: 'high' },
      { id: 'FactSales.TotalRevenue', label: 'TotalRevenue', type: 'measure', description: 'SUM of OrderTotal.', confidence: 'medium' },
    ],
    edges: [
      {
        id: 'e1',
        source: 'dbo.Orders.OrderTotal',
        target: 'FactSales.TotalRevenue',
        transformation: 'SUM(OrderTotal) grouped by OrderDate',
        type: 'aggregated',
        confidence: 'medium',
      },
    ],
  },
  null,
  2
);

/**
 * Builds the prompt that turns pasted SQL / DAX / M source into a
 * lineage graph. Returns { system, userContent }.
 * @param {Array<{name: string, dialect: string, content: string}>} sources
 */
function buildLineagePrompt(sources) {
  const system =
    'You are a data lineage extraction engine for a SQL Server Analysis ' +
    'Services (SSAS) data-modernization project. You read SQL, DAX, and ' +
    'Power Query (M) source and output ONLY strict JSON describing ' +
    'table-level and column-level lineage — no prose, no markdown fences, ' +
    'no commentary before or after the JSON.\n\n' +
    'Output schema (follow exactly):\n' +
    `${GRAPH_SCHEMA_EXAMPLE}\n\n` +
    'Rules:\n' +
    '- A node is a table, view, column, or DAX measure. Use ' +
    '"schema.table" or "schema.table.column" as the id convention when ' +
    'the source makes that clear; otherwise use the name as written.\n' +
    '- An edge means data flows from source to target: a JOIN, a ' +
    'SELECT INTO / CTAS, a DAX measure referencing a column, an M step ' +
    'referencing a prior step or source query, a view referencing a ' +
    'base table, etc.\n' +
    '- Set edge "type" to "direct" for a plain copy/reference, "derived" ' +
    'for a calculated/transformed column or DAX expression, ' +
    '"aggregated" for SUM/COUNT/AVG-style rollups, "filtered" when a ' +
    'WHERE/FILTER meaningfully changes what rows flow through.\n' +
    '- Only extract lineage that the source text actually implies. Do ' +
    'not invent tables, columns, or relationships that aren\'t there.\n' +
    '- If a reference is ambiguous (e.g. a column name without a clear ' +
    'source table), still include it but set its "confidence" to ' +
    '"low" or "medium" rather than guessing silently at "high".\n' +
    '- Every edge\'s "source" and "target" must exactly match a node id ' +
    'you also included in "nodes".\n' +
    '- Return JSON only. The response must start with "{" and end with "}".';

  const labeledSources = sources
    .map((s, i) => `--- Source ${i + 1}: ${s.name} (${s.dialect}) ---\n${s.content}`)
    .join('\n\n');

  const userContent =
    `Extract lineage from the following ${sources.length} source ` +
    `file(s):\n\n${labeledSources}`;

  return { system, userContent };
}

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

module.exports = { buildLineagePrompt, buildAskPrompt, buildReportPrompt };
