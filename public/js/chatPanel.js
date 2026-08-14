/**
 * chatPanel.js — the "Ask AI" tab. Sends the question plus the current
 * lineage graph to /api/ask on every turn; there's no server-side
 * session, so grounding is only ever as fresh as the graph in state.
 */

import { api } from './api.js';
import { showToast } from './toast.js';
import { getCredential } from './aiSettings.js';

export class ChatPanel {
  /** @param {Object} deps @param {ReturnType<typeof import('./state.js').createStore>} deps.store */
  constructor({ store }) {
    this.store = store;
    this.logEl = document.getElementById('chatLog');
    this.formEl = document.getElementById('chatForm');
    this.inputEl = document.getElementById('chatInput');

    this.formEl.addEventListener('submit', (e) => this._handleSubmit(e));
  }

  async _handleSubmit(e) {
    e.preventDefault();
    const question = this.inputEl.value.trim();
    if (!question) return;

    const { graph } = this.store.get();
    if (graph.nodes.length === 0) {
      showToast('Infer or import a lineage graph before asking questions about it.', 'error');
      return;
    }

    this._appendMessage(question, 'user');
    this.inputEl.value = '';
    this.inputEl.disabled = true;
    const pendingEl = this._appendMessage('Thinking…', 'assistant');

    try {
      const { answer } = await api.ask(question, graph, getCredential());
      pendingEl.textContent = '';
      pendingEl.innerHTML = renderInlineMarkdown(answer);
    } catch (err) {
      pendingEl.textContent = `Couldn't get an answer: ${err.message}`;
    } finally {
      this.inputEl.disabled = false;
      this.inputEl.focus();
    }
  }

  _appendMessage(text, role) {
    // Clear the initial empty-hint the first time a message is sent.
    const hint = this.logEl.querySelector('.empty-hint');
    hint?.remove();

    const el = document.createElement('div');
    el.className = `chat-message chat-message--${role}`;
    el.textContent = text;
    this.logEl.appendChild(el);
    this.logEl.scrollTop = this.logEl.scrollHeight;
    return el;
  }
}

/** Minimal, dependency-free markdown for short chat answers (bold + line breaks only). */
function renderInlineMarkdown(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
}
