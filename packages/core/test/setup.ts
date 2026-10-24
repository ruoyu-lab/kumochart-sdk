/**
 * Browser APIs jsdom lacks: a recording 2D canvas context, Path2D, ResizeObserver and matchMedia.
 */

export interface CanvasCall {
  name: string;
  args: unknown[];
}

const GRADIENT = { addColorStop: () => undefined };

function createContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { canvas, calls: [] as CanvasCall[] };
  return new Proxy(state, {
    get(target, property) {
      if (property in target) {
        return target[property];
      }

      if (property === 'measureText') {
        return (text: string) => ({ width: text.length * 6 });
      }

      if (property === 'createLinearGradient' || property === 'createRadialGradient') {
        return () => GRADIENT;
      }

      return (...args: unknown[]) => {
        (target.calls as CanvasCall[]).push({ name: String(property), args });
      };
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    }
  }) as unknown as CanvasRenderingContext2D;
}

const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value(this: HTMLCanvasElement) {
    let context = contexts.get(this);

    if (!context) {
      context = createContext(this);
      contexts.set(this, context);
    }

    return context;
  }
});

/** Calls recorded on a canvas by the stub context. */
export function canvasCalls(canvas: HTMLCanvasElement): CanvasCall[] {
  return (canvas.getContext('2d') as unknown as { calls: CanvasCall[] }).calls;
}

class Path2DStub {
  constructor(readonly data?: string) {}
}

export const resizeObservers = new Set<ResizeObserverStub>();

class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}

  /** Reports a new content size, as the browser does after layout. */
  report(width: number, height: number): void {
    const entry = { contentRect: { width, height } } as ResizeObserverEntry;
    this.callback([entry], this);
  }

  observe(): void {
    resizeObservers.add(this);
  }

  disconnect(): void {
    resizeObservers.delete(this);
  }

  unobserve(): void {
    resizeObservers.delete(this);
  }
}

Object.assign(globalThis, { Path2D: Path2DStub, ResizeObserver: ResizeObserverStub });
Object.assign(window, {
  matchMedia: () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  })
});
