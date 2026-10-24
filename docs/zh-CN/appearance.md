# 外观

<!-- code-prelude
import { darkTheme } from '@kumochart-sdk/core';
declare const EYE_ICON: string, CLOSE_ICON: string;
-->

图表的样子都由选项决定：建图时给，之后随时用 `applyOptions()` 改。

```ts
const chart = createChart(container, {
  theme: darkTheme,
  grid: { vertical: false },
  latestPrice: { countdown: true }
});

chart.applyOptions({ crosshair: { mode: 'magnet' } });
chart.options(); // 现在全部的选项
```

`applyOptions()` 只改你给的那几项，其它保持不变；数组和函数整个替换。写错了选项名或者值不对会报错，图表保持原样。

没设的选项是 `null`，比如 `locale`、`timeZone`、`legend.rows`、`panes.separatorColor`；设过以后想回到默认，把它设回 `null` 就行，比如 `chart.applyOptions({ locale: null })`。`texts` 里的每个字、`mainSeries.styles` 里每种图形的样式也一样。

## 主题

内置浅色 `lightTheme`（默认）和深色 `darkTheme`，要深色就传 `theme: darkTheme`：

```ts live height=320
import { createChart, darkTheme } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, { theme: darkTheme });

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');
```

主题是一组颜色，K 线、指标、画线没单独设颜色的地方都从这里取。在内置主题上改几项就行：

```ts
import { lightTheme } from '@kumochart-sdk/core';

// 红涨绿跌
const theme = {
  ...lightTheme,
  up: '#ef5d5d',
  down: '#2fb57e',
  volumeUp: 'rgba(239, 93, 93, 0.4)',
  volumeDown: 'rgba(47, 181, 126, 0.4)'
};

createChart(container, { theme });
```

| 颜色                       | 用在                               |
| -------------------------- | ---------------------------------- |
| `background`               | 背景                               |
| `text`、`textMuted`        | 坐标轴、图例的文字，次要文字       |
| `grid`、`border`           | 网格线，窗格之间的分隔线           |
| `crosshair`                | 十字线                             |
| `crosshairLabelBackground` | 十字线在坐标轴上的标签底色         |
| `crosshairLabelText`       | 标签文字                           |
| `up`、`down`               | 上涨、下跌的 K 线和数值            |
| `volumeUp`、`volumeDown`   | 上涨、下跌的成交量柱               |
| `accent`                   | 选中的对象、拖动的控制点           |
| `palette`                  | 指标、画线、叠加图形依次使用的颜色 |
| `buy`、`sell`              | 买单、卖单和成交标记               |
| `alert`                    | 提醒线                             |

`withAlpha(color, 0.3)` 可以给一个颜色加透明度，配色时用得上。

颜色可以写成 CSS 支持的任何形式，如 `#26a69a`、`rgb(38 166 154)`、`rgba(38, 166, 154, 0.5)`、`teal`。传入时就会检查：主题、样式、指标、画线、提醒等各处的颜色写错了，当场报错并指出是哪个字段，不会等到画的时候才出错。不建图计算（如在 Node.js 里）时不画颜色，只检查是不是文字。应用自己的设置要和图表一样检查颜色，用 `checkColor(字段名, 值)`。

## 主图

主图默认是蜡烛图。核心有 11 种图形，切换类型：

```ts
chart.applyOptions({ mainSeries: { type: 'line' } });
```

| 类型             | 图形       |
| ---------------- | ---------- |
| `candles`        | 蜡烛       |
| `hollow-candles` | 空心蜡烛   |
| `ohlc`           | 美国线     |
| `high-low`       | 高低线     |
| `line`           | 折线       |
| `step-line`      | 阶梯线     |
| `line-markers`   | 带点的折线 |
| `area`           | 面积       |
| `baseline`       | 基线       |
| `hlc-area`       | HLC 面积   |
| `columns`        | 柱状       |

折线这类只画一个价格的图形，画哪个价格由 `mainSeries.source` 决定：`open`、`high`、`low`、`close`（默认）、`hl2`、`hlc3`、`ohlc4`。

每种图形的样式分开存，切换类型时各自的样式保留：

```ts
chart.applyOptions({
  mainSeries: {
    styles: {
      candles: { upColor: '#ffffff', border: true, bodyRatio: 0.7 },
      line: { color: '#5aa9fa', lineWidth: 2 }
    }
  }
});
```

