import type { Token } from 'markdown-it';

/** Languages whose code blocks are type-checked and can be live examples. */
export const CHECKED_LANGUAGES = ['ts', 'tsx', 'vue'] as const;

export type CheckedLanguage = (typeof CHECKED_LANGUAGES)[number];

/** Height of a live example when the block does not set one, in CSS pixels. */
export const DEFAULT_LIVE_HEIGHT = 400;

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 1200;

/**
 * What the info string of a fence says, such as ```` ```ts live height=360 ````. GitHub reads only
 * the language and ignores the rest.
 */
export interface FenceInfo {
  /** The language as written, such as `ts`. */
  readonly language: string;
  /** The language when its code is type-checked; `null` for other code and `no-check` blocks. */
  readonly checked: CheckedLanguage | null;
  /** Runs as a live example next to its code. */
  readonly live: boolean;
  /** Height of the live example. */
  readonly height: number;
  /** The code of the live example starts folded. */
  readonly collapsed: boolean;
}

function checkedLanguage(language: string): CheckedLanguage | null {
  if (language === 'typescript') {
    return 'ts';
  }

  return (CHECKED_LANGUAGES as readonly string[]).includes(language)
    ? (language as CheckedLanguage)
    : null;
}

/** Reads the info string of a fence; a string is the problem with it. */
export function parseFenceInfo(info: string): FenceInfo | string {
  const [language = '', ...words] = info.trim().split(/\s+/);
  let live = false;
  let height: number | null = null;
  let collapsed = false;
  let check = true;

  for (const word of words) {
    const match = /^height=(\d+)$/.exec(word);

    if (word === 'live') {
      live = true;
    } else if (word === 'collapsed') {
      collapsed = true;
    } else if (word === 'no-check') {
      check = false;
    } else if (match) {
      height = Number(match[1]);
    } else {
      return `unknown word "${word}" after the language of the code block (expected live, height=…, collapsed or no-check)`;
    }
  }

  const checked = checkedLanguage(language);

  if (live && checked === null) {
    return `a live example must be ts, tsx or vue code, not "${language}"`;
  }

  if (live && !check) {
    return 'a live example is always type-checked; remove no-check';
  }

  if (!check && checked === null) {
    return `no-check only applies to ts, tsx and vue code, which is type-checked`;
  }

  if (!live && (height !== null || collapsed)) {
    return 'height=… and collapsed only apply to live examples';
  }

  if (height !== null && (height < MIN_HEIGHT || height > MAX_HEIGHT)) {
    return `height must be between ${MIN_HEIGHT} and ${MAX_HEIGHT} pixels`;
  }

  return {
    language,
    checked: check ? checked : null,
    live,
    height: height ?? DEFAULT_LIVE_HEIGHT,
    collapsed
  };
}

/** Code put before the code blocks that follow it, from a `<!-- code-prelude … -->` comment. */
export interface Prelude {
  readonly code: string;
  /** Line of the first line of code in the Markdown file, from 1. */
  readonly line: number;
}

const PRELUDE = /^<!--\s*code-prelude[ \t]*\n([\s\S]*?)-->\s*$/;

/** The prelude an HTML block declares, or `null` for other HTML. */
export function preludeOf(token: Token): Prelude | null {
  const match = PRELUDE.exec(token.content);
  return match && token.map ? { code: match[1] ?? '', line: token.map[0] + 2 } : null;
}

/** A code block of a page that is type-checked. */
export interface CheckedBlock {
  /** The Markdown file. */
  readonly file: string;
  /** Line of the first line of code, from 1. */
  readonly line: number;
  readonly language: CheckedLanguage;
  readonly code: string;
  readonly live: boolean;
  /** Code checked before it; never for live examples and Vue components, which are complete. */
  readonly prelude: Prelude | null;
}

/**
 * The type-checked code blocks of parsed Markdown. Bad info strings are left to the build, which
 * reports them.
 */
export function checkedBlocks(file: string, tokens: readonly Token[]): CheckedBlock[] {
  const blocks: CheckedBlock[] = [];
  let prelude: Prelude | null = null;

  for (const token of tokens) {
    if (token.type === 'html_block') {
      prelude = preludeOf(token) ?? prelude;
      continue;
    }

    if (token.type !== 'fence' || !token.map) {
      continue;
    }

    const info = parseFenceInfo(token.info);

    if (typeof info === 'string' || info.checked === null) {
      continue;
    }

    blocks.push({
      file,
      line: token.map[0] + 2,
      language: info.checked,
      code: token.content,
      live: info.live,
      prelude: info.live || info.checked === 'vue' ? null : prelude
    });
  }

  return blocks;
}
