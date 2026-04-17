import { describe, expect, it } from "vitest";

import {
  INITIAL_CANVAS_TEXT_EDIT_STATE,
  reduceCanvasTextEdit,
  type CanvasTextEditAction,
  type CanvasTextEditEffect,
  type CanvasTextEditState
} from "../../packages/app/src/ui/canvas-panel/canvas-text-edit-machine";
import type { EditableTextTarget } from "../../packages/app/src/ui/canvas-panel/types";

const BASE_SOURCE = String.raw`\begin{tikzpicture}
  \node at (0,0) {$x$};
\end{tikzpicture}`;

function buildTarget(source: string, text: string): EditableTextTarget {
  const spanFrom = source.indexOf(text);
  if (spanFrom < 0) {
    throw new Error("target text not found in source");
  }
  return {
    sourceId: "node:0",
    sceneTextId: "scene-text:0",
    sourceSpan: { from: spanFrom, to: spanFrom + text.length },
    text,
    renderSourceText: text,
    paragraphId: null,
    layoutKind: "single-line",
    style: {
      align: "left",
      opacity: 1,
      rotate: 0,
      baselineShift: 0,
      textColor: "black",
      font: null,
      widthPt: null,
      anchor: "center",
      isMatrixCell: false,
      matrixCellAnchor: null
    },
    totalWidth: text.length,
    region: {
      key: "region-0",
      shape: "rect",
      sourceId: "node:0",
      targetId: "node:0",
      interactionMode: "text",
      sceneTextId: "scene-text:0",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      cx: 5,
      cy: 5,
      rotation: 0,
      contentWidth: 10,
      contentHeight: 10,
      transform: null
    }
  } as unknown as EditableTextTarget;
}

function reduceMany(state: CanvasTextEditState, actions: CanvasTextEditAction[]): { state: CanvasTextEditState; effectsCount: number } {
  let current = state;
  let effectsCount = 0;
  for (const action of actions) {
    const reduced = reduceCanvasTextEdit(current, action);
    current = reduced.state;
    effectsCount += reduced.effects.length;
  }
  return { state: current, effectsCount };
}

function buildTargetAtOccurrence(source: string, text: string, occurrence: number): EditableTextTarget {
  let searchFrom = 0;
  let found = -1;
  for (let i = 0; i <= occurrence; i += 1) {
    const index = source.indexOf(text, searchFrom);
    if (index < 0) {
      throw new Error(`target text occurrence ${occurrence} not found`);
    }
    found = index;
    searchFrom = index + 1;
  }
  return {
    ...buildTarget(source, text),
    sourceSpan: { from: found, to: found + text.length }
  };
}

function assertStateInvariants(state: CanvasTextEditState): void {
  if (!state.session) {
    expect(state.selectionOverlay).toBeNull();
    return;
  }
  expect(state.session.selectionStart).toBeGreaterThanOrEqual(0);
  expect(state.session.selectionEnd).toBeGreaterThanOrEqual(state.session.selectionStart);
  expect(state.session.selectionEnd).toBeLessThanOrEqual(state.session.text.length);
}

function seedRng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function randomInt(rng: () => number, min: number, maxInclusive: number): number {
  return min + Math.floor(rng() * (maxInclusive - min + 1));
}

