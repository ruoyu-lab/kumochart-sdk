import { THEME_STORAGE_KEY } from '../shared/storage-keys';
import { initPopup } from './popup';
import { store } from './storage';

type Preference = 'system' | 'light' | 'dark';

const root = document.documentElement;
const media = window.matchMedia('(prefers-color-scheme: dark)');

function preference(): Preference {
  const value = root.dataset.themePreference;
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** Sets `data-theme` to the theme shown, from the preference and the system. */
function apply(value: Preference): void {
  root.dataset.themePreference = value;
  root.dataset.theme = value === 'dark' || (value === 'system' && media.matches) ? 'dark' : 'light';

  for (const option of document.querySelectorAll<HTMLElement>('[data-theme-option]')) {
    option.setAttribute('aria-checked', String(option.dataset.themeOption === value));
  }
}

/** The theme menu: follow the system, or always light or dark. */
export function initTheme(): void {
  const toggle = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
  const menu = toggle?.nextElementSibling;

  apply(preference());
  media.addEventListener('change', () => {
    apply(preference());
  });

  if (!toggle || !(menu instanceof HTMLElement)) {
    return;
  }

  const close = initPopup(toggle, menu);

  menu.addEventListener('click', (event) => {
    const option = (event.target as Element).closest<HTMLElement>('[data-theme-option]');
    const value = option?.dataset.themeOption;

    if (value === 'system' || value === 'light' || value === 'dark') {
      store(THEME_STORAGE_KEY, value);
      apply(value);
      close();
      toggle.focus();
    }
  });
}
