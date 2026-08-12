/**
 * aiSettings.js — bring-your-own-key settings for the optional AI
 * features (Ask AI, Reports). Lineage extraction never touches this
 * at all — it's a local Python parser, always, with or without any of
 * this configured.
 *
 * The credential lives only in this browser's localStorage. It's
 * never sent anywhere except as part of a request to /api/ask or
 * /api/report, which forwards it straight to whichever provider was
 * picked for that single request and never persists it server-side
 * (see lib/llmClient.js) — there's no account system and no database
 * here for it to live in even if that were the intent.
 */

import { showToast } from './toast.js';

const STORAGE_KEY = 'blueline_ai_credential';
const DEFAULT_MODEL_BY_PROVIDER = {
  anthropic: 'claude-sonnet-5',
  openrouter: 'openrouter/auto',
  custom: '',
};

const changeListeners = [];

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && parsed.provider ? parsed : null;
  } catch {
    return null; // corrupted or inaccessible storage — behave as if nothing were configured
  }
}

function writeStored(credential) {
  try {
    if (credential) localStorage.setItem(STORAGE_KEY, JSON.stringify(credential));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage unavailable (private browsing, full quota) — the credential just won't survive a reload this session */
  }
  for (const cb of changeListeners) cb(credential);
}

/** @returns {{provider: string, apiKey: string, model: string, baseUrl?: string}|null} */
export function getCredential() {
  return readStored();
}

export function isAiConfigured() {
  return Boolean(readStored());
}

/** @param {(credential: object|null) => void} cb */
export function onCredentialChange(cb) {
  changeListeners.push(cb);
}

export function initAiSettings() {
  const btn = document.getElementById('aiSettingsBtn');
  const overlay = document.getElementById('aiSettingsModal');
  const closeBtn = document.getElementById('aiSettingsClose');
  const form = document.getElementById('aiSettingsForm');
  const clearBtn = document.getElementById('aiSettingsClear');
  const providerSelect = document.getElementById('aiProvider');
  const baseUrlField = document.getElementById('aiBaseUrlField');
  const baseUrlInput = document.getElementById('aiBaseUrl');
  const apiKeyInput = document.getElementById('aiApiKey');
  const modelInput = document.getElementById('aiModel');
  const keyOptionalHint = document.getElementById('aiKeyOptionalHint');
  if (!btn || !overlay || !form) return;

  function updateButtonLabel() {
    const cred = readStored();
    btn.textContent = cred ? `AI: ${cred.provider}` : 'AI: Off';
    btn.classList.toggle('btn--active', Boolean(cred));
  }

  function syncFieldsToProvider() {
    const provider = providerSelect.value;
    baseUrlField.hidden = provider !== 'custom';
    modelInput.placeholder = provider === 'custom' ? 'Required for a custom endpoint' : `Default: ${DEFAULT_MODEL_BY_PROVIDER[provider]}`;
    keyOptionalHint.textContent = provider === 'custom' ? ' (optional — only if your endpoint requires one)' : '';
  }

  function openModal() {
    const cred = readStored();
    providerSelect.value = cred?.provider || 'anthropic';
    apiKeyInput.value = cred?.apiKey || '';
    modelInput.value = cred && cred.model !== DEFAULT_MODEL_BY_PROVIDER[cred.provider] ? cred.model || '' : '';
    baseUrlInput.value = cred?.baseUrl || '';
    syncFieldsToProvider();
    overlay.hidden = false;
    providerSelect.focus();
  }

  function closeModal() {
    overlay.hidden = true;
  }

  btn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) closeModal();
  });
  providerSelect.addEventListener('change', syncFieldsToProvider);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const provider = providerSelect.value;
    const apiKey = apiKeyInput.value.trim();
    const model = modelInput.value.trim();
    const baseUrl = baseUrlInput.value.trim();

    if (provider !== 'custom' && !apiKey) {
      showToast(`An API key is required for ${provider}.`, 'error');
      return;
    }
    if (provider === 'custom') {
      if (!baseUrl) {
        showToast('A base URL is required for a custom endpoint.', 'error');
        return;
      }
      if (!/^https?:\/\//i.test(baseUrl)) {
        showToast('That base URL must start with http:// or https://.', 'error');
        return;
      }
      if (!model) {
        showToast('A model name is required for a custom endpoint.', 'error');
        return;
      }
    }

    writeStored({
      provider,
      apiKey,
      model: model || DEFAULT_MODEL_BY_PROVIDER[provider],
      ...(provider === 'custom' ? { baseUrl } : {}),
    });
    updateButtonLabel();
    closeModal();
    showToast('AI settings saved — Ask AI and Reports are ready.');
  });

  clearBtn.addEventListener('click', () => {
    writeStored(null);
    form.reset();
    updateButtonLabel();
    closeModal();
    showToast('AI credential cleared.');
  });

  updateButtonLabel();
}
