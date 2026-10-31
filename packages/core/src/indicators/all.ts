import { ALMA, BBI, EMA, HMA, KAMA, MA, SMMA, VWMA, WMA } from './definitions/averages';
import { BOLL, DC, KC } from './definitions/channels';
import { BBP, BBW, HV, MASS } from './definitions/dispersion';
import {
  BIAS,
  BRAR,
  CCI,
  DPO,
  FISHER,
  KDJ,
  MACD,
  MTM,
  PSY,
  ROC,
  RSI,
  STOCH,
  STOCHRSI,
  WR
} from './definitions/momentum';
import {
  AO,
  BOP,
  CMO,
  COPPOCK,
  CRSI,
  KST,
  PPO,
  RVGI,
  SMI,
  TSI,
  UO
} from './definitions/oscillators';
import { ADR, PIVOTS, PREVHLC } from './definitions/periods';
import { RVOL } from './definitions/relative-volume';
import { SESSIONS } from './definitions/sessions';
import { ASI, CR } from './definitions/strength';
import { AROON, CHANDELIER, DMA, DMI, ICHIMOKU, SAR, SUPERTREND, TRIX } from './definitions/trend';
import { ATR, CHOP, STD } from './definitions/volatility';
import { CMF, EMV, MFI, OBV, VOL, VR, VWAP } from './definitions/volume';
import { AD, CHAIKINOSC, EFI, KVO, PVT, VO, WVAD } from './definitions/volume-flow';
import { ALLIGATOR, FRACTALS } from './definitions/williams';
import { ENVELOPE, MIKE } from './definitions/envelopes';
import { DEMA, LSMA, MCGINLEY, RIBBON, TEMA } from './definitions/smoothers';
import { CKSTOP, VSTOP } from './definitions/stops';
import { PIVOTHL, ZIGZAG } from './definitions/swings';
import { VORTEX } from './definitions/vortex';
import type { IndicatorDefinition } from './types';

/**
 * Every indicator type of the library, for `indicators(allIndicators)`. Listed one by one, so that an
 * application picking a few ships only those.
 */
export const allIndicators: readonly IndicatorDefinition[] = [
  MA,
  EMA,
  SMMA,
  BOLL,
  ICHIMOKU,
  VOL,
  MACD,
  RSI,
  KDJ,
  WR,
  CCI,
  ROC,
  BIAS,
  OBV,
  VR,
  EMV,
  MFI,
  ATR,
  STD,
  DMI,
  VWAP,
  SAR,
  SUPERTREND,
  KC,
  DC,
  WMA,
  HMA,
  KAMA,
  ALMA,
  VWMA,
  BBI,
  DMA,
  TRIX,
  AROON,
  CHANDELIER,
  STOCH,
  STOCHRSI,
  FISHER,
  MTM,
  DPO,
  PSY,
  BRAR,
  CMF,
  CHOP,
  ALLIGATOR,
  FRACTALS,
  PIVOTS,
  PREVHLC,
  ADR,
  SESSIONS,
  AD,
  VO,
  RVOL,
  CHAIKINOSC,
  EFI,
  KVO,
  PVT,
  WVAD,
  HV,
  MASS,
  BBW,
  BBP,
  AO,
  PPO,
  CMO,
  UO,
  KST,
  COPPOCK,
  TSI,
  SMI,
  RVGI,
  BOP,
  CRSI,
  ASI,
  CR,
  DEMA,
  TEMA,
  LSMA,
  MCGINLEY,
  RIBBON,
  ENVELOPE,
  VSTOP,
  CKSTOP,
  VORTEX,
  PIVOTHL,
  MIKE,
  ZIGZAG
];
