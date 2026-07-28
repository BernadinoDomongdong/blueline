/**
 * lib/claudeClient.js — thin wrapper around the real Anthropic Messages
 * API. Runs only on Vercel's servers; ANTHROPIC_API_KEY never reaches
 * the browser (same principle as OPENROUTER_API_KEY in BERN-AI).
 */

'use strict';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// Overridable via ANTHROPIC_MODEL if Anthropic ships a newer model you'd
// rather use — check https://docs.claude.com for current model ids.
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const UPSTREAM_TIMEOUT_MS = 55 * 1000;

class ClaudeConfigError extends Error {}
class ClaudeUpstreamError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * Calls Claude and returns the concatenated text of every text block in
 * the response. Throws ClaudeConfigError if no API key is configured,
 * or ClaudeUpstreamError if Anthropic returns a non-2xx response.
 *
 * @param {Object} params
 * @param {string} params.system - System prompt.
 * @param {Array<{role: 'user'|'assistant', content: string}>} params.messages
 * @param {number} [params.maxTokens]
 * @param {number} [params.temperature]
 * @returns {Promise<string>}
 */
async function callClaude({ system, messages, maxTokens = 4096, temperature = 0 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ClaudeConfigError(
      'ANTHROPIC_API_KEY is not set on this deployment. Add it in Vercel → ' +
        'Settings → Environment Variables (see README).'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: maxTokens,
        temperature,
        system,
        messages,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ClaudeUpstreamError('Claude did not respond in time.', 504);
    }
    throw new ClaudeUpstreamError(`Could not reach Claude: ${err.message}`, 502);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || '';
    } catch {
      /* upstream didn't return JSON — fall through with empty detail */
    }
    throw new ClaudeUpstreamError(
      `Claude API returned ${res.status}${detail ? `: ${detail}` : ''}`,
      res.status === 429 ? 429 : 502
    );
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  if (!text) {
    throw new ClaudeUpstreamError('Claude returned an empty response.', 502);
  }
  return text;
}

/**
 * Claude is instructed to return strict JSON, but models occasionally
 * wrap it in a fenced code block or add stray whitespace. This strips
 * the common wrapping before JSON.parse, without attempting to repair
 * genuinely malformed JSON — that failure should surface, not be
 * silently patched over.
 * @param {string} text
 * @returns {any}
 */
function parseJsonResponse(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : text;
  return JSON.parse(candidate.trim());
}

module.exports = { callClaude, parseJsonResponse, ClaudeConfigError, ClaudeUpstreamError };
