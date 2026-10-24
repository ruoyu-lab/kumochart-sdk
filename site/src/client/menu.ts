/** The navigation as a drawer on narrow screens, and the current page kept in view. */
export function initMenu(): void {
  const toggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.querySelector<HTMLElement>('[data-menu-close]');

  if (!toggle || !sidebar || !backdrop) {
    return;
  }

  const current = sidebar.querySelector<HTMLElement>('[aria-current="page"]');

  if (current && current.offsetTop > sidebar.clientHeight * 0.6) {
    sidebar.scrollTop = current.offsetTop - sidebar.clientHeight / 3;
  }

  const setOpen = (open: boolean) => {
    document.body.classList.toggle('menu-open', open);
    backdrop.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };

  toggle.addEventListener('click', () => {
    setOpen(!document.body.classList.contains('menu-open'));

    if (document.body.classList.contains('menu-open')) {
      (current ?? sidebar.querySelector<HTMLElement>('a'))?.focus();
    }
  });

  backdrop.addEventListener('click', () => {
    setOpen(false);
  });

  sidebar.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a')) {
      setOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('menu-open')) {
      setOpen(false);
      toggle.focus();
    }
  });
}
