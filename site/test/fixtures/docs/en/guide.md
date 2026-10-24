# Writing pages

This page shows how pages are written: headings, tables, code blocks, links and images.

## Links

- A heading of this page: [code blocks](#code-blocks)
- Another page and one of its headings: [bars from trades](live.md#按成交生成-k-线)
- A symbol of the API: [`createChart()`](../api.md#createChart)

## Code blocks

<!-- code-prelude
import { createChart } from '@kumochart-sdk/core';
import { indicators, MA } from '@kumochart-sdk/core/indicators';

const chart = createChart(document.createElement('div'), { modules: [indicators([MA])] });
-->

```ts
chart.indicators.add({ type: 'MA', params: { periods: [5, 10, 20] } });
```
