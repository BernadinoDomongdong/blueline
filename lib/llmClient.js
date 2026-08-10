/**
 * lib/llmClient.js — provider-agnostic LLM client. Runs only on
 * Vercel's servers; no API key of any kind ever reaches the browser.
 *
 * Selected by LLM_PROVIDER (see .env.example for the full list and
 * setup instructions):
 *   - "openrouter" (default) — OpenRouter's unified API. One key,
 *     hundreds of models — Claude, GPT, Gemini, and a rotating set of
 *     free community-hosted models. The free/paid shortlists surfaced
 *     in the UI's model picker (see api/models.js) are fetched live
 *     from OpenRouter's own /models endpoint and cached briefly (see
 *     loadCatalog below) — not hardcoded, since that list goes stale
 *     as soon as a given free-tier window rotates. Any other
 *     OpenRouter model id also works from .env, just not selectable
 *     live in the picker.
 *   - "custom" — any OpenAI-compatible /chat/completions endpoint: a
 *     local model (Ollama, LM Studio, vLLM) or an org's own internal
 *     LLM gateway. Single fixed model — the UI model picker is hidden
 *     for this provider.
 *   - "anthropic" — calls the real Anthropic Messages API directly,
 *     no middleman. Also a single fixed model.
 *
 * Every provider is normalized to the same callLLM({system, messages,
 * maxTokens, temperature, model}) → Promise<string> shape, so nothing
 * else in this codebase needs to know which one is active.
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

// ── Live OpenRouter model catalog ──────────────────────────────────
// A hardcoded snapshot goes stale the moment OpenRouter's free-tier
// roster rotates (which it does often — free windows on individual
// models can run out in weeks). Fetching live and caching briefly
// gets freshness without paying the latency cost on every request.
const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
const KNOWN_PROVIDER_PREFIXES = ['anthropic/', 'openai/', 'google/', 'z-ai/', 'deepseek/', 'meta-llama/', 'mistralai/', 'x-ai/'];
const MAX_FREE_MODELS = 6;
const MAX_PAID_MODELS = 8;
// Last-resort default when the live catalog can't be reached at all
// and no OPENROUTER_MODEL is configured. OpenRouter's own auto-router
// — not a specific model id, so it can't go stale the way a pinned
// model id would.
const EMERGENCY_FALLBACK_MODEL = 'openrouter/auto';

/** @type {{ data: {free: Array, paid: Array}, fetchedAt: number }|null} */
let catalogCache = null;
/** @type {Promise<{free: Array, paid: Array}>|null} de-dupes concurrent cache misses into one upstream call */
let catalogFetchPromise = null;

function isFreeModel(model) {
  return Number(model.pricing?.prompt) === 0 && Number(model.pricing?.completion) === 0;
}

function toModelEntry(model) {
  return {
    id: model.id,
    label: model.name || model.id,
    note: (model.description || '').slice(0, 160),
    contextLength: model.context_length || model.top_provider?.context_length || 0,
  };
}

async function fetchLiveCatalog() {
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) {
    throw new LLMUpstreamError(`OpenRouter's model list returned ${res.status}`, res.status === 429 ? 429 : 502);
  }
  const body = await res.json();
  const all = Array.isArray(body.data) ? body.data : [];

  const free = all
    .filter(isFreeModel)
    .sort((a, b) => (b.context_length || 0) - (a.context_length || 0))
    .slice(0, MAX_FREE_MODELS)
    .map(toModelEntry);

  const paid = all
    .filter((m) => !isFreeModel(m) && KNOWN_PROVIDER_PREFIXES.some((p) => m.id.startsWith(p)))
    .sort((a, b) => (b.context_length || 0) - (a.context_length || 0))
    .slice(0, MAX_PAID_MODELS)
    .map(toModelEntry);

  return { free, paid };
}

/** Cached, de-duped access to the live free/paid model lists. */
async function loadCatalog() {
  const now = Date.now();
  if (catalogCache && now - catalogCache.fetchedAt < CATALOG_CACHE_TTL_MS) {
    return catalogCache.data;
  }
  if (catalogFetchPromise) return catalogFetchPromise;

  catalogFetchPromise = fetchLiveCatalog()
    .then((data) => {
      catalogCache = { data, fetchedAt: Date.now() };
      return data;
    })
    .finally(() => {
      catalogFetchPromise = null;
    });
  return catalogFetchPromise;
}

