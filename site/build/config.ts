import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Where the site reads its pages and the SDK from, and where links to the repository go. */
export interface SiteConfig {
  /** The SDK repository. */
  readonly repoRoot: string;
  /** The directory with `nav.json`, `api.md` and one directory of pages per language. */
  readonly docsDir: string;
  /** The `site/` workspace. */
  readonly siteDir: string;
  /** The repository on GitHub, such as `https://github.com/ruoyu-lab/kumochart-sdk`. */
  readonly repository: string;
  /** The branch links to the repository point at. */
  readonly branch: string;
}

const siteDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(siteDir, '..');

/** The repository URL from the core package, without `git+` and `.git`. */
function repositoryUrl(): string {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, 'packages/core/package.json'), 'utf8')
  ) as { repository: { url: string } };
  return manifest.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
}

/**
 * The configuration of the site. `docsDir` is relative to the repository: `docs` for the
 * documentation, or the pages of the tests.
 */
export function siteConfig(docsDir = 'docs'): SiteConfig {
  return {
    repoRoot,
    docsDir: resolve(repoRoot, docsDir),
    siteDir,
    repository: repositoryUrl(),
    branch: 'main'
  };
}
