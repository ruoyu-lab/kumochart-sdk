// Type-checks the code of the documentation against the SDK's sources, so that a change of the
// API fails on the pages that show the old one:
//
//   node site/scripts/run.mjs site/scripts/check-code.ts [docs directories…]
//
// Every ts, tsx and vue code block is checked, live examples included, unless it is marked
// `no-check`. Live examples and Vue components must be complete. A ts or tsx snippet can use
// `chart` (a chart with every module), `container`, `createChart`, `bars` and `trades` without
// declaring them, and gets the `<!-- code-prelude … -->` above it put before it. Errors are
// reported at their line in the Markdown.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { checkedBlocks, type CheckedBlock } from '../build/code-blocks';
import { siteConfig } from '../build/config';
import { createMarkdown } from '../build/markdown';

/** The documentation checked by default: the real one and the pages of the tests. */
const DEFAULT_DIRECTORIES = ['docs', 'site/test/fixtures/docs'];

/** Where a line of a checked file comes from in the Markdown. */
interface Origin {
  readonly file: string;
  /** Line in the Markdown of each line of the checked file, from 1. */
  readonly lines: readonly number[];
}

/** The checked file of a block, and the Markdown lines of its lines. */
export function checkedFile(block: CheckedBlock): { text: string; lines: number[] } {
  const prelude = block.prelude;
  const preludeLines = prelude ? prelude.code.replace(/\n$/, '').split('\n') : [];
  const codeLines = block.code.replace(/\n$/, '').split('\n');
  const lines = [
    ...preludeLines.map((_, index) => (prelude?.line ?? 0) + index),
    ...codeLines.map((_, index) => block.line + index)
  ];
  // A module of its own, so that blocks do not share names and can await at their top.
  const end = block.language === 'vue' ? '' : '\nexport {};';
  return { text: `${[...preludeLines, ...codeLines].join('\n')}${end}\n`, lines };
}

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.md'))
    .map((path) => join(directory, path));
}

/** What every snippet can use without declaring it; live examples and components declare all. */
const SNIPPET_GLOBALS = `// The names every snippet of the documentation can use without declaring them.
import type { BarInput, Chart, TradeInput, createChart as create } from '@kumochart-sdk/core';
import type { AllModules } from '@kumochart-sdk/core/all';

declare global {
  /** A chart with every module of the SDK. */
  const chart: Chart<AllModules>;
  /** The element the chart is in. */
  const container: HTMLElement;
  const createChart: typeof create;
  /** Bars and trades of the application. */
  const bars: BarInput[];
  const trades: TradeInput[];
}

export {};
`;

/** Writes the tsconfig of a project of checked files. */
function writeProject(directory: string, files: readonly string[], siteDir: string): void {
  writeFileSync(
    join(directory, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2023', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          moduleResolution: 'Bundler',
          customConditions: ['@kumochart-sdk/source'],
          // What an application of the reader likely has: strict, nothing stricter.
          strict: true,
          jsx: 'react-jsx',
          isolatedModules: true,
          skipLibCheck: true,
          noEmit: true,
          types: [],
          paths: { '@docs/data': [relative(directory, join(siteDir, 'src/examples/data.ts'))] }
        },
        files
      },
      null,
      2
    )}\n`
  );
}

/** Checks a project; prints its errors at their line in the Markdown and returns how many. */
function checkProject(
  directory: string,
  origins: ReadonlyMap<string, Origin>,
  root: string
): number {
  const compiler = createRequire(import.meta.url).resolve('vue-tsc/bin/vue-tsc.js');
  const result = spawnSync(
    process.execPath,
    [compiler, '-p', join(directory, 'tsconfig.json'), '--pretty', 'false'],
    { encoding: 'utf8' }
  );
  const diagnostic = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/;
  let errors = 0;

  for (const line of `${result.stdout}${result.stderr}`.split('\n')) {
    const match = diagnostic.exec(line);

    if (!match) {
      if (line.trim() !== '') {
        console.error(line);
      }

      continue;
    }

    const [, path = '', row = '0', column = '0', , code = '', message = ''] = match;
    const origin = origins.get(resolve(path));
    const at = origin
      ? `${relative(root, origin.file)}:${origin.lines[Number(row) - 1] ?? 0}`
      : `${relative(root, resolve(path))}:${row}`;
    console.error(`${at}:${column} - error ${code}: ${message}`);
    errors += 1;
  }

  return result.status === 0 ? errors : Math.max(errors, 1);
}

export function main(args: readonly string[]): number {
  const directories = args.length > 0 ? args : DEFAULT_DIRECTORIES;
  const config = siteConfig();
  const output = join(config.siteDir, '.cache/code');
  const md = createMarkdown();
  /** Live examples and Vue components, then snippets. */
  const projects = { complete: join(output, 'complete'), snippets: join(output, 'snippets') };
  const files = { complete: [] as string[], snippets: ['globals.d.ts'] };
  const origins = new Map<string, Origin>();

  rmSync(output, { recursive: true, force: true });
  mkdirSync(projects.complete, { recursive: true });
  mkdirSync(projects.snippets, { recursive: true });
  writeFileSync(join(projects.snippets, 'globals.d.ts'), SNIPPET_GLOBALS);

  for (const directory of directories) {
    const docs = resolve(config.repoRoot, directory);
    const languages = readdirSync(docs, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory()
    );

    for (const language of languages) {
      for (const file of markdownFiles(join(docs, language.name))) {
        const blocks = checkedBlocks(file, md.parse(readFileSync(file, 'utf8'), {}));

        for (const block of blocks) {
          const project = block.live || block.language === 'vue' ? 'complete' : 'snippets';
          const name = `${relative(config.repoRoot, file).replace(/[^\w]+/g, '_')}_${block.line}.${block.language}`;
          const { text, lines } = checkedFile(block);
          writeFileSync(join(projects[project], name), text);
          files[project].push(name);
          origins.set(join(projects[project], name), { file, lines });
        }
      }
    }
  }

  if (origins.size === 0) {
    console.log('The documentation has no code to type-check.');
    return 0;
  }

  let errors = 0;

  for (const project of ['complete', 'snippets'] as const) {
    if (files[project].some((file) => !file.endsWith('.d.ts'))) {
      writeProject(projects[project], files[project], config.siteDir);
      errors += checkProject(projects[project], origins, config.repoRoot);
    }
  }

  if (errors > 0) {
    console.error(
      `The code of the documentation has ${errors} type error${errors === 1 ? '' : 's'}.`
    );
    return 1;
  }

  console.log(`The code of the documentation type-checks: ${origins.size} blocks.`);
  return 0;
}
