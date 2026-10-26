import { parseBar, parseBars, priceOf } from '../data/bar-store';
import { checkAscending } from '../data/points';
import { PRICE_SOURCES, type Bar, type BarInput, type PriceSource } from '../data/types';
import { createCalendar, type Calendar } from '../feed/calendar';
import { parseInterval, type IntervalInput } from '../feed/interval';
import { fail } from '../utils/errors';
import { checkArray, checkFields, checkNumber, checkOneOf, fieldsOf } from '../utils/validate';
import { validateDefinition } from './definition';
import { resolveSettings } from './input';
import { createStream } from './instance';
import type { IndicatorDefinition, IndicatorOutput, IndicatorStream, ParamValues } from './types';

/** Options of {@link createIndicatorCalculator} and {@link computeIndicator}. */
export interface IndicatorCalculatorOptions {
  /** Overrides of the parameter defaults, as `chart.indicators.add()` takes them. */
  params?: ParamValues;
  /** Price passed to the calculation; the type's default, `close` unless it sets another. */
  source?: PriceSource;
  /**
   * The trading calendar of indicators that follow trading days, such as VWAP and the relative
   * volume at time: the chart's `calendar` option made with `createCalendar()`. Default
   * `createCalendar()`, the local zone.
   */
  calendar?: Calendar;
  /**
   * The interval of the bars, as a chart has it: its timeframe, or the source interval. Indicators
   * that follow it, such as the pivot points left to Auto and the historical volatility, which it
   * annualizes, take it; `null` (default) for bars without one.
   */
  interval?: IntervalInput | null;
}

/**
 * An indicator computed without a chart: it consumes bars one by one and returns the values a
 * chart computes on them.
 */
export interface IndicatorCalculator {
  /** The parameters, defaults included. */
  readonly params: ParamValues;
  readonly source: PriceSource;
  /** What each value is, in the order `next()` returns them. */
  readonly outputs: readonly IndicatorOutput[];
  /** The type's reference lines for these parameters. */
  readonly levels: readonly number[];
  /**
   * Consumes the next bar and returns one value per output, `NaN` where there is none (warm-up,
   * division by zero). Values are those computed on the bar: an output with an `offset` is drawn
   * that many bars later on a chart. Throws on a bar no later than the last one, which would be
   * counted twice; `clone()` tries a bar both ways.
   */
  next(bar: BarInput): number[];
  /**
   * Consumes the next bar as a chart computes an indicator whose source is another one: `value`,
   * the other's on the bar, as every price, the bar giving its time and volume. A `NaN` value, as
   * the other warms up, skips the bar as the chart skips it: its values are `NaN`.
   */
  nextOf(bar: BarInput, value: number): number[];
  /** An independent copy that continues from here, e.g. to try the next bar both ways. */
  clone(): IndicatorCalculator;
}

class Calculator implements IndicatorCalculator {
  constructor(
    readonly params: ParamValues,
    readonly source: PriceSource,
    readonly outputs: readonly IndicatorOutput[],
    readonly levels: readonly number[],
    private readonly stream: IndicatorStream,
    /** The time of the last bar consumed. */
    private last = Number.NEGATIVE_INFINITY
  ) {}

  next(input: BarInput): number[] {
    const bar = this.later(input);
    return this.consume(bar, priceOf(bar, this.source));
  }

  nextOf(input: BarInput, value: number): number[] {
    if (!Number.isNaN(value)) {
      checkNumber('value', value);
    }

    const bar = this.later(input);

    if (Number.isNaN(value)) {
      this.last = bar.time;
      return this.outputs.map(() => Number.NaN);
    }

    // The value is the price, whatever the source, as a chart reads an indicator.
    return this.consume({ ...bar, open: value, high: value, low: value, close: value }, value);
  }

  /** A bar given, checked, and later than the last one. */
  private later(input: BarInput): Bar {
    const bar = parseBar(input);

    if (bar.time <= this.last) {
      fail(
        `bar.time (${String(bar.time)}) must be after the time of the last bar (${String(this.last)}).`
      );
    }

    return bar;
  }

  /** Takes a validated bar later than the last one, and the price the calculation reads. */
  consume(bar: Bar, price: number): number[] {
    this.last = bar.time;
    const values = this.stream.next(bar, price);
    const result = new Array<number>(this.outputs.length);

    for (let index = 0; index < result.length; index += 1) {
      result[index] = values[index] ?? Number.NaN;
    }

    return result;
  }

  clone(): IndicatorCalculator {
    return new Calculator(
      this.params,
      this.source,
      this.outputs,
      this.levels,
      this.stream.clone(),
      this.last
    );
  }
}

/**
 * Starts computing an indicator of a definition without a chart, such as `MACD`. Runs anywhere,
 * Node and workers included; the values equal those of a chart with the same bars, parameters,
 * source, calendar and interval.
 */
export function createIndicatorCalculator<P extends ParamValues>(
  definition: IndicatorDefinition<P>,
  options: IndicatorCalculatorOptions = {}
): IndicatorCalculator {
  return start(definition, options);
}

const OPTION_FIELDS = fieldsOf<IndicatorCalculatorOptions>({
  params: true,
  source: true,
  calendar: true,
  interval: true
});

function start(definition: IndicatorDefinition, options: IndicatorCalculatorOptions): Calculator {
  checkFields('options', options, OPTION_FIELDS);
  validateDefinition(definition);
  const { params, outputs } = resolveSettings(definition, options.params, definition.type);
  const source =
    options.source === undefined
      ? (definition.source ?? 'close')
      : checkOneOf('options.source', options.source, PRICE_SOURCES);
  const calendar = options.calendar ?? createCalendar();
  const interval =
    options.interval === undefined || options.interval === null
      ? null
      : parseInterval(options.interval, 'options.interval');
  return new Calculator(
    params,
    source,
    outputs,
    definition.levels?.(params) ?? [],
    createStream(definition, params, outputs.length, { calendar, interval })
  );
}

/**
 * Computes an indicator over `bars`, in strictly ascending time as a chart takes them: one array
 * per output key, with a value for every bar.
 */
export function computeIndicator<P extends ParamValues>(
  definition: IndicatorDefinition<P>,
  bars: readonly BarInput[],
  options: IndicatorCalculatorOptions = {}
): Record<string, number[]> {
  checkArray('bars', bars);
  const calculator = start(definition, options);
  const columns = calculator.outputs.map(() => new Array<number>(bars.length));
  const parsed = parseBars(bars);
  checkAscending(parsed, 'bars');

  parsed.forEach((bar, index) => {
    calculator.consume(bar, priceOf(bar, calculator.source)).forEach((value, column) => {
      const target = columns[column];

      if (target) {
        target[index] = value;
      }
    });
  });

  return Object.fromEntries(
    calculator.outputs.map((output, column) => [output.key, columns[column] ?? []])
  );
}
