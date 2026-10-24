// Lists the pages without a translation, which the site shows in the source language meanwhile:
//
//   node site/scripts/run.mjs site/scripts/translations.ts [docs directory]
//
// It only informs: a missing translation never fails a check.
import { join, relative } from 'node:path';
import { LANGUAGES, SOURCE_LANGUAGE } from '../src/shared/ui-text';
import { siteConfig } from '../build/config';
import { loadContent, missingTranslations } from '../build/content';
import { Problems } from '../build/problems';

export function main(args: readonly string[]): number {
  const config = siteConfig(args[0]);
  const content = loadContent(config, new Problems());

  for (const language of LANGUAGES.filter((item) => item !== SOURCE_LANGUAGE)) {
    const pages = content.pages.filter((page) => page.language === language);
    const missing = missingTranslations(content, language);

    console.log(
      `${language}: ${pages.length - missing.length} of ${pages.length} pages translated${missing.length > 0 ? ', missing:' : ''}`
    );

    for (const page of missing) {
      console.log(`  ${relative(config.repoRoot, join(config.docsDir, language, page.file))}`);
    }
  }

  return 0;
}
