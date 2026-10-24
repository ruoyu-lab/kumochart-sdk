import type { InteractionHost } from './types';

const KEY_ZOOM = 1.15;

/**
 * Runs the chart command of a key press; returns whether one did anything, which takes the key
 * from the page. While a gesture is in progress only Escape works, cancelling it. Keys moving the
 * chart leave the keys with Ctrl, ⌘ or Alt to the browser, as Ctrl+- zooms the page and Alt+←
 * goes back.
 */
export function runKeyCommand(
  event: KeyboardEvent,
  host: InteractionHost,
  busy: boolean,
  cancelGesture: () => void
): boolean {
  const command = (event.metaKey || event.ctrlKey) && !event.altKey;
  const key = event.key;
  const lower = key.toLowerCase();
  const width = host.plotWidth();

  if (key === 'Escape') {
    if (busy) {
      cancelGesture();
      return true;
    }

    return host.command('escape');
  }

  // Commands that edit or move the chart wait until the gesture in progress ends.
  if (busy) {
    return false;
  }

  if (command && lower === 'z') {
    return host.command(event.shiftKey ? 'redo' : 'undo');
  }

  if (command && !event.shiftKey && lower === 'y') {
    return host.command('redo');
  }

  if (command && (lower === 'c' || lower === 'v')) {
    return host.command(lower === 'c' ? 'copy' : 'paste');
  }

  if (event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }

  if (key === 'Delete' || key === 'Backspace') {
    return host.command('delete');
  }

  if (key === 'Enter') {
    return host.command('enter');
  }

  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    host.scrollTime((event.shiftKey ? width / 2 : width / 20) * (key === 'ArrowLeft' ? 1 : -1));
  } else if (key === 'ArrowUp' || key === '+' || key === '=') {
    host.zoomTime(KEY_ZOOM, null);
  } else if (key === 'ArrowDown' || key === '-') {
    host.zoomTime(1 / KEY_ZOOM, null);
  } else if (key === 'End') {
    host.scrollToRealTime();
  } else {
    return false;
  }

  return true;
}
