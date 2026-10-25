// Fails when a built bundle grows past its gzip budget. Run after `npm run build`.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { rolldown } from 'rolldown';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'packages/core/dist');

/** Files of the packages as published. */
const BUDGETS = [
  // The script for pages without a bundler: the core and every module.
  // The fixes of the drawings' tools, editors and drags (removed panes, API changes while they
  // run) took it to 96.3 kB; those of the indicators (the checks of definitions and inputs, the
  // colors of values) add 0.4 kB. The indicators' averages to pick from (SMA, EMA, RMA, WMA,
  // VWMA), the moving average of an oscillator with its bands, and the new options of Keltner
  // Channels, ATR, MACD, VWAP, DPO and the pivot points took it to 98.6 kB; the price ticks the
  // axis labels cover and the transform kept in saved states add 0.1 kB; the checks rejecting a
  // misspelled field of every input and option 1.2 kB; the volume profiles module and the fixed
  // range volume profile drawing type, 3.2 kB, took it to 103.7 kB; the fixes after the first
  // release (the calendar fitting the bars, failing transforms, options and modules changing
  // nothing, painting that throws, views asked for while hidden) 0.7 kB. The gzip of the CI's
  // Node.js comes out 0.2 kB larger than on macOS. The review after the first release took it to
  // 112 kB: the fixes of the data, the rendering, the indicators and the drawings, one way to name
  // the API and keep its collections, colors checked as they are given, modules of applications
  // with options, events and state, the watermark, series taking trades, and indicators of a
  // timeframe of their own (1.5 kB). The words of the indicators are a script of their own.
  // Thirteen drawing types after it (the info line, Schiff pitchforks, the Gann fan, the ABCD,
  // three Elliott waves, cyclic lines, the highlighter, the rotated rectangle and the arrow
  // marks) add 1.5 kB.
  { file: 'packages/core/dist/kumochart.iife.js', gzip: 114.5 },
  { file: 'packages/core/dist/kumochart-indicator-texts.iife.js', gzip: 6.5 },
  { file: 'packages/vue/dist/index.js', gzip: 3 },
  { file: 'packages/react/dist/index.js', gzip: 3 }
];

let failed = false;

for (const budget of BUDGETS) {
  const content = await readFile(join(root, budget.file));
  const raw = content.byteLength / 1024;
  const gzip = gzipSync(content, { level: 9 }).byteLength / 1024;
  const ok = gzip <= budget.gzip;
  failed ||= !ok;
  console.log(
    `${ok ? '✓' : '✗'} ${budget.file}: ${raw.toFixed(1)} kB, ${gzip.toFixed(1)} kB gzip (budget ${budget.gzip} kB)`
  );
}

/**
 * What an application ships: the entries bundled from `dist` with only what it imports, minified.
 * A module stays out of an application that does not import it, and of a module only the types
 * an application picks go in. The checks rejecting a misspelled field of every input and option,
 * of the core and of each module, add 0.4 to 1.2 kB to each; the fixes after the first release
 * (the calendar fitting the bars, failing transforms, options and modules changing nothing,
 * painting that throws, views asked for while hidden) 0.6 kB. The review after it took the core
 * from 45 to 47.2 kB: the fixes of the data, the rendering and the interaction, the API named one
 * way with collections kept alike and `null` for what is not there, colors checked as they are
 * given, and the options, events and state of modules of applications; each module grew by its
 * own fixes besides.
 */