describe("canvas text edit machine", () => {
  it("covers lifecycle start/select/type/delete/close", () => {
    const target = buildTarget(BASE_SOURCE, "$x$");
    const started = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: BASE_SOURCE,
      target,
      selectionStart: 0,
      selectionEnd: 3,
      historyMergeKey: "merge"
    }).state;
    expect(started.session?.text).toBe("$x$");

    const selected = reduceCanvasTextEdit(started, {
      type: "textarea_selection",
      selectionStart: 2,
      selectionEnd: 2
    }).state;
    expect(selected.session?.selectionStart).toBe(2);

    const typed = reduceCanvasTextEdit(selected, {
      type: "textarea_input_replace",
      nextText: "$x}$",
      selectionStart: 3,
      selectionEnd: 3
    });
    expect(typed.state.session?.text).toBe("$x}$");
    expect(typed.effects).toHaveLength(1);

    const deleted = reduceCanvasTextEdit(typed.state, {
      type: "textarea_delete",
      key: "Backspace",
      value: "$x}$",
      selectionStart: 3,
      selectionEnd: 3
    });
    expect(deleted.state.session?.text).toBe("$x$");

    const closed = reduceCanvasTextEdit(deleted.state, { type: "session_close" }).state;
    expect(closed.session).toBeNull();
  });

  it("drops stale async pointer/drag resolutions after input revision changes", () => {
    const target = buildTarget(BASE_SOURCE, "$x$");
    const down = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "pointer_down_provisional",
      source: BASE_SOURCE,
      target,
      pointerId: 1,
      selectionStart: 2,
      selectionEnd: 2,
      anchorOffset: 2,
      mode: "char",
      anchorLineRange: null,
      historyMergeKey: "merge"
    }).state;

    const afterInput = reduceCanvasTextEdit(down, {
      type: "textarea_input_replace",
      nextText: "$x}$",
      selectionStart: 3,
      selectionEnd: 3
    }).state;

    const stalePointer = reduceCanvasTextEdit(afterInput, {
      type: "pointer_resolved",
      requestRevision: down.asyncRequestRevision,
      baseInputRevision: down.inputRevision,
      sourceId: target.sourceId,
      sceneTextId: target.sceneTextId,
      pointerId: 1,
      selectionStart: 2,
      selectionEnd: 2,
      anchorOffset: 2,
      anchorLineRange: null
    }).state;

    expect(stalePointer.session?.selectionStart).toBe(3);
    expect(stalePointer.session?.selectionEnd).toBe(3);
  });

  it("keeps session text and selection stable through invalid source reconciles", () => {
    const target = buildTarget(BASE_SOURCE, "$x$");
    const initial = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: BASE_SOURCE,
      target,
      selectionStart: 2,
      selectionEnd: 2,
      historyMergeKey: "merge"
    }).state;

    const typed = reduceCanvasTextEdit(initial, {
      type: "textarea_input_replace",
      nextText: "$x}$",
      selectionStart: 3,
      selectionEnd: 3
    }).state;

    const invalidRecon = reduceCanvasTextEdit(typed, {
      type: "source_reconciled",
      source: String.raw`\begin{tikzpicture}
  \node at (0,0) {$x}$};
\end{tikzpicture}`,
      sourceRevision: 12,
      target: null
    }).state;

    expect(invalidRecon.session?.text).toBe("$x}$");
    expect(invalidRecon.session?.selectionStart).toBe(3);
  });

  it("reproduces exact regression sequence and returns to original source", () => {
    const target = buildTarget(BASE_SOURCE, "$x$");
    const { state } = reduceMany(INITIAL_CANVAS_TEXT_EDIT_STATE, [
      {
        type: "start_session",
        source: BASE_SOURCE,
        target,
        selectionStart: 2,
        selectionEnd: 2,
        historyMergeKey: "merge"
      },
      {
        type: "textarea_input_replace",
        nextText: "$x}$",
        selectionStart: 3,
        selectionEnd: 3
      },
      {
        type: "source_reconciled",
        source: String.raw`\begin{tikzpicture}
  \node at (0,0) {$x}$};
\end{tikzpicture}`,
        sourceRevision: 1,
        target: null
      },
      {
        type: "source_reconciled",
        source: String.raw`\begin{tikzpicture}
  \node at (0,0) {$x}$};
\end{tikzpicture}`,
        sourceRevision: 2,
        target: null
      },
      {
        type: "textarea_delete",
        key: "Backspace",
        value: "$x}$",
        selectionStart: 3,
        selectionEnd: 3
      }
    ]);

    expect(state.session?.text).toBe("$x$");
    expect(state.session?.workingSource).toBe(BASE_SOURCE);
    expect(state.session?.selectionStart).toBe(2);
    expect(state.session?.selectionEnd).toBe(2);
  });

  it("does not loop or oscillate on repeated source_reconciled", () => {
    const target = buildTarget(BASE_SOURCE, "$x$");
    let current = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: BASE_SOURCE,
      target,
      selectionStart: 2,
      selectionEnd: 2,
      historyMergeKey: "merge"
    }).state;

    for (let i = 0; i < 200; i += 1) {
      current = reduceCanvasTextEdit(current, {
        type: "source_reconciled",
        source: BASE_SOURCE,
        sourceRevision: i + 1,
        target
      }).state;
    }

    expect(current.session?.text).toBe("$x$");
    expect(current.session?.selectionStart).toBe(2);
    expect(current.sourceRevision).toBe(200);
  });

  it("enforces core invariants for selection bounds and session close cleanup", () => {
    const target = buildTarget(BASE_SOURCE, "$x$");
    let state = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "pointer_down_provisional",
      source: BASE_SOURCE,
      target,
      pointerId: 1,
      selectionStart: -100,
      selectionEnd: 999,
      anchorOffset: 2,
      mode: "char",
      anchorLineRange: null,
      historyMergeKey: "merge"
    }).state;
    assertStateInvariants(state);

    state = reduceCanvasTextEdit(state, {
      type: "textarea_selection",
      selectionStart: -500,
      selectionEnd: 500
    }).state;
    assertStateInvariants(state);

    state = reduceCanvasTextEdit(state, {
      type: "overlay_resolved",
      requestRevision: state.asyncRequestRevision,
      sourceId: target.sourceId,
      selectionStart: 0,
      selectionEnd: 0,
      overlay: {
        sourceId: target.sourceId,
        selectionStart: 0,
        selectionEnd: 0,
        caret: { left: 0, top: 0, height: 1 },
        rects: []
      }
    }).state;
    expect(state.selectionOverlay).not.toBeNull();
    state = reduceCanvasTextEdit(state, { type: "session_close" }).state;
    expect(state.session).toBeNull();
    expect(state.selectionOverlay).toBeNull();
    expect(state.dragSelection).toBeNull();
  });

  it("keeps text and selection unchanged for stale async responses", () => {
    const target = buildTarget(BASE_SOURCE, "$x$");
    const started = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "pointer_down_provisional",
      source: BASE_SOURCE,
      target,
      pointerId: 1,
      selectionStart: 2,
      selectionEnd: 2,
      anchorOffset: 2,
      mode: "char",
      anchorLineRange: null,
      historyMergeKey: "merge"
    }).state;
    const typed = reduceCanvasTextEdit(started, {
      type: "textarea_input_replace",
      nextText: "$x}$",
      selectionStart: 3,
      selectionEnd: 3
    }).state;
    const baselineText = typed.session?.text;
    const baselineSelection = {
      start: typed.session?.selectionStart,
      end: typed.session?.selectionEnd
    };

    const stalePointer = reduceCanvasTextEdit(typed, {
      type: "pointer_resolved",
      requestRevision: started.asyncRequestRevision,
      baseInputRevision: started.inputRevision,
      sourceId: target.sourceId,
      sceneTextId: target.sceneTextId,
      pointerId: 1,
      selectionStart: 0,
      selectionEnd: 0,
      anchorOffset: 0,
      anchorLineRange: null
    }).state;
    expect(stalePointer.session?.text).toBe(baselineText);
    expect(stalePointer.session?.selectionStart).toBe(baselineSelection.start);
    expect(stalePointer.session?.selectionEnd).toBe(baselineSelection.end);

    const staleDrag = reduceCanvasTextEdit(typed, {
      type: "drag_resolved",
      requestRevision: started.asyncRequestRevision,
      baseInputRevision: started.inputRevision,
      sourceId: target.sourceId,
      sceneTextId: target.sceneTextId,
      selectionStart: 0,
      selectionEnd: 0
    }).state;
    expect(staleDrag.session?.text).toBe(baselineText);
    expect(staleDrag.session?.selectionStart).toBe(baselineSelection.start);
    expect(staleDrag.session?.selectionEnd).toBe(baselineSelection.end);

    const staleOverlay = reduceCanvasTextEdit(typed, {
      type: "overlay_resolved",
      requestRevision: started.asyncRequestRevision,
      sourceId: target.sourceId,
      selectionStart: 0,
      selectionEnd: 0,
      overlay: {
        sourceId: target.sourceId,
        selectionStart: 0,
        selectionEnd: 0,
        caret: { left: 0, top: 0, height: 1 },
        rects: []
      }
    }).state;
    expect(staleOverlay.session?.text).toBe(baselineText);
    expect(staleOverlay.session?.selectionStart).toBe(baselineSelection.start);
    expect(staleOverlay.session?.selectionEnd).toBe(baselineSelection.end);
  });

  it("passes deterministic stateful fuzz without invariant violations", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const rng = seedRng(seed);
      let state = INITIAL_CANVAS_TEXT_EDIT_STATE;
      let sourceRevision = 0;
      const target = buildTarget(BASE_SOURCE, "$x$");

      for (let step = 0; step < 120; step += 1) {
        const roll = rng();
        const previous = state;
        let reduced:
          | { state: CanvasTextEditState; effects: CanvasTextEditEffect[] }
          | null = null;

        if (!state.session || roll < 0.08) {
          reduced = reduceCanvasTextEdit(state, {
            type: "start_session",
            source: state.session?.workingSource ?? BASE_SOURCE,
            target,
            selectionStart: randomInt(rng, -5, 8),
            selectionEnd: randomInt(rng, -5, 8),
            historyMergeKey: `merge-${seed}-${step}`
          });
        } else if (roll < 0.23) {
          const text = state.session.text;
          const insertAt = randomInt(rng, 0, text.length);
          const token = ["}", "$", "x", " "][randomInt(rng, 0, 3)]!;
          reduced = reduceCanvasTextEdit(state, {
            type: "textarea_input_replace",
            nextText: `${text.slice(0, insertAt)}${token}${text.slice(insertAt)}`,
            selectionStart: insertAt + token.length,
            selectionEnd: insertAt + token.length
          });
        } else if (roll < 0.35) {
          const text = state.session.text;
          const a = randomInt(rng, 0, text.length);
          const b = randomInt(rng, 0, text.length);
          reduced = reduceCanvasTextEdit(state, {
            type: "textarea_delete",
            key: rng() < 0.5 ? "Backspace" : "Delete",
            value: text,
            selectionStart: a,
            selectionEnd: b
          });
        } else if (roll < 0.48) {
          reduced = reduceCanvasTextEdit(state, {
            type: "textarea_selection",
            selectionStart: randomInt(rng, -10, 20),
            selectionEnd: randomInt(rng, -10, 20)
          });
        } else if (roll < 0.62) {
          reduced = reduceCanvasTextEdit(state, {
            type: "pointer_resolved",
            requestRevision: rng() < 0.75 ? state.asyncRequestRevision : Math.max(0, state.asyncRequestRevision - 1),
            baseInputRevision: rng() < 0.75 ? state.inputRevision : Math.max(0, state.inputRevision - 1),
            sourceId: state.session.sourceId,
            sceneTextId: state.session.sceneTextId,
            pointerId: 1,
            selectionStart: randomInt(rng, -5, 25),
            selectionEnd: randomInt(rng, -5, 25),
            anchorOffset: randomInt(rng, -5, 25),
            anchorLineRange: null
          });
        } else if (roll < 0.74) {
          reduced = reduceCanvasTextEdit(state, {
            type: "drag_resolved",
            requestRevision: rng() < 0.75 ? state.asyncRequestRevision : Math.max(0, state.asyncRequestRevision - 1),
            baseInputRevision: rng() < 0.75 ? state.inputRevision : Math.max(0, state.inputRevision - 1),
            sourceId: state.session.sourceId,
            sceneTextId: state.session.sceneTextId,
            selectionStart: randomInt(rng, -5, 25),
            selectionEnd: randomInt(rng, -5, 25)
          });
        } else if (roll < 0.86) {
          reduced = reduceCanvasTextEdit(state, {
            type: "overlay_resolved",
            requestRevision: rng() < 0.75 ? state.asyncRequestRevision : Math.max(0, state.asyncRequestRevision - 1),
            sourceId: state.session.sourceId,
            selectionStart: randomInt(rng, -5, 25),
            selectionEnd: randomInt(rng, -5, 25),
            overlay: {
              sourceId: state.session.sourceId,
              selectionStart: 0,
              selectionEnd: 0,
              caret: { left: 0, top: 0, height: 1 },
              rects: []
            }
          });
        } else if (roll < 0.95) {
          sourceRevision += 1;
          reduced = reduceCanvasTextEdit(state, {
            type: "source_reconciled",
            source: state.session.workingSource,
            sourceRevision,
            target: rng() < 0.7 ? target : null
          });
        } else {
          reduced = reduceCanvasTextEdit(state, { type: "session_close" });
        }

        state = reduced.state;
        assertStateInvariants(state);

        if (
          previous.session &&
          reduced.effects.length === 0 &&
          (roll >= 0.48 && roll < 0.86)
        ) {
          expect(state.session?.text).toBe(previous.session.text);
        }
      }
    }
  });

  it("patches the nearest matching repeated span deterministically", () => {
    const repeatedSource = String.raw`\begin{tikzpicture}
  \node at (0,0) {$x$};
  \node at (1,0) {$x$};
\end{tikzpicture}`;
    const secondTarget = buildTargetAtOccurrence(repeatedSource, "$x$", 1);
    const started = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
      type: "start_session",
      source: repeatedSource,
      target: secondTarget,
      selectionStart: 2,
      selectionEnd: 2,
      historyMergeKey: "merge"
    }).state;
    const driftedSource = repeatedSource.replace("\\node at (0,0)", "  \\node at (0,0)");
    const reconciled = reduceCanvasTextEdit(started, {
      type: "source_reconciled",
      source: driftedSource,
      sourceRevision: 1,
      target: null
    }).state;
    const reduced = reduceCanvasTextEdit(reconciled, {
      type: "textarea_input_replace",
      nextText: "$x}$",
      selectionStart: 3,
      selectionEnd: 3
    });
    expect(reduced.effects).toHaveLength(1);
    const [effect] = reduced.effects;
    expect(effect?.type).toBe("apply_source_patch");
    if (effect?.type === "apply_source_patch") {
      const firstOccurrence = driftedSource.indexOf("$x$");
      const secondOccurrence = driftedSource.indexOf("$x$", firstOccurrence + 1);
      expect(effect.previousSpan.from).toBe(secondOccurrence);
      expect(effect.previousSpan.from).not.toBe(firstOccurrence);
    }
  });

  it("round-trips through invalid partially typed math states without corruption", () => {
    const cases = [
      {
        name: "simple inline math with unmatched brace",
        initialText: "$x$",
        insertChars: ["}", "{", "$"]
      },
      {
        name: "fraction with partially typed braces",
        initialText: "$\\frac{a}{b}$",
        insertChars: ["}", "{", "c"]
      },
      {
        name: "sqrt with dangling root body",
        initialText: "$\\sqrt{x}$",
        insertChars: ["}", "{", "y"]
      }
    ] as const;

    for (const testCase of cases) {
      const baseSource = `\\begin{tikzpicture}\n  \\node at (0,0) {${testCase.initialText}};\n\\end{tikzpicture}`;
      const target = buildTarget(baseSource, testCase.initialText);
      let state = reduceCanvasTextEdit(INITIAL_CANVAS_TEXT_EDIT_STATE, {
        type: "start_session",
        source: baseSource,
        target,
        selectionStart: Math.max(0, testCase.initialText.length - 1),
        selectionEnd: Math.max(0, testCase.initialText.length - 1),
        historyMergeKey: `merge-${testCase.name}`
      }).state;

      let sourceRevision = 0;
      for (const ch of testCase.insertChars) {
        const current = state.session?.text ?? testCase.initialText;
        const caret = state.session?.selectionStart ?? Math.max(0, current.length - 1);
        const nextText = `${current.slice(0, caret)}${ch}${current.slice(caret)}`;
        const nextCaret = caret + ch.length;
        state = reduceCanvasTextEdit(state, {
          type: "textarea_input_replace",
          nextText,
          selectionStart: nextCaret,
          selectionEnd: nextCaret
        }).state;
        sourceRevision += 1;
        state = reduceCanvasTextEdit(state, {
          type: "source_reconciled",
          source: `\\begin{tikzpicture}\n  \\node at (0,0) {${nextText}};\n\\end{tikzpicture}`,
          sourceRevision,
          target: null
        }).state;
      }

      for (let i = 0; i < testCase.insertChars.length; i += 1) {
        const value = state.session?.text ?? "";
        const caret = state.session?.selectionStart ?? 0;
        state = reduceCanvasTextEdit(state, {
          type: "textarea_delete",
          key: "Backspace",
          value,
          selectionStart: caret,
          selectionEnd: caret
        }).state;
        sourceRevision += 1;
        state = reduceCanvasTextEdit(state, {
          type: "source_reconciled",
          source: state.session?.workingSource ?? baseSource,
          sourceRevision,
          target: null
        }).state;
      }

      expect(state.session?.text, testCase.name).toBe(testCase.initialText);
      expect(state.session?.workingSource, testCase.name).toBe(baseSource);
      expect(state.session?.selectionStart, testCase.name).toBe(Math.max(0, testCase.initialText.length - 1));
      expect(state.session?.selectionEnd, testCase.name).toBe(Math.max(0, testCase.initialText.length - 1));
    }
  });
});
