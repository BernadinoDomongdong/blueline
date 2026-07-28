/**
 * toast.js — brief, dismissable-by-timeout notifications.
 */

const TOAST_DURATION_MS = 6000;

export function showToast(message, kind = 'info') {
  const region = document.getElementById('toastRegion');
  if (!region) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.kind = kind;
  el.textContent = message;
  region.appendChild(el);
  setTimeout(() => el.remove(), TOAST_DURATION_MS);
}
