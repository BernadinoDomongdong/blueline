/**
 * lib/llmClient.js — provider-agnostic LLM client. Runs only on
 * Vercel's servers; no API key of any kind ever reaches the browser.
 *
 * Selected by LLM_PROVIDER (see .env.example for the full list and
 * setup instructions):
 *   - "openrouter" (default) — OpenRouter's unified API. One key,
 *     hundreds of models — Claude, GPT, Gemini, and a rotating set of
 *     free community-hosted models. FREE_MODELS / PAID_MODELS below
 *     are a curated, periodically-refreshed shortlist for this app's
 *     structured-JSON extraction workload; any other OpenRouter model
 *     id also works, just paste it into OPENROUTER_MODEL.
 *   - "custom" — any OpenAI-compatible /chat/completions endpoint: a
 *     local model (Ollama, LM Studio, vLLM) or an org's own internal
 *     LLM gateway.
 *   - "anthropic" — calls the real Anthropic Messages API directly,
 *     no middleman.
 *
 * Every provider is normalized to the same callLLM({system, messages,
 * maxTokens, temperature}) → Promise<string> shape, so nothing else in
 * this codebase needs to know which one is active.
 */

'use strict';

const UPSTREAM_TIMEOUT_MS = 55 * 1000;

class LLMConfigError extends Error {}
class LLMUpstreamError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// ── Curated OpenRouter model shortlist ─────────────────────────────
// Snapshot taken directly from https://openrouter.ai/api/v1/models in
// July 2026, picked for this app's actual job — reading SQL/DAX/Power
// Query and returning strict-schema lineage JSON — so weighted toward
// strong coding/structured-output benchmarks and generous context
// windows (SSAS query sets can be long). OpenRouter's free-model
// roster in particular rotates often; if a ":free" id below ever 404s,
// browse https://openrouter.ai/models?q=free for its current
// replacement and just paste the new id into OPENROUTER_MODEL — no
// code change needed either way.
const FREE_MODELS = [
  { id: 'poolside/laguna-m.1:free', note: 'Best free pick for this app — a dedicated coding-agent model, good at parsing SQL/DAX into structured JSON. 256K context.' },
  { id: 'tencent/hy3:free', note: 'Large (295B) general reasoning model, solid fallback. 262K context.' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', note: 'Frontier-scale reasoning model with a 1M-token context — useful for very large source-query sets.' },
  { id: 'poolside/laguna-xs-2.1:free', note: 'Smaller/faster coding-agent model — good if you are hitting the larger free model\'s rate limit.' },
];
const PAID_MODELS = [
  { id: 'anthropic/claude-sonnet-5', note: 'Recommended default — the model this app\'s prompts were originally written for. Strong, well-priced.' },
  { id: 'anthropic/claude-opus-4.8', note: 'Anthropic\'s most capable model — worth it for large or messy source sets.' },
  { id: 'openai/gpt-5.6-sol', note: 'OpenAI\'s flagship — strong coding/reasoning benchmarks, 1M context.' },
  { id: 'google/gemini-3.5-flash', note: 'Near-flagship coding quality at a fraction of the cost, 1M context — good value default.' },
  { id: 'z-ai/glm-5.2', note: 'Cheapest of this list with a 1M context window — good for high-volume or budget-conscious use.' },
];
const DEFAULT_OPENROUTER_MODEL = FREE_MODELS[0].id;

function getProvider() {
  const raw = (process.env.LLM_PROVIDER || 'openrouter').toLowerCase().trim();
  if (!['openrouter', 'custom', 'anthropic'].includes(raw)) {
    throw new LLMConfigError(
      `LLM_PROVIDER is set to "${raw}", which isn't recognized. Use "openrouter", "custom", or "anthropic" — see .env.example.`
    );
  }
  return raw;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new LLMUpstreamError('The model did not respond in time.', 504);
    }
    throw new LLMUpstreamError(`Could not reach the model provider: ${err.message}`, 502);
  } finally {
    clearTimeout(timeout);
  }
}

/** Shared request/response handling for OpenAI-style Chat Completions APIs — used by both "openrouter" and "custom". */
async function callOpenAiCompatible({ url, apiKey, model, system, messages, maxTokens, temperature, providerLabel, extraHeaders = {} }) {
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || (typeof body?.error === 'string' ? body.error : '');
    } catch {
      /* upstream didn't return JSON — fall through with empty detail */
    }
    throw new LLMUpstreamError(
      `${providerLabel} returned ${res.status}${detail ? `: ${detail}` : ''}`,
      res.status === 429 ? 429 : 502
    );
  }

  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content || '').trim();
  if (!text) {
    throw new LLMUpstreamError(`${providerLabel} returned an empty response.`, 502);
  }
  return text;
}

