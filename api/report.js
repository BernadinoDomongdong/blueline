/**
 * api/report.js — Vercel serverless function.
 *
 * Generates a Markdown documentation or impact-analysis report from the
 * lineage graph currently loaded in the browser, using whichever LLM
 * provider is configured (see lib/llmClient.js / .env.example).
 * Upstream/downstream traversal is computed here, deterministically,
 * and handed to the model as grounding data — it writes prose, it
 * doesn't re-derive graph structure.
 */

'use strict';

const { callLLM, LLMConfigError, LLMUpstreamError } = require('../lib/llmClient');
const { buildReportPrompt } = require('../lib/prompts');
const { validateAndNormalizeGraph, computeImpact, GraphValidationError } = require('../lib/validateGraph');
const { checkRateLimit, clientKeyFromRequest, ensureSweepScheduled } = require('../lib/rateLimit');
const { isOriginAllowed } = require('../lib/checkOrigin');

const MAX_BODY_BYTES = 1024 * 1024;
const ALLOWED_REPORT_TYPES = new Set(['documentation', 'impact']);

const RATE_LIMIT = { windowMs: 60 * 1000, max: 6 };
const GLOBAL_RATE_LIMIT_KEY = '__global_report__';
const GLOBAL_RATE_LIMIT = {
  windowMs: 60 * 1000,
  max: Number(process.env.GLOBAL_RATE_LIMIT_PER_MINUTE) || 60,
};

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
module.exports = async function handler(req, res) {
  try {
    await handleReport(req, res);
  } catch (err) {
    console.error('Unhandled error in /api/report:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: `Unexpected server error (${err?.name || 'Error'}): ${err?.message || err}` });
    }
  }
};

async function handleReport(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > MAX_BODY_BYTES) {
    res.status(413).json({ error: 'Request body is too large.' });
    return;
  }
  if (!isOriginAllowed(req)) {
    res.status(403).json({ error: 'Origin not allowed.' });
    return;
  }

  ensureSweepScheduled(Math.max(RATE_LIMIT.windowMs, GLOBAL_RATE_LIMIT.windowMs));
  const clientKey = clientKeyFromRequest(req);
  const rate = checkRateLimit(clientKey, RATE_LIMIT);
  res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT.max));
  res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    res.status(429).json({ error: 'Too many requests — please slow down and try again shortly.' });
    return;
  }
  const globalRate = checkRateLimit(GLOBAL_RATE_LIMIT_KEY, GLOBAL_RATE_LIMIT);
  if (!globalRate.allowed) {
    res.setHeader('Retry-After', String(globalRate.retryAfterSeconds));
    res.status(429).json({ error: 'This deployment is getting more traffic than usual — please try again shortly.' });
    return;
  }

  const reportType = req.body?.reportType;
  if (!ALLOWED_REPORT_TYPES.has(reportType)) {
    res.status(400).json({ error: '"reportType" must be "documentation" or "impact".' });
    return;
  }

  try {
    const { graph } = validateAndNormalizeGraph(req.body?.graph);
    if (graph.nodes.length === 0) {
      res.status(400).json({ error: 'The lineage graph is empty — infer or import lineage before generating a report.' });
      return;
    }
    const impact = computeImpact(graph);
    const { system, userContent } = buildReportPrompt(reportType, graph, impact);
    const clientCredential = req.body?.credential && typeof req.body.credential === 'object' ? req.body.credential : undefined;
    const markdown = await callLLM({
      system,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 6000,
      temperature: 0.3,
      clientCredential,
    });
    res.status(200).json({ markdown });
  } catch (err) {
    if (err instanceof GraphValidationError) {
      res.status(400).json({ error: `"graph" isn't a valid lineage graph: ${err.message}` });
      return;
    }
    if (err instanceof LLMConfigError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof LLMUpstreamError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err; // re-thrown — caught by the outer guard above, which always returns a clean, specific response
  }
}
