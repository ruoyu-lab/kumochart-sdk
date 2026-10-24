import type { ChartCore } from '../chart/chart-core';
import { fail } from '../utils/errors';
import {
  checkArray,
  checkBoolean,
  checkFields,
  checkNumber,
  checkObject,
  checkString,
  fieldsOf
} from '../utils/validate';
import { DrawingStore } from './drawing-store';
import type { DrawingsDomain, ToolOptions } from './drawings-domain';
import { LINEAR_SCALE, levelContext } from './levels';
import { DEFAULT_FIELDS, resolveStyle, typeStyle } from './style';
import type {
  Drawing,
  DrawingBounds,
  DrawingField,
  DrawingInput,
  DrawingStyle,
  DrawingTypeDefinition
} from './types';

export interface DrawingUpdateOptions {
  /**
   * Makes the update part of the undoable step of the update before, when that one changed the
   * same drawing with the same key and nothing undoable came between: the keystrokes of one edit
   * of a field, or the moves of one drag of a slider, are then undone at once. Give each edit a
   * key of its own, e.g. the field and a count of the edits.
   */
  merge?: string;
}

const UPDATE_OPTION_FIELDS = fieldsOf<DrawingUpdateOptions>({ merge: true });

export interface DrawingsApi {
  /**
   * Replaces every drawing (e.g. when loading a saved layout) and clears the undo history. An
   * invalid input throws and changes nothing.
   */
  set(drawings: readonly DrawingInput[]): void;
  /**
   * Adds a drawing as an undoable step and returns its id: the one it has, or one the chart
   * numbers for it.
   */
  add(drawing: DrawingInput): string;
  /**
   * Changes a drawing as an undoable step, or as part of the step before with `merge`. Points are
   * set exactly as given, without the magnet; style fields merge into the drawing's own.
   */
  update(
    id: string,
    patch: Omit<Partial<DrawingInput>, 'id' | 'type'>,
    options?: DrawingUpdateOptions
  ): void;
  /** Removes a drawing as an undoable step. Throws for an unknown id. */
  remove(id: string): void;
  /** Removes every drawing as an undoable step. */
  clear(): void;
  /** The drawing of an id, or `null`. */
  get(id: string): Drawing | null;
  list(): Drawing[];
  /**
   * Throws the `ChartError` that `set()` would throw for a drawing, without adding it: its type,
   * pane, points, style, text and timeframes. Checks drawings kept elsewhere before showing them.
   */
  validate(drawing: DrawingInput): void;
  /**
   * Adds a copy of a drawing a few bars to the right, as pasting does, as an undoable step and
   * returns its id.
   */
  duplicate(id: string): string;
  /**
   * The area a drawing covers in chart coordinates (CSS pixels from the chart's top-left corner),
   * clipped to its pane, or `null` while it is hidden or off screen. Use it to place a toolbar
   * next to the selected drawing; it moves whenever the view, the data or the drawing changes.
   */
  bounds(id: string): DrawingBounds | null;
  /**
   * Keys of the lines of a drawing that alerts can watch with `{ kind: 'drawing', id, level }`,
   * e.g. `['top', 'bottom']` for a rectangle; empty for types without lines.
   */
  levels(id: string): string[];
  /**
   * Opens the in-place text editor of a drawing whose type has editable text (`text`); returns
   * whether it opened. Double-clicking such a drawing does the same.
   */
  editText(id: string): boolean;
  /**
   * Lets the user place a drawing of `type`, in place of the active tool. The tool ends when the
   * drawing is placed (`drawingsChange` with reason `create`, then `toolEnd`), on Escape or a
   * right click (`toolEnd`, not completed), or with `cancelTool()`, which reports nothing; with
   * `continuous` it stays active for the next drawing.
   */
  startTool(type: string, options?: ToolOptions): void;
  cancelTool(): void;
  /** Type of the active tool, or `null`. */
  activeTool(): string | null;
  /** The style the tool of a type gives the drawings the user places, as `setToolStyle()` set it. */
  toolStyle(type: string): Partial<DrawingStyle>;
  /**
   * Sets the style the tool of a type gives the drawings the user places from now on, under the
   * style `startTool()` is given, e.g. the style the user last chose; `null` forgets it. The
   * drawings keep it as their own style, so changing it later leaves them as they are.
   */
  setToolStyle(type: string, style: Partial<DrawingStyle> | null): void;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Adds a drawing type to this chart, named by its `type`. */
  register(definition: DrawingTypeDefinition): void;
  /**
   * Removes a drawing type. Fails while drawings of it are on the chart or its tool is active;
   * copies of them in the undo history are forgotten, and the text of one being placed dropped.
   */
  unregister(type: string): void;
  /** Every drawing type the chart has. */
  types(): string[];
  /** The definition of a type, or `null` for an unknown type. */
  definition(type: string): Readonly<DrawingTypeDefinition> | null;
  /** What a form of a type's settings offers: style fields, and `text` when it paints its text. */
  fields(type: string): DrawingField[];
  /**
   * The style a drawing of a type takes where its own leaves a field out: the chart's defaults
   * and the type's, in the current theme. A form shows it for the fields a drawing does not set.
   */
  defaultStyle(type: string): DrawingStyle;
}

