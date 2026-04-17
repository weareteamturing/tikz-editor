import type { Span } from "tikz-editor/ast/types";
import { replaceSpan } from "tikz-editor/edit/patch";

import type { EditableTextTarget, TextEditingSession, TextSelectionOverlay } from "./types";
import { clamp } from "./geometry";

export type CanvasTextLineRange = {
  start: number;
  end: number;
};

export type CanvasTextSelectionMode = "char" | "word" | "line";

export type CanvasTextSelectionDragState = {
  pointerId: number;
  sourceId: string;
  sceneTextId: string;
  anchorOffset: number;
  mode: CanvasTextSelectionMode;
  anchorLineRange: CanvasTextLineRange | null;
};

export type CanvasTextEditState = {
  session: TextEditingSession | null;
  selectionOverlay: TextSelectionOverlay | null;
  dragSelection: CanvasTextSelectionDragState | null;
  inputRevision: number;
  asyncRequestRevision: number;
  sourceRevision: number;
};

export type CanvasTextEditAction =
  | {
      type: "start_session";
      target: EditableTextTarget;
      source: string;
      selectionStart: number;
      selectionEnd: number;
      historyMergeKey: string;
    }
  | {
      type: "pointer_down_provisional";
      target: EditableTextTarget;
      source: string;
      pointerId: number;
      selectionStart: number;
      selectionEnd: number;
      anchorOffset: number;
      mode: CanvasTextSelectionMode;
      anchorLineRange: CanvasTextLineRange | null;
      historyMergeKey: string;
    }
  | {
      type: "pointer_resolved";
      requestRevision: number;
      baseInputRevision: number;
      sourceId: string;
      sceneTextId: string;
      pointerId: number;
      selectionStart: number;
      selectionEnd: number;
      anchorOffset: number;
      anchorLineRange: CanvasTextLineRange | null;
    }
  | {
      type: "drag_resolved";
      requestRevision: number;
      baseInputRevision: number;
      sourceId: string;
      sceneTextId: string;
      selectionStart: number;
      selectionEnd: number;
    }
  | {
      type: "textarea_input_replace";
      nextText: string;
      selectionStart: number;
      selectionEnd: number;
    }
  | {
      type: "textarea_delete";
      key: "Backspace" | "Delete";
      value: string;
      selectionStart: number;
      selectionEnd: number;
    }
  | {
      type: "textarea_selection";
      selectionStart: number;
      selectionEnd: number;
    }
  | {
      type: "source_reconciled";
      source: string;
      sourceRevision: number;
      target: EditableTextTarget | null;
    }
  | {
      type: "session_close";
    }
  | {
      type: "overlay_resolved";
      requestRevision: number;
      sourceId: string;
      selectionStart: number;
      selectionEnd: number;
      overlay: TextSelectionOverlay | null;
    };

export type CanvasTextEditEffect =
  | {
      type: "apply_source_patch";
      sourceId: string;
      historyMergeKey: string;
      nextText: string;
      previousSpan: Span;
      changedSpan: Span;
      replacement: string;
      nextSource: string;
    };

export const INITIAL_CANVAS_TEXT_EDIT_STATE: CanvasTextEditState = {
  session: null,
  selectionOverlay: null,
  dragSelection: null,
  inputRevision: 0,
  asyncRequestRevision: 0,
  sourceRevision: 0
};

function resolveCurrentTextSpan(source: string, expectedText: string, previousSpan: Span): Span {
  if (source.slice(previousSpan.from, previousSpan.to) === expectedText) {
    return previousSpan;
  }
  if (expectedText.length === 0) {
    return { from: previousSpan.from, to: previousSpan.from };
  }
  let bestStart = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let searchFrom = 0;
  while (searchFrom <= source.length - expectedText.length) {
    const matchAt = source.indexOf(expectedText, searchFrom);
    if (matchAt < 0) {
      break;
    }
    const distance = Math.abs(matchAt - previousSpan.from);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestStart = matchAt;
      if (distance === 0) {
        break;
      }
    }
    searchFrom = matchAt + 1;
  }
  if (bestStart < 0) {
    return previousSpan;
  }
  return {
    from: bestStart,
    to: bestStart + expectedText.length
  };
}

