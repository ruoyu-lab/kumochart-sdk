const PADDING_X = 3;
const PADDING_Y = 2;
const MIN_WIDTH = 40;

export interface TextEditorOptions {
  /** The chart element; the editor is positioned inside it. */
  readonly root: HTMLElement;
  /** Left edge of the text and middle of its first line, in chart coordinates. */
  readonly x: number;
  readonly y: number;
  readonly text: string;
  /** Accessible name of the editor. */
  readonly label: string;
  readonly font: string;
  /** How the lines align with one another. */
  readonly align: 'left' | 'center' | 'right';
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly color: string;
  readonly border: string;
  readonly background: string;
  commit(text: string): void;
  cancel(): void;
}

/**
 * Edits the text of a drawing in place, over the canvas where the text is painted. Enter keeps the
 * text (Shift+Enter adds a line), Escape restores it, leaving the editor keeps it. Keys and
 * pointer input stay in the editor instead of reaching the chart.
 */
export class TextEditor {
  private readonly area: HTMLTextAreaElement;
  private done = false;
  /** Blur counts as leaving only after the editor had the focus. */
  private focused = false;
  private focusTimer = 0;

  constructor(private readonly options: TextEditorOptions) {
    const area = options.root.ownerDocument.createElement('textarea');
    this.area = area;
    area.value = options.text;
    area.spellcheck = false;
    area.setAttribute('aria-label', options.label);
    Object.assign(area.style, {
      position: 'absolute',
      zIndex: '2',
      left: `${options.x - PADDING_X - 1}px`,
      top: `${options.y - options.lineHeight / 2 - PADDING_Y - 1}px`,
      margin: '0',
      padding: `${PADDING_Y}px ${PADDING_X}px`,
      border: `1px solid ${options.border}`,
      borderRadius: '3px',
      outline: 'none',
      resize: 'none',
      overflow: 'hidden',
      whiteSpace: 'pre',
      background: options.background,
      color: options.color,
      font: options.font,
      textAlign: options.align,
      lineHeight: `${options.lineHeight}px`,
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.12)'
    });

    area.addEventListener('keydown', this.onKey);
    area.addEventListener('input', this.fit);
    area.addEventListener('blur', this.onBlur);
    area.addEventListener('focus', this.onFocus);

    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'dblclick', 'wheel', 'keyup']) {
      area.addEventListener(type, stop);
    }

    options.root.appendChild(area);
    this.fit();
    // The click that placed the text is still being handled and would take the focus back to the
    // chart: focus once it is over.
    const view = options.root.ownerDocument.defaultView;
    this.focusTimer =
      view?.setTimeout(() => {
        area.focus();
        area.select();
      }, 0) ?? 0;
  }

  /** Keeps the text, as Enter does. */
  commit(): void {
    this.finish(() => {
      this.options.commit(this.area.value);
    });
  }

  /** Restores the text, as Escape does. */
  cancel(): void {
    this.finish(() => {
      this.options.cancel();
    });
  }

  private finish(callback: () => void): void {
    if (this.done) {
      return;
    }

    this.done = true;
    this.area.ownerDocument.defaultView?.clearTimeout(this.focusTimer);
    this.area.removeEventListener('blur', this.onBlur);
    this.area.remove();
    callback();
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    event.stopPropagation();

    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel();
    } else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.commit();
    }
  };

  private readonly onFocus = (): void => {
    this.focused = true;
  };

  private readonly onBlur = (): void => {
    if (this.focused) {
      this.commit();
    }
  };

  /** Grows the editor with its text. */
  private readonly fit = (): void => {
    const area = this.area;
    const lines = Math.max(1, area.value.split('\n').length);
    area.style.height = `${lines * this.options.lineHeight + PADDING_Y * 2 + 2}px`;
    area.style.width = '0';
    area.style.width = `${Math.max(MIN_WIDTH, area.scrollWidth + 2)}px`;
  };
}

function stop(event: Event): void {
  event.stopPropagation();
}
