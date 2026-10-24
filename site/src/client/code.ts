import { UI_TEXT, type Language } from '../shared/ui-text';

/** The copy buttons of the code blocks. */
export function initCode(language: Language): void {
  const text = UI_TEXT[language];

  document.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-copy]');
    const code = button?.parentElement?.querySelector('pre')?.textContent;

    if (!button || code === undefined) {
      return;
    }

    const show = (label: string, state: string) => {
      button.textContent = label;
      button.dataset.state = state;
      window.setTimeout(() => {
        button.textContent = text.copy;
        delete button.dataset.state;
      }, 1600);
    };

    navigator.clipboard.writeText(code).then(
      () => {
        show(text.copied, 'copied');
      },
      () => {
        show(text.copyFailed, 'failed');
      }
    );
  });
}
