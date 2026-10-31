# @kumo-charts/react

The `KumoChart` component and the `useKumoChart` hook for React, around [`@kumo-charts/core`](https://www.npmjs.com/package/@kumo-charts/core).

```bash
npm install @kumo-charts/core @kumo-charts/react
```

```tsx
import { KumoChart } from '@kumo-charts/react';
import { indicators, MACD } from '@kumo-charts/core/indicators';
import type { BarInput } from '@kumo-charts/core';

const modules = [indicators([MACD])];

export function PriceChart({ bars }: { bars: BarInput[] }) {
  return (
    <div style={{ height: 480 }}>
      <KumoChart modules={modules} data={bars} interval="1m" timeframe="15m" />
    </div>
  );
}
```

Documentation: [docs.kumochart.com/en/react](https://docs.kumochart.com/en/react/) · [中文](https://docs.kumochart.com/zh-CN/react/)

Apache-2.0 License. If you use KumoChart in a website or an app, please credit it with a link to [kumochart.com](https://kumochart.com), as NOTICE asks.
