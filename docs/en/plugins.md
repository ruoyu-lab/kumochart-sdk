# Plugins

<!-- code-prelude
declare const plugin: import('@kumochart-sdk/core').ChartPlugin;
-->

What the chart does not draw, a plugin can paint straight on its canvas: a watermark, a shaded background, marks you compute. Plugins repaint with the chart, so they stay in place as it zooms and scrolls.

```ts live height=360
import { createChart, withAlpha, type ChartPlugin } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

/** A watermark in the middle of the main pane */
function watermark(text: string): ChartPlugin {
  return {
    name: 'watermark',
    paint: ({ ctx, layer, pane, theme, font }) => {
      if (layer !== 'below' || pane.id !== 'main') return;
      ctx.font = `600 40px ${font.family}`;
      ctx.fillStyle = withAlpha(theme.text, 0.07);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, pane.width / 2, pane.height / 2);
    }
  };
}

const chart = createChart(document.getElementById('chart')!);
chart.plugins.add(watermark('BTCUSDT · 1h'));

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');
```

## Painting

Whenever the chart repaints, it calls `paint` twice for each pane:

- `layer: 'below'`: after the grid, before the bars, for backgrounds.
- `layer: 'above'`: after the bars, before drawings and order lines, for marks.

`ctx` is clipped to the pane's plot and moved to its top left corner; paint in CSS pixels, and the chart takes care of dense screens.

The context `paint` receives holds:

| Field                             | For                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pane`                            | The pane's id and size, `valueToY` and `yToValue` between prices and pixels, `formatValue` to write a price as its axis does |
| `bars`                            | The displayed bars, read by column                                                                                           |
| `visible`                         | The indices of the first and last bars in view, or `null` without bars                                                       |
| `indexToX`, `xToIndex`, `timeToX` | Between indices, times and x                                                                                                 |
| `barSpacing`                      | The width of a bar                                                                                                           |
| `theme`, `font`                   | The current theme and font, so the colors follow the theme                                                                   |
| `source`, `cutoff`                | The bars of the source interval; while replaying, paint nothing after `cutoff`                                               |

Paint what is in view only, and many bars stay fast:

```ts
import { withAlpha, type ChartPlugin } from '@kumochart-sdk/core';

const highlightBigBars: ChartPlugin = {
  name: 'big-bars',
  paint: ({ ctx, layer, pane, bars, visible, indexToX, barSpacing, theme }) => {
    if (layer !== 'below' || pane.id !== 'main' || !visible) return;
    ctx.fillStyle = withAlpha(theme.accent, 0.08);
    for (let i = visible.from; i <= visible.to; i += 1) {
      if (bars.high(i) - bars.low(i) > 500) {
        ctx.fillRect(indexToX(i) - barSpacing / 2, 0, barSpacing, pane.height);
      }
    }
  }
};
```

## State and repainting

When a plugin's own settings change, it asks the chart to repaint: `attach` receives a `host` with `host.repaint()`.

```ts
import type { ChartPlugin } from '@kumochart-sdk/core';

function watermark(initial: string) {
  let text = initial;
  let repaint = () => {};

  const plugin: ChartPlugin = {
    name: 'watermark',
    attach: (host) => {
      repaint = host.repaint;
    },
    paint: ({ ctx, layer, pane }) => {
      if (layer === 'below' && pane.id === 'main')
        ctx.fillText(text, pane.width / 2, pane.height / 2);
    }
  };

  return {
    plugin,
    setText(next: string) {
      text = next;
      repaint();
    }
  };
}
```

`host.chart` is the chart itself, whose whole API a plugin can use, such as registering types or listening to events. `detach` is called when the plugin is removed or the chart destroyed: release your listeners there.

```ts
chart.plugins.add(plugin);
chart.plugins.list(); // the plugins, in the order they paint
chart.plugins.remove('watermark');
```

## Canvas or HTML

For what users click or type into, such as buttons or fields floating over the chart, HTML elements over it suit better: `chart.layout()` says where each pane is, `priceScale().priceToY()` and `timeScale.timeToX()` convert coordinates, and `visibleRangeChange` tells when to move them. What is only to be seen is faster painted by a plugin, and shows in screenshots too.

A plugin can be packaged with your indicator and drawing types as a module; see [Custom modules](custom-modules.md).
