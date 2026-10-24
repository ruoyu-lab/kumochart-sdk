// Downloads the market data of the documentation's examples from Binance's public data and writes
// it compactly next to this file:
//
//   node site/scripts/run.mjs site/data/generate.ts
//
// The months and days are fixed, so the files only change when the constants below do.
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const SYMBOL = 'BTCUSDT';
/** The month of the 1-minute bars, in UTC. */
const MONTH = '2026-09';
/** The day the trades come from: the day after the month, so they continue its last bar. */
const TRADES_DAY = '2026-10-01';
/** The minutes of trades kept, from midnight UTC. */
const TRADES_MINUTES = 15;

const BASE = 'https://data.binance.vision/data/spot';
const PRICE_STEP = 0.01;
const SIZE_STEP = 0.00001;

const BARS_FILE = `btcusdt-1m-${MONTH}.json`;
const TRADES_FILE = `btcusdt-trades-${TRADES_DAY}.json`;

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${url} answered ${response.status} ${response.statusText}.`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/** Downloads a zip of Binance's public data and checks it against its published checksum. */
async function downloadChecked(url: string): Promise<Buffer> {
  const [zip, checksum] = await Promise.all([download(url), download(`${url}.CHECKSUM`)]);
  const expected = checksum.toString('utf8').trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(zip).digest('hex');

  if (expected !== actual) {
    throw new Error(`${url} does not match its checksum (${actual} instead of ${expected}).`);
  }

  return zip;
}

/** The single file of a zip archive, read through its central directory. */
function unzipSingle(zip: Buffer): string {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));

  if (end === -1 || zip.readUInt16LE(end + 10) !== 1) {
    throw new Error('Expected a zip archive with exactly one file.');
  }

  const directory = zip.readUInt32LE(end + 16);
  const method = zip.readUInt16LE(directory + 10);
  const compressedSize = zip.readUInt32LE(directory + 20);
  const local = zip.readUInt32LE(directory + 42);
  const data = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const compressed = zip.subarray(data, data + compressedSize);

  if (method !== 8) {
    throw new Error(`Expected a deflated file in the zip archive, not method ${method}.`);
  }

  return inflateRawSync(compressed).toString('utf8');
}

/** A decimal of the data as a whole number of steps, exactly. */
function steps(text: string, step: number, label: string): number {
  const value = Math.round(Number(text) / step);

  if (!Number.isFinite(value) || Math.abs(value * step - Number(text)) > step / 1000) {
    throw new Error(`${label} ${text} is not a multiple of ${step}.`);
  }

  return value;
}

/** Binance's spot data gives times in microseconds since 2025. */
function milliseconds(text: string): number {
  const micros = Number(text);

  if (!Number.isInteger(micros) || micros < 1e15) {
    throw new Error(`Expected a time in microseconds, not ${text}.`);
  }

  return Math.floor(micros / 1000);
}

function rows(csv: string): string[][] {
  return csv
    .trim()
    .split('\n')
    .map((line) => line.trim().split(','));
}

/** A JSON file of a header and one long array of numbers, which stays on one line. */
function json(
  header: Readonly<Record<string, unknown>>,
  key: string,
  values: readonly number[]
): string {
  const head = JSON.stringify(header, null, 2).slice(0, -2);
  return `${head},\n  "${key}": ${JSON.stringify(values)}\n}\n`;
}

async function writeBars(directory: string): Promise<void> {
  const url = `${BASE}/monthly/klines/${SYMBOL}/1m/${SYMBOL}-1m-${MONTH}.zip`;
  const table = rows(unzipSingle(await downloadChecked(url)));
  const values: number[] = [];
  const start = milliseconds(table[0]?.[0] ?? '');
  const basePrice = steps(table[0]?.[1] ?? '', PRICE_STEP, 'open');
  let time = start;
  let close = basePrice;

  for (const [openTime = '', o = '', h = '', l = '', c = '', v = ''] of table) {
    const barTime = milliseconds(openTime);
    const open = steps(o, PRICE_STEP, 'open');
    const high = steps(h, PRICE_STEP, 'high');
    const low = steps(l, PRICE_STEP, 'low');
    const next = steps(c, PRICE_STEP, 'close');
    const minutes = (barTime - time) / 60_000;

    if (!Number.isInteger(minutes) || (values.length > 0 && minutes < 1)) {
      throw new Error(`The bar at ${new Date(barTime).toISOString()} is not on a later minute.`);
    }

    values.push(
      minutes,
      open - close,
      high - Math.max(open, next),
      Math.min(open, next) - low,
      next - open,
      steps(v, SIZE_STEP, 'volume')
    );
    time = barTime;
    close = next;
  }

  const count = table.length;
  const header = {
    description: `${SYMBOL} 1-minute bars of Binance spot, ${MONTH} (UTC), for the documentation's examples.`,
    source: url,
    symbol: SYMBOL,
    interval: '1m',
    from: new Date(start).toISOString(),
    to: new Date(time).toISOString(),
    count,
    priceStep: PRICE_STEP,
    volumeStep: SIZE_STEP,
    basePrice,
    encoding:
      'Six whole numbers per bar: minutes since the previous bar (0 for the first, which starts at "from"), open minus the previous close ("basePrice" before the first bar), high minus the larger of open and close, the smaller of open and close minus low, close minus open, all in price steps, then the volume in volume steps.'
  };
  await writeFile(join(directory, BARS_FILE), json(header, 'bars', values));
  console.log(`${BARS_FILE}: ${count} bars from ${header.from} to ${header.to}`);
}

async function writeTrades(directory: string): Promise<void> {
  const url = `${BASE}/daily/aggTrades/${SYMBOL}/${SYMBOL}-aggTrades-${TRADES_DAY}.zip`;
  const from = Date.parse(`${TRADES_DAY}T00:00:00Z`);
  const to = from + TRADES_MINUTES * 60_000;
  const table = rows(unzipSingle(await downloadChecked(url))).filter(([, , , , , time = '']) => {
    const value = milliseconds(time);
    return value >= from && value < to;
  });
  const values: number[] = [];
  const basePrice = steps(table[0]?.[1] ?? '', PRICE_STEP, 'price');
  let time = from;
  let price = basePrice;

  for (const [, p = '', quantity = '', , , t = ''] of table) {
    const tradeTime = milliseconds(t);
    const next = steps(p, PRICE_STEP, 'price');

    if (tradeTime < time) {
      throw new Error(`The trades are not in time order at ${new Date(tradeTime).toISOString()}.`);
    }

    values.push(tradeTime - time, next - price, steps(quantity, SIZE_STEP, 'quantity'));
    time = tradeTime;
    price = next;
  }

  const header = {
    description: `${SYMBOL} trades of Binance spot, the first ${TRADES_MINUTES} minutes of ${TRADES_DAY} (UTC), right after the bars of ${MONTH}, for the documentation's examples. Each is an aggregated trade: the fills of one order at one price.`,
    source: url,
    symbol: SYMBOL,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    count: table.length,
    priceStep: PRICE_STEP,
    sizeStep: SIZE_STEP,
    basePrice,
    encoding:
      'Three whole numbers per trade: milliseconds since the previous trade ("from" before the first), the price minus the previous price ("basePrice" before the first) in price steps, the size in size steps.'
  };
  await writeFile(join(directory, TRADES_FILE), json(header, 'trades', values));
  console.log(`${TRADES_FILE}: ${table.length} trades from ${header.from} to ${header.to}`);
}

export async function main(): Promise<number> {
  const directory = import.meta.dirname;
  await writeBars(directory);
  await writeTrades(directory);
  return 0;
}
