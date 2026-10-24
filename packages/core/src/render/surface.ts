import { fail } from '../utils/errors';

export type LayerName = 'scene' | 'objects' | 'cursor';

const LAYERS: readonly LayerName[] = ['scene', 'objects', 'cursor'];

interface Layer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
}

/**
 * The DOM owned by a chart: a focusable root element with three stacked canvases. The scene
 * holds the data, the objects layer holds drawings, orders, markers and alerts, and the cursor
 * layer holds the crosshair and legends, so pointer moves repaint only what changed.
 *
 * The surface also watches the container size (with `autoSize`) and the device pixel ratio, which
 * changes when the window moves to another screen, and reports both through `onChange`.
 *
 * Each canvas bitmap covers a whole number of device pixels and the canvas element is sized to
 * exactly that area, so one bitmap pixel maps to one screen pixel and the chart stays sharp even
 * when the container has a fractional size such as 661.5 × 977 CSS pixels.
 */
export class Surface {
  readonly root: HTMLDivElement;
  private readonly layers: Record<LayerName, Layer>;
  private cssWidth = 0;
  private cssHeight = 0;
  private ratio = 1;
  private resizeObserver: ResizeObserver | null = null;
  private pixelRatioQuery: MediaQueryList | null = null;

  constructor(
    private readonly view: Window,
    private readonly container: HTMLElement,
    private maxPixelRatio: number,
    private readonly onChange: () => void
  ) {
    const document = container.ownerDocument;
    this.root = document.createElement('div');
    this.root.tabIndex = 0;
    this.root.setAttribute('role', 'img');
    this.root.setAttribute('aria-label', 'Trading chart');
    Object.assign(this.root.style, {
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      outline: 'none',
      touchAction: 'none',
      userSelect: 'none',
      webkitUserSelect: 'none',
      webkitTapHighlightColor: 'transparent'
    });

    const entries = LAYERS.map((name): [LayerName, Layer] => {
      const canvas = document.createElement('canvas');
      canvas.dataset.layer = name;
      Object.assign(canvas.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        pointerEvents: 'none'
      });
      const ctx =
        canvas.getContext('2d') ?? fail('The browser does not provide a 2D canvas context.');
      this.root.appendChild(canvas);
      return [name, { canvas, ctx }];
    });

    this.layers = Object.fromEntries(entries) as Record<LayerName, Layer>;
    container.appendChild(this.root);
  }

  get width(): number {
    return this.cssWidth;
  }

  get height(): number {
    return this.cssHeight;
  }

  get pixelRatio(): number {
    return this.ratio;
  }

  context(layer: LayerName): CanvasRenderingContext2D {
    return this.layers[layer].ctx;
  }

  canvas(layer: LayerName): HTMLCanvasElement {
    return this.layers[layer].canvas;
  }

  setMaxPixelRatio(maxPixelRatio: number): boolean {
    this.maxPixelRatio = maxPixelRatio;
    return this.resize(this.cssWidth, this.cssHeight);
  }

  /**
   * Size of the container in CSS pixels, rounded to whole pixels. The observer installed by
   * {@link setAutoSize} reports the exact size before the first paint.
   */
  measureContainer(): { width: number; height: number } {
    return { width: this.container.clientWidth, height: this.container.clientHeight };
  }

  /** Follows the container size while `enabled`. */
  setAutoSize(enabled: boolean): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    if (enabled) {
      const observer = new ResizeObserver((entries) => {
        const size = entries.at(-1)?.contentRect;

        if (size && this.resize(size.width, size.height)) {
          this.onChange();
        }
      });
      observer.observe(this.container);
      this.resizeObserver = observer;
    }
  }

  /** Re-renders crisply when the device pixel ratio changes. */
  watchPixelRatio(): void {
    this.pixelRatioQuery?.removeEventListener('change', this.handlePixelRatioChange);
    this.pixelRatioQuery = this.view.matchMedia(`(resolution: ${this.view.devicePixelRatio}dppx)`);
    this.pixelRatioQuery.addEventListener('change', this.handlePixelRatioChange);
  }

  private readonly handlePixelRatioChange = (): void => {
    this.watchPixelRatio();

    if (this.resize(this.cssWidth, this.cssHeight)) {
      this.onChange();
    }
  };

  /**
   * Resizes the canvases to `width` × `height` CSS pixels, adjusted to whole device pixels;
   * returns whether anything changed.
   */
  resize(width: number, height: number): boolean {
    const ratio = Math.min(this.maxPixelRatio, Math.max(1, this.view.devicePixelRatio));
    const bitmapWidth = Math.round(Math.max(0, width) * ratio);
    const bitmapHeight = Math.round(Math.max(0, height) * ratio);
    const cssWidth = bitmapWidth / ratio;
    const cssHeight = bitmapHeight / ratio;

    if (cssWidth === this.cssWidth && cssHeight === this.cssHeight && ratio === this.ratio) {
      return false;
    }

    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.ratio = ratio;

    for (const name of LAYERS) {
      const { canvas } = this.layers[name];
      canvas.width = bitmapWidth;
      canvas.height = bitmapHeight;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
    }

    return true;
  }

  /**
   * Clears a layer and prepares it for drawing in CSS pixels, with x 0 at `originX`: the left edge
   * of the plots, right of a left price axis.
   */
  begin(layer: LayerName, originX = 0): CanvasRenderingContext2D {
    const { canvas, ctx } = this.layers[layer];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return this.over(layer, originX);
  }

  /** Prepares a layer for drawing over what it holds, as `begin` does without clearing it. */
  over(layer: LayerName, originX = 0): CanvasRenderingContext2D {
    const { ctx } = this.layers[layer];
    ctx.setTransform(this.ratio, 0, 0, this.ratio, this.ratio * originX, 0);
    return ctx;
  }

  /** Draws all layers onto one canvas, for screenshots. */
  composite(): HTMLCanvasElement {
    const output = this.container.ownerDocument.createElement('canvas');
    output.width = this.layers.scene.canvas.width;
    output.height = this.layers.scene.canvas.height;
    const ctx =
      output.getContext('2d') ?? fail('The browser does not provide a 2D canvas context.');

    for (const name of LAYERS) {
      ctx.drawImage(this.layers[name].canvas, 0, 0);
    }

    return output;
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.pixelRatioQuery?.removeEventListener('change', this.handlePixelRatioChange);
    this.root.remove();
  }
}
