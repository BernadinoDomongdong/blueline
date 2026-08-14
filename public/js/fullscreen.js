/**
 * fullscreen.js — an in-app "focus mode" for the diagram: collapses
 * both sidebars so the canvas fills the row. Deliberately not the
 * browser's native Fullscreen API (no permission prompt, works the
 * same whether or not the page is embedded, and Escape still closes
 * any open modal first the same way it always did).
 */

// Matches --motion-base in tokens.css — how long the sidebar-collapse
// transition takes, so the post-toggle fit() waits for it to finish
// instead of fitting mid-animation.
const TRANSITION_MS = 220;

/** @param {import('./graphView.js').GraphView} graphView */
export function initFullscreen(graphView) {
  const btn = document.getElementById('fullscreenBtn');
  const body = document.querySelector('.app__body');
  if (!btn || !body) return;

  let isFullscreen = false;

  function setFullscreen(on) {
    isFullscreen = on;
    body.classList.toggle('is-fullscreen', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Exit fullscreen' : 'Fullscreen the diagram';
    btn.textContent = on ? '⤡' : '⛶';
    // The container resize itself is already kept in sync live by
    // GraphView's own ResizeObserver — this is only about re-centering
    // the view once the transition settles, a deliberate one-time
    // reaction to this specific user action rather than something
    // that should happen on every intermediate resize tick.
    setTimeout(() => graphView.fit(), TRANSITION_MS);
  }

  btn.addEventListener('click', () => setFullscreen(!isFullscreen));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isFullscreen) setFullscreen(false);
  });
}
