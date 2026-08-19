/**
 * theme.js — dark/light toggle. Blueline's dark "blueprint" theme is
 * the original design and stays the default; light is an alternate
 * palette (see tokens.css [data-theme="light"]) for anyone who prefers
 * it or is in a bright room. Preference persists in localStorage (this
 * is a real static site, not a chat-embedded artifact, so localStorage
 * is fine here) and falls back to the OS-level prefers-color-scheme on
 * a first visit.
 */

const STORAGE_KEY = 'blueline-theme';

function systemPrefersLight() {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches;
}

export function initTheme({ onChange } = {}) {
  const toggleBtn = document.getElementById('themeToggle');
  const root = document.documentElement;

  function apply(theme) {
    root.dataset.theme = theme;
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-pressed', String(theme === 'light'));
      toggleBtn.textContent = theme === 'light' ? '☾' : '☀';
      toggleBtn.title = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
    }
    onChange?.(theme);
  }

  let stored;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null; // private browsing / storage disabled — just won't persist across visits
  }
  apply(stored === 'light' || stored === 'dark' ? stored : systemPrefersLight() ? 'light' : 'dark');

  toggleBtn?.addEventListener('click', () => {
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    apply(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* nothing further to do if storage is unavailable */
    }
  });
}
