/**
 * api/model-info.js — Vercel serverless function.
 *
 * Read-only: reports which LLM provider and model this deployment is
 * currently configured to use (LLM_PROVIDER / *_MODEL env vars — see
 * .env.example), so the person running the deployment can confirm
 * their setup took effect without checking Vercel's dashboard. Never
 * returns a key, and makes no upstream call — this only ever reads
 * local environment variables.
 */

'use strict';

const { getActiveModelInfo } = require('../lib/llmClient');
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
  res.status(200).json(getActiveModelInfo());
};
