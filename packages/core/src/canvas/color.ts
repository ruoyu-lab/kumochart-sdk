import { fail } from '../utils/errors';
import { checkString } from '../utils/validate';

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;
const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i;

let normalizer: CanvasRenderingContext2D | null | undefined;

function parseHex(hex: string): Rgba {
  const digits =
    hex.length <= 4
      ? hex
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : hex;
  const value = (offset: number) => Number.parseInt(digits.slice(offset, offset + 2), 16);
  return { r: value(0), g: value(2), b: value(4), a: digits.length === 8 ? value(6) / 255 : 1 };
}

function parseRgb(match: RegExpExecArray): Rgba {
  const alpha = match[4];
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a:
      alpha === undefined
        ? 1
        : alpha.endsWith('%')
          ? Number(alpha.slice(0, -1)) / 100
          : Number(alpha)
  };
}

/**
 * A CSS color of another syntax as the browser's canvas writes it, hex or `rgba()`; `null` for one
 * the canvas does not take, and `undefined` without a canvas, as in Node.
 */
function canvasForm(color: string): string | null | undefined {
  normalizer ??=
    typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');

  if (!normalizer) {
    return undefined;
  }

  normalizer.fillStyle = '#000000';
  normalizer.fillStyle = color;
  const form = normalizer.fillStyle;
  // A canvas keeps its color for one it does not take.
  const taken = form !== '#000000' || /^(black|#0{3,8})$/i.test(color);
  return taken && (HEX.test(form) || RGB.test(form)) ? form : null;
}

function parse(color: string): Rgba {
  const trimmed = color.trim();
  const hex = HEX.exec(trimmed);

  if (hex?.[1]) {
    return parseHex(hex[1]);
  }

  const rgb = RGB.exec(trimmed);

  if (rgb) {
    return parseRgb(rgb);
  }

  const form = canvasForm(trimmed);
  return form ? parse(form) : fail(`Unsupported color ${JSON.stringify(color)}.`);
}

/**
 * Checks a color as the chart takes it: hex, `rgb()` or `rgba()`, or any other CSS color the
 * browser's canvas paints. Without a canvas, as in Node, nothing is painted, and any text is
 * taken.
 */
export function checkColor(path: string, value: unknown): string {
  const color = checkString(path, value).trim();

  if (!HEX.test(color) && !RGB.test(color) && canvasForm(color) === null) {
    fail(`${path} must be a CSS color, not ${JSON.stringify(value)}.`);
  }

  return value as string;
}

/** Checks the fields of a style named `color` or `…Color` that are given: they take CSS colors. */
export function checkStyleColors(path: string, style: Readonly<Record<string, unknown>>): void {
  for (const [key, value] of Object.entries(style)) {
    if ((key === 'color' || key.endsWith('Color')) && value !== undefined && value !== null) {
      checkColor(`${path}.${key}`, value);
    }
  }
}

interface Parsed {
  readonly rgba: Rgba;
  /** The colors made from it, by what made them. */
  readonly made: Map<string, string>;
}

/**
 * The colors parsed so far, with the colors made from each, as painting asks for the same ones
 * every frame. Caps keep colors made on the fly, as by a callback, from piling up.
 */
const parsed = new Map<string, Parsed>();
const MAX_PARSED = 256;
const MAX_MADE = 32;

function parsedColor(color: string): Parsed {
  let entry = parsed.get(color);

  if (!entry) {
    if (parsed.size >= MAX_PARSED) {
      parsed.clear();
    }

    entry = { rgba: parse(color), made: new Map() };
    parsed.set(color, entry);
  }

  return entry;
}

/** The color made from `entry` as `key` says, made by `make` the first time. */
function madeFrom(entry: Parsed, key: string, make: () => string): string {
  let made = entry.made.get(key);

  if (made === undefined) {
    if (entry.made.size >= MAX_MADE) {
      entry.made.clear();
    }

    made = make();
    entry.made.set(key, made);
  }

  return made;
}

/** `color` laid over `background` at `alpha`, as one opaque color. */
export function blend(color: string, background: string, alpha: number): string {
  const entry = parsedColor(color);
  return madeFrom(entry, `${alpha} over ${background}`, () => {
    const top = entry.rgba;
    const bottom = parsedColor(background).rgba;
    const share = top.a * alpha;
    const channel = (front: number, back: number) => Math.round(front * share + back * (1 - share));
    return `rgb(${channel(top.r, bottom.r)}, ${channel(top.g, bottom.g)}, ${channel(top.b, bottom.b)})`;
  });
}

/** Returns `color` with its alpha multiplied by `alpha`. */
export function withAlpha(color: string, alpha: number): string {
  const entry = parsedColor(color);
  return madeFrom(entry, String(alpha), () => {
    const { r, g, b, a } = entry.rgba;
    return `rgba(${r}, ${g}, ${b}, ${Math.round(a * alpha * 1000) / 1000})`;
  });
}
