# Timeframes and calendars

Give the chart 1-minute bars and it builds 5-minute, 4-hour, daily, weekly or other bars in the browser, so switching timeframes needs nothing more from your server. It builds them by a trading calendar: when a day starts, which sessions it trades, which days are trading days.

## Intervals

A number and a unit:

| Unit | Meaning | Examples       |
| ---- | ------- | -------------- |
| `s`  | second  | `'15s'`        |
| `m`  | minute  | `'1m'`, `'5m'` |
| `h`  | hour    | `'1h'`, `'4h'` |
| `D`  | day     | `'1D'`         |
| `W`  | week    | `'1W'`         |
| `M`  | month   | `'1M'`, `'3M'` |

Only minutes `m` and months `M` differ by case; other units take either (`'4H'`, `'1d'`). A count of 1 can be left out: `'D'` is `'1D'`. An object works too: `{ unit: 'hour', count: 4 }`.

## Switching timeframes

```ts live height=360
import { createChart } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

const chart = createChart(document.getElementById('chart')!);

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('4h');
```

The `interval` given to `set()` is the source interval; `setTimeframe()` sets the displayed one, and `setTimeframe(null)` shows the source bars again:

```ts
chart.data.sourceInterval(); // { unit: 'minute', count: 1 }
chart.data.timeframe(); // { unit: 'hour', count: 4 }, or null at the source interval
```

A built bar starts at the start of its period, opens at its first bar's open, has the highest high and the lowest low of its bars, closes at the last bar's close, and sums their volume. The latest one updates with the real-time data.

Bars of several days (such as `'2D'`) count trading days: each takes exactly that many trading days in a row (the calendar's `weekdays`), the days without trading left out, and is dated at the first of them. They are grouped in turn from 1 January 1970, so the same calendar always makes the same groups.

Indicators can be computed in a timeframe longer than the chart's too, such as an hourly average on 5-minute bars; see [Indicators](indicators.md#in-a-timeframe-of-its-own).

## Which timeframes can be built

- Seconds, minutes and hours: multiples of the source interval. 1-minute bars build 3-minute and hourly bars, not 90-second ones.
- Days: from an interval that divides a day, such as 1 minute, 15 minutes or 4 hours, not 7 minutes.
- Weeks and months: from an interval that divides a day, or from 1 day; not from 2 days.
- Never shorter than the source.

`setTimeframe()` throws for a timeframe it cannot build, saying why. For a menu of timeframes, `canBuildTimeframe()` tells which can be chosen:

```ts
import { canBuildTimeframe } from '@kumochart-sdk/core';

canBuildTimeframe('4h', '1h'); // true
canBuildTimeframe('1W', '2D'); // false
```

Intervals of seconds, minutes and hours have a fixed length, which `intervalDuration()` gives in milliseconds; days, weeks and months last as the trading calendar says, and give `null`:

```ts
import { intervalDuration } from '@kumochart-sdk/core';

intervalDuration('15m'); // 900000
intervalDuration('1D'); // null
```

## Time zones

Two options take a time zone:

- `timeZone`: the zone the axis and the crosshair show times in; the user's local zone unless set.
- `calendar.timeZone`: the zone the bars' days and weeks are cut in, and where hours start; `UTC` by default.

Crypto exchanges cut their bars in UTC, with days starting at 00:00 UTC: the default fits them, and times still show in the user's zone. Stocks, futures and other bars given in an exchange's time need the exchange's zone:

```ts
createChart(container, {
  timeZone: 'Asia/Shanghai', // times shown in Shanghai time
  calendar: { timeZone: 'America/New_York' } // US stocks: days start at midnight in New York
});
```

The calendar must fit the data. Bars of minutes and hours must start where the calendar starts one: hours starting on the hour in UTC, given to a calendar in India's time, half an hour apart, make `set()` throw and say what to set, rather than move the bars to other times. Bars of days, weeks and months go by their trading date, dated at midnight, at the open or at the close alike.

Time zones are IANA names, such as `Asia/Shanghai`, `America/New_York` or `UTC`.

## Trading sessions

Markets that trade around the clock need nothing. For markets with trading hours, describe them in `calendar`:

| Option      | Meaning                                                                                                                             | Default        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `sessions`  | The sessions of a trading day as `'HH:MM-HH:MM'`; an end before its start crosses midnight. Times outside every session are dropped | `[]` (all day) |
| `dayStart`  | When a trading day starts; from this time on, times belong to the next trading day                                                  | `'00:00'`      |
| `weekdays`  | The days that are trading days, 0 being Sunday                                                                                      | every day      |
| `weekStart` | The first day of a week bar, 0 being Sunday                                                                                         | `1` (Monday)   |

Some examples:

```ts
// Shanghai stocks: a morning and an afternoon session, Monday to Friday
createChart(container, {
  calendar: {
    timeZone: 'Asia/Shanghai',
    sessions: ['09:30-11:30', '13:00-15:00'],
    weekdays: [1, 2, 3, 4, 5]
  }
});

// Chinese futures with a night session: the session from 21:00 belongs to the next trading day,
// Friday night's to Monday
createChart(container, {
  calendar: {
    timeZone: 'Asia/Shanghai',
    sessions: ['21:00-02:30', '09:00-10:15', '10:30-11:30', '13:30-15:00'],
    dayStart: '21:00',
    weekdays: [1, 2, 3, 4, 5]
  }
});

// Forex: the day changes at 17:00 New York time
createChart(container, {
  calendar: {
    timeZone: 'America/New_York',
    dayStart: '17:00',
    weekdays: [1, 2, 3, 4, 5]
  }
});
```

With sessions, hours count from the start of each session: Shanghai's hourly bars start at 9:30, 10:30, 13:00 and 14:00.

## Holidays and other rules

For what fixed rules cannot say, such as holidays or an early close, `calendar.bucket` decides which bar each time goes to:

```ts
const holidays = new Set(['2026-10-01', '2026-10-02']);

createChart(container, {
  calendar: {
    timeZone: 'Asia/Shanghai',
    sessions: ['09:30-11:30', '13:00-15:00'],
    bucket: (time, interval, fallback) => {
      const date = new Date(time + 8 * 3_600_000).toISOString().slice(0, 10);
      return holidays.has(date) ? null : fallback(time);
    }
  }
});
```

Return the start of the bar, or `null` to drop the time. `fallback` is what the other calendar options give. The returned starts must not go back in time.

## The calendar in your own code

When your code needs to line times up as the chart does, for example to build bars on a server or to tell which bar a time belongs to, use `createCalendar()`:

```ts
import { createCalendar } from '@kumochart-sdk/core';

const calendar = createCalendar({
  timeZone: 'Asia/Shanghai',
  sessions: ['09:30-11:30', '13:00-15:00']
});

calendar.bucket('2026-05-06T02:15:00Z', '1h'); // 10:15 in Shanghai falls in the bar from 9:30: its start
```

It needs no chart and runs in Node.js too.

With a chart, `chart.data.calendar()` is the calendar the chart uses (its `calendar` option, in the chart's time zone), for example to group bars by trading day in a plugin. It is a new one once the options change, so read it when you need it.