const APPS = [
  { name: 'the core', code: `export { createChart } from 'core';`, gzip: 48 },
  {
    name: 'the core with every indicator',
    code: `export { createChart } from 'core'; export { indicators, allIndicators } from 'core/indicators';`,
    // The averages to pick from, the moving average of an oscillator and the new options of the
    // types took it from 60.4 to 61.4 kB; the indicators of a timeframe of their own add 1.5 kB,
    // their words in the chart's language 0.3 kB.
    gzip: 68.5
  },
  {
    // Only the three definitions go in, 50.5 kB; MACD picks its averages and RSI has its own
    // moving average with bands since, 52.4 kB.
    name: 'the core with MA, MACD and RSI',
    code: `export { createChart } from 'core'; export { indicators, MA, MACD, RSI } from 'core/indicators';`,
    gzip: 59.5
  },
  {
    // The fixes of the drawings' tools, editors and drags took the drawings module up 0.5 kB;
    // the thirteen drawing types after the review 1.3 kB.
    name: 'the core with every drawing type',
    code: `export { createChart } from 'core'; export { drawings, allDrawings } from 'core/drawings';`,
    gzip: 76
  },
  {
    // The price ticks the axis labels cover, and the transform kept in saved states, add 0.1 kB.
    name: 'the core with trend and horizontal lines',
    code: `export { createChart } from 'core'; export { drawings, trendLine, horizontalLine } from 'core/drawings';`,
    gzip: 62
  },
  {
    name: 'the core with every chart type',
    code: `export { createChart } from 'core'; export { chartTypes, allChartTypes } from 'core/chart-types';`,
    gzip: 52.5
  },
  {
    name: 'the core with alerts',
    code: `export { createChart } from 'core'; export { alerts } from 'core/alerts';`,
    gzip: 52.5
  },
  {
    name: 'the core with orders and markers',
    code: `export { createChart } from 'core'; export { orders, markers } from 'core/trading';`,
    gzip: 52
  },
  {
    name: 'the core with replay',
    code: `export { createChart } from 'core'; export { replay } from 'core/replay';`,
    gzip: 48.5
  },
  {
    // The profiles of the bars in view and of the trading days, their cache and their state.
    name: 'the core with volume profiles',
    code: `export { createChart } from 'core'; export { volumeProfiles } from 'core/volume-profile';`,
    gzip: 50.5
  },
  {
    name: 'the core with the watermark',
    code: `export { createChart } from 'core'; export { watermark } from 'core/watermark';`,
    gzip: 48
  },
  {
    // The fixes of the indicators add 0.4 kB; their averages to pick from and new options 1.3 kB;
    // the price ticks the axis labels cover and the transform kept in saved states 0.1 kB; the
    // volume profiles module and the fixed range volume profile drawing type 3.1 kB, to 102.9 kB;
    // the review after the first release, as for the script for pages without a bundler, 111 kB;
    // the thirteen drawing types after it 1.5 kB.
    name: 'everything',
    code: `export { createChart } from 'core'; export { allModules } from 'core/all';`,
    gzip: 113.5
  },
  {
    // MACD picks EMAs or SMAs, which brings the averages to pick from: 8.5 kB; the checks of a
    // definition alike with a chart and without, 9.2 kB.
    name: 'MACD computed without a chart',
    code: `export { computeIndicator, MACD } from 'core/indicators';`,
    gzip: 9.5
  },
  {
    // One way to write a level, and the anchors a type has, typed: 7.9 kB.
    name: 'the lines of a Fibonacci retracement without a chart',
    code: `export { computeDrawingLevels, fibRetracement } from 'core/drawings';`,
    gzip: 8.5
  }
];

const ENTRIES = {
  core: 'index.js',
  'core/indicators': 'indicators.js',
  'core/drawings': 'drawings.js',
  'core/chart-types': 'chart-types.js',
  'core/alerts': 'alerts.js',
  'core/trading': 'trading.js',
  'core/replay': 'replay.js',
  'core/volume-profile': 'volume-profile.js',
  'core/watermark': 'watermark.js',
  'core/all': 'all.js'
};

const scratch = await mkdtemp(join(tmpdir(), 'kumochart-size-'));

try {
  for (const app of APPS) {
    const entry = join(scratch, 'entry.js');
    const code = app.code.replace(/from '([^']+)'/g, (_match, name) => {
      const file = ENTRIES[name];

      if (!file) {
        throw new Error(`No entry "${name}".`);
      }

      return `from ${JSON.stringify(join(dist, file))}`;
    });
    await writeFile(entry, `${code}\n`);
    const bundle = await rolldown({ input: entry, logLevel: 'silent' });
    const { output } = await bundle.generate({ format: 'esm', minify: true });
    await bundle.close();
    const minified = output[0].code;
    const gzip = gzipSync(minified, { level: 9 }).byteLength / 1024;
    const ok = gzip <= app.gzip;
    failed ||= !ok;
    console.log(
      `${ok ? '✓' : '✗'} ${app.name}: ${(minified.length / 1024).toFixed(1)} kB min, ${gzip.toFixed(1)} kB min+gzip (budget ${app.gzip} kB)`
    );
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

if (failed) {
  process.exit(1);
}