function normalizeSelection(textLength: number, selectionStart: number, selectionEnd: number): { start: number; end: number } {
  const boundedStart = clamp(Math.floor(selectionStart), 0, textLength);
  const boundedEnd = clamp(Math.floor(selectionEnd), 0, textLength);
  return {
    start: Math.min(boundedStart, boundedEnd),
    end: Math.max(boundedStart, boundedEnd)
  };
}

function sameSpan(left: Span, right: Span): boolean {
  return left.from === right.from && left.to === right.to;
}

function sameRegion(left: TextEditingSession["region"], right: TextEditingSession["region"]): boolean {
  const leftTransform = left.transform ?? null;
  const rightTransform = right.transform ?? null;
  return (
    left.key === right.key &&
    left.sourceId === right.sourceId &&
    left.targetId === right.targetId &&
    left.interactionMode === right.interactionMode &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    left.cx === right.cx &&
    left.cy === right.cy &&
    left.rotation === right.rotation &&
    (left.contentWidth ?? null) === (right.contentWidth ?? null) &&
    (left.contentHeight ?? null) === (right.contentHeight ?? null) &&
    ((leftTransform == null && rightTransform == null) ||
      (leftTransform != null &&
        rightTransform != null &&
        leftTransform.a === rightTransform.a &&
        leftTransform.b === rightTransform.b &&
        leftTransform.c === rightTransform.c &&
        leftTransform.d === rightTransform.d &&
        leftTransform.e === rightTransform.e &&
        leftTransform.f === rightTransform.f))
  );
}

function closeState(state: CanvasTextEditState): CanvasTextEditState {
  if (!state.session && !state.selectionOverlay && !state.dragSelection) {
    return state;
  }
  return {
    ...state,
    session: null,
    selectionOverlay: null,
    dragSelection: null,
    asyncRequestRevision: state.asyncRequestRevision + 1
  };
}

function applySessionTextUpdate(
  state: CanvasTextEditState,
  nextText: string,
  selectionStart: number,
  selectionEnd: number
): { state: CanvasTextEditState; effects: CanvasTextEditEffect[] } {
  const current = state.session;
  if (!current) {
    return { state, effects: [] };
  }
  const selection = normalizeSelection(nextText.length, selectionStart, selectionEnd);
  const currentSpan = resolveCurrentTextSpan(current.workingSource, current.text, current.sourceSpan);
  const updated = replaceSpan(current.workingSource, currentSpan, nextText);
  return {
    state: {
      ...state,
      session: {
        ...current,
        sourceSpan: updated.changedSpan,
        workingSource: updated.source,
        text: nextText,
        selectionStart: selection.start,
        selectionEnd: selection.end
      },
      inputRevision: state.inputRevision + 1,
      asyncRequestRevision: state.asyncRequestRevision + 1
    },
    effects: [
      {
        type: "apply_source_patch",
        sourceId: current.sourceId,
        historyMergeKey: current.historyMergeKey,
        nextText,
        previousSpan: currentSpan,
        changedSpan: updated.changedSpan,
        replacement: nextText,
        nextSource: updated.source
      }
    ]
  };
}

