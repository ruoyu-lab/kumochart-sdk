import type { Bar } from '../../data/types';
import type { Calendar } from '../../feed/calendar';
import { MovingAverage, MovingSum, Previous, SimpleAverage } from '../primitives';
import type { IndicatorDefinition, IndicatorOutput, IndicatorStream } from '../types';
import {
  choiceParam,
  IDENTITY,
  lineOutput,
  namedLine,
  ParallelStream,
  periodParam,
  picked,
  ratio,
  smoothingFills,
  SmoothedStream,
  smoothingOutputs,
  smoothingParams,
  type BarStep,
  type SmoothingParams
} from './shared';

/** Volume columns colored by the bar direction, with simple moving averages of the volume. */
export const VOL: IndicatorDefinition<{ periods: readonly number[] }> = {
  type: 'VOL',
  name: 'VOL',
  pane: 'new',
  precision: 'volume',
  params: {
    periods: { default: [], min: 1, max: 2000, integer: true, label: 'MA Length' }
  },
  outputs: ({ periods }) => [
    { key: 'volume', label: 'Volume', plot: { kind: 'histogram', colorBy: 'bar' } },
    ...periods.map((period): IndicatorOutput =>
      namedLine(`ma${String(period)}`, `MA${String(period)}`)
    )
  ],
  create: ({ periods }) =>
    new ParallelStream(
      [IDENTITY, ...periods.map((period) => new SimpleAverage(period))],
      (bar) => bar.volume
    )
};

/**
 * Running total of the volume, added on up closes and subtracted on down closes, from 0 on the
 * first bar.
 */
class ObvStep implements BarStep {
  constructor(
    private readonly closes = new Previous(),
    private total = 0
  ) {}

  next(_value: number, bar: Bar): number {
    const change = bar.close - this.closes.next(bar.close);

    if (!Number.isNaN(change)) {
      this.total += Math.sign(change) * bar.volume;
    }

    return this.total;
  }

  clone(): BarStep {
    return new ObvStep(this.closes.clone(), this.total);
  }
}

/** On-balance volume, and a moving average of it if picked, none by default. */
export const OBV: IndicatorDefinition<SmoothingParams> = {
  type: 'OBV',
  name: 'OBV',
  pane: 'new',
  precision: 'volume',
  params: smoothingParams(false),
  outputs: (params) => [
    namedLine('onBalanceVolume', 'OnBalanceVolume'),
    ...smoothingOutputs('obv', 'OBV', params)
  ],
  fills: smoothingFills,
  create: (params) => SmoothedStream.of(new ObvStep(), params)
};

/**
 * `(2 * up + flat) / (2 * down + flat) * 100` of the volume on up, down and unchanged closes over
 * `period` bars, and its average.
 */
class VrStream implements IndicatorStream {
  private readonly out = new Float64Array(2);

  constructor(
    private readonly period: number,
    private readonly average: MovingAverage,
    private readonly closes = new Previous(),
    private readonly up = new MovingSum(period),
    private readonly down = new MovingSum(period),
    private readonly flat = new MovingSum(period)
  ) {}

  next(bar: Bar): ArrayLike<number> {
    const change = bar.close - this.closes.next(bar.close);

    if (Number.isNaN(change)) {
      this.out.fill(Number.NaN);
      return this.out;
    }

    const up = this.up.next(change > 0 ? bar.volume : 0);
    const down = this.down.next(change < 0 ? bar.volume : 0);
    const flat = this.flat.next(change === 0 ? bar.volume : 0);
    const vr = ratio(2 * up + flat, 2 * down + flat) * 100;
    this.out[0] = vr;
    this.out[1] = this.average.next(vr);
    return this.out;
  }

  clone(): IndicatorStream {
    return new VrStream(
      this.period,
      this.average.clone(),
      this.closes.clone(),
      this.up.clone(),
      this.down.clone(),
      this.flat.clone()
    );
  }
}

/**
 * 成交量变异率 (volume ratio), as in Chinese charting software: `VR = (2 * TH + TQ) / (2 * TL +
 * TQ) * 100` of the volume of the up (TH), down (TL) and unchanged (TQ) closes of `period` bars,
 * and its average `MAVR = MA(VR, M)`.
 */
export const VR: IndicatorDefinition<{ period: number; signal: number }> = {
  type: 'VR',
  name: 'VR',
  pane: 'new',
  precision: 2,
  params: { period: periodParam(26), signal: periodParam(6, 'Signal') },
  outputs: () => [lineOutput('VR'), lineOutput('MAVR')],
  create: ({ period, signal }) => new VrStream(period, new MovingAverage(signal))
};

