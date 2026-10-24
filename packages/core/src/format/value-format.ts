import type { Formatter } from './formatter';

/** How the numbers of a pane, series or indicator are written. */
export type ValueFormat =
  { readonly kind: 'decimal'; readonly precision: number } | { readonly kind: 'compact' };

export function formatValue(formatter: Formatter, value: number, format: ValueFormat): string {
  if (!Number.isFinite(value)) {
    return '—';
  }

  return format.kind === 'compact'
    ? formatter.compact(value)
    : formatter.number(value, format.precision);
}

/** The finer of two formats, so a pane can show the values of everything drawn in it. */
export function finerFormat(left: ValueFormat | null, right: ValueFormat): ValueFormat {
  if (!left) {
    return right;
  }

  if (left.kind === 'decimal' && right.kind === 'decimal') {
    return left.precision >= right.precision ? left : right;
  }

  return left.kind === 'decimal' ? left : right;
}
