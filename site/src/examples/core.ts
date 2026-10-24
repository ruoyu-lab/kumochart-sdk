// What `@kumochart-sdk/core` is inside the live examples: the core itself, except that a chart
// created without a `theme` follows the light or dark theme of the site, and one without a
// `locale` the language of the page. The examples' code stays exactly what an application writes.
import {
  createChart as createSdkChart,
  darkTheme,
  lightTheme,
  type Chart,
  type ChartModule,
  type CreateChartOptions
} from '../../../packages/core/src/index';
import { currentTheme, onThemeChange, type SiteTheme } from './frame';

export * from '../../../packages/core/src/index';

const THEMES = { light: lightTheme, dark: darkTheme } as const satisfies Record<SiteTheme, unknown>;

export function createChart<const M extends readonly ChartModule[] = readonly []>(
  container: HTMLElement,
  options?: CreateChartOptions<M>
): Chart<M> {
  // The frame has the language of the page it is in.
  const locale = options?.locale ?? document.documentElement.lang;

  if (options?.theme !== undefined) {
    return createSdkChart(container, { ...options, locale });
  }

  const chart = createSdkChart(container, {
    ...options,
    locale,
    theme: THEMES[currentTheme()]
  } as CreateChartOptions<M>);
  const stop = onThemeChange((theme) => {
    // A destroyed chart has removed its element.
    if (chart.element.isConnected) {
      chart.applyOptions({ theme: THEMES[theme] } as Parameters<Chart<M>['applyOptions']>[0]);
    } else {
      stop();
    }
  });
  return chart;
}