/**
 * `divisor * Δ((H + L) / 2) * (H - L) / VOLUME` of each bar, undefined on the first bar and on
 * bars without volume.
 */
class EaseStep implements BarStep {
  constructor(
    private readonly divisor: number,
    private readonly medians = new Previous()
  ) {}

  next(_value: number, bar: Bar): number {
    const median = (bar.high + bar.low) / 2;
    const change = median - this.medians.next(median);
    return ratio(this.divisor * change * (bar.high - bar.low), bar.volume);
  }

  clone(): EaseStep {
    return new EaseStep(this.divisor, this.medians.clone());
  }
}

/** Ease of movement: a simple average, over `period` bars that have it, of the ease of each bar. */
class EaseStream implements IndicatorStream {
  private readonly out = new Float64Array(1);

  constructor(
    private readonly ease: EaseStep,
    private readonly average: SimpleAverage
  ) {}

  next(bar: Bar, price: number): ArrayLike<number> {
    this.out[0] = this.average.next(this.ease.next(price, bar));
    return this.out;
  }

  clone(): IndicatorStream {
    return new EaseStream(this.ease.clone(), this.average.clone());
  }
}

/**
 * Ease of movement: how far the median price moves for the volume traded, `divisor * Δ((H + L) /
 * 2) * (H - L) / VOLUME`, averaged over `period` bars; bars without volume are skipped.
 */
export const EMV: IndicatorDefinition<{ period: number; divisor: number }> = {
  type: 'EMV',
  name: 'EMV',
  pane: 'new',
  precision: 'volume',
  params: {
    period: periodParam(14, 'Length'),
    divisor: { default: 10000, min: 1, max: 1e12, integer: true, label: 'Divisor' }
  },
  outputs: () => [namedLine('eom', 'EOM')],
  create: ({ period, divisor }) => new EaseStream(new EaseStep(divisor), new SimpleAverage(period))
};

/**
 * Money flow index over the typical price `TP = (H + L + C) / 3`: `100 - 100 / (1 + positive /
 * negative)` of the money flow `TP * VOLUME` of `period` bars, positive where TP rose and negative
 * where it fell; the first bar, without a change, counts to both. Undefined without negative flow.
 */
class MfiStream implements IndicatorStream {
  private readonly out = new Float64Array(1);

  constructor(
    private readonly period: number,
    private readonly typicals = new Previous(),
    private readonly positive = new MovingSum(period),
    private readonly negative = new MovingSum(period)
  ) {}

  next(bar: Bar): ArrayLike<number> {
    const typical = (bar.high + bar.low + bar.close) / 3;
    const change = typical - this.typicals.next(typical);
    const flow = typical * bar.volume;
    const positive = this.positive.next(change <= 0 ? 0 : flow);
    const negative = this.negative.next(change >= 0 ? 0 : flow);
    this.out[0] = 100 - 100 / (1 + ratio(positive, negative));
    return this.out;
  }

  clone(): IndicatorStream {
    return new MfiStream(
      this.period,
      this.typicals.clone(),
      this.positive.clone(),
      this.negative.clone()
    );
  }
}

export const MFI: IndicatorDefinition<{ period: number }> = {
  type: 'MFI',
  name: 'MFI',
  pane: 'new',
  precision: 2,
  params: { period: periodParam(14, 'Length') },
  outputs: () => [namedLine('mf', 'MF')],
  levels: () => [80, 50, 20],
  range: { min: 0, max: 100 },
  create: ({ period }) => new MfiStream(period)
};

/**
 * Chaikin money flow: the volume weighted by where the close lies in the bar's range, `(2C - L -
 * H) / (H - L) * V` (0 for a bar without range), summed over `period` bars and divided by their
 * volume.
 */
class CmfStream implements IndicatorStream {
  private readonly out = new Float64Array(1);

  constructor(
    private readonly period: number,
    private readonly flows = new MovingSum(period),
    private readonly volumes = new MovingSum(period)
  ) {}

  next(bar: Bar): ArrayLike<number> {
    const range = bar.high - bar.low;
    const flow = range === 0 ? 0 : ((2 * bar.close - bar.low - bar.high) / range) * bar.volume;
    this.out[0] = ratio(this.flows.next(flow), this.volumes.next(bar.volume));
    return this.out;
  }

  clone(): IndicatorStream {
    return new CmfStream(this.period, this.flows.clone(), this.volumes.clone());
  }
}

