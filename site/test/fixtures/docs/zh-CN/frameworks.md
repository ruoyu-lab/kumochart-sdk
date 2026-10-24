# Vue 和 React

## Vue

```vue live height=320
<script setup lang="ts">
import { loadBars } from '@docs/data';
import { KumoChart } from '@kumochart-sdk/vue';

const bars = await loadBars();
</script>

<template>
  <KumoChart :data="bars" interval="1m" timeframe="1h" />
</template>
```

## React

```tsx live height=320
import type { BarInput } from '@kumochart-sdk/core';
import { KumoChart } from '@kumochart-sdk/react';
import { useEffect, useState } from 'react';
import { loadBars } from '@docs/data';

export default function App() {
  const [bars, setBars] = useState<BarInput[]>([]);

  useEffect(() => {
    void loadBars().then(setBars);
  }, []);

  return <KumoChart data={bars} interval="1m" timeframe="4h" />;
}
```
