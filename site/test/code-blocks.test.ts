import { describe, expect, it } from 'vitest';
import { checkedBlocks, DEFAULT_LIVE_HEIGHT, parseFenceInfo } from '../build/code-blocks';
import { createMarkdown } from '../build/markdown';
import { checkedFile } from '../scripts/check-code';

describe('the info string of a code block', () => {
  it('reads the language and the words after it', () => {
    expect(parseFenceInfo('ts live height=360 collapsed')).toEqual({
      language: 'ts',
      checked: 'ts',
      live: true,
      height: 360,
      collapsed: true
    });
    expect(parseFenceInfo('vue live')).toMatchObject({
      checked: 'vue',
      height: DEFAULT_LIVE_HEIGHT
    });
    expect(parseFenceInfo('typescript')).toMatchObject({
      language: 'typescript',
      checked: 'ts',
      live: false
    });
    expect(parseFenceInfo('ts no-check')).toMatchObject({ checked: null });
    expect(parseFenceInfo('bash')).toMatchObject({ checked: null, live: false });
    expect(parseFenceInfo('')).toMatchObject({ language: '', checked: null });
  });

  it('rejects what it cannot do', () => {
    expect(parseFenceInfo('ts lve')).toBe(
      'unknown word "lve" after the language of the code block (expected live, height=…, collapsed or no-check)'
    );
    expect(parseFenceInfo('js live')).toBe('a live example must be ts, tsx or vue code, not "js"');
    expect(parseFenceInfo('ts live no-check')).toBe(
      'a live example is always type-checked; remove no-check'
    );
    expect(parseFenceInfo('bash no-check')).toBe(
      'no-check only applies to ts, tsx and vue code, which is type-checked'
    );
    expect(parseFenceInfo('ts height=300')).toBe(
      'height=… and collapsed only apply to live examples'
    );
    expect(parseFenceInfo('ts live height=40')).toBe('height must be between 120 and 1200 pixels');
  });
});

const PAGE = `# Page

\`\`\`ts
const before = 1;
\`\`\`

<!-- code-prelude
import { createChart } from '@kumochart-sdk/core';
const chart = createChart(document.body);
-->

\`\`\`ts
chart.data.clear();
\`\`\`

\`\`\`ts live
import { createChart } from '@kumochart-sdk/core';
\`\`\`

\`\`\`vue
<template><div /></template>
\`\`\`

\`\`\`ts no-check
chart.anything(…);
\`\`\`

\`\`\`bash
npm install
\`\`\`
`;

describe('the checked code of a page', () => {
  const blocks = checkedBlocks('page.md', createMarkdown().parse(PAGE, {}));

  it('takes ts, tsx and vue blocks with their lines', () => {
    expect(blocks.map((block) => [block.language, block.line, block.live])).toEqual([
      ['ts', 4, false],
      ['ts', 13, false],
      ['ts', 17, true],
      ['vue', 21, false]
    ]);
  });

  it('puts the prelude above it before the snippets that follow, not before live examples or components', () => {
    expect(blocks.map((block) => block.prelude?.line ?? null)).toEqual([null, 8, null, null]);
    expect(blocks[1]?.prelude?.code).toBe(
      "import { createChart } from '@kumochart-sdk/core';\nconst chart = createChart(document.body);\n"
    );
  });

  it('maps every line of a checked file back to the Markdown', () => {
    const file = checkedFile(blocks[1]!);
    expect(file.text).toBe(
      "import { createChart } from '@kumochart-sdk/core';\nconst chart = createChart(document.body);\nchart.data.clear();\nexport {};\n"
    );
    expect(file.lines).toEqual([8, 9, 13]);
    expect(checkedFile(blocks[3]!)).toEqual({
      text: '<template><div /></template>\n',
      lines: [21]
    });
  });
});
