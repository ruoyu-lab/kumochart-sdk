import type {
  ChartCommand,
  DragSession,
  HitTarget,
  InteractionHost,
  PaneResizeSession,
  Point,
  Region,
  ToolSession
} from '../interaction/types';
import { LEFT_SCALE, MAIN_PANE_ID, RIGHT_SCALE } from '../panes/pane-store';
import type { Frame } from '../render/frame';
import { clamp } from '../utils/math';
import type { ChartCore } from './chart-core';
import { crosshairAt } from './cursor';
import type { ChartPointerEvent } from './events';

const SEPARATOR_GRAB = 3;
const OUTSIDE: Region = { kind: 'outside' };

/**
 * Runs what the user's input does as a chart operation, whose events are dispatched after it.
 * Input handled once a listener destroyed the chart, such as the rest of a tap whose click
 * destroyed it, does nothing.
 */
function act(core: ChartCore, operation: () => void): void;
function act<T>(core: ChartCore, operation: () => T, ignored: T): T;
function act<T>(core: ChartCore, operation: () => T, ignored?: T): T | undefined {
  return core.isDestroyed ? ignored : core.run(operation);
}

/** Runs a command of the modules; Escape that none takes clears the selection. */
function command(core: ChartCore, name: ChartCommand): boolean {
  if (core.runCommand(name)) {
    return true;
  }

  if (name === 'escape' && core.objects.selection) {
    core.selectByUser(null);
    return true;
  }

  return false;
}

export function regionAt(frame: Frame, point: Point): Region {
  const { layout } = frame;

  for (const separator of layout.separators) {
    if (
      point.y >= separator.y - SEPARATOR_GRAB &&
      point.y <= separator.y + separator.height + SEPARATOR_GRAB
    ) {
      return { kind: 'separator', above: separator.above, below: separator.below };
    }
  }

  for (const pane of frame.panes) {
    if (point.y >= pane.plot.y && point.y < pane.plot.y + pane.plot.height) {
      if (point.x < 0) {
        return { kind: 'price-axis', paneId: pane.id, scale: LEFT_SCALE };
      }

      return point.x < layout.plotWidth
        ? { kind: 'plot', paneId: pane.id }
        : { kind: 'price-axis', paneId: pane.id, scale: RIGHT_SCALE };
    }
  }

  const axis = layout.timeAxis;

  if (
    axis &&
    point.y >= axis.y &&
    point.y < axis.y + axis.height &&
    point.x >= 0 &&
    point.x < layout.plotWidth
  ) {
    return { kind: 'time-axis' };
  }

  return { kind: 'outside' };
}

function pointerEvent(core: ChartCore, point: Point, target: HitTarget | null): ChartPointerEvent {
  const frame = core.frame();
  const region = regionAt(frame, point);
  const position = {
    x: point.x + frame.layout.leftAxisWidth,
    y: point.y,
    target: target ? { kind: target.kind, id: target.id, part: target.part } : null
  };

  const axisPane =
    region.kind === 'price-axis' ? frame.panes.find((pane) => pane.id === region.paneId) : null;

  // Over a price axis, the value at the pointer in the scale of that axis; no bar is there.
  if (region.kind === 'price-axis' && axisPane) {
    const scale = core.panes.findScale(region.paneId, region.scale)?.scale;
    const price = scale?.yToValue(point.y - axisPane.plot.y) ?? Number.NaN;
    return {
      ...position,
      area: region.kind,
      paneId: region.paneId,
      scaleId: region.scale,
      index: null,
      time: null,
      price: Number.isFinite(price) ? price : null
    };
  }

  const crosshair = crosshairAt(core, frame, point.x, point.y);
  return {
    ...position,
    area: region.kind,
    paneId: crosshair?.paneId ?? null,
    scaleId: null,
    index: crosshair?.index ?? null,
    time: crosshair?.time ?? null,
    price: crosshair?.price ?? null
  };
}

/**
 * Resizes the two panes beside a separator. The other panes keep the heights they are shown at,
 * which they take as theirs when the layout shrank them to fit: the separator follows the pointer
 * and nothing else moves.
 */
