/**
 * demoData.js — a small, realistic sample lineage graph, bundled so
 * "Load demo" works instantly with no network call. Deliberately
 * touches every edge type (direct/derived/aggregated/filtered) and
 * every confidence level (high/medium/low) so the visual language —
 * solid vs. dashed lines, node shapes, the legend — is demonstrated
 * all at once, plus one manually-added node to show that path too.
 */

export const DEMO_GRAPH = {
  nodes: [
    { id: 'dbo.Orders', label: 'dbo.Orders', type: 'table', description: 'Raw orders table.', confidence: 'high' },
    { id: 'dbo.Orders.Total', label: 'Total', type: 'column', description: '', confidence: 'high' },
    { id: 'dbo.Customers', label: 'dbo.Customers', type: 'table', description: 'Raw customers table.', confidence: 'high' },
    { id: 'dbo.Customers.Region', label: 'Region', type: 'column', description: '', confidence: 'high' },
    {
      id: 'dbo.FactSales',
      label: 'dbo.FactSales',
      type: 'view',
      description: 'Traced from a CREATE VIEW joining Orders and Customers — table- and column-level lineage resolved from the real SQL syntax tree.',
      confidence: 'high',
    },
    { id: 'dbo.FactSales.TotalRevenue', label: 'TotalRevenue', type: 'column', description: '', confidence: 'high' },
    { id: 'dbo.FactSales.Region', label: 'Region', type: 'column', description: '', confidence: 'high' },
    {
      id: 'Measures.Total Revenue',
      label: 'Total Revenue',
      type: 'measure',
      description: 'SUM(FactSales[TotalRevenue]) — a DAX measure, read with pattern-matching rather than a real parser.',
      confidence: 'high',
    },
    {
      id: 'Measures.Revenue Growth',
      label: 'Revenue Growth',
      type: 'measure',
      description: '[Total Revenue] - [Prior Year Revenue] — heuristic DAX extraction, so this is medium confidence even though the match is clean.',
      confidence: 'medium',
    },
    {
      id: 'Measures.Prior Year Revenue',
      label: 'Prior Year Revenue',
      type: 'measure',
      description: "Referenced by Revenue Growth but not defined anywhere in the pasted DAX file — Blueline links it at low confidence rather than guessing what it is.",
      confidence: 'low',
    },
    {
      id: 'StagingOrders',
      label: 'StagingOrders',
      type: 'view',
      description: 'Traced from a Power Query (M) step chain — also heuristic, medium confidence.',
      confidence: 'medium',
    },
    {
      id: 'Analyst Notes',
      label: 'Analyst Notes',
      type: 'table',
      description: "Added by hand with Blueline's manual editor — not traced from any source file. This is what a manually-added node looks like: high confidence by default, since a person asserted it directly.",
      confidence: 'high',
    },
  ],
  edges: [
    { id: 'e1', source: 'dbo.Orders', target: 'dbo.FactSales', transformation: 'JOIN dbo.Customers c ON o.CustomerId = c.Id', type: 'direct', confidence: 'high' },
    { id: 'e2', source: 'dbo.Customers', target: 'dbo.FactSales', transformation: 'JOIN dbo.Customers c ON o.CustomerId = c.Id', type: 'direct', confidence: 'high' },
    { id: 'e3', source: 'dbo.Orders.Total', target: 'dbo.FactSales.TotalRevenue', transformation: 'SUM(o.Total)', type: 'aggregated', confidence: 'high' },
    { id: 'e4', source: 'dbo.Customers.Region', target: 'dbo.FactSales.Region', transformation: '', type: 'direct', confidence: 'high' },
    { id: 'e5', source: 'dbo.FactSales.TotalRevenue', target: 'Measures.Total Revenue', transformation: 'SUM(FactSales[TotalRevenue])', type: 'aggregated', confidence: 'high' },
    { id: 'e6', source: 'Measures.Total Revenue', target: 'Measures.Revenue Growth', transformation: '[Total Revenue] - [Prior Year Revenue]', type: 'derived', confidence: 'medium' },
    { id: 'e7', source: 'Measures.Prior Year Revenue', target: 'Measures.Revenue Growth', transformation: "[Prior Year Revenue] isn't defined in this file", type: 'derived', confidence: 'low' },
    { id: 'e8', source: 'StagingOrders', target: 'dbo.Orders', transformation: 'Power Query step chain (heuristic match, not a real parse)', type: 'derived', confidence: 'medium' },
    { id: 'e9', source: 'dbo.Orders', target: 'Analyst Notes', transformation: 'Manually linked — flags orders worth a second look', type: 'filtered', confidence: 'high' },
  ],
  metadata: { sourceFiles: ['demo'] },
};
