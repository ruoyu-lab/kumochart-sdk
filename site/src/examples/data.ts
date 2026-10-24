/**
 * `@docs/data`: the market data of the documentation's examples, real BTCUSDT spot data from
 * Binance's public data. Only the examples use it; an application loads its own data.
 *
 * ```ts
 * import { loadBars, loadTrades } from '@docs/data';
 *
 * const bars = await loadBars(); // BarInput[], the 1-minute bars of September 2026
 * const trades = await loadTrades(); // TradeInput[], the 15 minutes after them
 * ```
 *
 * The files and how to build them again are described in `site/data/README.md`.
 */
import type { BarInput, TradeInput } from '../../../packages/core/src/index';

/** The header of a data file, then its values. */
interface DataFile {
  readonly source: string;
  readonly from: string;
  readonly count: number;
  readonly priceStep: number;
  readonly basePrice: number;
}

interface BarsFile extends DataFile {
  readonly volumeStep: number;
  readonly bars: readonly number[];
}

interface TradesFile extends DataFile {
  readonly sizeStep: number;
  readonly trades: readonly number[];
}

const BARS_URL = new URL('../../data/btcusdt-1m-2026-09.json', import.meta.url);
const TRADES_URL = new URL('../../data/btcusdt-trades-2026-10-01.json', import.meta.url);

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`The example data ${url.pathname} could not be loaded: ${response.status}.`);
  }

  return (await response.json()) as T;
}

/** A price or size in steps as a number, without the rounding noise of the multiplication. */
function decimal(steps: number, step: number): number {
  return Number((steps * step).toFixed(8));
}

function decodeBars(file: BarsFile): BarInput[] {
  const bars: BarInput[] = [];
  let time = Date.parse(file.from);
  let close = file.basePrice;

  for (let index = 0; index < file.bars.length; index += 6) {
    const [minutes = 0, open = 0, high = 0, low = 0, change = 0, volume = 0] = file.bars.slice(
      index,
      index + 6
    );
    const openSteps = close + open;
    const closeSteps = openSteps + change;
    time += minutes * 60_000;
    close = closeSteps;
    bars.push({
      time,
      open: decimal(openSteps, file.priceStep),
      high: decimal(Math.max(openSteps, closeSteps) + high, file.priceStep),
      low: decimal(Math.min(openSteps, closeSteps) - low, file.priceStep),
      close: decimal(closeSteps, file.priceStep),
      volume: decimal(volume, file.volumeStep)
    });
  }

  return bars;
}

function decodeTrades(file: TradesFile): TradeInput[] {
  const trades: TradeInput[] = [];
  let time = Date.parse(file.from);
  let price = file.basePrice;

  for (let index = 0; index < file.trades.length; index += 3) {
    const [elapsed = 0, change = 0, size = 0] = file.trades.slice(index, index + 3);
    time += elapsed;
    price += change;
    trades.push({
      time,
      price: decimal(price, file.priceStep),
      size: decimal(size, file.sizeStep)
    });
  }

  return trades;
}

let bars: Promise<BarInput[]> | null = null;
let trades: Promise<TradeInput[]> | null = null;

/**
 * BTCUSDT 1-minute bars of September 2026 (UTC), 43,200 of them, oldest first. Pass them with
 * `{ interval: '1m' }` and let the chart build coarser timeframes.
 */
export async function loadBars(): Promise<BarInput[]> {
  bars ??= fetchJson<BarsFile>(BARS_URL).then(decodeBars);
  return [...(await bars)];
}

/**
 * BTCUSDT trades of 2026-10-01 00:00 to 00:15 UTC, oldest first: they start right after the last
 * bar of {@link loadBars}, so they can stream into those bars.
 */
export async function loadTrades(): Promise<TradeInput[]> {
  trades ??= fetchJson<TradesFile>(TRADES_URL).then(decodeTrades);
  return [...(await trades)];
}
