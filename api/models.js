/**
 * api/models.js — Vercel serverless function.
 *
 * Read-only: returns the free/paid OpenRouter model list (fetched live
 * and cached briefly — see lib/llmClient.js) for the UI's model
 * picker. Also reports which provider is active and whether paid
 * models are enabled, so the frontend knows whether to show the
 * picker at all — it's only meaningful when LLM_PROVIDER=openrouter,
 * since "custom" and "anthropic" deployments are single fixed models.
 */

'use strict';

const { getModelCatalog } = require('../lib/llmClient');
const { isOriginAllowed } = require('../lib/checkOrigin');

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!isOriginAllowed(req)) {
    res.status(403).json({ error: 'Origin not allowed.' });
    return;
  }
  const catalog = await getModelCatalog();
  res.status(200).json(catalog);
};
