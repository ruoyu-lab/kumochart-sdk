import { UI_TEXT, type Language } from '../src/shared/ui-text';
import type { CheckedLanguage, FenceInfo } from './code-blocks';
import type { Highlighter } from './highlight';
import { escapeHtml } from './html';

/** A live example: a code block run in a frame of its own. */
export interface LiveExample {
  /** Its page and position there, such as `zh-CN/data/1`. */
  readonly id: string;
  readonly language: CheckedLanguage;
  readonly code: string;
  readonly title: string;
}

/** Where the example's frame is. */
export function exampleUrl(id: string): string {
  return `/examples/${id}.html`;
}

/** The module of the example's code, `.ts`, `.tsx` or `.vue` as the block is. */
export function exampleModuleUrl(example: LiveExample): string {
  return `/examples/${example.id}.${example.language}`;
}

/** The module a Vue or React example starts from, mounting its component on `#chart`. */
export function exampleEntryUrl(example: LiveExample): string {
  return `/examples/${example.id}.entry.ts`;
}

/** The modules of an example by address: its code, and the mount of a component. */
export function exampleModules(example: LiveExample): Map<string, string> {
  const modules = new Map([[exampleModuleUrl(example), example.code]]);
  const module = JSON.stringify(exampleModuleUrl(example));

  if (example.language === 'vue') {
    modules.set(
      exampleEntryUrl(example),
      [
        "import { createApp, h, Suspense } from 'vue';",
        `import App from ${module};`,
        '',
        '// Suspense lets the component await at the top of its <script setup>.',
        "createApp({ render: () => h(Suspense, null, { default: () => h(App) }) }).mount('#chart');",
        ''
      ].join('\n')
    );
  } else if (example.language === 'tsx') {
    modules.set(
      exampleEntryUrl(example),
      [
        "import { createElement, StrictMode } from 'react';",
        "import { createRoot } from 'react-dom/client';",
        `import App from ${module};`,
        '',
        "const container = document.getElementById('chart');",
        '',
        'if (!container) {',
        "  throw new Error('The example has no #chart element.');",
        '}',
        '',
        'createRoot(container).render(createElement(StrictMode, null, createElement(App)));',
        ''
      ].join('\n')
    );
  }

  return modules;
}

/** The page of the example's frame: an element `#chart` filling it, and the example's code. */
export function exampleHtml(example: LiveExample, language: Language): string {
  const entry = example.language === 'ts' ? exampleModuleUrl(example) : exampleEntryUrl(example);
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(example.title)}</title>
<script type="module" src="/src/examples/frame.ts"></script>
</head>
<body>
<div id="chart"></div>
<script type="module" src="${entry}"></script>
</body>
</html>
`;
}

/** A code block with its copy button. */
export function codeBlockHtml(
  highlighter: Highlighter,
  code: string,
  language: string,
  page: Language
): string {
  const text = UI_TEXT[page];
  return `<div class="code-block">${highlighter.html(code, language)}<button class="code-copy" type="button" data-copy>${escapeHtml(text.copy)}</button></div>\n`;
}

/** The figure of a live example in its page: the frame, then its code, which can fold. */
export function liveExampleHtml(
  highlighter: Highlighter,
  example: LiveExample,
  info: FenceInfo,
  page: Language
): string {
  const text = UI_TEXT[page];
  return [
    '<figure class="live">',
    `<iframe class="live-frame" src="${exampleUrl(example.id)}" title="${escapeHtml(text.liveExample)}" loading="lazy" style="height:${info.height}px"></iframe>`,
    `<details class="live-code"${info.collapsed ? '' : ' open'}>`,
    `<summary><span class="live-show">${escapeHtml(text.showCode)}</span><span class="live-hide">${escapeHtml(text.hideCode)}</span></summary>`,
    codeBlockHtml(highlighter, example.code, example.language, page),
    '</details>',
    '</figure>\n'
  ].join('');
}
