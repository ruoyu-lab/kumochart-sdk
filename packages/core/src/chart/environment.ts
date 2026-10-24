import { ChartError, fail } from '../utils/errors';

/** Checks the browser APIs the SDK relies on and returns the container's window. */
export function assertEnvironment(container: unknown): Window {
  if (typeof HTMLElement === 'undefined' || !(container instanceof HTMLElement)) {
    fail('createChart() needs an HTMLElement container.');
  }

  const view =
    container.ownerDocument.defaultView ?? fail('The container is not attached to a window.');
  const required: Array<[string, boolean]> = [
    ['ResizeObserver', typeof globalThis.ResizeObserver === 'function'],
    ['PointerEvent', typeof globalThis.PointerEvent === 'function'],
    ['Path2D', typeof globalThis.Path2D === 'function'],
    ['matchMedia', typeof view.matchMedia === 'function'],
    ['requestAnimationFrame', typeof view.requestAnimationFrame === 'function'],
    ['Intl.DateTimeFormat', typeof globalThis.Intl.DateTimeFormat === 'function']
  ];
  const missing = required.filter(([, available]) => !available).map(([name]) => name);

  if (missing.length > 0) {
    throw new ChartError(`This browser lacks required APIs: ${missing.join(', ')}.`);
  }

  return view;
}
