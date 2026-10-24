import { relative } from 'node:path';

/** Something wrong in the documentation, at a file and optionally a line (from 1). */
export interface Problem {
  readonly file: string;
  readonly line?: number;
  readonly message: string;
}

/** `docs/zh-CN/data.md:12: message`, with the file relative to `root`. */
export function formatProblem(problem: Problem, root: string): string {
  const file = relative(root, problem.file);
  return `${file}${problem.line === undefined ? '' : `:${problem.line}`}: ${problem.message}`;
}

/** The errors that stop a build, all of them at once. */
export class DocsError extends Error {
  constructor(problems: readonly Problem[], root: string) {
    super(
      `The documentation has ${problems.length} error${problems.length === 1 ? '' : 's'}:\n${problems
        .map((problem) => `  ${formatProblem(problem, root)}`)
        .join('\n')}`
    );
    this.name = 'DocsError';
    // Where the build stopped says nothing about the pages; the message says it all.
    this.stack = `${this.name}: ${this.message}`;
  }
}

/**
 * Collects the errors and warnings of a build, each once: a page shown untranslated in another
 * language repeats the problems of its source.
 */
export class Problems {
  readonly errors: Problem[] = [];
  readonly warnings: Problem[] = [];
  private readonly seen = new Set<string>();

  private add(list: Problem[], file: string, line: number | undefined, message: string): void {
    const key = `${file}:${String(line)}:${message}`;

    if (!this.seen.has(key)) {
      this.seen.add(key);
      list.push(line === undefined ? { file, message } : { file, line, message });
    }
  }

  error(file: string, line: number | undefined, message: string): void {
    this.add(this.errors, file, line, message);
  }

  warn(file: string, line: number | undefined, message: string): void {
    this.add(this.warnings, file, line, message);
  }

  /** Throws a {@link DocsError} with every error collected, if there is any. */
  throwIfAny(root: string): void {
    if (this.errors.length > 0) {
      throw new DocsError(this.errors, root);
    }
  }
}