export const CMF: IndicatorDefinition<{ period: number }> = {
  type: 'CMF',
  name: 'CMF',
  pane: 'new',
  precision: 2,
  params: { period: periodParam(20, 'Length') },
  outputs: () => [lineOutput('CMF')],
  levels: () => [0],
  create: ({ period }) => new CmfStream(period)
};

/** Periods of the calendar the VWAP `anchor` parameter picks by value. */
const VWAP_ANCHORS = ['1D', '1W', '1M', '3M', '12M'];

/**
 * Volume-weighted average price of the period of the calendar, with bands `multiplier`
 * volume-weighted standard deviations away, or `multiplier` percent of the VWAP.
 */
class VwapStream implements IndicatorStream {
  private readonly out: Float64Array;

  constructor(
    private readonly calendar: Calendar,
    private readonly anchor: string,
    private readonly percent: boolean,
    private readonly bands: readonly number[],
    /** Start of the current period. */
    private period = Number.NaN,
    private volume = 0,
    private sum = 0,
    private squares = 0
  ) {
    this.out = new Float64Array(1 + bands.length * 2);
  }

  next(bar: Bar, price: number): ArrayLike<number> {
    const period = this.calendar.bucket(bar.time, this.anchor);

    // Bars the calendar drops (outside the sessions) count to the period they follow.
    if (period !== null && period !== this.period) {
      this.period = period;
      this.volume = 0;
      this.sum = 0;
      this.squares = 0;
    }

    this.volume += bar.volume;
    this.sum += price * bar.volume;
    this.squares += price * price * bar.volume;
    const vwap = this.sum / this.volume;
    const width = this.percent
      ? vwap * 0.01
      : Math.sqrt(Math.max(0, this.squares / this.volume - vwap * vwap));
    this.out[0] = vwap;
    this.bands.forEach((multiplier, index) => {
      this.out[1 + index * 2] = vwap + width * multiplier;
      this.out[2 + index * 2] = vwap - width * multiplier;
    });
    return this.out;
  }

  clone(): IndicatorStream {
    return new VwapStream(
      this.calendar,
      this.anchor,
      this.percent,
      this.bands,
      this.period,
      this.volume,
      this.sum,
      this.squares
    );
  }
}

/** The parameters of {@link VWAP}. */
export type VwapParams = {
  anchor: number;
  bandMode: number;
  band1: number;
  band2: number;
  band3: number;
};

/** Band multipliers by slot; 0 turns a band off. */
function vwapBands({ band1, band2, band3 }: VwapParams): number[] {
  return [band1, band2, band3];
}

/** A multiplier of a band of VWAP, left out of the legend. */
function bandParam(slot: number, value: number) {
  return {
    default: value,
    min: 0,
    max: 10,
    label: `Bands Multiplier #${String(slot)}`,
    legend: false
  };
}

/**
 * VWAP restarting every trading day of the chart's calendar (or week, month, quarter, year), of
 * `hlc3` by default, with up to three bands of standard deviations or percents; the first, of one
 * deviation, on by default.
 */
export const VWAP: IndicatorDefinition<VwapParams> = {
  type: 'VWAP',
  name: 'VWAP',
  pane: 'main',
  source: 'hlc3',
  precision: 'price',
  params: {
    anchor: choiceParam(['Session', 'Week', 'Month', 'Quarter', 'Year'], 0, 'Anchor Period'),
    bandMode: choiceParam(['Standard Deviation', 'Percentage'], 0, 'Bands Calculation Mode', false),
    band1: bandParam(1, 1),
    band2: bandParam(2, 0),
    band3: bandParam(3, 0)
  },
  outputs: (params) => [
    namedLine('vwap', 'VWAP'),
    ...vwapBands(params).flatMap((multiplier, index) =>
      multiplier > 0
        ? [
            namedLine(`upperBand${String(index + 1)}`, `Upper Band #${String(index + 1)}`),
            namedLine(`lowerBand${String(index + 1)}`, `Lower Band #${String(index + 1)}`)
          ]
        : []
    )
  ],
  fills: (params) =>
    vwapBands(params).flatMap((multiplier, index) =>
      multiplier > 0
        ? [{ from: `upperBand${String(index + 1)}`, to: `lowerBand${String(index + 1)}` }]
        : []
    ),
  create: (params, { calendar }) =>
    new VwapStream(
      calendar,
      picked(VWAP_ANCHORS, params.anchor, 'VWAP anchor'),
      picked([false, true], params.bandMode, 'VWAP band mode'),
      vwapBands(params).filter((multiplier) => multiplier > 0)
    )
};