/** Whether the deployment allows selecting a paid model from the UI at all. Defaults to true; set ALLOW_PAID_MODELS=false to lock a public deployment to the free tier only. */
function paidModelsAllowed() {
  return (process.env.ALLOW_PAID_MODELS || 'true').toLowerCase().trim() !== 'false';
}

/**
 * Validates a model id a client requested against the live catalog —
 * never trust a client-supplied string as a literal upstream model
 * id, since it directly determines which provider model gets billed.
 * Returns null (not a fallback id) on no match or an unreachable
 * catalog, so the caller can fall through to its own configured
 * default rather than silently picking something.
 * @param {string|undefined|null} requestedId
 * @returns {Promise<string|null>}
 */
async function sanitizeModelChoice(requestedId) {
  if (!requestedId) return null;
  try {
    const { free, paid } = await loadCatalog();
    const match = [...free, ...paid].find((m) => m.id === requestedId);
    if (!match) return null;
    const isPaidChoice = paid.some((m) => m.id === match.id);
    if (isPaidChoice && !paidModelsAllowed()) return null;
    return match.id;
  } catch {
    return null; // catalog unreachable — fall back rather than trust an unverified client string
  }
}

/**
 * The data behind the UI's model picker (api/models.js).
 * @returns {Promise<{ provider: string, free: Array, paid: Array, allowPaid: boolean, default: string|null, error?: string }>}
 */
async function getModelCatalog() {
  const provider = (process.env.LLM_PROVIDER || 'openrouter').toLowerCase().trim();
  if (provider !== 'openrouter') {
    return { provider, free: [], paid: [], allowPaid: paidModelsAllowed(), default: null };
  }
  try {
    const { free, paid } = await loadCatalog();
    return { provider, free, paid, allowPaid: paidModelsAllowed(), default: free[0]?.id || paid[0]?.id || null };
  } catch {
    return {
      provider,
      free: [],
      paid: [],
      allowPaid: paidModelsAllowed(),
      default: null,
      error: "Could not load the live model list from OpenRouter — try again shortly, or set OPENROUTER_MODEL to pin a specific model.",
    };
  }
}

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

async function callOpenRouter({ system, messages, maxTokens, temperature, model: requestedModel }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new LLMConfigError(
      'OPENROUTER_API_KEY is not set on this deployment. Add it in Vercel → ' +
        'Settings → Environment Variables (see README / .env.example), or get one free at https://openrouter.ai/keys.'
    );
  }
  // A model chosen in the UI picker takes precedence over the .env
  // default, but only after passing sanitizeModelChoice — see its
  // doc comment for why a client-supplied id is never used verbatim.
  const sanitized = requestedModel ? await sanitizeModelChoice(requestedModel) : null;
  const model = sanitized || process.env.OPENROUTER_MODEL || EMERGENCY_FALLBACK_MODEL;
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
 * @param {string} [params.model] - a model id from the UI picker (openrouter only; validated against the curated shortlist, ignored for other providers since they're single-model).
 * @returns {Promise<string>}
 */
async function callLLM({ system, messages, maxTokens = 4096, temperature = 0, model }) {
  const provider = getProvider();
  if (provider === 'custom') return callCustom({ system, messages, maxTokens, temperature });
  if (provider === 'anthropic') return callAnthropicDirect({ system, messages, maxTokens, temperature });
  return callOpenRouter({ system, messages, maxTokens, temperature, model });
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
  return { provider: 'openrouter', model: process.env.OPENROUTER_MODEL || `${EMERGENCY_FALLBACK_MODEL} (or whichever model is picked in the UI)` };
}

module.exports = {
  callLLM,
  parseJsonResponse,
  getActiveModelInfo,
  getModelCatalog,
  sanitizeModelChoice,
  LLMConfigError,
  LLMUpstreamError,
};
