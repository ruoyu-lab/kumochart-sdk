// The words of the library's indicators in English, Chinese, Japanese and Korean.
import type { IndicatorTexts } from './texts';
import { en } from './built-in-texts/en';
import { ja } from './built-in-texts/ja';
import { ko } from './built-in-texts/ko';
import { zh } from './built-in-texts/zh';

/**
 * The words of the library's indicators: their full names in English, Chinese, Japanese and Korean,
 * and the labels of their outputs, parameters and options in the last three. Given to the module,
 * the legend and `valuesAt()` follow the chart's locale:
 *
 * ```ts
 * indicators(allIndicators, { texts: [indicatorTexts] });
 * ```
 */
export const indicatorTexts: IndicatorTexts = { en, zh, ja, ko };
