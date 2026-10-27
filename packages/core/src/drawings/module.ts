import type { ChartCore, CommandHandler } from '../chart/chart-core';
import { defineModule, type ChartModule } from '../chart/modules';
import type { StatePart } from '../chart/state';
import { RIGHT_SCALE } from '../panes/pane-store';
import { formatPaneValue } from '../render/frame';
import { fail } from '../utils/errors';
import { Registry } from '../utils/registry';
import { checkArray } from '../utils/validate';
import { createDrawingsApi, validateDefinition, type DrawingsApi } from './api';
import { DrawingStore } from './drawing-store';
import { DrawingsDomain, type DrawingsChangeReason } from './drawings-domain';
import { LINEAR_SCALE, LOG_SCALE } from './levels';
import { DRAWING_OPTIONS, type DrawingOptions } from './options';
import type { Drawing, DrawingInput, DrawingTypeDefinition } from './types';
import { drawingValues } from './values';

/** The user created, edited or removed drawings, or undid/redid such a change. */
export interface DrawingsChangeEvent {
  readonly reason: DrawingsChangeReason;
  /** Drawings created, edited or removed; empty for undo and redo, which may affect several. */
  readonly ids: readonly string[];
}

/**
 * The user ended the drawing tool: placed its drawing, or cancelled it with Escape or a right
 * click. Ending it through the API reports nothing: `cancelTool()`, another `startTool()`, or
 * what closes the editor of its text, such as `set()`, `loadState()` or removing its pane.
 */
export interface ToolEndEvent {
  /** The type of the tool. */
  readonly type: string;
  /**
   * Whether the user placed its drawing, which `drawingsChange` reported first. A type with
   * editable text ends once its editor closes: completed when the text was kept, not when it was
   * empty or dropped.
   */
  readonly completed: boolean;
}

export interface DrawingsEventMap {
  drawingsChange: DrawingsChangeEvent;
  toolEnd: ToolEndEvent;
}

export type DrawingsModule = ChartModule<{
  readonly api: { readonly drawings: DrawingsApi };
  readonly options: { readonly drawings: DrawingOptions };
  readonly events: DrawingsEventMap;
  readonly state: { readonly drawings: readonly Drawing[] };
}>;

/** Escape, Delete, undo, redo, Enter, copy and paste on drawings. */
function drawingCommands(core: ChartCore, domain: DrawingsDomain): CommandHandler {
  const events = core.events<DrawingsEventMap>();
  /**
   * The drawing selected, as marked: a tool placing a drawing marks only that one, and a hidden
   * drawing shows no mark.
   */
  const selected = (): string | null => {
    const selection = core.objects.selection;
    return selection?.kind === 'drawing' && !domain.activeTool() && domain.shown(selection.id)
      ? selection.id
      : null;
  };

  return (command) => {
    switch (command) {
      case 'escape': {
        const type = domain.activeToolType();

        if (type === null) {
          return false;
        }

        domain.cancelTool();
        events.emit('toolEnd', { type, completed: false });
        return true;
      }
      case 'delete': {
        const id = selected();

        if (id === null) {
          return false;
        }

        domain.remove(id, true);
        return true;
      }
      case 'undo':
      case 'redo':
        return domain.restore(command, true);
      case 'enter':
        return domain.finishTool();
      case 'copy':
        return domain.copy(selected());
      case 'paste':
        return domain.paste();
    }
  };
}

/** What a chart state keeps of the drawings, under `drawings`. */
function drawingsState(domain: DrawingsDomain): StatePart {
  const { store } = domain;
  return {
    key: 'drawings',
    save: () => store.list().map((entry) => store.info(entry)),
    prepare: (saved, panes) => {
      const drawings = (saved ?? []) as readonly DrawingInput[];
      checkArray('state.drawings', drawings);
      const staging = store.staging(drawings);
      drawings.forEach((drawing) => {
        staging.add(staging.create(drawing, (id) => panes.get(id) !== undefined));
      });
      return {
        apply: () => {
          domain.replace(staging.snapshot());
          domain.cancelTool();
        }
      };
    }
  };
}

/**
 * The drawings module: `chart.drawings`, the drawing tools and editing, with the drawing types
 * given, such as `drawings(allDrawings)` or `drawings([trendLine, horizontalLine])`. Other types
 * can be registered with `chart.drawings.register()`.
 */
export function drawings(definitions: readonly DrawingTypeDefinition[] = []): DrawingsModule {
  const types = new Set<string>();

  definitions.forEach((definition) => {
    validateDefinition(definition);
    const { type } = definition;

    if (types.has(type)) {
      fail(`drawings() is given the drawing type "${type}" twice.`);
    }

    types.add(type);
  });

  return defineModule({
    name: 'drawings',
    options: DRAWING_OPTIONS,
    install: (core) => {
      const registry = new Registry<DrawingTypeDefinition>(
        'drawing type',
        [],
        'Give it to the drawings module, or register it with chart.drawings.register().'
      );
      definitions.forEach((definition) => {
        registry.register(definition);
      });
      const events = core.events<DrawingsEventMap>();
      const domain = new DrawingsDomain(new DrawingStore(registry), {
        context: () => core.objectContext(),
        root: core.surface.root,
        repaint: (below) => {
          if (below) {
            core.invalidateLayers('scene', 'objects');
          } else {
            core.invalidateLayers('objects');
          }
        },
        paneExists: (id) => core.panes.get(id) !== undefined,
        prune: (user) => {
          if (core.objects.prune() && user) {
            core.bus.emit('selectionChange', { selection: core.objects.selection });
          }
        },
        formatValue: (pane, value) => formatPaneValue(core, pane, value),
        changed: (reason, ids) => {
          events.emit('drawingsChange', { reason, ids });
        },
        toolEnded: (type, completed) => {
          events.emit('toolEnd', { type, completed });
        },
        selected: (id) => {
          core.selectByUser(id === null ? null : { kind: 'drawing', id });
        }
      });
      core.objects.add(domain, 20);
      // A text being edited goes with the chart, rather than being kept once it is gone.
      core.hooks.destroyed.push(() => {
        domain.closeTextQuietly(false);
      });
      core.scenePainters.push((ctx, frame, pane, layer, pixelRatio) => {
        if (layer === 'below') {
          domain.paintBelow({ ...core.objectContext(frame), ctx, pixelRatio }, pane);
        }
      });
      core.tool = () => domain.activeTool();
      core.commands.push(drawingCommands(core, domain));
      core.values.provide(
        'drawing',
        drawingValues(
          {
            bars: core.bars,
            options: () => core.options,
            /**
             * Straight lines on the pane's scale: logarithmic, or linear for the other modes, which
             * only shift and stretch values. Read from the mode, not the fitted scale, so alerts
             * need no frame.
             */
            scaleOf: (paneId) =>
              core.panes.get(paneId)?.scales.get(RIGHT_SCALE)?.mode === 'log'
                ? LOG_SCALE
                : LINEAR_SCALE
          },
          domain.store
        )
      );
      core.paneOccupants.push({
        // Drawings go with their pane, so they keep none from being removed.
        occupants: () => [],
        removed: (paneId) => {
          domain.forgetPane(paneId);
        }
      });
      core.stateParts.push(drawingsState(domain));
      return { drawings: createDrawingsApi(core, domain) };
    }
  });
}
