# 指标

指标模块有 50 种指标，从均线、MACD、RSI 到一目均衡表、VWAP。国际通行的指标，算法和默认参数都和国际上通用的一致；KDJ、BIAS 这类国内常用的指标，按国内软件的公式。

```ts live height=480
import { createChart } from '@kumochart-sdk/core';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators(allIndicators)]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');

chart.indicators.add({ type: 'EMA', params: { periods: [20, 50] } });
chart.indicators.add({ type: 'BOLL' });
chart.indicators.add({ type: 'MACD' });
chart.indicators.add({ type: 'RSI' });
```

## 载入

```ts
import { indicators, allIndicators, MA, MACD, RSI } from '@kumochart-sdk/core/indicators';

createChart(container, { modules: [indicators(allIndicators)] }); // 全部
createChart(container, { modules: [indicators([MA, MACD, RSI])] }); // 只要这几种
```

## 添加

```ts
const id = chart.indicators.add({ type: 'RSI' });
```

<!-- code-prelude
declare const id: string;
declare const userInput: import('@kumochart-sdk/core/indicators').IndicatorInput;
-->

`add()` 返回指标的 id：你给的 `id`，或者图表按类型编的号，比如 `rsi-1`。不写的设置都用这种指标的默认值，要改的写上：

```ts
chart.indicators.add({
  type: 'MA',
  params: { periods: [20, 60, 120] }, // 参数
  source: 'hlc3', // 用哪个价格算，默认收盘价
  pane: 'main', // 画在哪个窗格：'main'、'new'（新开一个），或者已有窗格的 id
  scale: 'right', // 用窗格里的哪个价格坐标
  colors: { ma20: '#e8b04a' }, // 按输出改颜色
  styles: { ma120: { lineWidth: 2, lineStyle: 'dashed' } }, // 按输出改线宽、线型，或者隐藏
  levels: [], // 参考线，比如 RSI 的 70、30；[] 不画
  visible: true
});
```

均线这类叠在主图上的指标默认 `pane: 'main'`，MACD、RSI 这类默认自己开一个副图，见[窗格](panes.md)。

## 修改和去掉

```ts
chart.indicators.update(id, { params: { period: 21 } });
chart.indicators.update(id, { colors: { rsi: null } }); // null 恢复默认颜色
chart.indicators.update(id, { levels: null }); // 恢复默认参考线
chart.indicators.update(id, { visible: false }); // 隐藏
chart.indicators.update(id, { pane: 'new' }); // 挪到单独的窗格；'main' 挪回主图

chart.indicators.remove(id);
chart.indicators.list(); // 全部指标
chart.indicators.get(id);
chart.indicators.set([{ type: 'MA' }, { type: 'RSI' }]); // 整批替换
chart.indicators.clear(); // 全部去掉
```

被[提醒](alerts.md)盯着的指标不能直接去掉，要先删提醒；用 `set()` 换掉、`clear()` 清空时也一样。

## 读值

```ts
chart.indicators.valuesAt(id); // 最新一根上的值
chart.indicators.valuesAt(id, 120); // 第 120 根上的值
// [{ key: 'rsi', label: 'RSI', value: 63.2, text: '63.20', color: '#…' }, …]
```

和图例上显示的一样：`text` 是按指标的小数位格式化好的，`color` 是这条线的颜色。某根上这条线没有值时（比如 RSI 还没攒够 K 线），`value` 是 `null`。

## 一个指标算另一个指标

`source` 可以是另一个指标的某条线，比如 RSI 的 EMA：

```ts
const rsiId = chart.indicators.add({ type: 'RSI' });
chart.indicators.add({
  type: 'EMA',
  source: { kind: 'indicator', id: rsiId, key: 'rsi' },
  pane: rsiId // 和 RSI 画在同一个副图里
});
```

不写 `key` 就用那个指标的第一条线。被别的指标用着的指标不能先去掉。

## 按另一个周期算

`timeframe` 让指标按比图表长的周期算，比如在 5 分钟图上看 1 小时的均线：

```ts live height=420
import { createChart } from '@kumochart-sdk/core';
import { indicators, allIndicators } from '@kumochart-sdk/core/indicators';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [indicators(allIndicators)]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('5m');

chart.indicators.add({ type: 'MA', params: { periods: [20] }, timeframe: '1h' }); // 1 小时的 20 均线
chart.indicators.add({ type: 'MA', params: { periods: [20] } }); // 5 分钟的 20 均线
```