export function reduceCanvasTextEdit(
  state: CanvasTextEditState,
  action: CanvasTextEditAction
): { state: CanvasTextEditState; effects: CanvasTextEditEffect[] } {
  switch (action.type) {
    case "start_session": {
      const selection = normalizeSelection(action.target.text.length, action.selectionStart, action.selectionEnd);
      return {
        state: {
          ...state,
          session: {
            sourceId: action.target.sourceId,
            sceneTextId: action.target.sceneTextId,
            sourceSpan: action.target.sourceSpan,
            workingSource: action.source,
            text: action.target.text,
            selectionStart: selection.start,
            selectionEnd: selection.end,
            historyMergeKey: action.historyMergeKey,
            paragraphId: action.target.paragraphId,
            renderSourceText: action.target.renderSourceText,
            layoutKind: action.target.layoutKind,
            region: action.target.region,
            popupAnchorBox: action.target.popupAnchorBox
          },
          selectionOverlay: null,
          dragSelection: null,
          asyncRequestRevision: state.asyncRequestRevision + 1
        },
        effects: []
      };
    }

    case "pointer_down_provisional": {
      const selection = normalizeSelection(action.target.text.length, action.selectionStart, action.selectionEnd);
      return {
        state: {
          ...state,
          session: {
            sourceId: action.target.sourceId,
            sceneTextId: action.target.sceneTextId,
            sourceSpan: action.target.sourceSpan,
            workingSource: action.source,
            text: action.target.text,
            selectionStart: selection.start,
            selectionEnd: selection.end,
            historyMergeKey: action.historyMergeKey,
            paragraphId: action.target.paragraphId,
            renderSourceText: action.target.renderSourceText,
            layoutKind: action.target.layoutKind,
            region: action.target.region,
            popupAnchorBox: action.target.popupAnchorBox
          },
          selectionOverlay: null,
          dragSelection: {
            pointerId: action.pointerId,
            sourceId: action.target.sourceId,
            sceneTextId: action.target.sceneTextId,
            anchorOffset: action.anchorOffset,
            mode: action.mode,
            anchorLineRange: action.anchorLineRange
          },
          asyncRequestRevision: state.asyncRequestRevision + 1
        },
        effects: []
      };
    }

    case "pointer_resolved": {
      if (action.requestRevision !== state.asyncRequestRevision || action.baseInputRevision !== state.inputRevision) {
        return { state, effects: [] };
      }
      const session = state.session;
      if (!session || session.sourceId !== action.sourceId || session.sceneTextId !== action.sceneTextId) {
        return { state, effects: [] };
      }
      const selection = normalizeSelection(session.text.length, action.selectionStart, action.selectionEnd);
      return {
        state: {
          ...state,
          session: {
            ...session,
            selectionStart: selection.start,
            selectionEnd: selection.end
          },
          dragSelection:
            state.dragSelection &&
            state.dragSelection.pointerId === action.pointerId &&
            state.dragSelection.sourceId === action.sourceId &&
            state.dragSelection.sceneTextId === action.sceneTextId
              ? {
                  ...state.dragSelection,
                  anchorOffset: clamp(action.anchorOffset, 0, session.text.length),
                  anchorLineRange: action.anchorLineRange
                }
              : state.dragSelection
        },
        effects: []
      };
    }

    case "drag_resolved": {
      if (action.requestRevision !== state.asyncRequestRevision || action.baseInputRevision !== state.inputRevision) {
        return { state, effects: [] };
      }
      const session = state.session;
      if (!session || session.sourceId !== action.sourceId || session.sceneTextId !== action.sceneTextId) {
        return { state, effects: [] };
      }
      const selection = normalizeSelection(session.text.length, action.selectionStart, action.selectionEnd);
      return {
        state: {
          ...state,
          session: {
            ...session,
            selectionStart: selection.start,
            selectionEnd: selection.end
          }
        },
        effects: []
      };
    }

    case "textarea_input_replace": {
      return applySessionTextUpdate(state, action.nextText, action.selectionStart, action.selectionEnd);
    }

    case "textarea_delete": {
      const session = state.session;
      if (!session) {
        return { state, effects: [] };
      }
      const value = action.value;
      const start = clamp(Math.min(action.selectionStart, action.selectionEnd), 0, value.length);
      const end = clamp(Math.max(action.selectionStart, action.selectionEnd), 0, value.length);

      if (start !== end) {
        const nextText = `${value.slice(0, start)}${value.slice(end)}`;
        return applySessionTextUpdate(state, nextText, start, start);
      }
      if (action.key === "Backspace") {
        if (start === 0) {
          return { state, effects: [] };
        }
        const nextText = `${value.slice(0, start - 1)}${value.slice(start)}`;
        return applySessionTextUpdate(state, nextText, start - 1, start - 1);
      }
      if (start >= value.length) {
        return { state, effects: [] };
      }
      const nextText = `${value.slice(0, start)}${value.slice(start + 1)}`;
      return applySessionTextUpdate(state, nextText, start, start);
    }

    case "textarea_selection": {
      const session = state.session;
      if (!session) {
        return { state, effects: [] };
      }
      const selection = normalizeSelection(session.text.length, action.selectionStart, action.selectionEnd);
      if (session.selectionStart === selection.start && session.selectionEnd === selection.end) {
        return { state, effects: [] };
      }
      return {
        state: {
          ...state,
          session: {
            ...session,
            selectionStart: selection.start,
            selectionEnd: selection.end
          }
        },
        effects: []
      };
    }

    case "source_reconciled": {
      const session = state.session;
      if (!session) {
        if (state.sourceRevision === action.sourceRevision) {
          return { state, effects: [] };
        }
        return {
          state: {
            ...state,
            sourceRevision: action.sourceRevision
          },
          effects: []
        };
      }
      if (!action.target || action.target.sourceId !== session.sourceId) {
        if (state.sourceRevision === action.sourceRevision && session.workingSource === action.source) {
          return { state, effects: [] };
        }
        return {
          state: {
            ...state,
            sourceRevision: action.sourceRevision,
            session: {
              ...session,
              workingSource: action.source
            }
          },
          effects: []
        };
      }
      if (
        state.sourceRevision === action.sourceRevision &&
        session.workingSource === action.source &&
        session.sceneTextId === action.target.sceneTextId &&
        sameSpan(session.sourceSpan, action.target.sourceSpan) &&
        session.paragraphId === action.target.paragraphId &&
        session.renderSourceText === action.target.renderSourceText &&
        session.layoutKind === action.target.layoutKind &&
        sameRegion(session.region, action.target.region) &&
        session.popupAnchorBox?.x === action.target.popupAnchorBox?.x &&
        session.popupAnchorBox?.y === action.target.popupAnchorBox?.y &&
        session.popupAnchorBox?.width === action.target.popupAnchorBox?.width &&
        session.popupAnchorBox?.height === action.target.popupAnchorBox?.height
      ) {
        return { state, effects: [] };
      }
      return {
        state: {
          ...state,
          sourceRevision: action.sourceRevision,
          session: {
            ...session,
            sceneTextId: action.target.sceneTextId,
            sourceSpan: action.target.sourceSpan,
            workingSource: action.source,
            paragraphId: action.target.paragraphId,
            renderSourceText: action.target.renderSourceText,
            layoutKind: action.target.layoutKind,
            region: action.target.region,
            popupAnchorBox: action.target.popupAnchorBox
          }
        },
        effects: []
      };
    }

    case "overlay_resolved": {
      if (action.requestRevision !== state.asyncRequestRevision) {
        return { state, effects: [] };
      }
      const session = state.session;
      if (!session || session.sourceId !== action.sourceId) {
        return { state, effects: [] };
      }
      const nextOverlay = action.overlay
        ? {
            ...action.overlay,
            selectionStart: action.selectionStart,
            selectionEnd: action.selectionEnd
          }
        : null;
      return {
        state: {
          ...state,
          selectionOverlay: nextOverlay
        },
        effects: []
      };
    }

    case "session_close": {
      return {
        state: closeState(state),
        effects: []
      };
    }

    default: {
      return { state, effects: [] };
    }
  }
}
