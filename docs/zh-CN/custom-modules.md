# 自定义模块

<!-- code-prelude
declare const DEVIATION: import('@kumochart-sdk/core/indicators').IndicatorDefinition;
declare const priceZone: import('@kumochart-sdk/core/drawings').DrawingTypeDefinition;
-->

自己写的指标、画线、图形，最简单的做法是直接交给对应的模块（`indicators([...allIndicators, MY_INDICATOR])`）。当你想把几样东西打包在一起，比如一组自己的指标加一个插件，再给图表加一套自己的接口，就做成一个模块，和 SDK 的模块一样在建图时传进去。

## 写一个模块

`createModule({ name, install })`：`install` 在图表建好、SDK 的模块都装好之后运行，拿到图表本身，返回的对象会成为图表上的新接口。

```ts
import { createChart, createModule, withAlpha } from '@kumochart-sdk/core';

/** 主图上一段高亮的价格区间，可以随时改 */
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
chart.band.set(62_000, 64_000); // 有类型
```

返回 `{ band: ... }`，图表上就多了 `chart.band`，TypeScript 也知道它。新接口的名字不能和图表已有的重复（比如 `data`、`indicators`），重复了建图会报错。不需要新接口时，`install` 什么都不返回就行。

## 带上自己的类型

模块里注册指标、画线这些类型，需要图表有对应的模块。`install` 拿到的 `chart` 只有核心的类型，用到某个模块的接口时，把它标成带这个模块的图表：

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

`install` 在图表使用选项之前运行，所以建图时的选项里就能用模块注册的类型，比如主图直接用自定义的图形：

```ts no-check
createChart(container, {
  modules: [myToolkit],
  mainSeries: { type: 'dots' } // 'dots' 由 myToolkit 注册
});
```

## 选项、事件和布局

模块还可以像 SDK 的模块一样：在图表的选项里加一段自己的选项，发自己的事件，在 `saveState()` 存的布局里存一份自己的东西。要用这些，先用一个类型写清模块加了什么，作为 `createModule` 的类型参数：

```ts
import { createChart, createModule } from '@kumochart-sdk/core';

interface Range {
  from: number;
  to: number;
}

interface BandTypes {
  /** 图表上的新接口 */
  api: { band: { set(range: Range | null): void } };
  /** 选项里的一段：options.band */
  options: { band: { opacity: number } };
  /** 模块的事件 */
  events: { bandChange: { range: Range | null } };
  /** 布局里存的一份：saveState().band */
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

### 选项

`options` 里的 `key` 是这段选项在图表选项里的名字。建图时、`applyOptions()` 时传的这段都合并在 `defaults()` 上，再交给 `validate()` 检查；`validate()` 抛错的话，这次设置什么都不改。模块里用 `context.options()` 读这段现在的值，`chart.options()` 里也有它。没有声明 `options` 的模块调用 `context.options()` 会报错。

### 事件

`context.emit(名字, 事件)` 发出模块的事件，图表的 `chart.on()` 就能监听，和 SDK 的事件一样有类型。在一次 API 调用里发出的事件，也和图表的事件一样，等调用做完才派发。

### 跟着选项变

图表每次设置选项（`applyOptions()`，以及 `loadState()` 换了主图的类型时）都会发出 `optionsChange`，带着设置后的 `options` 和设置前的 `previous`。模块比较自己关心的那几项就知道有没有变，比如主图的类型换掉了：

```ts
chart.on('optionsChange', ({ options, previous }) => {
  if (options.mainSeries.type !== previous.mainSeries.type) {
    // 主图换了类型
  }
});
```

### 存进布局

`context.keepState()` 让 `saveState()` 存下 `save()` 的结果，放在 `key` 下面。`loadState()` 时先用 `read()` 检查这一份（抛错就整次读取失败，图表什么都不改），等所有部分都检查通过，再调用 `load()`。读的布局里没有这一份时（比如是装这个模块之前存的），`load()` 收到 `null`。`key` 不能和图表自己存的（`view`、`panes` 等）或别的模块存的重复。

## 运行顺序

- SDK 的模块先装，然后按 `modules` 里的顺序运行各个自定义模块的 `install`。
- `install` 里抛出的错误会让 `createChart()` 失败，已经建了一半的图表会被清理掉。
- 模块名字在一个图表里不能重复；`chart.modules()` 列出全部模块的名字。

## 打包发布

模块就是一个普通的函数，可以放进自己的 npm 包。把 `@kumochart-sdk/core` 写成 `peerDependencies`，用的人装一份 SDK，你的模块和他们的图表共用它。
