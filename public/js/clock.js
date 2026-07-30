/**
 * clock.js — a small live digital clock in the header. Purely
 * decorative/orienting (no timezone logic beyond the browser's own
 * local time) — updates once a second via setInterval.
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

export function initClock() {
  const el = document.getElementById('digitalClock');
  if (!el) return;

  function tick() {
    const now = new Date();
    el.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    el.dateTime = now.toISOString();
  }

  tick();
  const id = setInterval(tick, 1000);
  // Not strictly necessary for a single-page app that never tears this
  // down, but keeps the intent explicit for anyone extending this later.
  window.addEventListener('beforeunload', () => clearInterval(id));
}
