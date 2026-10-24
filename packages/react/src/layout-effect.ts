import { useEffect, useLayoutEffect } from 'react';

/**
 * `useLayoutEffect` in the browser, so the chart is created and filled before the first paint.
 * Neither effect runs during server rendering, where `useEffect` avoids React 18's warning.
 */
export const useBrowserLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect;
