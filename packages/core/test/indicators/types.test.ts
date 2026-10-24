import { describe, expect, it } from 'vitest';
import { MA } from '../../src/indicators';
import { allIndicators } from '../../src/indicators/all';
import { indicators } from '../../src/indicators/module';
import { createBars } from '../helpers/bars';
import { createModularChart, createTestChart } from '../helpers/chart';
import { compute, expectClose, incrementalMatchesFull } from './helpers';
import { walk } from './reference';

const bars = walk(400);

/** Every indicator type of the SDK, in the order of `allIndicators`, and its default outputs. */
const DEFAULT_OUTPUTS: [type: string, keys: string[]][] = [
  ['MA', ['ma9']],
  ['EMA', ['ema9']],
  ['SMMA', ['smma7']],
  ['BOLL', ['basis', 'upper', 'lower']],
  [
    'ICHIMOKU',
    [
      'conversionLine',
      'baseLine',
      'laggingSpan',
      'leadingSpanA',
      'leadingSpanB',
      'kumoCloudUpperLine',
      'kumoCloudLowerLine'
    ]
  ],
  ['VOL', ['volume']],
  ['MACD', ['histogram', 'macd', 'signalLine']],
  ['RSI', ['rsi', 'rsiBasedMa']],
  ['KDJ', ['k', 'd', 'j']],
  ['WR', ['wr14']],
  ['CCI', ['cci', 'cciBasedMa']],
  ['ROC', ['roc']],
  ['BIAS', ['bias6', 'bias12', 'bias24']],
  ['OBV', ['onBalanceVolume']],
  ['VR', ['vr', 'mavr']],
  ['EMV', ['eom']],
  ['MFI', ['mf']],
  ['ATR', ['atr']],
  ['STD', ['std']],
  ['DMI', ['adx', 'plus', 'minus']],
  ['VWAP', ['vwap', 'upperBand1', 'lowerBand1']],
  ['SAR', ['parabolicSar']],
  ['SUPERTREND', ['upTrend', 'downTrend', 'bodyMiddle']],
  ['KC', ['upper', 'basis', 'lower']],
  ['DC', ['basis', 'upper', 'lower']],
  ['WMA', ['wma9']],
  ['HMA', ['hma9']],
  ['KAMA', ['kama']],
  ['ALMA', ['alma']],
  ['VWMA', ['vwma20']],
  ['BBI', ['bbi']],
  ['DMA', ['dif', 'difma']],
  ['TRIX', ['trix']],
  ['AROON', ['aroonUp', 'aroonDown']],
  ['CHANDELIER', ['longExit', 'shortExit']],
  ['STOCH', ['k', 'd']],
  ['STOCHRSI', ['k', 'd']],
  ['FISHER', ['fisher', 'trigger']],
  ['MTM', ['mom']],
  ['DPO', ['dpo']],
  ['PSY', ['psy', 'psyma']],
  ['BRAR', ['br', 'ar']],
  ['CMF', ['cmf']],
  ['CHOP', ['chop']],
  ['ALLIGATOR', ['jaw', 'teeth', 'lips']],
  ['FRACTALS', ['downFractal', 'upFractal']],
  ['PIVOTS', ['p', 'r1', 's1', 'r2', 's2', 'r3', 's3', 'r4', 's4', 'r5', 's5']],
  ['PREVHLC', ['high', 'low', 'close']],
  ['ADR', ['adr']],
  [
    'SESSIONS',
    [
      'tokyoHigh',
      'tokyoLow',
      'tokyoDay',
      'londonHigh',
      'londonLow',
      'londonDay',
      'newYorkHigh',
      'newYorkLow',
      'newYorkDay'
    ]
  ]
];

const TYPES = DEFAULT_OUTPUTS.map(([type]) => type);

describe('indicator types', () => {
  it('are every type of the SDK', () => {
    expect(allIndicators.map((definition) => definition.type)).toEqual(TYPES);
  });

  it.each(DEFAULT_OUTPUTS)('%s has the default outputs %j', (type, keys) => {
    expect(Object.keys(compute(type, bars.slice(0, 5)))).toEqual(keys);
  });

  it.each(TYPES)('%s gives the same values incrementally and in full', (type) => {
    const { full, incremental } = incrementalMatchesFull(type, bars);

    for (const [key, values] of Object.entries(full)) {
      expect(
        values.some((value) => !Number.isNaN(value)),
        `${key} has values`
      ).toBe(true);
      expectClose(incremental[key] ?? [], values, 9);
    }
  });

  it('come with the indicators module, all of them or those picked', () => {
    const few = createModularChart({ modules: [indicators([MA])] });
    few.data.set(createBars(60));

    expect(() => few.indicators.add({ type: 'HMA' })).toThrow(
      'Unknown indicator type "HMA". Give it to the indicators module'
    );
    expect(few.indicators.types()).toEqual(['MA']);

    const chart = createTestChart();
    chart.data.set(createBars(60));
    expect(chart.indicators.types()).toEqual(TYPES);
    const id = chart.indicators.add({ type: 'STOCHRSI' });
    expect(chart.indicators.valuesAt(id).map((value) => value.key)).toEqual(['k', 'd']);
  });
});
