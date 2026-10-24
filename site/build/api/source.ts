import ts from 'typescript';

/** Source text as shown, and where positions of the file are in it. */
export interface Excerpt {
  readonly text: string;
  /** The offset in `text` of a position of the file, or `null` outside the excerpt. */
  readonly offset: (position: number) => number | null;
}

/**
 * The source between two positions, the lines after the first moved left by `indent` spaces
 * (the column the excerpt starts at), and trailing whitespace and `;` or `,` removed.
 */
export function excerpt(file: ts.SourceFile, start: number, end: number, indent: number): Excerpt {
  const lines = file.text.slice(start, end).split('\n');
  /** Per line: its position in the file, its offset in the text, the characters removed. */
  const layout: { position: number; offset: number; removed: number }[] = [];
  let position = start;
  let offset = 0;
  const kept = lines.map((line, index) => {
    const spaces = index === 0 ? 0 : Math.min(indent, /^ */.exec(line)?.[0].length ?? 0);
    layout.push({ position, offset, removed: spaces });
    position += line.length + 1;
    offset += line.length - spaces + 1;
    return line.slice(spaces);
  });
  const text = kept.join('\n').replace(/[\s;,]+$/, '');

  return {
    text,
    offset: (target) => {
      if (target < start || target > end) {
        return null;
      }

      const line = layout.findLast((item) => item.position <= target);

      if (!line) {
        return null;
      }

      const value = line.offset + Math.max(0, target - line.position - line.removed);
      return value <= text.length ? value : null;
    }
  };
}

/** Where a declaration starts once `export`, `declare` and `default` are left out. */
export function startAfterExport(node: ts.Node, file: ts.SourceFile): number {
  const modifiers = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
  let start = node.getStart(file);

  for (const modifier of modifiers) {
    if (
      modifier.kind === ts.SyntaxKind.ExportKeyword ||
      modifier.kind === ts.SyntaxKind.DeclareKeyword ||
      modifier.kind === ts.SyntaxKind.DefaultKeyword
    ) {
      start = modifier.end;
    }
  }

  while (/\s/.test(file.text[start] ?? '')) {
    start += 1;
  }

  return start;
}