function paneResize(core: ChartCore, above: string, below: string): PaneResizeSession {
  const shown = new Map(core.frame().panes.map((pane) => [pane.id, pane.plot.height]));
  const stored = new Map(core.panes.list().map((entry) => [entry.id, entry.height]));
  const startAbove = shown.get(above) ?? 0;
  const total = startAbove + (shown.get(below) ?? 0);
  const min = Math.min(core.options.panes.minHeight, total / 2);
  let changed = false;

  // The main pane stretches, so only the other panes' heights are stored; a pane added since
  // the drag started keeps its own.
  const apply = (heights: ReadonlyMap<string, number>) => {
    act(core, () => {
      for (const entry of core.panes.list()) {
        if (entry.id !== MAIN_PANE_ID) {
          core.panes.update(entry.id, { height: heights.get(entry.id) ?? entry.height });
        }
      }

      core.invalidate();
    });
  };

  return {
    move: (deltaY) => {
      const nextAbove = clamp(startAbove + deltaY, min, total - min);
      apply(new Map([...shown, [above, nextAbove], [below, total - nextAbove]]));
      changed = true;
    },
    cancel: () => {
      if (changed) {
        apply(stored);
      }
    },
    end: () => {
      if (!changed) {
        return;
      }

      act(core, () => {
        for (const entry of core.panes.list()) {
          if (entry.id !== MAIN_PANE_ID && entry.height !== stored.get(entry.id)) {
            core.bus.emit('paneResize', { paneId: entry.id, height: entry.height });
          }
        }
      });
    }
  };
}

/** A drag whose steps run as chart operations, so their events are dispatched after each step. */
function dragOperations(core: ChartCore, session: DragSession): DragSession {
  return {
    move: (point, modifiers) => {
      act(core, () => {
        session.move(point, modifiers);
      });
    },
    end: () => {
      act(core, () => {
        session.end();
      });
    },
    cancel: () => {
      act(core, () => {
        session.cancel();
      });
    }
  };
}

/** The drawing tool, with each pointer step run as a chart operation. */
function toolOperations(core: ChartCore, tool: ToolSession): ToolSession {
  return {
    pointerDown: (point, modifiers, touch) => {
      act(core, () => {
        tool.pointerDown(point, modifiers, touch);
      });
    },
    pointerMove: (point, modifiers) => {
      act(core, () => {
        tool.pointerMove(point, modifiers);
      });
    },
    pointerUp: (point, modifiers, touch) => {
      act(core, () => {
        tool.pointerUp(point, modifiers, touch);
      });
    },
    doubleClick: (point) => {
      act(core, () => {
        tool.doubleClick(point);
      });
    },
    cancelPress: () => {
      act(core, () => {
        tool.cancelPress();
      });
    }
  };
}