没设的样式从主题来，换主题时跟着变。每种图形有哪些样式见 [API 参考](../api.md#SeriesStyleMap)。

要给个别 K 线单独上色，比如标出放量的那几根，用 `mainSeries.barColor`：

```ts
chart.applyOptions({
  mainSeries: {
    barColor: ({ bar }) => (bar.volume > 500 ? '#e8b04a' : null) // null 用原来的颜色
  }
});
```

## 网格和十字线

```ts
chart.applyOptions({
  grid: { vertical: false, horizontal: true, style: 'dashed' },
  crosshair: {
    mode: 'magnet', // 横线吸附到收盘价；'free' 跟着鼠标
    labels: true, // 坐标轴上显示时间和价格
    style: 'dashed'
  }
});
```

线型都是 `'solid'`、`'dashed'`、`'dotted'` 三种。

## 坐标轴

```ts
chart.applyOptions({
  priceScale: {
    margins: { top: 0.1, bottom: 0.08 }, // 自动缩放时上下留的空，按窗格高度的比例
    precision: 2, // 价格的小数位，默认 'auto' 从数据推断
    minWidth: 48 // 坐标轴最小宽度，标签长了会自己变宽
  },
  timeScale: {
    barSpacing: 8, // 开始时每根 K 线占多宽
    minBarSpacing: 0.5,
    maxBarSpacing: 60,
    rightOffset: 60 // 最新一根右边留多宽
  }
});
```

`margins` 和每个坐标的 `setMargins()` 是同一条规则：上下各自不小于 0，合起来不超过 0.9，给数据留至少十分之一的高度。

宽度、高度都是 CSS 像素。

### 自己格式化

价格和时间的文字可以自己写：

```ts
chart.applyOptions({
  priceScale: {
    formatter: (value, { precision }) => `$${value.toFixed(precision)}`
  },
  timeScale: {
    formatter: (time, { kind, unit }) => {
      const date = new Date(time);
      if (kind === 'crosshair') return date.toLocaleString('zh-CN');
      return unit === 'day'
        ? `${date.getMonth() + 1}月${date.getDate()}日`
        : date.toTimeString().slice(0, 5);
    }
  }
});
```

时间的 `kind` 是 `axis`（坐标轴上的刻度）或 `crosshair`（十字线的标签）；`unit` 是刻度落在哪一级上，年、月、日、时、分、秒。不写就按 `locale` 和 `timeZone` 自动格式化。格式化函数拿到的 `locale`、`timeZone` 是实际用的：没设时是浏览器的语言和本地时区。

## 最新价

右侧坐标轴上的最新价标签和那条横线：

```ts
chart.applyOptions({
  latestPrice: {
    line: true,
    label: true,
    countdown: true, // 标签下面显示这根 K 线还有多久收盘
    style: 'dotted',
    color: null // null 跟着最新这根的涨跌变色
  }
});
```

倒计时只在 K 线代表一段时间时显示：回放中、砖形图这类不显示；最新一根已经收盘（数据停了、休市）时也不显示，等新的一根来了再接着倒数。

## 图例

图例在每个窗格的左上角，显示鼠标所在那根（或最新一根）K 线的开高低收和指标的值。指标那一行先写名字和参数，再写各条线的值；只有一条线的指标（如 RSI、单个周期的 MA）名字已经说清了是哪条线，值前面不再写线名。

```ts
chart.applyOptions({
  legend: {
    visible: true,
    // 每一行鼠标经过时显示的按钮
    buttons: (item) =>
      item.kind === 'indicator'
        ? [
            { id: 'hide', icon: EYE_ICON },
            { id: 'remove', icon: CLOSE_ICON }
          ]
        : []
  }
});

chart.on('legendButtonClick', ({ item, buttonId }) => {
  if (buttonId === 'remove') chart.indicators.remove(item.id);
  if (buttonId === 'hide') chart.indicators.update(item.id, { visible: false });
});
```

按钮的 `icon` 是 24 × 24 的 SVG 路径（`<path d="...">` 里的那串），图标库里都能找到。

默认只列出看得见的指标和叠加图形。想把隐藏的也列出来（显示成灰的，方便再点开），用 `rows`：

```ts
chart.applyOptions({ legend: { rows: () => true } });
```

## 水印

主图正中可以显示一两行大字，比如品种和周期，画在 K 线下面，颜色很淡，不挡视线。用水印模块，文字用选项设：

```ts
import { createChart } from '@kumochart-sdk/core';
import { watermark } from '@kumochart-sdk/core/watermark';

const chart = createChart(container, {
  modules: [watermark()],
  watermark: { lines: [{ text: 'BTCUSDT' }, { text: '1h', size: 20 }] }
});

chart.applyOptions({ watermark: { lines: [{ text: 'ETHUSDT' }, { text: '4h', size: 20 }] } });
```

`lines` 从上往下排，`size` 是字号（默认 40）；`color` 不设时用主题的文字颜色，调得很淡。换品种、换周期时用 `applyOptions()` 换掉整组 `lines`。

## 语言和文字

```ts
createChart(container, {
  locale: 'zh-CN', // 数字和日期的格式，默认跟着浏览器
  texts: {
    legendOpen: '开',
    legendHigh: '高',
    legendLow: '低',
    legendClose: '收',
    legendVolume: '量',
    days: (count) => `${count}天` // 倒计时里的天数
  }
});
```

图表画在画布上的文字默认是 `O H L C V` 这类各种语言通用的写法，需要的话用 `texts` 换掉。

## 字体

```ts
chart.applyOptions({ font: { family: 'Inter, sans-serif', size: 12 } });
```

## 截图

```ts
const canvas = chart.screenshot();
canvas.toBlob((blob) => {
  /* 下载或上传 */
});
```

`screenshot()` 返回一个画好整张图表的 canvas，包括所有窗格和坐标轴。
