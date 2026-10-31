import type { BarInput, TradeInput } from '@kumo-charts/core';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const BASE_PRICE = 68_000;

/** A stable pseudo-random number in [0, 1) for an integer key. */
function noise(key: number): number {
  const value = Math.sin(key * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

/** Smooth noise in [-0.5, 0.5]: random values at whole steps, eased in between. */
function smoothNoise(position: number, seed: number): number {
  const step = Math.floor(position);
  const fraction = position - step;
  const eased = fraction * fraction * (3 - 2 * fraction);
  const from = noise(step * 7 + seed);
  const to = noise((step + 1) * 7 + seed);
  return from + (to - from) * eased - 0.5;
}

/** Trends over days down to jitter over minutes: period and relative amplitude. */
const OCTAVES = [
  [2.5 * DAY, 0.06],
  [16 * HOUR, 0.028],
  [5 * HOUR, 0.014],
  [80 * MINUTE, 0.007],
  [20 * MINUTE, 0.0035],
  [5 * MINUTE, 0.0016]
] as const;

/**
 * The simulated price at a time. Being a pure function of the time, history and live trades
 * always agree, and the same times always give the same bars.
 */
function priceAt(time: number): number {
  let drift = 0.0006 * (noise(Math.floor(time / MINUTE)) - 0.5);

  OCTAVES.forEach(([period, amplitude], index) => {
    drift += amplitude * smoothNoise(time / period, index * 101);
  });

  return BASE_PRICE * Math.exp(drift);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function barAt(time: number): BarInput {
  const samples = Array.from({ length: 7 }, (_, index) => priceAt(time + (index * MINUTE) / 6));
  const key = Math.floor(time / MINUTE);
  const wick = 1 + 0.0012 * noise(key + 3);
  return {
    time,
    open: round(samples[0] ?? BASE_PRICE),
    high: round(Math.max(...samples) * wick),
    low: round(Math.min(...samples) / wick),
    close: round(samples[6] ?? BASE_PRICE),
    volume: Math.round(4 + 40 * noise(key + 7) ** 2)
  };
}

/** `count` one-minute bars of a simulated market, the last one being the minute of `end`. */
export function sampleBars(count: number, end = Date.now()): BarInput[] {
  const last = Math.floor(end / MINUTE) * MINUTE;
  return Array.from({ length: count }, (_, index) => barAt(last - (count - 1 - index) * MINUTE));
}

/** Streams simulated trades a few times a second until the returned function is called. */
export function streamTrades(listener: (trades: TradeInput[]) => void): () => void {
  const timer = window.setInterval(() => {
    const time = Date.now();
    const price = priceAt(time) * (1 + 0.0003 * (Math.random() - 0.5));
    listener([{ time, price: round(price), size: Math.round(1 + Math.random() * 30) / 100 }]);
  }, 400);
  return () => {
    window.clearInterval(timer);
  };
}
