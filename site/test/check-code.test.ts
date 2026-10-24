import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { siteConfig } from '../build/config';
import { main } from '../scripts/check-code';

const root = mkdtempSync(join(tmpdir(), 'kumochart-code-'));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const PAGE = `# Code

\`\`\`ts
chart.data.set(bars);
chart.data.sett(bars);
\`\`\`

\`\`\`ts live
chart.data.clear();
\`\`\`

<!-- code-prelude
const maId: string = chart.indicators.add({ type: 'MA' });
-->

\`\`\`ts
chart.indicators.remove(maId);
chart.indicators.remove(macdId);
\`\`\`
`;

describe('the type check of the documentation', () => {
  it('reports errors at their line in the Markdown', () => {
    mkdirSync(join(root, 'zh-CN'));
    writeFileSync(join(root, 'zh-CN/code.md'), PAGE);
    const messages: string[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation((message: string) => {
      messages.push(message);
    });

    const status = main([root]);
    error.mockRestore();
    const page = relative(siteConfig().repoRoot, join(root, 'zh-CN/code.md'));

    expect(status).toBe(1);
    expect(messages).toEqual([
      // A live example declares what it uses; snippets have chart, bars, … and their prelude.
      `${page}:9:1 - error TS2304: Cannot find name 'chart'.`,
      `${page}:18:25 - error TS2552: Cannot find name 'macdId'. Did you mean 'maId'?`,
      `${page}:5:12 - error TS2551: Property 'sett' does not exist on type 'DataApi'. Did you mean 'set'?`,
      'The code of the documentation has 3 type errors.'
    ]);
  }, 30_000);
});
