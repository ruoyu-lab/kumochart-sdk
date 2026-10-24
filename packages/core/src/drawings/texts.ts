import type { DrawingTexts } from './types';

type Language = 'en' | 'zh' | 'ja' | 'ko';

const UNITS = [
  { ms: 86_400_000, en: 'd', zh: '天', ja: '日', ko: '일' },
  { ms: 3_600_000, en: 'h', zh: '小时', ja: '時間', ko: '시간' },
  { ms: 60_000, en: 'm', zh: '分钟', ja: '分', ko: '분' },
  { ms: 1000, en: 's', zh: '秒', ja: '秒', ko: '초' }
] as const;

/** What goes between the units of a span. */
const SPAN_SEPARATORS: Readonly<Record<Language, string>> = { en: ' ', zh: '', ja: '', ko: ' ' };

/** The two largest units of a span, e.g. `3d 4h`, `3天4小时`, `3日4時間` or `3일 4시간`. */
function span(ms: number, language: Language): string {
  let rest = Math.round(Math.abs(ms) / 1000) * 1000;
  const parts: string[] = [];

  for (const unit of UNITS) {
    const count = Math.floor(rest / unit.ms);

    if (count > 0 && parts.length < 2) {
      parts.push(`${count}${unit[language]}`);
      rest -= count * unit.ms;
    } else if (parts.length > 0) {
      break;
    }
  }

  const zero = `0${UNITS[3][language]}`;
  return parts.length === 0 ? zero : parts.join(SPAN_SEPARATORS[language]);
}

export const ENGLISH: DrawingTexts = {
  text: 'Text',
  bars: (count) => (count === 1 ? '1 bar' : `${count} bars`),
  duration: (ms) => span(ms, 'en'),
  target: 'Target',
  stop: 'Stop',
  riskReward: 'R:R',
  open: 'Open',
  targetHit: 'Target hit',
  stopped: 'Stopped',
  leftShoulder: 'Left Shoulder',
  head: 'Head',
  rightShoulder: 'Right Shoulder'
};

const CHINESE: DrawingTexts = {
  text: '文字',
  bars: (count) => `${count} 根 K 线`,
  duration: (ms) => span(ms, 'zh'),
  target: '止盈',
  stop: '止损',
  riskReward: '盈亏比',
  open: '持仓中',
  targetHit: '已止盈',
  stopped: '已止损',
  leftShoulder: '左肩',
  head: '头部',
  rightShoulder: '右肩'
};

const JAPANESE: DrawingTexts = {
  text: 'テキスト',
  bars: (count) => `${count}本`,
  duration: (ms) => span(ms, 'ja'),
  target: '利確',
  stop: '損切り',
  riskReward: 'RR比',
  open: '保有中',
  targetHit: '利確済み',
  stopped: '損切り済み',
  leftShoulder: '左肩',
  head: '頭',
  rightShoulder: '右肩'
};

const KOREAN: DrawingTexts = {
  text: '텍스트',
  bars: (count) => `캔들 ${count}개`,
  duration: (ms) => span(ms, 'ko'),
  target: '익절',
  stop: '손절',
  riskReward: '손익비',
  open: '보유 중',
  targetHit: '익절 완료',
  stopped: '손절 완료',
  leftShoulder: '왼쪽 어깨',
  head: '머리',
  rightShoulder: '오른쪽 어깨'
};

/**
 * The words of a locale's language: Chinese, Japanese or Korean for a `zh`, `ja` or `ko` locale,
 * English otherwise; `undefined` is the runtime's.
 */
export function textsFor(locale: string | null): DrawingTexts {
  const language = new Intl.NumberFormat(locale ?? undefined)
    .resolvedOptions()
    .locale.split('-')[0];
  return language === 'zh'
    ? CHINESE
    : language === 'ja'
      ? JAPANESE
      : language === 'ko'
        ? KOREAN
        : ENGLISH;
}
