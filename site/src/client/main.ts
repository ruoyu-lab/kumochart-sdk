import '../styles/site.css';
import { isLanguage, SOURCE_LANGUAGE } from '../shared/ui-text';
import { initCode } from './code';
import { initLanguage, initNotFound } from './language';
import { initMenu } from './menu';
import { initScroll } from './scroll';
import { initSearch } from './search';
import { initTheme } from './theme';
import { initToc } from './toc';

const declared =
  document.querySelector<HTMLMetaElement>('meta[name="docs-language"]')?.content ?? '';
const language = isLanguage(declared) ? declared : SOURCE_LANGUAGE;

initTheme();
initMenu();
initCode(language);
initToc();
initScroll();
initSearch(language);
initLanguage();
initNotFound();
// Set up: the page fades in (hidden until then by the style in its head).
requestAnimationFrame(() => {
  document.documentElement.dataset.ready = '';
});