export function validateDefinition(definition: DrawingTypeDefinition): void {
  checkObject('drawing type definition', definition);
  checkString('drawing type definition type', definition.type);
  checkNumber('definition.points', definition.points, { min: 0, max: 20, integer: true });

  if (typeof definition.paint !== 'function' || typeof definition.hitTest !== 'function') {
    fail('A drawing type definition needs paint() and hitTest() functions.');
  }

  if (definition.mainPane !== undefined) {
    checkBoolean('definition.mainPane', definition.mainPane);
  }

  if (definition.freehand && definition.points !== 0) {
    fail('A drawing type drawn by hand (definition.freehand) needs points: 0.');
  }

  if (definition.textAnchor !== undefined) {
    checkNumber('definition.textAnchor', definition.textAnchor, {
      min: 0,
      max: Math.max(0, definition.points - 1),
      integer: true
    });
  }

  if (definition.place !== undefined) {
    checkNumber('definition.place', definition.place, {
      min: 1,
      max: Math.max(1, definition.points - 1),
      integer: true
    });

    if (definition.points === 0 || typeof definition.complete !== 'function') {
      fail('A drawing type with definition.place needs a fixed number of points and complete().');
    }
  }

  if (definition.fields !== undefined && !Array.isArray(definition.fields)) {
    fail('definition.fields must be an array of style fields when given.');
  }

  for (const name of [
    'paintBelow',
    'defaultStyle',
    'handles',
    'moveHandle',
    'axisMarks',
    'bounds',
    'complete',
    'levels'
  ] as const) {
    if (definition[name] !== undefined && typeof definition[name] !== 'function') {
      fail(`definition.${name} must be a function when given.`);
    }
  }
}

export function createDrawingsApi(core: ChartCore, domain: DrawingsDomain): DrawingsApi {
  const store = domain.store;
  const paneExists = (id: string) => core.panes.get(id) !== undefined;
  /** Changes the drawings as the API does: undoably, reporting nothing. */
  const change = (operation: () => void, merge?: string) => {
    core.run(() => {
      domain.change(operation, merge === undefined ? {} : { merge });
    });
  };

  return {
    set: (drawings) => {
      core.run(() => {
        checkArray('drawings', drawings);
        const staging = store.staging(drawings);
        drawings.forEach((drawing) => {
          staging.add(staging.create(drawing, paneExists));
        });
        domain.replace(staging.snapshot());
      });
    },
    add: (drawing) =>
      core.run(() => {
        const entry = store.create(drawing, paneExists);
        change(() => {
          store.add(entry);
        });
        return entry.id;
      }),
    update: (id, patch, options = {}) => {
      core.run(() => {
        store.require(id);
        checkFields('options', options, UPDATE_OPTION_FIELDS);
        const merge =
          options.merge === undefined
            ? undefined
            : JSON.stringify([id, checkString('options.merge', options.merge)]);
        change(() => {
          store.update(id, patch, paneExists);
        }, merge);
      });
    },
    remove: (id) => {
      core.run(() => {
        domain.remove(id, false);
      });
    },
    clear: () => {
      change(() => {
        store.restore([]);
      });
    },
    get: (id) => {
      const entry = store.get(id);
      return entry ? store.info(entry) : null;
    },
    list: () => store.list().map((entry) => store.info(entry)),
    validate: (drawing) => {
      new DrawingStore(store.registry).create(drawing, paneExists);
    },
    duplicate: (id) => core.run(() => domain.duplicate(id)),
    bounds: (id) => domain.bounds(id),
    levels: (id) => {
      const entry = store.get(id) ?? fail(`Unknown drawing "${id}".`);
      const style = resolveStyle(core.options, entry.definition, entry.style);
      // Keys do not depend on the scale.
      return (
        entry.definition.levels?.(
          entry.points,
          LINEAR_SCALE,
          style,
          levelContext(core.bars, core.bars)
        ) ?? []
      ).map((level) => level.key);
    },
    editText: (id) => core.run(() => domain.editText(id)),
    startTool: (type, options = {}) => {
      core.run(() => {
        domain.startTool(type, options);
      });
    },
    cancelTool: () => {
      core.run(() => {
        domain.cancelTool();
      });
    },
    activeTool: () => domain.activeToolType(),
    toolStyle: (type) => domain.toolStyle(type),
    setToolStyle: (type, style) => {
      core.run(() => {
        domain.setToolStyle(type, style);
      });
    },
    undo: () => core.run(() => domain.restore('undo', false)),
    redo: () => core.run(() => domain.restore('redo', false)),
    canUndo: () => domain.history.canUndo,
    canRedo: () => domain.history.canRedo,
    register: (definition) => {
      core.run(() => {
        validateDefinition(definition);
        store.registry.register(definition);
        core.bus.emit('typesChange', { kind: 'drawing', type: definition.type, registered: true });
      });
    },
    unregister: (type) => {
      core.run(() => {
        store.registry.require(type);

        if (store.hasType(type)) {
          fail(`Drawings of type "${type}" are on the chart; remove them first.`);
        }

        if (domain.activeToolType() === type) {
          fail(`The "${type}" tool is active; cancel it first.`);
        }

        store.registry.unregister(type);
        domain.forgetType(type);
        core.bus.emit('typesChange', { kind: 'drawing', type, registered: false });
      });
    },
    types: () => store.registry.types(),
    definition: (type) => store.registry.get(type) ?? null,
    fields: (type) => [...(store.registry.require(type).fields ?? DEFAULT_FIELDS)],
    defaultStyle: (type) => structuredClone(typeStyle(core.options, store.registry.require(type)))
  };
}
