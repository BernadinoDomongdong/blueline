/**
 * tabs.js — switches between the Inspect / Ask AI / Reports panels.
 */

export function initTabs() {
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panels = Array.from(document.querySelectorAll('.tab-panel'));

  function activate(name) {
    for (const tab of tabs) {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    }
    for (const panel of panels) {
      panel.classList.toggle('is-active', panel.dataset.tabPanel === name);
    }
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => activate(tab.dataset.tab));
  }

  return { activate };
}
