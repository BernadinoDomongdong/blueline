/**
 * api/ask.js — Vercel serverless function.
 *
 * Answers natural-language questions about the lineage graph currently
 * loaded in the browser, using whichever LLM provider is configured
 * (see lib/llmClient.js / .env.example). The graph is sent up with each
 * question rather than stored server-side — this app keeps no database,
 * by design (see README) — so answers are only as fresh as the graph
 * the client sends.
 */

'use strict';

const { callLLM, LLMConfigError, LLMUpstreamError } = require('../lib/llmClient');
const { buildAskPrompt } = require('../lib/prompts');
const { validateAndNormalizeGraph, GraphValidationError } = require('../lib/validateGraph');
const { checkRateLimit, clientKeyFromRequest, ensureSweepScheduled } = require('../lib/rateLimit');
const { isOriginAllowed } = require('../lib/checkOrigin');

const MAX_QUESTION_LENGTH = 1000;
const MAX_BODY_BYTES = 1024 * 1024; // graphs (up to 500 nodes / 1500 edges) can be a few hundred KB as JSON

const RATE_LIMIT = { windowMs: 60 * 1000, max: 15 };
const GLOBAL_RATE_LIMIT_KEY = '__global_ask__';
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

  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question) {
    res.status(400).json({ error: 'Provide a non-empty "question".' });
    return;
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    res.status(400).json({ error: `Question is too long (limit ${MAX_QUESTION_LENGTH} characters).` });
    return;
  }

  try {
    const { graph } = validateAndNormalizeGraph(req.body?.graph);
    const { system, userContent } = buildAskPrompt(question, graph);
    const requestedModel = typeof req.body?.model === 'string' ? req.body.model : undefined;
    const answer = await callLLM({
      system,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 1200,
      temperature: 0.2,
      model: requestedModel,
    });
    res.status(200).json({ answer });
  } catch (err) {
    if (err instanceof GraphValidationError) {
      res.status(400).json({ error: `"graph" isn't a valid lineage graph: ${err.message}` });
      return;
    }
    if (err instanceof LLMConfigError) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (err instanceof LLMUpstreamError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('Unexpected error in /api/ask:', err);
    res.status(500).json({ error: 'Unexpected server error.' });
  }
};
