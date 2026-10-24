// Enforces the module structure of the packages:
// - core modules only import modules of the same or a lower layer,
// - the core never imports a chart module (indicators, drawings, …), and chart modules never
//   import one another: they meet only through the core's extension points; a module of a higher
//   layer may take the types of one below, as volume profiles give a drawing type,
// - no runtime import cycles,
// - the core never imports a framework or an adapter,
// - no oversized files, leftover markers or version-suffixed names.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const coreSource = join(root, 'packages/core/src');
const MAX_LINES = 800;

/** Layer of each top-level core module; a module may import its own or lower layers only. */
const LAYERS = {
  utils: 0,
  events: 1,
  data: 1,
  options: 1,
  canvas: 1,
  format: 2,
  scales: 2,
  layout: 2,
  feed: 2,
  panes: 3,
  series: 3,
  interaction: 4,
  objects: 4,
  render: 4,
  chart: 5,
  indicators: 6,
  drawings: 6,
  'chart-types': 6,
  alerts: 6,
  trading: 6,
  replay: 6,
  // Gives a drawing type too, so it builds on the drawings, whose types it takes.
  'volume-profile': 7,
  watermark: 6,
  'index.ts': 8,
  'all.ts': 8,
  'browser.ts': 8,
  'browser-texts.ts': 8
};

/** The chart modules, each an entry of the package and a layer of its own. */
const CHART_MODULES = [
  'indicators',
  'drawings',
  'chart-types',
  'alerts',
  'trading',
  'replay',
  'volume-profile',
  'watermark'
];

const FORBIDDEN_TEXT = [
  [/\bTODO\b|\bFIXME\b|\bXXX\b/, 'leftover TODO/FIXME marker'],
  [/@ts-ignore|@ts-expect-error|@ts-nocheck/, 'TypeScript suppression'],
  [/eslint-disable/, 'ESLint suppression'],
  [/\bconsole\.(log|debug|info|warn|error)\(/, 'console output'],
  [
    /\b\w*(?:V\d+|Legacy|Compat|Deprecated|Temp|Backup|Old)\b(?=\s*[(:=<])/,
    'version or transition suffix in a name'
  ]
];

const IMPORT = /^\s*(import|export)\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/gm;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
    })
  );
  return files.flat();
}

function moduleOf(file) {
  return relative(coreSource, file).split('/')[0];
}

const errors = [];
const packages = ['core', 'vue', 'react'];
const graph = new Map();

for (const name of packages) {
  for (const file of await sourceFiles(join(root, `packages/${name}/src`))) {
    const text = await readFile(file, 'utf8');
    const label = relative(root, file);
    const lines = text.split('\n').length;

    if (lines > MAX_LINES) {
      errors.push(
        `${label} has ${lines} lines (limit ${MAX_LINES}); split it along its responsibilities.`
      );
    }

    for (const [pattern, reason] of FORBIDDEN_TEXT) {
      if (pattern.test(text)) {
        errors.push(`${label} contains a ${reason}.`);
      }
    }

    const runtimeImports = [];

    for (const match of text.matchAll(IMPORT)) {
      const typeOnly = Boolean(match[2]);
      const specifier = match[3];

      if (name === 'core' && !specifier.startsWith('.')) {
        errors.push(`${label} imports "${specifier}"; the core has no runtime dependencies.`);
        continue;
      }

      if (!specifier.startsWith('.')) {
        continue;
      }

      const path = resolve(dirname(file), specifier);
      // A directory stands for its index, as `./indicators` for an entry of the package.
      const target = existsSync(`${path}.ts`) ? `${path}.ts` : join(path, 'index.ts');

      if (name === 'core') {
        const from = LAYERS[moduleOf(file)];
        const to = LAYERS[moduleOf(target)];

        const source = moduleOf(file);
        const imported = moduleOf(target);

        if (from === undefined || to === undefined) {
          errors.push(
            `${label} belongs to or imports a module without a layer: ${source} → ${imported}.`
          );
        } else if (CHART_MODULES.includes(imported) && source !== imported && from <= to) {
          errors.push(
            `${label} (${source}) imports the chart module ${imported}; the core and the chart modules meet only through the core's extension points.`
          );
        } else if (
          CHART_MODULES.includes(source) &&
          CHART_MODULES.includes(imported) &&
          source !== imported &&
          !typeOnly
        ) {
          errors.push(
            `${label} (${source}) imports code of the chart module ${imported}; it may take its types only, so that an application with one module does not ship the other.`
          );
        } else if (!typeOnly && to > from) {
          errors.push(
            `${label} (${moduleOf(file)}) imports the higher-layer module ${moduleOf(target)}.`
          );
        }
      }

      if (!typeOnly) {
        runtimeImports.push(target);
      }
    }

    graph.set(file, runtimeImports);
  }
}

// Depth-first search for runtime import cycles.
const state = new Map();
const trail = [];

function visit(file) {
  if (state.get(file) === 'done') {
    return;
  }

  if (state.get(file) === 'active') {
    const cycle = trail
      .slice(trail.indexOf(file))
      .concat(file)
      .map((item) => relative(root, item));
    errors.push(`Runtime import cycle: ${cycle.join(' → ')}`);
    return;
  }

  state.set(file, 'active');
  trail.push(file);

  for (const dependency of graph.get(file) ?? []) {
    visit(dependency);
  }

  trail.pop();
  state.set(file, 'done');
}

for (const file of graph.keys()) {
  visit(file);
}

if (errors.length > 0) {
  console.error(`Architecture check failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

console.log(`Architecture check passed for ${graph.size} source files.`);
