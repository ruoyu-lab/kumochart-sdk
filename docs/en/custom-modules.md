# Custom modules

<!-- code-prelude
declare const DEVIATION: import('@kumochart-sdk/core/indicators').IndicatorDefinition;
declare const priceZone: import('@kumochart-sdk/core/drawings').DrawingTypeDefinition;
-->

The simplest way to use your own indicators, drawings and series types is to give them to their module (`indicators([...allIndicators, MY_INDICATOR])`). When you want to package several things together, such as a set of indicators and a plugin, and add an API of your own to the chart, make a module, given at creation like the SDK's.

## Writing a module

`createModule({ name, install })`: `install` runs once the chart and the SDK's modules are there, receives the chart, and what it returns becomes new API on the chart.

```ts
import { createChart, createModule, withAlpha } from '@kumochart-sdk/core';

/** A range of prices highlighted on the main pane, which can change */
export function band() {
  return createModule({
    name: 'band',
    install: (chart) => {
      let range: { from: number; to: number } | null = null;
      let repaint = () => {};

      chart.plugins.add({
        name: 'band',
        attach: (host) => {
          repaint = host.repaint;
        },
        paint: ({ ctx, layer, pane, theme }) => {
          if (layer !== 'below' || pane.id !== 'main' || !range) return;
          const top = pane.valueToY(Math.max(range.from, range.to));
          const bottom = pane.valueToY(Math.min(range.from, range.to));
          ctx.fillStyle = withAlpha(theme.accent, 0.12);
          ctx.fillRect(0, top, pane.width, bottom - top);
        }
      });

      return {
        band: {
          set(from: number, to: number) {
            range = { from, to };
            repaint();
          },
          clear() {
            range = null;
            repaint();
          }
        }
      };
    }
  });
}

const chart = createChart(container, { modules: [band()] });
chart.band.set(62_000, 64_000); // typed
```

Returning `{ band: ... }` adds `chart.band` to the chart, and TypeScript knows it. A new name must not be one the chart has (such as `data` or `indicators`): the chart fails to be created. When a module adds no API, `install` returns nothing.

## Bringing your own types

Registering indicator or drawing types takes a chart with those modules. The `chart` that `install` receives is typed with the core only; to use a module's API, type it as a chart with that module:

```ts
import { createModule, type Chart } from '@kumochart-sdk/core';
import { indicators, allIndicators, type IndicatorsModule } from '@kumochart-sdk/core/indicators';
import { drawings, allDrawings, type DrawingsModule } from '@kumochart-sdk/core/drawings';

export const myToolkit = createModule({
  name: 'my-toolkit',
  install: (chart) => {
    if (!chart.modules().includes('indicators') || !chart.modules().includes('drawings')) {
      throw new Error('my-toolkit needs the indicators and drawings modules.');
    }

    const typed = chart as Chart<[IndicatorsModule, DrawingsModule]>;
    typed.indicators.register(DEVIATION);
    typed.drawings.register(priceZone);
  }
});

createChart(container, {
  modules: [indicators(allIndicators), drawings(allDrawings), myToolkit]
});
```

`install` runs before the chart uses its options, so the options given at creation can use what the module registers, such as a custom series type on the main series:

```ts no-check
createChart(container, {
  modules: [myToolkit],
  mainSeries: { type: 'dots' } // 'dots' registered by myToolkit
});
```

## Options, events and the layout

Like the SDK's modules, a module can add a section of its own to the chart's options, emit events of its own, and keep a part of its own in the layout `saveState()` saves. For these, write down what the module adds as a type, and give it to `createModule` as its type parameter:

```ts
import { createChart, createModule } from '@kumochart-sdk/core';

interface Range {
  from: number;
  to: number;
}

interface BandTypes {
  /** New API on the chart */
  api: { band: { set(range: Range | null): void } };
  /** A section of the options: options.band */
  options: { band: { opacity: number } };
  /** The module's events */
  events: { bandChange: { range: Range | null } };
  /** A part of the saved layout: saveState().band */
  state: { band?: Range };
}

export const band = createModule<BandTypes>({
  name: 'band',
  options: {
    key: 'band',
    defaults: () => ({ opacity: 0.12 }),
    validate: (section, label) => {
      if (section.opacity < 0 || section.opacity > 1) {
        throw new Error(`${label}.opacity must be between 0 and 1.`);
      }
    }
  },
  install: (chart, context) => {
    let range: Range | null = null;

    const set = (next: Range | null) => {
      range = next;
      context.emit('bandChange', { range });
    };

    context.keepState({
      key: 'band',
      save: () => range ?? { from: Number.NaN, to: Number.NaN },
      read: (saved, label) => {
        const value = saved as Partial<Range> | null;

        if (typeof value?.from !== 'number' || typeof value.to !== 'number') {
          throw new Error(`${label} must have from and to.`);
        }

        return { from: value.from, to: value.to };
      },
      load: (state) => {
        range = state && Number.isFinite(state.from) ? state : null;
      }
    });

    chart.plugins.add({
      name: 'band',
      paint: ({ ctx, layer, pane }) => {
        if (layer !== 'below' || pane.id !== 'main' || !range) return;
        const top = pane.valueToY(Math.max(range.from, range.to));
        const bottom = pane.valueToY(Math.min(range.from, range.to));
        ctx.fillStyle = `rgba(41, 98, 255, ${context.options().opacity})`;
        ctx.fillRect(0, top, pane.width, bottom - top);
      }
    });

    return { band: { set } };
  }
});

const chart = createChart(container, { modules: [band], band: { opacity: 0.2 } });
chart.on('bandChange', ({ range }) => console.log(range));
chart.band.set({ from: 62_000, to: 64_000 });
chart.applyOptions({ band: { opacity: 0.3 } });
```

### Options

The `key` of `options` names the section in the chart's options. What is given for it at creation and to `applyOptions()` is merged over `defaults()`, then checked by `validate()`; when `validate()` throws, the call changes nothing. The module reads the section as it is now with `context.options()`, and `chart.options()` has it too. A module that declares no `options` throws for `context.options()`.

### Events

`context.emit(name, event)` emits an event of the module, which `chart.on()` listens to, typed as the SDK's events are. Like the chart's events, those emitted in an API call are dispatched once the call is done.

### Following the options

Each time the chart's options are set (by `applyOptions()`, and by `loadState()` as it sets the main series' type), the chart emits `optionsChange`, with the `options` after and the `previous` ones before. A module compares those it cares about to know what changed, such as the type of the main series:

```ts
chart.on('optionsChange', ({ options, previous }) => {
  if (options.mainSeries.type !== previous.mainSeries.type) {
    // the main series changed its type
  }
});
```

### Keeping a part of the layout

With `context.keepState()`, `saveState()` keeps what `save()` gives under `key`. `loadState()` first checks the part with `read()` (when it throws, the whole load fails and the chart changes nothing), and calls `load()` once every part passed. A layout without the part, as one saved before the module was there, gives `load()` a `null`. The `key` must be neither one the chart keeps (`view`, `panes`, …) nor another module's.

## Order

- The SDK's modules come first, then the `install` of each custom module in the order of `modules`.
- An error thrown in `install` makes `createChart()` fail, and the half-made chart is cleaned up.
- Module names are unique on a chart; `chart.modules()` lists them.

## Publishing

A module is a plain function, ready for an npm package of your own. Make `@kumochart-sdk/core` a `peerDependency`, so that applications install one copy of the SDK, shared by your module and their charts.
