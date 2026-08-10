/**
 * toast.js — brief, dismissable-by-timeout notifications, optionally
 * with a single action button (e.g. "Undo").
 */

const TOAST_DURATION_MS = 6000;

/**
 * @param {string} message
 * @param {'info'|'error'} [kind]
 * @param {{ label: string, onClick: () => void }} [action] - an optional single action button; clicking it also dismisses the toast.
 */
export function showToast(message, kind = 'info', action) {
  const region = document.getElementById('toastRegion');
  if (!region) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.kind = kind;

  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);

  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast__action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      action.onClick();
      el.remove();
    });
    el.appendChild(btn);
  }

  region.appendChild(el);
  setTimeout(() => el.remove(), TOAST_DURATION_MS);
}
