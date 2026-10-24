# Market data of the examples

Real market data for the live examples of the documentation, read through the `@docs/data` module
(`site/src/examples/data.ts`). It is not part of the SDK.

| File                             | What                                                                               | Source                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `btcusdt-1m-2026-09.json`        | BTCUSDT spot, 1-minute bars, 2026-09-01 00:00 to 2026-09-30 23:59 UTC, 43,200 bars | [`BTCUSDT-1m-2026-09.zip`](https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1m/BTCUSDT-1m-2026-09.zip)                   |
| `btcusdt-trades-2026-10-01.json` | BTCUSDT spot, aggregated trades, 2026-10-01 00:00 to 00:15 UTC, 6,492 trades       | [`BTCUSDT-aggTrades-2026-10-01.zip`](https://data.binance.vision/data/spot/daily/aggTrades/BTCUSDT/BTCUSDT-aggTrades-2026-10-01.zip) |

Both come from [Binance's public market data](https://data.binance.vision/). The trades start
right after the last bar, so an example can stream them into the bars.

Each file starts with a header describing it (`source`, `from`, `to`, `count`, the price and size
steps) and its `encoding`; the values are whole numbers relative to the previous bar or trade,
which keeps the files small (about 0.4 MB gzip together).

To build them again, which downloads the archives above and checks them against their published
checksums:

```bash
node site/scripts/run.mjs site/data/generate.ts
```

The month and the day are constants at the top of `generate.ts`.
