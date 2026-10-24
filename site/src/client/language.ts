import { LANGUAGE_STORAGE_KEY } from '../shared/storage-keys';
import { isLanguage } from '../shared/ui-text';
import { initPopup } from './popup';
import { store } from './storage';

/** The language of the address, such as `en` for `/en/data/`, or `null`. */
function addressLanguage(): string | null {
  return /^\/([^/]+)\//.exec(window.location.pathname)?.[1] ?? null;
}

/**
 * The language menu, whose items open the page in another language; and the language the reader
 * reads in, remembered for the next visit of the site's root.
 */
export function initLanguage(): void {
  const toggle = document.querySelector<HTMLButtonElement>('[data-language-toggle]');
  const menu = toggle?.nextElementSibling;

  if (toggle && menu instanceof HTMLElement) {
    initPopup(toggle, menu);
  }

  const language = addressLanguage();

  if (language !== null && isLanguage(language)) {
    store(LANGUAGE_STORAGE_KEY, language);
  }
}

/** The page of a missing address shows its text in the language of the address. */
export function initNotFound(): void {
  const blocks = document.querySelectorAll<HTMLElement>('[data-not-found]');
  const language = addressLanguage();

  if (blocks.length === 0 || language === null || !isLanguage(language)) {
    return;
  }

  for (const block of blocks) {
    block.hidden = block.dataset.notFound !== language;
  }
}
