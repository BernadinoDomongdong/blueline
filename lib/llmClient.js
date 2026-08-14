/**
 * lib/llmClient.js — provider-agnostic LLM client. Runs only on
 * Vercel's servers.
 *
 * Two ways a call gets configured, in order of precedence:
 *   1. A visitor's own credential, entered client-side (see
 *      public/js/aiSettings.js) and sent per-request — never stored
 *      server-side, used only for that one outbound call, then
 *      discarded. This is "bring your own key": each person supplies
 *      their own account, so there's no shared budget for a public
 *      deployment to protect and no picker to maintain.
 *   2. This deployment's own server-side default (LLM_PROVIDER env
 *      var — see .env.example), if the deployer configured one and
 *      the visitor didn't bring their own key.
 *
 * Both resolve to the same plain shape — { provider, apiKey, model,
 * baseUrl? } — before either ever reaches an HTTP call, so the actual
 * provider-calling functions below don't need to know or care which
 * source it came from. That separation (resolve config → call
 * provider) is deliberate: config resolution can change (as it just
 * did, twice) without the HTTP-calling code changing at all.
 */

'use strict';

const UPSTREAM_TIMEOUT_MS = 55 * 1000;
const MAX_CLIENT_KEY_LENGTH = 512;
const MAX_CLIENT_MODEL_LENGTH = 200;
const MAX_CLIENT_BASEURL_LENGTH = 300;

const DEFAULT_MODEL_BY_PROVIDER = {
  anthropic: 'claude-sonnet-5',
  openrouter: 'openrouter/auto', // OpenRouter's own auto-router, not a pinned model id — can't go stale the way one would
  custom: '',
};

class LLMConfigError extends Error {}
class LLMUpstreamError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// ── Config resolution ────────────────────────────────────────────────

/**
 * Validates and normalizes a visitor's own credential (from the
 * request body). Never trusts it blindly — bounded lengths, a known
 * provider, and a real-looking base URL for "custom" — but it's still
 * the visitor's own key for their own account, so validation here is
 * about catching honest mistakes, not a security boundary the way
 * sanitizing a shared resource would be.
 * @param {any} raw
 * @returns {{ provider: string, apiKey: string, model: string, baseUrl?: string }}
 */
function resolveClientCredential(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new LLMConfigError('That AI credential is malformed.');
  }
  const provider = raw.provider;
  if (!['anthropic', 'openrouter', 'custom'].includes(provider)) {
    throw new LLMConfigError('AI provider must be "anthropic", "openrouter", or "custom".');
  }

  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
  if (apiKey.length > MAX_CLIENT_KEY_LENGTH) {
    throw new LLMConfigError('That API key is too long to be valid.');
  }
  if (provider !== 'custom' && !apiKey) {
    throw new LLMConfigError(`An API key is required for ${provider}.`);
  }

  const model = typeof raw.model === 'string' ? raw.model.trim().slice(0, MAX_CLIENT_MODEL_LENGTH) : '';

  let baseUrl;
  if (provider === 'custom') {
    baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '';
    if (!baseUrl) throw new LLMConfigError('A base URL is required for a custom endpoint.');
    if (baseUrl.length > MAX_CLIENT_BASEURL_LENGTH || !/^https?:\/\//i.test(baseUrl)) {
      throw new LLMConfigError("That base URL doesn't look valid — it must start with http:// or https://.");
    }
    if (!model) throw new LLMConfigError('A model name is required for a custom endpoint.');
  }

  return { provider, apiKey, model: model || DEFAULT_MODEL_BY_PROVIDER[provider], baseUrl };
}

