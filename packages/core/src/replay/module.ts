import { defineModule, type ChartModule } from '../chart/modules';
import { createReplayApi, type ReplayApi } from './api';
import { Replay, type ReplayEvent } from './replay';

export interface ReplayEventMap {
  /** Replay playback revealed data or reached the end. API calls on `chart.replay` emit nothing. */
  replay: ReplayEvent;
}

export type ReplayModule = ChartModule<{
  readonly api: { readonly replay: ReplayApi };
  readonly events: ReplayEventMap;
}>;

/** The replay module: `chart.replay`, replaying the bars one by one from a time in the past. */
export function replay(): ReplayModule {
  return defineModule({
    name: 'replay',
    install: (core) => {
      const events = core.events<ReplayEventMap>();
      const controller = new Replay({
        view: core.view,
        market: core.market,
        reveal: (time, follow) => {
          core.reveal(time, follow);
        },
        played: (step) => {
          core.run(() => {
            events.emit('replay', step());
          });
        }
      });
      core.hooks.dataCleared.push(() => {
        controller.reset();
      });
      core.hooks.destroyed.push(() => {
        controller.reset();
      });
      return { replay: createReplayApi(core, controller) };
    }
  });
}