async function callOpenRouter({ system, messages, maxTokens, temperature }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new LLMConfigError(
      'OPENROUTER_API_KEY is not set on this deployment. Add it in Vercel → ' +
        'Settings → Environment Variables (see README / .env.example), or get one free at https://openrouter.ai/keys.'
    );
  }
  const model = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  return callOpenAiCompatible({
    url: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey,
    model,
    system,
    messages,
    maxTokens,
    temperature,
    providerLabel: 'OpenRouter',
    extraHeaders: {
      // Attribution only — OpenRouter's own leaderboard/analytics.
      // Optional, doesn't affect billing or behavior.
      ...(process.env.OPENROUTER_SITE_URL ? { 'HTTP-Referer': process.env.OPENROUTER_SITE_URL } : {}),
      'X-Title': process.env.OPENROUTER_SITE_NAME || 'Blueline',
    },
  });
}

async function callCustom({ system, messages, maxTokens, temperature }) {
  const baseUrl = process.env.CUSTOM_LLM_BASE_URL;
  if (!baseUrl) {
    throw new LLMConfigError(
      'LLM_PROVIDER is "custom" but CUSTOM_LLM_BASE_URL is not set. Point it at an ' +
        "OpenAI-compatible /chat/completions endpoint — a local model (Ollama, LM " +
        "Studio, vLLM) or your org's own LLM gateway (see .env.example)."
    );
  }
  const model = process.env.CUSTOM_LLM_MODEL;
  if (!model) {
    throw new LLMConfigError('LLM_PROVIDER is "custom" but CUSTOM_LLM_MODEL is not set — see .env.example.');
  }
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  return callOpenAiCompatible({
    url,
    apiKey: process.env.CUSTOM_LLM_API_KEY || '',
    model,
    system,
    messages,
    maxTokens,
    temperature,
    providerLabel: 'Your custom model endpoint',
  });
}

async function callAnthropicDirect({ system, messages, maxTokens, temperature }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new LLMConfigError(
      'LLM_PROVIDER is "anthropic" but ANTHROPIC_API_KEY is not set. Add it in Vercel → ' +
        'Settings → Environment Variables (see README), or get one at https://console.anthropic.com/settings/keys.'
    );
  }
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || '';
    } catch {
      /* upstream didn't return JSON */
    }
    throw new LLMUpstreamError(
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
    throw new LLMUpstreamError('Claude returned an empty response.', 502);
  }
  return text;
}

/**
 * Calls whichever LLM provider is configured (LLM_PROVIDER) and
 * returns plain response text. Throws LLMConfigError if required
 * config is missing, or LLMUpstreamError if the provider returns a
 * non-2xx response or times out.
 *
 * @param {Object} params
 * @param {string} params.system
 * @param {Array<{role: 'user'|'assistant', content: string}>} params.messages
 * @param {number} [params.maxTokens]
 * @param {number} [params.temperature]
 * @returns {Promise<string>}
 */
async function callLLM({ system, messages, maxTokens = 4096, temperature = 0 }) {
  const provider = getProvider();
  if (provider === 'custom') return callCustom({ system, messages, maxTokens, temperature });
  if (provider === 'anthropic') return callAnthropicDirect({ system, messages, maxTokens, temperature });
  return callOpenRouter({ system, messages, maxTokens, temperature });
}

/**
 * Models occasionally wrap strict JSON in a fenced code block or add
 * stray whitespace, regardless of provider. This strips the common
 * wrapping before JSON.parse, without attempting to repair genuinely
 * malformed JSON — that failure should surface, not be silently
 * patched over.
 * @param {string} text
 * @returns {any}
 */
function parseJsonResponse(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : text;
  return JSON.parse(candidate.trim());
}

/**
 * What's actually configured right now, for display only — used by
 * api/model-info.js. Never includes a key.
 * @returns {{ provider: string, model: string }}
 */
function getActiveModelInfo() {
  const provider = (process.env.LLM_PROVIDER || 'openrouter').toLowerCase().trim();
  if (provider === 'custom') return { provider: 'custom', model: process.env.CUSTOM_LLM_MODEL || '(not set)' };
  if (provider === 'anthropic') return { provider: 'anthropic', model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5' };
  return { provider: 'openrouter', model: process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL };
}

module.exports = {
  callLLM,
  parseJsonResponse,
  getActiveModelInfo,
  FREE_MODELS,
  PAID_MODELS,
  LLMConfigError,
  LLMUpstreamError,
};
