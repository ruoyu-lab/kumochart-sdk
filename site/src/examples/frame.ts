// The frame of a live example: it fills the frame with `#chart`, follows the theme of the page
// around it, and shows the errors of the example's code instead of failing silently.
import './frame.css';

export type SiteTheme = 'light' | 'dark';

const listeners = new Set<(theme: SiteTheme) => void>();

/** The page the frame is in; the frame itself when it is opened on its own. */
const host = window.parent === window ? null : window.parent.document.documentElement;
const media = window.matchMedia('(prefers-color-scheme: dark)');

function readTheme(): SiteTheme {
  if (host) {
    return host.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  return media.matches ? 'dark' : 'light';
}

let theme = readTheme();
document.documentElement.dataset.theme = theme;

function update(): void {
  const next = readTheme();

  if (next !== theme) {
    theme = next;
    document.documentElement.dataset.theme = theme;

    for (const listener of listeners) {
      listener(theme);
    }
  }
}

if (host) {
  new MutationObserver(update).observe(host, { attributes: true, attributeFilter: ['data-theme'] });
} else {
  media.addEventListener('change', update);
}

/** The theme of the site: light or dark. */
export function currentTheme(): SiteTheme {
  return theme;
}

/** Calls `listener` when the site changes theme; returns the function that stops it. */
export function onThemeChange(listener: (theme: SiteTheme) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function showError(error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const element = document.createElement('pre');
  element.className = 'frame-error';
  element.textContent = message;
  document.body.append(element);
}

window.addEventListener('error', (event) => {
  showError(event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  showError(event.reason);
});
