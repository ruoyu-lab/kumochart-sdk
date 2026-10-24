import { prepareIndex, search, type PreparedIndex, type SearchIndex } from '../shared/search';
import { UI_TEXT, type Language } from '../shared/ui-text';

/** The search dialog: opened with its button, Ctrl K, ⌘ K or `/`; the index loads when it opens. */
export function initSearch(language: Language): void {
  const dialog = document.querySelector<HTMLDialogElement>('[data-search]');
  const input = dialog?.querySelector<HTMLInputElement>('[data-search-input]');
  const results = dialog?.querySelector<HTMLElement>('[data-search-results]');
  const indexUrl = document.querySelector<HTMLMetaElement>(
    'meta[name="docs-search-index"]'
  )?.content;

  if (!dialog || !input || !results || indexUrl === undefined) {
    return;
  }

  const text = UI_TEXT[language];
  let index: Promise<PreparedIndex> | null = null;
  let selected = 0;

  if (/Mac|iPhone|iPad/.test(navigator.platform)) {
    for (const shortcut of document.querySelectorAll('[data-search-shortcut]')) {
      shortcut.textContent = '⌘ K';
    }
  }

  const status = (message: string) => {
    results.replaceChildren(
      Object.assign(document.createElement('p'), {
        className: 'search-status',
        textContent: message
      })
    );
  };

  const options = () => [...results.querySelectorAll<HTMLAnchorElement>('a')];

  const select = (position: number) => {
    const items = options();
    selected = Math.max(0, Math.min(position, items.length - 1));
    items.forEach((item, itemIndex) => {
      item.setAttribute('aria-selected', String(itemIndex === selected));
    });
    items[selected]?.scrollIntoView({ block: 'nearest' });
  };

  const render = async () => {
    const query = input.value;

    if (query.trim() === '') {
      results.replaceChildren();
      return;
    }

    let prepared: PreparedIndex;

    try {
      prepared = await (index ??= fetch(indexUrl).then(async (response) => {
        if (!response.ok) {
          throw new Error(`${indexUrl}: ${response.status}`);
        }

        return prepareIndex((await response.json()) as SearchIndex);
      }));
    } catch {
      index = null;
      status(text.searchFailed);
      return;
    }

    if (input.value !== query) {
      return;
    }

    const found = search(prepared, query);

    if (found.length === 0) {
      status(text.searchNoResults);
      return;
    }

    results.replaceChildren(
      ...found.map((result) => {
        const link = document.createElement('a');
        link.href = result.url;
        link.setAttribute('role', 'option');
        const title = document.createElement('span');
        title.className = 'search-title';
        title.textContent = result.page;

        if (result.heading !== '') {
          const heading = document.createElement('span');
          heading.textContent = ` › ${result.heading}`;
          title.append(heading);
        }

        const snippet = document.createElement('span');
        snippet.className = 'search-snippet';
        snippet.append(
          ...result.snippet.map((segment) =>
            segment.match
              ? Object.assign(document.createElement('mark'), { textContent: segment.text })
              : segment.text
          )
        );
        link.append(title, snippet);
        return link;
      })
    );
    select(0);
  };

  const open = () => {
    if (dialog.open) {
      return;
    }

    dialog.showModal();
    input.select();

    if (input.value === '') {
      results.replaceChildren();
    }
  };

  for (const button of document.querySelectorAll('[data-search-open]')) {
    button.addEventListener('click', open);
  }

  dialog.querySelector('[data-search-close]')?.addEventListener('click', () => {
    dialog.close();
  });

  dialog.addEventListener('click', (event) => {
    // A click on the backdrop lands on the dialog itself.
    if (event.target === dialog) {
      dialog.close();
    }

    if ((event.target as Element).closest('a')) {
      dialog.close();
    }
  });

  input.addEventListener('input', () => {
    void render();
  });

  input.addEventListener('keydown', (event) => {
    // A search field would only clear itself on Escape; the dialog closes at once.
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      select(selected + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter') {
      const item = options()[selected];

      if (item) {
        event.preventDefault();
        dialog.close();
        window.location.assign(item.href);
      }
    }
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    const typing =
      target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

    if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      open();
    } else if (event.key === '/' && !typing && !dialog.open) {
      event.preventDefault();
      open();
    }
  });
}
