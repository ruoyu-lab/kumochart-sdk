import { paneOf, type ObjectContext } from '../objects/types';
import { anchorPosition } from './anchoring';
import { textLineHeight } from './geometry';
import { drawingTexts } from './options';
import { styleOf, type Shape } from './painting';
import { textFont } from './style';
import { TextEditor } from './text-editor';
import type { DrawingInput, DrawingTypeDefinition } from './types';

/** What the editor of a text edits: a drawing, or one a tool is placing, which may end the tool. */
export type EditedText =
  | { readonly id: string }
  | { readonly id: null; readonly input: DrawingInput; readonly endsTool: boolean };

export interface TextEditingHost {
  /** The chart element, which hosts the editor. */
  readonly root: HTMLElement;
  context(): ObjectContext;
  repaint(): void;
  definition(type: string): DrawingTypeDefinition;
  /** The editor closed with its text. */
  keep(edited: EditedText, text: string): void;
  /** The editor closed without its text. */
  drop(edited: EditedText): void;
}

/** The in-place editor of the text of a drawing, one at a time. */
export class TextEditing {
  private current: { readonly editor: TextEditor; readonly edited: EditedText } | null = null;

  constructor(private readonly host: TextEditingHost) {}

  /** What the open editor edits, or `null`. */
  get edited(): EditedText | null {
    return this.current?.edited ?? null;
  }

  /** Opens the editor at the text anchor of `input`, in its pane. */
  open(input: DrawingInput, edited: EditedText): void {
    const { host } = this;
    const context = host.context();
    const pane = paneOf(context.frame, input.pane ?? 'main');
    const definition = host.definition(input.type);
    // The type's textAnchor is one of its anchors.
    const anchor = input.points[definition.textAnchor ?? 0];

    if (!pane || !anchor) {
      return;
    }

    const entry: Shape = { definition, style: input.style ?? {}, text: input.text ?? '' };
    const style = styleOf(context, entry);
    const position = anchorPosition(context, pane, {
      time: Number(anchor.time),
      price: anchor.price
    });
    const close = () => {
      this.current = null;
      host.repaint();
    };

    const editor = new TextEditor({
      root: host.root,
      // The editor is an element of the chart, placed from its left edge.
      x: context.frame.layout.leftAxisWidth + pane.plot.x + position.x,
      y: pane.plot.y + position.y,
      text: entry.text,
      label: drawingTexts(context.options).text,
      font: textFont(style, context.options.font.family),
      align: style.textAlign,
      fontSize: style.fontSize,
      lineHeight: textLineHeight(style.fontSize),
      color: style.textColor,
      border: style.color,
      background: context.options.theme.background,
      commit: (text) => {
        close();
        host.keep(edited, text);
      },
      cancel: () => {
        close();
        host.drop(edited);
      }
    });
    this.current = { editor, edited };
    host.repaint();
  }

  /** Keeps the text being edited. */
  commit(): void {
    this.current?.editor.commit();
  }

  /** Closes the editor without its text. */
  cancel(): void {
    this.current?.editor.cancel();
  }
}
