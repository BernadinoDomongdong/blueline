/**
 * api/infer-lineage.js — Vercel serverless function.
 *
 * Takes the source queries a person has pasted/uploaded and asks the
 * configured LLM (see lib/llmClient.js / .env.example — OpenRouter by
 * default, or a direct/custom/local model) to extract table/column-
 * level lineage from them. Runs only on Vercel's servers — no API key
 * of any kind ever reaches the browser.
 */

'use strict';

const { callLLM, parseJsonResponse, LLMConfigError, LLMUpstreamError } = require('../lib/llmClient');
const { buildLineagePrompt } = require('../lib/prompts');
const { validateAndNormalizeGraph, GraphValidationError } = require('../lib/validateGraph');
const { checkRateLimit, clientKeyFromRequest, ensureSweepScheduled } = require('../lib/rateLimit');
const { isOriginAllowed } = require('../lib/checkOrigin');

const MAX_SOURCES = 20;
const MAX_TOTAL_CONTENT_CHARS = 80_000; // generous for real SSAS query sets, cheap to enforce
const MAX_BODY_BYTES = 400 * 1024; // pasted queries can legitimately be large; still far below Vercel's ~4.5MB platform limit
const ALLOWED_DIALECTS = new Set(['sql', 'dax', 'm', 'other']);

// This endpoint costs a real LLM call per request, so it gets a
// tighter budget than a read-only endpoint would. See lib/rateLimit.js
// for what this protection does and doesn't cover.
const RATE_LIMIT = { windowMs: 60 * 1000, max: 6 };
const GLOBAL_RATE_LIMIT_KEY = '__global_infer__';
const GLOBAL_RATE_LIMIT = {
  windowMs: 60 * 1000,
  max: Number(process.env.GLOBAL_RATE_LIMIT_PER_MINUTE) || 60,
};

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
module.exports = async function handler(req, res) {
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

  const sources = Array.isArray(req.body?.sources) ? req.body.sources : null;
  if (!sources || sources.length === 0) {
    res.status(400).json({ error: 'Provide at least one source (sources: [{ name, dialect, content }]).' });
    return;
  }
  if (sources.length > MAX_SOURCES) {
    res.status(400).json({ error: `Too many sources — the limit is ${MAX_SOURCES} per request.` });
    return;
  }

  let totalChars = 0;
  const cleanSources = [];
  for (const s of sources) {
    if (!s || typeof s.content !== 'string' || !s.content.trim()) {
      res.status(400).json({ error: 'Each source needs non-empty "content".' });
      return;
    }
    totalChars += s.content.length;
    cleanSources.push({
      name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 200) : 'untitled',
      dialect: ALLOWED_DIALECTS.has(s.dialect) ? s.dialect : 'other',
      content: s.content,
    });
  }
  if (totalChars > MAX_TOTAL_CONTENT_CHARS) {
    res.status(400).json({ error: `Combined source content is too large (limit ${MAX_TOTAL_CONTENT_CHARS} characters).` });
    return;
  }

  try {
    const { system, userContent } = buildLineagePrompt(cleanSources);
    const responseText = await callLLM({
      system,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 8000,
      temperature: 0,
    });

    let rawGraph;
    try {
      rawGraph = parseJsonResponse(responseText);
    } catch {
      res.status(502).json({ error: 'The model did not return valid JSON for this source set. Try again, or split large sources into smaller pieces.' });
      return;
    }

    const { graph, warnings } = validateAndNormalizeGraph(rawGraph, cleanSources.map((s) => s.name));
    res.status(200).json({ graph, warnings });
  } catch (err) {
    if (err instanceof LLMConfigError) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (err instanceof LLMUpstreamError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof GraphValidationError) {
      res.status(502).json({ error: `The model's output didn't match the expected graph shape: ${err.message}` });
      return;
    }
    console.error('Unexpected error in /api/infer-lineage:', err);
    res.status(500).json({ error: 'Unexpected server error.' });
  }
};
