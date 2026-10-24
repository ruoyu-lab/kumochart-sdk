# 플러그인으로 그리기

<!-- code-prelude
declare const plugin: import('@kumochart-sdk/core').ChartPlugin;
-->

차트에 없는 것은 플러그인으로 캔버스에 직접 그릴 수 있습니다. 워터마크, 배경 색 영역, 직접 계산한 표시 같은 것입니다. 플러그인은 차트와 함께 다시 그려지므로 확대/축소하거나 드래그해도 위치가 어긋나지 않습니다.

```ts live height=360
import { createChart, withAlpha, type ChartPlugin } from '@kumochart-sdk/core';
import { loadBars } from '@docs/data';

/** 메인 창 한가운데의 워터마크 */
function watermark(text: string): ChartPlugin {
  return {
    name: 'watermark',
    paint: ({ ctx, layer, pane, theme, font }) => {
      if (layer !== 'below' || pane.id !== 'main') return;
      ctx.font = `600 40px ${font.family}`;
      ctx.fillStyle = withAlpha(theme.text, 0.07);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, pane.width / 2, pane.height / 2);
    }
  };
}

const chart = createChart(document.getElementById('chart')!);
chart.plugins.add(watermark('BTCUSDT · 1h'));

chart.data.set(await loadBars(), { interval: '1m' });
chart.data.setTimeframe('1h');
```

## 그리는 방법

차트는 다시 그릴 때마다 창마다 `paint`를 두 번 호출합니다.

- `layer: 'below'`: 격자 다음, 봉 이전. 배경 같은 것을 그립니다.
- `layer: 'above'`: 봉 다음, 그리기와 주문선 이전. 표시 같은 것을 그립니다.

`ctx`는 이미 이 창의 플롯 영역으로 잘려 있고 좌표도 그 왼쪽 위로 옮겨져 있으므로 CSS 픽셀 단위로 그리면 됩니다. 고해상도 화면의 배율은 이미 처리되어 있습니다.

`paint`가 받는 컨텍스트에는 다음이 들어 있습니다.

| 필드                              | 용도                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pane`                            | 창의 id와 너비·높이, 가격과 픽셀을 변환하는 `valueToY`, `yToValue`, 축의 형식으로 가격을 표시하는 `formatValue` |
| `bars`                            | 표시되는 봉, 열 단위로 읽음                                                                                     |
| `visible`                         | 보이는 첫 봉과 마지막 봉의 인덱스, 봉이 없으면 `null`                                                           |
| `indexToX`, `xToIndex`, `timeToX` | 인덱스·시간과 가로 좌표 사이의 변환                                                                             |
| `barSpacing`                      | 봉 하나가 차지하는 너비                                                                                         |
| `theme`, `font`                   | 현재 테마와 글꼴, 색상은 테마를 따름                                                                            |
| `source`, `cutoff`                | 원래 주기의 봉, 리플레이 중에는 `cutoff` 이후를 그리지 않아야 함                                                |

보이는 부분만 그리면 봉이 아무리 많아도 느려지지 않습니다.

```ts
import { withAlpha, type ChartPlugin } from '@kumochart-sdk/core';

const highlightBigBars: ChartPlugin = {
  name: 'big-bars',
  paint: ({ ctx, layer, pane, bars, visible, indexToX, barSpacing, theme }) => {
    if (layer !== 'below' || pane.id !== 'main' || !visible) return;
    ctx.fillStyle = withAlpha(theme.accent, 0.08);
    for (let i = visible.from; i <= visible.to; i += 1) {
      if (bars.high(i) - bars.low(i) > 500) {
        ctx.fillRect(indexToX(i) - barSpacing / 2, 0, barSpacing, pane.height);
      }
    }
  }
};
```

## 상태와 다시 그리기

플러그인 자체의 설정이 바뀌면 차트를 한 번 다시 그리게 해야 합니다. `attach`에서 `host`를 받아 두고 `host.repaint()`를 호출합니다.

```ts
import type { ChartPlugin } from '@kumochart-sdk/core';

function watermark(initial: string) {
  let text = initial;
  let repaint = () => {};

  const plugin: ChartPlugin = {
    name: 'watermark',
    attach: (host) => {
      repaint = host.repaint;
    },
    paint: ({ ctx, layer, pane }) => {
      if (layer === 'below' && pane.id === 'main')
        ctx.fillText(text, pane.width / 2, pane.height / 2);
    }
  };

  return {
    plugin,
    setText(next: string) {
      text = next;
      repaint();
    }
  };
}
```

`host.chart`는 차트 자체이므로 플러그인은 유형 등록이나 이벤트 구독 등 차트의 모든 API를 쓸 수 있습니다. 플러그인이 제거되거나 차트가 파기되면 `detach`가 호출되므로, 여기서 직접 등록한 리스너를 해제합니다.

```ts
chart.plugins.add(plugin);
chart.plugins.list(); // 그리는 순서대로 플러그인을 나열
chart.plugins.remove('watermark');
```

## 캔버스 또는 HTML

클릭하거나 입력할 수 있어야 하는 것, 예를 들어 차트 위에 떠 있는 버튼이나 입력 상자는 HTML 요소를 차트 위에 겹치는 편이 낫습니다. `chart.layout()`으로 각 창의 위치를 얻고, `priceScale().priceToY()`, `timeScale.timeToX()`로 좌표를 변환하고, `visibleRangeChange`가 발생할 때 위치를 갱신합니다. 보기만 하면 되는 것은 플러그인으로 캔버스에 그리는 편이 성능이 좋고, 스크린샷에도 함께 담깁니다.

플러그인은 직접 만든 지표, 그리기 유형과 함께 하나의 모듈로 묶을 수 있습니다. [사용자 정의 모듈](custom-modules.md)을 참고하세요.
