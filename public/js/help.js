/**
 * help.js — the "How to use Blueline" modal. Deliberately independent
 * of EditMode's modal (separate overlay element, separate open/close
 * state) so the two can never interfere with each other.
 */

export function initHelp() {
  const btn = document.getElementById('helpBtn');
  const overlay = document.getElementById('helpModal');
  const closeBtn = document.getElementById('helpModalClose');
  if (!btn || !overlay || !closeBtn) return;

  const open = () => {
    overlay.hidden = false;
  };
  const close = () => {
    overlay.hidden = true;
  };

  btn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(); // click on the dim backdrop, not the modal itself
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) close();
  });
}
