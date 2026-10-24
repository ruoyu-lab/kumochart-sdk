import { checkColor } from '../canvas/color';
import { checkBoolean, checkFields, checkOneOf, fieldsOf } from '../utils/validate';
import { checkVolumeProfileOptions, checkShare } from './profile';
import type {
  VolumeProfile,
  VolumeProfileInput,
  VolumeProfileMode,
  VolumeProfilePlacement
} from './types';

const MODES: readonly VolumeProfileMode[] = ['visible', 'session'];
const PLACEMENTS: readonly VolumeProfilePlacement[] = ['left', 'right'];

const INPUT_FIELDS = fieldsOf<VolumeProfileInput>({
  id: true,
  mode: true,
  rows: true,
  valueArea: true,
  width: true,
  placement: true,
  upColor: true,
  downColor: true,
  pocColor: true,
  visible: true
});
export const PATCH_FIELDS = INPUT_FIELDS.filter((field) => field !== 'id');

function colorOf(path: string, value: string | undefined): string | null {
  return value === undefined ? null : checkColor(path, value);
}

/** A profile's settings from an input, checked, without its id. */
export function parseProfile(input: VolumeProfileInput, label: string): Omit<VolumeProfile, 'id'> {
  checkFields(label, input, INPUT_FIELDS);
  const { rows, valueArea } = checkVolumeProfileOptions(input, label);
  return {
    mode: checkOneOf(`${label}.mode`, input.mode, MODES),
    rows,
    valueArea,
    width: input.width === undefined ? null : checkShare(`${label}.width`, input.width),
    placement:
      input.placement === undefined
        ? 'right'
        : checkOneOf(`${label}.placement`, input.placement, PLACEMENTS),
    upColor: colorOf(`${label}.upColor`, input.upColor),
    downColor: colorOf(`${label}.downColor`, input.downColor),
    pocColor: colorOf(`${label}.pocColor`, input.pocColor),
    visible: input.visible === undefined ? true : checkBoolean(`${label}.visible`, input.visible)
  };
}

/** The input that gives a profile, as a chart state keeps it and a patch applies to it. */
export function inputOf(profile: VolumeProfile): VolumeProfileInput {
  const { width, upColor, downColor, pocColor } = profile;
  return {
    id: profile.id,
    mode: profile.mode,
    rows: profile.rows,
    valueArea: profile.valueArea,
    placement: profile.placement,
    visible: profile.visible,
    ...(width === null ? {} : { width }),
    ...(upColor === null ? {} : { upColor }),
    ...(downColor === null ? {} : { downColor }),
    ...(pocColor === null ? {} : { pocColor })
  };
}
