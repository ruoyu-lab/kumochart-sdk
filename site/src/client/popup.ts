/**
 * A button opening the menu after it: a click opens or closes it, a click elsewhere or Escape
 * closes it, and opening it puts the focus on its checked item. Returns the function closing it.
 */
export function initPopup(toggle: HTMLButtonElement, menu: HTMLElement): () => void {
  const close = () => {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };

  toggle.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));

    if (open) {
      menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target as Node;

    if (!menu.hidden && !menu.contains(target) && !toggle.contains(target)) {
      close();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      close();
      toggle.focus();
    }
  });

  return close;
}
