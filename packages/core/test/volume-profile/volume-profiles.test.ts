import { describe, expect, it } from 'vitest';
import { drawings, trendLine } from '../../src/drawings';
import { volumeProfiles, type VolumeProfileInput } from '../../src/volume-profile';
import { createModularChart, createTestChart, type Chart } from '../helpers/chart';
import { count, DAY_START, HOUR, hourly } from './helpers';

function hourlyChart(days: number): Chart {
  const chart = createTestChart({ calendar: { timeZone: 'UTC' }, timeScale: { barSpacing: 6 } });
  chart.data.set(hourly(days * 24), { interval: '1h' });
  chart.timeScale.fitContent();
  return chart;
}

const rects = (chart: Chart) => count(chart, 'scene', 'fillRect');

describe('volume profiles', () => {
  it('are added, changed and removed, painted under the bars, two rects a row', () => {
    const chart = hourlyChart(3);
    const without = rects(chart);
    const id = chart.volumeProfiles.add({ mode: 'visible', rows: 20 });

    expect(id).toBe('volume-profile-1');
    expect(chart.volumeProfiles.get(id)).toEqual({
      id,
      mode: 'visible',
      rows: 20,
      valueArea: 0.7,
      width: null,
      placement: 'right',
      upColor: null,
      downColor: null,
      pocColor: null,
      visible: true
    });
    expect(rects(chart) - without).toBe(40);

    chart.volumeProfiles.update(id, { rows: 10, placement: 'left' });
    expect(chart.volumeProfiles.get(id)).toMatchObject({ rows: 10, placement: 'left' });
    expect(rects(chart) - without).toBe(20);

    chart.volumeProfiles.update(id, { visible: false });
    expect(rects(chart)).toBe(without);

    chart.volumeProfiles.remove(id);
    expect(chart.volumeProfiles.list()).toEqual([]);
    expect(chart.volumeProfiles.get(id)).toBeNull();
    expect(rects(chart)).toBe(without);
  });

  it('paint one profile per trading day of the chart’s calendar', () => {
    const chart = hourlyChart(3);
    const without = rects(chart);
    chart.volumeProfiles.add({ mode: 'session', rows: 12 });

    expect(rects(chart) - without).toBe(3 * 24);

    // Days start at 12:00 with this calendar, so the hours fall into four days.
    chart.applyOptions({ calendar: { dayStart: '12:00' } });
    expect(rects(chart) - without).toBe(4 * 24);
  });

  it('count only the bars a running replay has revealed', () => {
    const chart = hourlyChart(3);
    const id = chart.volumeProfiles.add({ mode: 'session', rows: 12, visible: false });
    /** The rects the profiles add to the scene. */
    const added = () => {
      chart.volumeProfiles.update(id, { visible: false });
      const without = rects(chart);
      chart.volumeProfiles.update(id, { visible: true });
      return rects(chart) - without;
    };

    chart.replay.start(DAY_START + 30 * HOUR);
    chart.timeScale.fitContent();
    // The first day and seven hours of the second.
    expect(added()).toBe(2 * 24);

    chart.replay.stop();
    chart.timeScale.fitContent();
    expect(added()).toBe(3 * 24);
  });

  it('take generated ids never given before, or their own', () => {
    const chart = hourlyChart(1);

    expect(chart.volumeProfiles.add({ mode: 'visible' })).toBe('volume-profile-1');
    expect(chart.volumeProfiles.add({ id: 'days', mode: 'session' })).toBe('days');
    chart.volumeProfiles.remove('volume-profile-1');
    expect(chart.volumeProfiles.add({ mode: 'visible' })).toBe('volume-profile-2');
    expect(chart.volumeProfiles.list().map((profile) => profile.id)).toEqual([
      'days',
      'volume-profile-2'
    ]);
  });

  it('give copies, and keep a width left out at the default of the mode', () => {
    const chart = hourlyChart(1);
    const id = chart.volumeProfiles.add({ mode: 'visible', upColor: '#0a0' });
    const profile = chart.volumeProfiles.get(id) as { rows: number };
    profile.rows = 3;

    expect(chart.volumeProfiles.get(id)?.rows).toBe(24);

    chart.volumeProfiles.update(id, { mode: 'session' });
    expect(chart.volumeProfiles.get(id)).toMatchObject({
      mode: 'session',
      width: null,
      upColor: '#0a0'
    });
  });

  it('check what they are given, and change nothing when they fail', () => {
    const chart = hourlyChart(1);
    const profiles = chart.volumeProfiles;
    profiles.add({ id: 'a', mode: 'visible' });

    expect(() => profiles.add({ mode: 'weekly' as 'visible' })).toThrow(
      'volumeProfile.mode must be one of "visible", "session", received "weekly".'
    );
    expect(() => profiles.add({} as VolumeProfileInput)).toThrow(
      'volumeProfile.mode must be one of "visible", "session", received undefined.'
    );
    expect(() => profiles.add({ mode: 'visible', rows: 0 })).toThrow(
      'volumeProfile.rows must be at least 1, received 0.'
    );
    expect(() => profiles.add({ mode: 'visible', valueArea: 0 })).toThrow(
      'volumeProfile.valueArea must be greater than 0'
    );
    expect(() => profiles.add({ mode: 'visible', width: 2 })).toThrow(
      'volumeProfile.width must be at most 1, received 2.'
    );
    expect(() => profiles.add({ mode: 'visible', placement: 'top' as 'left' })).toThrow(
      'volumeProfile.placement must be one of "left", "right"'
    );
    expect(() => profiles.add({ mode: 'visible', pocColor: '' })).toThrow(
      'volumeProfile.pocColor must be a non-empty string'
    );
    expect(() => profiles.add({ mode: 'visible', visible: 1 as never })).toThrow(
      'volumeProfile.visible must be a boolean'
    );
    expect(() => profiles.add({ id: 'a', mode: 'session' })).toThrow(
      'A volume profile with id "a" already exists.'
    );
    expect(() => {
      profiles.update('a', { rows: -1 });
    }).toThrow('volumeProfile.rows must be at least 1');
    expect(() => {
      profiles.update('missing', {});
    }).toThrow('Unknown volume profile "missing".');
    expect(() => {
      profiles.remove('missing');
    }).toThrow('Unknown volume profile "missing".');
    expect(profiles.list()).toEqual([expect.objectContaining({ id: 'a', rows: 24 })]);
    // The failed inputs took no generated id.
    expect(profiles.add({ mode: 'visible' })).toBe('volume-profile-1');
  });

  it('are kept in the chart’s state and restored with it', () => {
    const chart = hourlyChart(2);
    chart.volumeProfiles.add({ mode: 'visible' });
    chart.volumeProfiles.add({
      id: 'days',
      mode: 'session',
      rows: 12,
      width: 0.5,
      pocColor: '#f0a',
      visible: false
    });
    const state = chart.saveState();

    expect(state.volumeProfiles).toEqual([
      {
        id: 'volume-profile-1',
        mode: 'visible',
        rows: 24,
        valueArea: 0.7,
        placement: 'right',
        visible: true
      },
      {
        id: 'days',
        mode: 'session',
        rows: 12,
        valueArea: 0.7,
        placement: 'right',
        visible: false,
        width: 0.5,
        pocColor: '#f0a'
      }
    ]);

    const other = hourlyChart(2);
    other.volumeProfiles.add({ id: 'gone', mode: 'visible' });
    other.loadState(JSON.parse(JSON.stringify(state)) as typeof state);
    expect(other.volumeProfiles.list()).toEqual(chart.volumeProfiles.list());
    expect(other.volumeProfiles.add({ mode: 'visible' })).toBe('volume-profile-2');
  });

  it('reject a state with a wrong profile, and leave none of a state without them', () => {
    const chart = hourlyChart(1);
    chart.volumeProfiles.add({ id: 'kept', mode: 'visible' });
    const state = chart.saveState();

    expect(() => {
      chart.loadState({ ...state, volumeProfiles: [{ mode: 'weekly' }] });
    }).toThrow('state.volumeProfiles[0].mode must be one of "visible", "session"');
    expect(() => {
      chart.loadState({
        ...state,
        volumeProfiles: [
          { id: 'twice', mode: 'visible' },
          { id: 'twice', mode: 'session' }
        ]
      });
    }).toThrow('A volume profile with id "twice" already exists.');
    expect(() => {
      chart.loadState({ ...state, volumeProfiles: 'all' });
    }).toThrow('state.volumeProfiles must be an array');
    expect(chart.volumeProfiles.list().map((profile) => profile.id)).toEqual(['kept']);

    const without = Object.fromEntries(
      Object.entries(state).filter(([key]) => key !== 'volumeProfiles')
    ) as typeof state;
    chart.loadState(without);
    expect(chart.volumeProfiles.list()).toEqual([]);
  });

  it('are a module of their own, which a chart without it lacks', () => {
    const chart = createModularChart({ modules: [volumeProfiles(), drawings([trendLine])] });
    const core = createModularChart({});

    expect(chart.modules()).toEqual(['volumeProfiles', 'drawings']);
    expect(chart.drawings.types()).toEqual(['trend-line']);
    expect('volumeProfiles' in core).toBe(false);
    expect('volumeProfiles' in core.saveState()).toBe(false);

    chart.data.set(hourly(24), { interval: '1h' });
    expect(chart.volumeProfiles.add({ mode: 'session' })).toBe('volume-profile-1');
    expect(() => {
      core.loadState(chart.saveState());
    }).toThrow('The state has "volumeProfiles", which no module of the chart keeps.');
  });
});