/** Connects the input controller to the chart. */
export function createInteractionHost(core: ChartCore): InteractionHost {
  const options = () => core.options.interaction;
  // Input moves what is on screen: it reads the frame shown, which the move before made stale,
  // rather than building it again only to build it once more as it paints.
  const perform = (operation: () => void) => {
    act(core, () => {
      core.shownFrame();
      operation();
      core.invalidate();
    });
  };

  /**
   * Moves the bars as the user scrolls or zooms them; returns whether they moved. A view that
   * cannot move, at the oldest bar or the widest bars, builds no frame.
   */
  const moveTime = (move: () => void): boolean =>
    act(
      core,
      () => {
        core.shownFrame();
        const before = core.timeScale.state();
        move();
        const after = core.timeScale.state();
        const moved = after.barSpacing !== before.barSpacing || after.offset !== before.offset;

        if (moved) {
          core.noteMotion();
          core.invalidate();
        }

        return moved;
      },
      false
    );

  return {
    root: core.surface.root,
    enabled: (feature) => options()[feature],
    longPressMs: () => options().longPressMs,
    beforePaint: (task) => {
      core.beforePaint(() => {
        act(core, task);
      });
    },
    // Reads that may build a frame dispatch its events after them, as operations do.
    plotWidth: () => act(core, () => core.shownFrame().layout.plotWidth, 0),
    originX: () => act(core, () => core.shownFrame().layout.leftAxisWidth, 0),
    regionAt: (point) => act(core, () => regionAt(core.shownFrame(), point), OUTSIDE),
    setPointer: (point) => {
      act(core, () => {
        core.setPointer(point);
      });
    },
    magnify: (point) => {
      act(core, () => {
        core.magnify(point);
      });
    },
    hitTest: (point) => act(core, () => core.hitTest(point), null),
    hover: (target) => {
      act(core, () => {
        core.setHovered(target);
      });
    },
    hoverSeparator: (above) => {
      act(core, () => {
        core.setHoveredSeparator(above);
      });
    },
    legendAt: (point) => (core.options.legend.visible ? core.legend.at(point) : null),
    hoverLegend: (hit) => {
      act(core, () => {
        core.setLegendHover(hit);
      });
    },
    clickLegend: (hit) => {
      act(core, () => {
        if (hit.button !== null) {
          core.bus.emit('legendButtonClick', { item: hit.item, buttonId: hit.button });
        }
      });
    },
    beginDrag: (target, point, modifiers) => {
      const session = act(core, () => core.beginDrag(target, point, modifiers), null);
      return session ? dragOperations(core, session) : null;
    },
    activeTool: () => {
      const tool = core.activeTool();
      return tool ? toolOperations(core, tool) : null;
    },
    click: (point, target) => {
      act(core, () => {
        if (target?.part.startsWith('button:')) {
          core.bus.emit('buttonClick', {
            kind: target.kind,
            id: target.id,
            buttonId: target.part.slice('button:'.length)
          });
          return;
        }

        core.selectByUser(target ? { kind: target.kind, id: target.id } : null);

        if (core.bus.has('click')) {
          core.bus.emit('click', pointerEvent(core, point, target));
        }
      });
    },
    doubleClick: (point, region) => {
      act(core, () => {
        if (region.kind === 'price-axis' && options().axisScale) {
          core.panes.findScale(region.paneId, region.scale)?.scale.lead.resetAutoScale();
          core.invalidate();
        } else if (region.kind === 'time-axis' && options().axisScale) {
          core.timeScale.reset(core.options.timeScale.barSpacing);
          core.invalidate();
        }

        if (core.bus.has('doubleClick')) {
          core.bus.emit('doubleClick', pointerEvent(core, point, core.hitTest(point)));
        }
      });
    },
    contextMenu: (point, target) =>
      act(
        core,
        () => {
          // While a tool draws, a right click cancels it as Escape does, and opens no menu.
          if (core.activeTool()) {
            command(core, 'escape');
            return true;
          }

          if (!core.bus.has('contextMenu')) {
            return false;
          }

          core.bus.emit('contextMenu', pointerEvent(core, point, target));
          return true;
        },
        false
      ),
    scrollTime: (deltaX) =>
      moveTime(() => {
        core.timeScale.scrollBy(deltaX);
      }),
    zoomTime: (factor, pointerX) =>
      moveTime(() => {
        core.timeScale.zoom(factor, core.timeScale.zoomAnchor(pointerX));
      }),
    isAutoScale: (paneId) => core.panes.manualScales(paneId).length === 0,
    panPrice: (paneId, deltaY) => {
      perform(() => {
        core.panes.manualScales(paneId).forEach((scale) => {
          scale.pan(deltaY);
        });
      });
    },
    zoomPrice: (paneId, scale, factor, anchorY) => {
      perform(() => {
        const pane = core.shownFrame().panes.find((item) => item.id === paneId);

        if (pane) {
          core.panes.findScale(paneId, scale)?.scale.lead.zoom(factor, anchorY - pane.plot.y);
        }
      });
    },
    beginPaneResize: (above, below) => paneResize(core, above, below),
    command: (name) => act(core, () => command(core, name), false),
    editObject: (target) => act(core, () => core.objects.edit(target), false),
    scrollToRealTime: () => {
      moveTime(() => {
        core.timeScale.scrollToRealTime();
      });
    }
  };
}
