/**
 * modelPicker.js — the "choose a model" control, styled after the
 * BERN-AI reference: a Free/Paid toggle, a dropdown of curated
 * OpenRouter models, and a capacity bar showing the selected model's
 * context window. Only meaningful when this deployment's
 * LLM_PROVIDER is "openrouter" — "custom" and "anthropic" deployments
 * are a single fixed model, so the whole control hides itself.
 *
 * The curated free/paid lists themselves live server-side
 * (lib/llmClient.js) and are fetched once from /api/models — this
 * module never invents a model id itself, so whatever it lets someone
 * pick is guaranteed to be something the server will actually accept
 * (see llmClient.sanitizeModelChoice for why that matters).
 */

import { api } from './api.js';

const MAX_CONTEXT_FOR_BAR = 1_000_000; // fills the bar at a 1M-token context — the largest in the curated list

function formatContext(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

export class ModelPicker {
  /**
   * @param {Object} deps
   * @param {import('./state.js').createStore} deps.store
   */
  constructor({ store }) {
    this.store = store;
    this.root = document.getElementById('modelPicker');
    this.tierFreeBtn = document.getElementById('modelTierFree');
    this.tierPaidBtn = document.getElementById('modelTierPaid');
    this.select = document.getElementById('modelSelect');
    this.hint = document.getElementById('modelHint');
    this.capacityLabel = document.getElementById('modelCapacityLabel');
    this.capacityBar = document.getElementById('modelCapacityBarFill');

    this.catalog = null; // { provider, free, paid, allowPaid, default }
    this.tier = 'free';

    this.tierFreeBtn.addEventListener('click', () => this._setTier('free'));
    this.tierPaidBtn.addEventListener('click', () => this._setTier('paid'));
    this.select.addEventListener('change', () => this._applySelection());

    this._load();
  }

  async _load() {
    try {
      const catalog = await api.models();
      this.catalog = catalog;
      if (catalog.provider !== 'openrouter') {
        // A single fixed model — nothing to pick. Leave selectedModel
        // as null so every API call falls back to the server's own
        // configured default, and hide the picker entirely.
        this.root.hidden = true;
        return;
      }
      this._setTier('free');
    } catch {
      // Not fatal — every API call still works with the server's
      // env-configured default model when selectedModel stays null.
      this.root.hidden = true;
    }
  }

  _setTier(tier) {
    if (!this.catalog) return; // catalog still loading (or failed) — buttons are effectively inert until then
    if (tier === 'paid' && !this.catalog.allowPaid) return; // disabled server-side for this deployment
    this.tier = tier;
    this.tierFreeBtn.classList.toggle('is-active', tier === 'free');
    this.tierPaidBtn.classList.toggle('is-active', tier === 'paid');
    this.tierPaidBtn.disabled = !this.catalog?.allowPaid;
    this.tierPaidBtn.title = this.catalog?.allowPaid ? '' : 'Paid models are disabled on this deployment.';

    const list = tier === 'free' ? this.catalog.free : this.catalog.paid;
    this.select.innerHTML = list.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
    this.hint.textContent =
      tier === 'free' ? `${list.length} free model${list.length === 1 ? '' : 's'} ready — pick one.` : `${list.length} paid models — billed per-token by OpenRouter.`;

    this._applySelection();
  }

  _applySelection() {
    const list = this.tier === 'free' ? this.catalog.free : this.catalog.paid;
    const model = list.find((m) => m.id === this.select.value) || list[0];
    if (!model) return;
    this.select.value = model.id;
    this.store.set({ selectedModel: model.id });

    const pct = Math.min(100, Math.round((model.contextLength / MAX_CONTEXT_FOR_BAR) * 100));
    this.capacityBar.style.width = `${pct}%`;
    this.capacityLabel.textContent = `Capacity: ~${formatContext(model.contextLength)} tokens`;
    this.select.title = model.note;
  }
}