/** This deployment's own server-side default, from LLM_PROVIDER and friends (see .env.example). Throws LLMConfigError if the deployer hasn't configured one. */
function resolveServerConfig() {
  const provider = (process.env.LLM_PROVIDER || '').toLowerCase().trim();
  if (!provider) {
    throw new LLMConfigError('No AI provider is configured for this deployment, and no personal API key was supplied.');
  }
  if (!['openrouter', 'custom', 'anthropic'].includes(provider)) {
    throw new LLMConfigError(`LLM_PROVIDER is set to "${provider}", which isn't recognized. Use "openrouter", "custom", or "anthropic" — see .env.example.`);
  }

  if (provider === 'custom') {
    const baseUrl = process.env.CUSTOM_LLM_BASE_URL;
    const model = process.env.CUSTOM_LLM_MODEL;
    if (!baseUrl || !model) {
      throw new LLMConfigError('LLM_PROVIDER is "custom" but CUSTOM_LLM_BASE_URL / CUSTOM_LLM_MODEL is not set — see .env.example.');
    }
    return { provider, apiKey: process.env.CUSTOM_LLM_API_KEY || '', model, baseUrl };
  }

  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new LLMConfigError(
        'LLM_PROVIDER is "anthropic" but ANTHROPIC_API_KEY is not set. Add it in Vercel → Settings → Environment Variables, or get one at https://console.anthropic.com/settings/keys.'
      );
    }
    return { provider, apiKey, model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL_BY_PROVIDER.anthropic };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new LLMConfigError(
      'LLM_PROVIDER is "openrouter" but OPENROUTER_API_KEY is not set. Add it in Vercel → Settings → Environment Variables, or get one free at https://openrouter.ai/keys.'
    );
  }
  return { provider, apiKey, model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL_BY_PROVIDER.openrouter };
}

// ── HTTP calls — take an already-resolved config, never read env vars or the request directly ──

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

/** Shared request/response handling for OpenAI-style Chat Completions APIs — used by "openrouter" and "custom". */
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
    throw new LLMUpstreamError(`${providerLabel} returned ${res.status}${detail ? `: ${detail}` : ''}`, res.status === 429 ? 429 : 502);
  }

  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content || '').trim();
  if (!text) {
    throw new LLMUpstreamError(`${providerLabel} returned an empty response.`, 502);
  }
  return text;
}

async function callOpenRouterHttp({ apiKey, model, system, messages, maxTokens, temperature }) {
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

async function callCustomHttp({ baseUrl, apiKey, model, system, messages, maxTokens, temperature }) {
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  return callOpenAiCompatible({
    url,
    apiKey: apiKey || '',
    model,
    system,
    messages,
    maxTokens,
    temperature,
    providerLabel: 'Your custom model endpoint',
  });
}

async function callAnthropicHttp({ apiKey, model, system, messages, maxTokens, temperature }) {
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
    throw new LLMUpstreamError(`Claude API returned ${res.status}${detail ? `: ${detail}` : ''}`, res.status === 429 ? 429 : 502);
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
 * Calls whichever LLM is configured — the visitor's own credential if
 * they supplied one, otherwise this deployment's server-side default.
 * Throws LLMConfigError if neither is available, or LLMUpstreamError
 * if the provider itself returns a non-2xx response or times out.
 *
 * @param {Object} params
 * @param {string} params.system
 * @param {Array<{role: 'user'|'assistant', content: string}>} params.messages
 * @param {number} [params.maxTokens]
 * @param {number} [params.temperature]
 * @param {any} [params.clientCredential] - raw credential object from the request body, if the visitor brought their own key.
 * @returns {Promise<string>}
 */
async function callLLM({ system, messages, maxTokens = 4096, temperature = 0, clientCredential }) {
  const cfg = clientCredential ? resolveClientCredential(clientCredential) : resolveServerConfig();
  const call = { system, messages, maxTokens, temperature };

  if (cfg.provider === 'anthropic') return callAnthropicHttp({ ...call, apiKey: cfg.apiKey, model: cfg.model });
  if (cfg.provider === 'custom') return callCustomHttp({ ...call, apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl });
  return callOpenRouterHttp({ ...call, apiKey: cfg.apiKey, model: cfg.model });
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
 * This deployment's own server-side default, for display only (the
 * footer, api/model-info.js) — never includes a key, and doesn't
 * reflect a visitor's own credential if they've set one, since that
 * lives only in their own browser and this endpoint has no way to see
 * it.
 * @returns {{ provider: string, model: string }|{ provider: null }}
 */
function getActiveModelInfo() {
  try {
    const cfg = resolveServerConfig();
    return { provider: cfg.provider, model: cfg.model };
  } catch {
    return { provider: null, model: null };
  }
}

module.exports = {
  callLLM,
  parseJsonResponse,
  getActiveModelInfo,
  LLMConfigError,
  LLMUpstreamError,
};