指标用的 1 小时 K 线，由图表的原始 K 线按交易日历合成，和[切换周期](timeframes.md#切换周期)合成出来的一样；实时数据、往前加载的历史、日历的改动、[回放](replay.md)，它都跟着变。同一个周期的指标共用一份 K 线。

**等大周期收盘**：图上每根 K 线显示的，是到这根 K 线结束时已经收盘的最后一根 1 小时 K 线的值。一根 1 小时 K 线要等下一根开始才算收盘，所以值在每个小时的最后一根 5 分钟 K 线上变，画出来是一级一级的台阶。这样历史上的每根 K 线都不会用到当时还没有的数据。最新一根例外：它显示还没收盘的那根 1 小时 K 线的值，随行情实时变。一根 K 线在下一根开始时结束，所以周期不成倍数（3 分钟图上的 5 分钟指标）、中间隔着周末和休市，规则都一样。

**算不了时按图上的 K 线算**：图表的周期不比指标的短（比如日线图上的 1 小时指标）、原始 K 线合成不了这个周期（见[哪些周期能合成](timeframes.md#哪些周期能合成)），或者显示的是不按时间生成的 K 线（砖形图这类，见[图表类型](chart-types.md)），指标就按图上的 K 线算，和没设 `timeframe` 一样，不报错也不消失；能算了再回到自己的周期。平均 K 线这类一根对一根的变换不影响。比长短时，秒、分钟、小时按实际长度，一天算 24 小时，一周算 7 天，一个月算 30 天。

`offset` 平移的是指标自己周期的 K 线，比如 1 小时一目均衡表的先行带往右移 26 根 1 小时 K 线。同一根大周期 K 线上的标记只画一次。图例把周期写在参数后面：`MA 20 1h`。[保存的状态](state.md)里也有它。

```ts
chart.indicators.get(id)?.timeframe; // '1h'，没设是 null
chart.indicators.update(id, { timeframe: '4h' }); // 换成 4 小时
chart.indicators.update(id, { timeframe: null }); // 换回图上的 K 线
```

算另一个指标的指标，跟着那个指标的周期，在它的值上算，显示的规则也一样：

```ts
const hourlyRsi = chart.indicators.add({ type: 'RSI', timeframe: '1h' });
chart.indicators.add({
  type: 'EMA',
  source: { kind: 'indicator', id: hourlyRsi }, // 也按 1 小时算
  pane: hourlyRsi
});
```

给它一个不一样的 `timeframe` 会报错。[不用图表](#不用图表也能算)的 `computeIndicator()` 不受影响：给它哪个周期的 K 线，就按哪个周期算。

## 做设置面板

指标有哪些参数、每个参数的范围，从定义里读：

```ts
const definition = chart.indicators.definition('RSI');
definition?.params; // { period: { default: 14, min: 1, max: 2000, integer: true, label: 'RSI Length' }, … }
```

带 `options` 的参数只能取那几个值（比如均线类型），界面上做成下拉框。用户填的设置，先用 `checkIndicatorInput()` 检查，不对会抛出和 `add()` 一样的错误：

```ts
import { checkIndicatorInput } from '@kumochart-sdk/core/indicators';

checkIndicatorInput(chart.indicators.definition('RSI')!, userInput);
```

## 多语言

指标的定义用英文写名字和标签。要让图例和 `valuesAt()` 跟着图表的 `locale` 显示中文、日文、韩文，把 SDK 带的译文 `indicatorTexts` 交给模块：

```ts
import { createChart } from '@kumochart-sdk/core';
import { indicators, allIndicators, indicatorTexts } from '@kumochart-sdk/core/indicators';

createChart(container, {
  modules: [indicators(allIndicators, { texts: [indicatorTexts] })],
  locale: 'zh-CN'
});
```

不交就只用英文，`indicatorTexts` 也不会打进你的包里。`MA`、`RSI` 这类代号各语言都一样，不翻。

做设置面板时，`chart.indicators.title(type)` 给出指标的全名，`chart.indicators.label(text)` 把定义里的标签（线、参数、选项的名字）换成图表的语言：

```ts
chart.indicators.title('BOLL'); // '布林带'
chart.indicators.label('Period'); // '周期'
```

译文按语言、再按英文原文写，后给的盖过先给的。自己的指标要多语言，或者想改几个字，再加一份；以数字结尾的标签（如 `Upper Band #2`）没有自己的译文时，用 `Upper Band #{n}` 的译文，`{n}` 换成那个数字：

```ts
import { indicators, allIndicators, indicatorTexts } from '@kumochart-sdk/core/indicators';

indicators(allIndicators, {
  texts: [indicatorTexts, { zh: { labels: { Upper: '上沿' } } }]
});
```

没有图表时（比如设置界面先于图表打开），`indicatorLanguage(texts, locale)` 照同样的规则给出 `title()` 和 `label()`。

## 内置指标

下面的"输出"是每条线的 key，读值、设颜色、设[提醒](alerts.md)时用。均线这类可以一次给好几个周期的，输出的 key 带周期，比如 `ma20`。

### 均线

| 类型        | 名称                 | 默认参数               | 输出                   |
| ----------- | -------------------- | ---------------------- | ---------------------- |
| `MA`        | 简单移动平均         | 周期 9                 | `ma9`                  |
| `EMA`       | 指数移动平均         | 周期 9                 | `ema9`                 |
| `SMMA`      | 平滑移动平均         | 周期 7                 | `smma7`                |
| `WMA`       | 加权移动平均         | 周期 9                 | `wma9`                 |
| `HMA`       | 赫尔移动平均         | 周期 9                 | `hma9`                 |
| `VWMA`      | 成交量加权移动平均   | 周期 20                | `vwma20`               |
| `ALMA`      | 阿尔诺·勒古移动平均  | 9，偏移 0.85，σ 6      | `alma`                 |
| `KAMA`      | 考夫曼自适应移动平均 | 10，快 2，慢 30        | `kama`                 |
| `ALLIGATOR` | 鳄鱼线               | 13、8、5，右移 8、5、3 | `jaw`、`teeth`、`lips` |
| `BBI`       | 多空指标（国内）     | 3、6、12、24           | `bbi`                  |

### 通道

| 类型       | 名称             | 默认参数                       | 输出                                                                        |
| ---------- | ---------------- | ------------------------------ | --------------------------------------------------------------------------- |
| `BOLL`     | 布林带           | 20，SMA，2 倍标准差            | `basis`、`upper`、`lower`                                                   |
| `KC`       | 肯特纳通道       | 20，EMA，2 倍 ATR（10）        | `upper`、`basis`、`lower`                                                   |
| `DC`       | 唐奇安通道       | 20                             | `basis`、`upper`、`lower`                                                   |
| `ICHIMOKU` | 一目均衡表       | 9、26、52，位移 26             | `conversionLine`、`baseLine`、`laggingSpan`、`leadingSpanA`、`leadingSpanB` |
| `VWAP`     | 成交量加权平均价 | 每个交易日重新算，1 倍标准差带 | `vwap`、`upperBand1`、`lowerBand1`                                          |

### 趋势和止损

| 类型         | 名称       | 默认参数           | 输出                       |
| ------------ | ---------- | ------------------ | -------------------------- |
| `SAR`        | 抛物线转向 | 0.02，0.02，0.2    | `parabolicSar`             |
| `SUPERTREND` | 超级趋势   | 10，3 倍 ATR       | `upTrend`、`downTrend`     |
| `CHANDELIER` | 吊灯止损   | 22，ATR 22，3 倍   | `longExit`、`shortExit`    |
| `DMI`        | 动向指标   | ADX 平滑 14，DI 14 | `adx`、`plus`、`minus`     |
| `AROON`      | 阿隆指标   | 14                 | `aroonUp`、`aroonDown`     |
| `FRACTALS`   | 威廉斯分形 | 2                  | `downFractal`、`upFractal` |

### 震荡

| 类型       | 名称                 | 默认参数                      | 输出                              |
| ---------- | -------------------- | ----------------------------- | --------------------------------- |
| `MACD`     | 指数平滑异同移动平均 | 12，26，9                     | `macd`、`signalLine`、`histogram` |
| `RSI`      | 相对强弱指标         | 14，带 14 的 SMA 均线         | `rsi`、`rsiBasedMa`               |
| `STOCH`    | 随机指标             | 14，%K 平滑 1，%D 平滑 3      | `k`、`d`                          |
| `STOCHRSI` | 随机 RSI             | %K 3，%D 3，RSI 14，随机 14   | `k`、`d`                          |
| `CCI`      | 顺势指标             | 20（hlc3），带 14 的 SMA 均线 | `cci`、`cciBasedMa`               |
| `WR`       | 威廉指标             | 14                            | `wr14`                            |
| `ROC`      | 变动率               | 9                             | `roc`                             |
| `MTM`      | 动量                 | 10                            | `mom`                             |
| `TRIX`     | 三重指数平滑         | 18                            | `trix`                            |
| `DPO`      | 去趋势价格振荡       | 21                            | `dpo`                             |
| `FISHER`   | 费舍尔变换           | 9（hl2）                      | `fisher`、`trigger`               |
| `KDJ`      | 随机指标（国内）     | 9，3，3                       | `k`、`d`、`j`                     |
| `BIAS`     | 乖离率（国内）       | 6、12、24                     | `bias6`、`bias12`、`bias24`       |
| `PSY`      | 心理线（国内）       | 12，6                         | `psy`、`psyma`                    |
| `BRAR`     | 人气意愿（国内）     | 26                            | `br`、`ar`                        |
| `DMA`      | 平行线差（国内）     | 10，50，10                    | `dif`、`difma`                    |

### 成交量

| 类型  | 名称               | 默认参数       | 输出              |
| ----- | ------------------ | -------------- | ----------------- |
| `VOL` | 成交量             | 不带均线       | `volume`          |
| `OBV` | 能量潮             | 不带均线       | `onBalanceVolume` |
| `MFI` | 资金流量指标       | 14             | `mf`              |
| `CMF` | 蔡金资金流         | 20             | `cmf`             |
| `EMV` | 简易波动指标       | 14，除数 10000 | `eom`             |
| `VR`  | 成交量比率（国内） | 26，6          | `vr`、`mavr`      |

### 波动

| 类型   | 名称         | 默认参数 | 输出   |
| ------ | ------------ | -------- | ------ |
| `ATR`  | 平均真实波幅 | 14，RMA  | `atr`  |
| `STD`  | 标准差       | 20       | `std`  |
| `CHOP` | 震荡指数     | 14       | `chop` |
| `ADR`  | 平均振幅     | 14       | `adr`  |

### 周期和时段

| 类型       | 名称           | 默认参数                   | 输出                                        |
| ---------- | -------------- | -------------------------- | ------------------------------------------- |
| `PIVOTS`   | 枢轴点         | 传统算法，周期按图表自动选 | `p`、`r1`、`s1` … `r5`、`s5`                |
| `PREVHLC`  | 上一周期高低收 | 日                         | `high`、`low`、`close`                      |
| `SESSIONS` | 交易时段       | 东京、伦敦、纽约           | `tokyoHigh`、`londonHigh`、`newYorkHigh` 等 |

枢轴点的周期默认跟着图表的周期选：15 分钟及以下用日，其它日内周期用周，日线用月，周线、月线用年；`data.set()` 没给 `interval` 时用日。

每个指标的完整参数和输出，用 `chart.indicators.definition(type)` 查，或者看 [API 参考](../api.md#indicators)。

## 和国内常见软件的不同

习惯了国内软件的话，这几处要注意：

- **MACD**：柱子是 MACD 线减信号线，不乘 2。三条线叫 `macd`、`signalLine`、`histogram`。
- **RSI**：默认一条 14，参考线 70 和 30，并带一条 14 的均线；平滑用的是 Wilder 的方法，前 14 根用简单平均起步。
- **WR**：在 -100 到 0 之间，0 是最高。
- **均线**：MA、EMA 默认一条 9，要几条就给 `periods: [5, 10, 20, 30]`。EMA 的第一个值是前几根的简单平均。
- **成交量**：默认不带均线，要的话给 `periods: [5, 10]`。

KDJ、BIAS、BRAR、PSY、DMA、VR、BBI 这几种是国内常用的指标，算法和国内软件一样。

## 不用图表也能算

```ts
import { computeIndicator, RSI } from '@kumochart-sdk/core/indicators';

const { rsi } = computeIndicator(RSI, bars);
// rsi[i] 是第 i 根 K 线上的值，和图表上算出来的一样
```

要跟着实时数据一根一根算，用 `createIndicatorCalculator()`。它们只依赖传进去的数据，Node.js 里也能用，比如在服务器上判断提醒。按交易日或周期算的指标，比如 VWAP 和枢轴点，要把图表的交易日历和周期也传进去，算出来才和图表一样：`{ calendar, interval: '15m' }`。

一个指标算另一个指标（比如 RSI 的 EMA）时，用 `nextOf(bar, value)` 把另一个指标在这根 K 线上的值喂进去，和图表上 `source` 写另一个指标时算出来的一样：

```ts
import { createIndicatorCalculator, EMA, RSI } from '@kumochart-sdk/core/indicators';

const rsi = createIndicatorCalculator(RSI);
const ema = createIndicatorCalculator(EMA, { params: { periods: [5] } });

for (const bar of bars) {
  const [value] = rsi.next(bar);
  const [smoothed] = ema.nextOf(bar, value); // RSI 还没有值（NaN）的 K 线跳过，和图表一样
}
```

自己写一种指标，见[自定义指标](custom-indicators.md)。
