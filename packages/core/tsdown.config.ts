import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    // The core and each module, sharing their common code in chunks.
    entry: {
      index: 'src/index.ts',
      indicators: 'src/indicators/index.ts',
      drawings: 'src/drawings/index.ts',
      'chart-types': 'src/chart-types/index.ts',
      alerts: 'src/alerts/index.ts',
      'alert-engine': 'src/alert-engine/index.ts',
      trading: 'src/trading/index.ts',
      replay: 'src/replay/index.ts',
      'volume-profile': 'src/volume-profile/index.ts',
      watermark: 'src/watermark/index.ts',
      all: 'src/all.ts'
    },
    platform: 'browser',
    target: 'es2022',
    dts: true,
    format: 'esm'
  },
  {
    // One script for a page without a bundler: the core and every module, as `KumoChart`.
    entry: { kumochart: 'src/browser.ts' },
    platform: 'browser',
    target: 'es2022',
    dts: false,
    format: 'iife',
    globalName: 'KumoChart',
    minify: true,
    clean: false
  },
  {
    // The words of the indicators in other languages, for a page without a bundler that wants
    // them, as `KumoChartIndicatorTexts`.
    entry: { 'kumochart-indicator-texts': 'src/browser-texts.ts' },
    platform: 'browser',
    target: 'es2022',
    dts: false,
    format: 'iife',
    globalName: 'KumoChartIndicatorTexts',
    minify: true,
    clean: false
  }
]);
