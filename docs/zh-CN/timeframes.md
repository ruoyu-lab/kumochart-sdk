# 周期和交易日历

给图表 1 分钟 K 线，它能在浏览器里合成 5 分钟、4 小时、日线、周线等周期，切换周期不用再向服务器要数据。怎么合成，按交易日历来：一天从几点开始、有哪些交易时段、哪几天交易。

## 周期的写法

数字加单位：

| 单位 | 意思 | 例子           |
| ---- | ---- | -------------- |
| `s`  | 秒   | `'15s'`        |
| `m`  | 分钟 | `'1m'`、`'5m'` |
| `h`  | 小时 | `'1h'`、`'4h'` |
| `D`  | 天   | `'1D'`         |
| `W`  | 周   | `'1W'`         |
| `M`  | 月   | `'1M'`、`'3M'` |

只有分钟 `m` 和月 `M` 靠大小写区分，其它大小写都行（`'4H'`、`'1d'`）。数字是 1 可以省略，`'D'` 就是 `'1D'`。也可以写成对象：`{ unit: 'hour', count: 4 }`。

## 切换周期

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!);

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('4h');
```

`set()` 时给的 `interval` 是原始周期，`setTimeframe()` 设的是显示的周期，`setTimeframe(null)` 回到原始周期：

```ts
chart.data.sourceInterval(); // { unit: 'minute', count: 1 }
chart.data.timeframe(); // { unit: 'hour', count: 4 }，原始周期时是 null
```

合成出来的每根 K 线：时间是这个周期的开始，开盘价是第一根的，最高、最低取所有根里的，收盘价是最后一根的，成交量相加。最新的那根会随着实时数据一起更新。

几天一根的周期（比如 `'2D'`）数的是交易日：每根正好是接连的几个交易日（按日历的 `weekdays`），不交易的日子不算，时间是其中第一个交易日。从 1970 年 1 月 1 日起依次分组，所以同样的日历分出来的总是同样几组。

指标也能按比图表长的周期算，比如 5 分钟图上的 1 小时均线，见[指标](indicators.md#按另一个周期算)。

## 哪些周期能合成

- 秒、分钟、小时：要是原始周期的整数倍，比如 1 分钟能合成 3 分钟、1 小时，不能合成 90 秒。
- 天：原始周期要能整除一天，比如 1 分钟、15 分钟、4 小时都行，7 分钟不行。
- 周、月：从能整除一天的周期合成，或者从 1 天合成；从 2 天合成不行。
- 不能比原始周期小。

合成不了的周期，`setTimeframe()` 会报错并说明原因。做周期菜单时，可以先用 `canBuildTimeframe()` 判断哪些能选：

```ts
import { canBuildTimeframe } from '@kumochart-sdk/core';

canBuildTimeframe('4h', '1h'); // true
canBuildTimeframe('1W', '2D'); // false
```

秒、分钟、小时的周期有固定的长度，`intervalDuration()` 给出它的毫秒数；天、周、月的长短由交易日历决定，给 `null`：

```ts
import { intervalDuration } from '@kumochart-sdk/core';

intervalDuration('15m'); // 900000
intervalDuration('1D'); // null
```

## 时区

有两个时区设置：

- `timeZone`：坐标轴和十字线上的时间按哪个时区显示。不设就是用户电脑的本地时区。
- `calendar.timeZone`：K 线按哪个时区切分日线、周线，以及小时线从几点开始。默认 `UTC`。

加密货币交易所的 K 线按 UTC 切分，日线从 UTC 0 点开始，用默认的就行，显示的时间仍然是用户本地的。股票、期货这类按交易所的时间给 K 线的，设成交易所的时区：

```ts
createChart(container, {
  timeZone: 'Asia/Shanghai', // 时间按北京时间显示
  calendar: { timeZone: 'America/New_York' } // 美股的日线从纽约 0 点开始
});
```

日历要和数据对得上。分钟线、小时线的时间要在日历的周期起点上：比如小时线从 UTC 整点开始、日历却设成了印度时间（差半小时），`set()` 会报错并说明该怎么设，不会悄悄把 K 线挪到别的时间。日线、周线、月线按交易日期归属，时间打在当天零点、开盘还是收盘都可以。

时区用 IANA 的名字，比如 `Asia/Shanghai`、`America/New_York`、`UTC`。

## 交易时段

24 小时交易的市场不用设。有固定交易时间的市场，在 `calendar` 里写明：

| 选项        | 意思                                                                              | 默认         |
| ----------- | --------------------------------------------------------------------------------- | ------------ |
| `sessions`  | 一天里的交易时段，`'HH:MM-HH:MM'`，结束早于开始表示跨过午夜。时段外的时间会被丢掉 | `[]`（全天） |
| `dayStart`  | 交易日从几点开始，这个时间以后算下一个交易日                                      | `'00:00'`    |
| `weekdays`  | 哪几天是交易日，0 是周日                                                          | 每天         |
| `weekStart` | 周线从周几开始，0 是周日                                                          | `1`（周一）  |

几个例子：

```ts
// A 股：上午、下午两个时段，周一到周五
createChart(container, {
  calendar: {
    timeZone: 'Asia/Shanghai',
    sessions: ['09:30-11:30', '13:00-15:00'],
    weekdays: [1, 2, 3, 4, 5]
  }
});

// 国内期货带夜盘：晚上 9 点开始的夜盘算下一个交易日，周五夜盘算到周一
createChart(container, {
  calendar: {
    timeZone: 'Asia/Shanghai',
    sessions: ['21:00-02:30', '09:00-10:15', '10:30-11:30', '13:30-15:00'],
    dayStart: '21:00',
    weekdays: [1, 2, 3, 4, 5]
  }
});

// 外汇：纽约时间下午 5 点换日
createChart(container, {
  calendar: {
    timeZone: 'America/New_York',
    dayStart: '17:00',
    weekdays: [1, 2, 3, 4, 5]
  }
});
```

有交易时段时，小时线从每个时段的开始算起，比如 A 股的 1 小时线是 9:30、10:30、13:00、14:00。

## 节假日和特殊规则

固定的规则表达不了的，比如节假日休市、某天提前收盘，用 `calendar.bucket` 自己决定每个时间归到哪根 K 线：

```ts
const holidays = new Set(['2026-10-01', '2026-10-02']);

createChart(container, {
  calendar: {
    timeZone: 'Asia/Shanghai',
    sessions: ['09:30-11:30', '13:00-15:00'],
    bucket: (time, interval, fallback) => {
      const date = new Date(time + 8 * 3_600_000).toISOString().slice(0, 10);
      return holidays.has(date) ? null : fallback(time);
    }
  }
});
```

返回这根 K 线的开始时间，返回 `null` 就丢掉这个时间。`fallback` 是按其它日历设置算出来的结果。返回的时间不能随着时间倒退。

## 自己用这套日历

自己的代码要和图表用同样的规则对齐时间，比如服务器上合成 K 线、判断某个时间属于哪根，用 `createCalendar()`：

```ts
import { createCalendar } from '@kumochart-sdk/core';

const calendar = createCalendar({
  timeZone: 'Asia/Shanghai',
  sessions: ['09:30-11:30', '13:00-15:00']
});

calendar.bucket('2026-05-06T02:15:00Z', '1h'); // 北京时间 10:15 属于 9:30 开始的那根，返回 9:30 的时间戳
```

它不需要图表，也能在 Node.js 里用。

已经有图表时，`chart.data.calendar()` 就是图表正在用的那个日历（`calendar` 选项，加上图表的时区），比如在插件里按交易日分组时用它。选项改了以后它会换成新的，所以用的时候再取。
