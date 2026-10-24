// The languages of the site and the text of its interface, shared by the pages built in Node
// and the scripts running in the browser.

/** The languages of the site; the first one is the language the pages are written in. */
export const LANGUAGES = ['zh-CN', 'en', 'ja', 'ko'] as const;

export type Language = (typeof LANGUAGES)[number];

/** The language every page is written in first; other languages fall back to it. */
export const SOURCE_LANGUAGE: Language = 'zh-CN';

export function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

export interface UiText {
  /** Name of the language in itself, for the language switch. */
  languageName: string;
  /** Label of the language switch. */
  language: string;
  skipToContent: string;
  menu: string;
  closeMenu: string;
  search: string;
  searchPlaceholder: string;
  searchLoading: string;
  searchNoResults: string;
  searchFailed: string;
  searchHint: string;
  closeSearch: string;
  onThisPage: string;
  previous: string;
  next: string;
  editPage: string;
  theme: string;
  themeSystem: string;
  themeLight: string;
  themeDark: string;
  copy: string;
  copied: string;
  copyFailed: string;
  showCode: string;
  hideCode: string;
  liveExample: string;
  untranslated: string;
  apiEnglishOnly: string;
  apiSource: string;
  notFoundTitle: string;
  notFoundText: string;
  backHome: string;
}

export const UI_TEXT: Readonly<Record<Language, UiText>> = {
  'zh-CN': {
    languageName: '中文',
    language: '语言',
    skipToContent: '跳到正文',
    menu: '打开目录',
    closeMenu: '关闭目录',
    search: '搜索',
    searchPlaceholder: '搜索文档',
    searchLoading: '正在载入索引…',
    searchNoResults: '没有找到相关内容',
    searchFailed: '搜索索引载入失败',
    searchHint: '↑↓ 选择 · Enter 打开 · Esc 关闭',
    closeSearch: '关闭搜索',
    onThisPage: '本页目录',
    previous: '上一页',
    next: '下一页',
    editPage: '在 GitHub 上编辑此页',
    theme: '外观',
    themeSystem: '跟随系统',
    themeLight: '浅色',
    themeDark: '深色',
    copy: '复制',
    copied: '已复制',
    copyFailed: '复制失败',
    showCode: '显示代码',
    hideCode: '收起代码',
    liveExample: '可操作的例子',
    untranslated: '本页还没有翻译，下面是中文原文。',
    apiEnglishOnly: 'API 参考由源码注释生成，只有英文。',
    apiSource: '源码',
    notFoundTitle: '找不到这个页面',
    notFoundText: '地址可能写错了，或者页面已经移走。',
    backHome: '回到首页'
  },
  en: {
    languageName: 'English',
    language: 'Language',
    skipToContent: 'Skip to content',
    menu: 'Open navigation',
    closeMenu: 'Close navigation',
    search: 'Search',
    searchPlaceholder: 'Search the docs',
    searchLoading: 'Loading the index…',
    searchNoResults: 'Nothing found',
    searchFailed: 'The search index failed to load',
    searchHint: '↑↓ to select · Enter to open · Esc to close',
    closeSearch: 'Close search',
    onThisPage: 'On this page',
    previous: 'Previous',
    next: 'Next',
    editPage: 'Edit this page on GitHub',
    theme: 'Appearance',
    themeSystem: 'System',
    themeLight: 'Light',
    themeDark: 'Dark',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    showCode: 'Show code',
    hideCode: 'Hide code',
    liveExample: 'Live example',
    untranslated: 'This page has not been translated yet; it is shown in Chinese.',
    apiEnglishOnly: 'The API reference is generated from the source comments.',
    apiSource: 'Source',
    notFoundTitle: 'Page not found',
    notFoundText: 'The address may be mistyped, or the page has moved.',
    backHome: 'Back to the home page'
  },
  ja: {
    languageName: '日本語',
    language: '言語',
    skipToContent: '本文へ移動',
    menu: 'ナビゲーションを開く',
    closeMenu: 'ナビゲーションを閉じる',
    search: '検索',
    searchPlaceholder: 'ドキュメントを検索',
    searchLoading: 'インデックスを読み込み中…',
    searchNoResults: '見つかりませんでした',
    searchFailed: '検索インデックスを読み込めませんでした',
    searchHint: '↑↓ で選択 · Enter で開く · Esc で閉じる',
    closeSearch: '検索を閉じる',
    onThisPage: 'このページの内容',
    previous: '前へ',
    next: '次へ',
    editPage: 'GitHub でこのページを編集',
    theme: '外観',
    themeSystem: 'システムに合わせる',
    themeLight: 'ライト',
    themeDark: 'ダーク',
    copy: 'コピー',
    copied: 'コピーしました',
    copyFailed: 'コピーできませんでした',
    showCode: 'コードを表示',
    hideCode: 'コードを隠す',
    liveExample: '操作できるサンプル',
    untranslated: 'このページはまだ翻訳されていません。中国語の原文を表示しています。',
    apiEnglishOnly: 'API リファレンスはソースコードのコメントから生成しており、英語のみです。',
    apiSource: 'ソース',
    notFoundTitle: 'ページが見つかりません',
    notFoundText: 'アドレスが間違っているか、ページが移動した可能性があります。',
    backHome: 'ホームに戻る'
  },
  ko: {
    languageName: '한국어',
    language: '언어',
    skipToContent: '본문으로 이동',
    menu: '목차 열기',
    closeMenu: '목차 닫기',
    search: '검색',
    searchPlaceholder: '문서 검색',
    searchLoading: '색인을 불러오는 중…',
    searchNoResults: '찾은 내용이 없습니다',
    searchFailed: '검색 색인을 불러오지 못했습니다',
    searchHint: '↑↓ 선택 · Enter 열기 · Esc 닫기',
    closeSearch: '검색 닫기',
    onThisPage: '이 페이지의 내용',
    previous: '이전',
    next: '다음',
    editPage: 'GitHub에서 이 페이지 편집',
    theme: '화면 모드',
    themeSystem: '시스템 설정',
    themeLight: '라이트',
    themeDark: '다크',
    copy: '복사',
    copied: '복사했습니다',
    copyFailed: '복사하지 못했습니다',
    showCode: '코드 보기',
    hideCode: '코드 숨기기',
    liveExample: '직접 조작할 수 있는 예제',
    untranslated: '이 페이지는 아직 번역되지 않아 중국어 원문을 보여 줍니다.',
    apiEnglishOnly: 'API 레퍼런스는 소스 코드의 주석에서 생성되며 영어로만 제공됩니다.',
    apiSource: '소스',
    notFoundTitle: '페이지를 찾을 수 없습니다',
    notFoundText: '주소가 잘못되었거나 페이지가 옮겨졌을 수 있습니다.',
    backHome: '홈으로 돌아가기'
  }
};
