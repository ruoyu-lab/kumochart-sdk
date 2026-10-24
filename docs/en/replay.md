# Replay

<!-- code-prelude
declare const time: number;
declare const progress: { update(time: number): void };
declare function showMessage(text: string): void;
-->

Replay takes the chart back to a moment in the past, hides the bars after it, and plays them back one by one, to practise reading the market or to review trades.

```ts live height=380
import { createChart } from '@kumochart-sdk/core';
import { replay } from '@kumochart-sdk/core/replay';
import { indicators, EMA } from '@kumochart-sdk/core/indicators';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!, {
  modules: [replay(), indicators([EMA])]
});

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('15m');
chart.indicators.add({ type: 'EMA' });

// From 300 bars back, 4 bars a second
const start = chart.data.at(chart.data.length - 300)!;
chart.replay.start(start.time, { speed: 4 });
chart.replay.play();
```

## Controls

```ts
chart.replay.start('2026-05-01T00:00:00Z'); // back to this time; what follows is hidden
chart.replay.play(); // plays on its own
chart.replay.pause();
chart.replay.step(); // one step on; returns how many steps it took
chart.replay.step(10);
chart.replay.seek(time); // to any time, forward or back
chart.replay.stop(); // ends replay and shows all the data

chart.replay.state(); // { time, playing, ended, speed, step }, or null when not replaying
```

Settings go to `start()`, or to `configure()` on the way:

```ts
chart.replay.configure({
  speed: 2, // steps a second
  step: 'bar' // how far a step goes
});
```

`step` is one of:

- `bar` (default): a step completes a displayed bar. On an hourly chart a step is an hour.
- `source`: a step reveals one bar of the source interval. On an hourly chart of 1-minute data, the hour's bar forms minute by minute.

## The chart while replaying

- The displayed bars, what `chart.data` returns and what indicators compute on go up to the replay's position: nothing of the future shows.
- Switching the timeframe or the chart type keeps the position.
- Real-time data keeps coming in, hidden until replay reaches it.
- Alerts are evaluated as usual; `alertTrigger` then carries `replay: true`, to tell them apart.
- `chart.data.clear()` ends replay.

## Events

Playing a step on, or reaching the end, emits `replay`:

```ts
chart.on('replay', ({ state, reason }) => {
  progress.update(state.time);
  if (reason === 'end') showMessage('Caught up with the latest bar');
});
```

At the end replay pauses, with `state.ended` `true`. Calling `step()`, `seek()` and the others emits nothing.
