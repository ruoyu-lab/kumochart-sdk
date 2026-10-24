import type { Bar } from '../data/types';
import { sizedStream, sizeRuleOf } from './box-sizes';
import type { BarTransformDefinition, BarTransformStream } from '../feed/transform';
import { checkKeys } from './transforms';

/** A Kagi line: where it starts and how far it has gone. */
interface KagiLine {
  time: number;
  open: number;
  close: number;
  volume: number;
}

interface KagiState {
  /** The first close, which the first line starts from; `NaN` before the first bar. */
  start: number;
  startTime: number;
  /** The line being drawn, `null` until the closes move the reversal amount from the start. */
  line: KagiLine | null;
  /**
   * Volume of the bars since the line's last extreme, from the start while there is no line:
   * the line it goes on with, or the next one, takes it.
   */
  pending: number;
}

const lineBar = (line: KagiLine): Bar => ({
  time: line.time,
  open: line.open,
  high: Math.max(line.open, line.close),
  low: Math.min(line.open, line.close),
  close: line.close,
  volume: line.volume
});

/**
 * Kagi lines on the closes: the first line starts at
 * the first close once a close is the reversal amount away from it; a line goes on while the
 * closes go its way and turns when a close comes back the reversal amount from its extreme,
 * the next line starting where it ended. Each line is a bar from its start (`open`) to its
 * extreme (`close`), timed at the bar that started it, with the volume of the bars after the
 * extreme before it up to its own: the closes pulling back from an extreme go on into the next
 * line, so the lines hold every bar's volume, as Renko bricks do.
 */
class KagiStream implements BarTransformStream {
  constructor(
    /** The amount the closes must come back to turn a line. */
    private readonly reversal: number,
    private readonly state: KagiState
  ) {}

  next(bar: Bar): readonly Bar[] {
    const state = this.state;

    if (Number.isNaN(state.start)) {
      state.start = bar.close;
      state.startTime = bar.time;
      state.pending = bar.volume;
      return [];
    }

    // Closes a reversal away within a rounding error count: steps of 0.1 add up unevenly.
    const reversal = this.reversal * (1 - 1e-9);
    const line = state.line;

    if (!line) {
      state.pending += bar.volume;

      if (Math.abs(bar.close - state.start) >= reversal) {
        state.line = {
          time: state.startTime,
          open: state.start,
          close: bar.close,
          volume: state.pending
        };
        state.pending = 0;
      }

      return [];
    }

    const rising = line.close > line.open;

    if (rising ? bar.close > line.close : bar.close < line.close) {
      line.close = bar.close;
      line.volume += state.pending + bar.volume;
      state.pending = 0;
      return [];
    }

    if ((rising ? line.close - bar.close : bar.close - line.close) >= reversal) {
      state.line = {
        time: bar.time,
        open: line.close,
        close: bar.close,
        volume: state.pending + bar.volume
      };
      state.pending = 0;
      return [lineBar(line)];
    }

    // A pullback short of a reversal draws nothing; its volume joins the line that goes on next.
    state.pending += bar.volume;
    return [];
  }

  current(): Bar | null {
    return this.state.line ? lineBar(this.state.line) : null;
  }

  clone(): BarTransformStream {
    const line = this.state.line;
    return new KagiStream(this.reversal, { ...this.state, line: line ? { ...line } : null });
  }

  resolved(): Readonly<Record<string, unknown>> {
    return { reversal: this.reversal };
  }
}

/**
 * Kagi lines, each bar one line from its start to its extreme. Parameters: `reversal`, a fixed
 * amount the closes must come back to turn the line; or `percentage`, that share of the last
 * close; otherwise, by default, the average true range over `atrLength` bars (14). Draw them with the `kagi` series type, thick where they pass the last shoulder.
 */
export const kagiTransform: BarTransformDefinition = {
  type: 'kagi',
  name: 'Kagi',
  keepsTime: false,
  create: (params, input, from) => {
    checkKeys('kagi', params, ['reversal', 'percentage', 'atrLength']);
    return sizedStream(
      sizeRuleOf('kagi', 'reversal', params, from),
      input,
      (reversal) =>
        new KagiStream(reversal, {
          start: Number.NaN,
          startTime: Number.NaN,
          line: null,
          pending: 0
        })
    );
  }
};
