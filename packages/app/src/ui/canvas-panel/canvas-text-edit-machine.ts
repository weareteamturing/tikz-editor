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
  undoStack: CanvasTextEditHistoryEntry[];
  redoStack: CanvasTextEditHistoryEntry[];
  inputRevision: number;
  asyncRequestRevision: number;
  sourceRevision: number;
};

export type CanvasTextEditHistoryEntry = {
  text: string;
  selectionStart: number;
  selectionEnd: number;
};

const SUPPORTED_CANVAS_TEXT_INPUT_TYPES = [
  "insertText",
  "insertLineBreak",
  "insertCompositionText",
  "insertFromComposition",
  "insertFromPaste",
  "deleteContentBackward",
  "deleteContentForward",
  "deleteByCut",
  "historyUndo",
  "historyRedo"
] as const;

export type CanvasTextInputIntentType = (typeof SUPPORTED_CANVAS_TEXT_INPUT_TYPES)[number];

const IS_FAIL_FAST_UNSUPPORTED_INPUT_TYPE = import.meta.env.DEV || import.meta.env.MODE === "test";

export function isCanvasTextInputIntentType(value: string): value is CanvasTextInputIntentType {
  return (SUPPORTED_CANVAS_TEXT_INPUT_TYPES as readonly string[]).includes(value);
}

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
      type: "textarea_input_intent";
      inputType: string;
      data: string | null;
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
  undoStack: [],
  redoStack: [],
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
  if (!state.session && !state.selectionOverlay && !state.dragSelection && state.undoStack.length === 0 && state.redoStack.length === 0) {
    return state;
  }
  return {
    ...state,
    session: null,
    selectionOverlay: null,
    dragSelection: null,
    undoStack: [],
    redoStack: [],
    asyncRequestRevision: state.asyncRequestRevision + 1
  };
}

function snapshotSession(session: TextEditingSession): CanvasTextEditHistoryEntry {
  return {
    text: session.text,
    selectionStart: session.selectionStart,
    selectionEnd: session.selectionEnd
  };
}

function withUndoCheckpoint(state: CanvasTextEditState, session: TextEditingSession): CanvasTextEditState {
  return {
    ...state,
    undoStack: [...state.undoStack, snapshotSession(session)],
    redoStack: []
  };
}

function applyInsertIntent(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  insertedText: string
): { nextText: string; nextSelectionStart: number; nextSelectionEnd: number } {
  const nextText = `${text.slice(0, selectionStart)}${insertedText}${text.slice(selectionEnd)}`;
  const caret = selectionStart + insertedText.length;
  return {
    nextText,
    nextSelectionStart: caret,
    nextSelectionEnd: caret
  };
}

function applyDeleteIntent(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  mode: "backward" | "forward" | "cut"
): { nextText: string; nextSelectionStart: number; nextSelectionEnd: number } | null {
  if (selectionStart !== selectionEnd) {
    return {
      nextText: `${text.slice(0, selectionStart)}${text.slice(selectionEnd)}`,
      nextSelectionStart: selectionStart,
      nextSelectionEnd: selectionStart
    };
  }
  if (mode === "cut") {
    return null;
  }
  if (mode === "backward") {
    if (selectionStart === 0) {
      return null;
    }
    return {
      nextText: `${text.slice(0, selectionStart - 1)}${text.slice(selectionStart)}`,
      nextSelectionStart: selectionStart - 1,
      nextSelectionEnd: selectionStart - 1
    };
  }
  if (selectionStart >= text.length) {
    return null;
  }
  return {
    nextText: `${text.slice(0, selectionStart)}${text.slice(selectionStart + 1)}`,
    nextSelectionStart: selectionStart,
    nextSelectionEnd: selectionStart
  };
}

function reduceUnsupportedInputIntent(
  state: CanvasTextEditState,
  inputType: string
): { state: CanvasTextEditState; effects: CanvasTextEditEffect[] } {
  if (IS_FAIL_FAST_UNSUPPORTED_INPUT_TYPE) {
    throw new Error(
      `[canvas-text-edit] unsupported inputType "${inputType}". Supported: ${SUPPORTED_CANVAS_TEXT_INPUT_TYPES.join(", ")}`
    );
  }
  console.warn("[canvas-text-edit][unsupported-input-type]", { inputType });
  return { state, effects: [] };
}

function hasUnstableTrailingEscape(text: string): boolean {
  let trailingBackslashes = 0;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (text[index] !== "\\") {
      break;
    }
    trailingBackslashes += 1;
  }
  return trailingBackslashes % 2 === 1;
}

function shouldReuseCurrentSpanForDeferredEscape(
  sourceSlice: string,
  expectedText: string
): boolean {
  if (sourceSlice === expectedText) {
    return true;
  }
  if (!sourceSlice.startsWith(expectedText)) {
    return false;
  }
  const suffix = sourceSlice.slice(expectedText.length);
  if (suffix.length === 0) {
    return false;
  }
  for (const character of suffix) {
    if (character !== "\\") {
      return false;
    }
  }
  return true;
}

function resolveSourceSpanForSessionText(source: string, text: string, suggestedSpan: Span): Span {
  if (source.slice(suggestedSpan.from, suggestedSpan.to) === text) {
    return suggestedSpan;
  }
  const resolved = resolveCurrentTextSpan(source, text, suggestedSpan);
  if (source.slice(resolved.from, resolved.to) === text) {
    return resolved;
  }
  const suggestedLength = Math.max(0, suggestedSpan.to - suggestedSpan.from);
  if (suggestedLength < text.length) {
    const expandedTo = Math.min(source.length, suggestedSpan.from + text.length);
    if (expandedTo > suggestedSpan.to) {
      return {
        from: suggestedSpan.from,
        to: expandedTo
      };
    }
  }
  return suggestedSpan;
}

function resolveReconciledSessionSourceSpan(
  source: string,
  session: TextEditingSession,
  targetSpan: Span
): Span {
  if (hasUnstableTrailingEscape(session.text)) {
    return session.sourceSpan;
  }
  return resolveSourceSpanForSessionText(source, session.text, targetSpan);
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
  const currentTextHasUnstableTrailingEscape = hasUnstableTrailingEscape(current.text);
  const nextTextHasUnstableTrailingEscape = hasUnstableTrailingEscape(nextText);
  if (nextTextHasUnstableTrailingEscape) {
    return {
      state: {
        ...state,
        session: {
          ...current,
          text: nextText,
          selectionStart: selection.start,
          selectionEnd: selection.end
        },
        inputRevision: state.inputRevision + 1,
        asyncRequestRevision: state.asyncRequestRevision + 1
      },
      effects: []
    };
  }
  const currentSlice = current.workingSource.slice(current.sourceSpan.from, current.sourceSpan.to);
  const isStabilizingDeferredEscape = currentTextHasUnstableTrailingEscape && !nextTextHasUnstableTrailingEscape;
  const currentSpan = isStabilizingDeferredEscape
    ? current.sourceSpan
    : shouldReuseCurrentSpanForDeferredEscape(currentSlice, current.text)
      ? current.sourceSpan
      : resolveCurrentTextSpan(current.workingSource, current.text, current.sourceSpan);
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
      const sourceSpan = resolveSourceSpanForSessionText(
        action.source,
        action.target.text,
        action.target.sourceSpan
      );
      return {
        state: {
          ...state,
          session: {
            sourceId: action.target.sourceId,
            sceneTextId: action.target.sceneTextId,
            sourceSpan,
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
          undoStack: [],
          redoStack: [],
          asyncRequestRevision: state.asyncRequestRevision + 1
        },
        effects: []
      };
    }

    case "pointer_down_provisional": {
      const selection = normalizeSelection(action.target.text.length, action.selectionStart, action.selectionEnd);
      const sourceSpan = resolveSourceSpanForSessionText(
        action.source,
        action.target.text,
        action.target.sourceSpan
      );
      return {
        state: {
          ...state,
          session: {
            sourceId: action.target.sourceId,
            sceneTextId: action.target.sceneTextId,
            sourceSpan,
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
          undoStack: [],
          redoStack: [],
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

    case "textarea_input_intent": {
      const session = state.session;
      if (!session) {
        return { state, effects: [] };
      }
      const selection = normalizeSelection(session.text.length, action.selectionStart, action.selectionEnd);
      if (!isCanvasTextInputIntentType(action.inputType)) {
        return reduceUnsupportedInputIntent(state, action.inputType);
      }

      if (action.inputType === "historyUndo") {
        const previous = state.undoStack[state.undoStack.length - 1];
        if (!previous) {
          return { state, effects: [] };
        }
        const reduced = applySessionTextUpdate(state, previous.text, previous.selectionStart, previous.selectionEnd);
        return {
          state: {
            ...reduced.state,
            undoStack: state.undoStack.slice(0, -1),
            redoStack: [...state.redoStack, snapshotSession(session)]
          },
          effects: reduced.effects
        };
      }

      if (action.inputType === "historyRedo") {
        const next = state.redoStack[state.redoStack.length - 1];
        if (!next) {
          return { state, effects: [] };
        }
        const reduced = applySessionTextUpdate(state, next.text, next.selectionStart, next.selectionEnd);
        return {
          state: {
            ...reduced.state,
            undoStack: [...state.undoStack, snapshotSession(session)],
            redoStack: state.redoStack.slice(0, -1)
          },
          effects: reduced.effects
        };
      }

      let nextIntent:
        | { nextText: string; nextSelectionStart: number; nextSelectionEnd: number }
        | null = null;

      switch (action.inputType) {
        case "insertText":
        case "insertCompositionText":
        case "insertFromComposition":
          nextIntent = applyInsertIntent(session.text, selection.start, selection.end, action.data ?? "");
          break;
        case "insertLineBreak":
          nextIntent = applyInsertIntent(session.text, selection.start, selection.end, "\n");
          break;
        case "insertFromPaste":
          nextIntent = applyInsertIntent(session.text, selection.start, selection.end, action.data ?? "");
          break;
        case "deleteContentBackward":
          nextIntent = applyDeleteIntent(session.text, selection.start, selection.end, "backward");
          break;
        case "deleteContentForward":
          nextIntent = applyDeleteIntent(session.text, selection.start, selection.end, "forward");
          break;
        case "deleteByCut":
          nextIntent = applyDeleteIntent(session.text, selection.start, selection.end, "cut");
          break;
        default:
          return { state, effects: [] };
      }

      if (!nextIntent) {
        return { state, effects: [] };
      }
      const reduced = applySessionTextUpdate(
        withUndoCheckpoint(state, session),
        nextIntent.nextText,
        nextIntent.nextSelectionStart,
        nextIntent.nextSelectionEnd
      );
      return reduced;
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
      const targetMatchesSessionText = action.target.text === session.text;
      const reconciledSourceSpan = resolveReconciledSessionSourceSpan(
        action.source,
        session,
        action.target.sourceSpan
      );
      const nextSceneTextId = targetMatchesSessionText ? action.target.sceneTextId : session.sceneTextId;
      const nextParagraphId = targetMatchesSessionText ? action.target.paragraphId : session.paragraphId;
      const nextRenderSourceText = targetMatchesSessionText ? action.target.renderSourceText : session.renderSourceText;
      const nextLayoutKind = targetMatchesSessionText ? action.target.layoutKind : session.layoutKind;
      const nextRegion = targetMatchesSessionText ? action.target.region : session.region;
      const nextPopupAnchorBox = targetMatchesSessionText ? action.target.popupAnchorBox : session.popupAnchorBox;
      if (
        state.sourceRevision === action.sourceRevision &&
        session.workingSource === action.source &&
        session.sceneTextId === nextSceneTextId &&
        sameSpan(session.sourceSpan, reconciledSourceSpan) &&
        session.paragraphId === nextParagraphId &&
        session.renderSourceText === nextRenderSourceText &&
        session.layoutKind === nextLayoutKind &&
        sameRegion(session.region, nextRegion) &&
        session.popupAnchorBox?.x === nextPopupAnchorBox?.x &&
        session.popupAnchorBox?.y === nextPopupAnchorBox?.y &&
        session.popupAnchorBox?.width === nextPopupAnchorBox?.width &&
        session.popupAnchorBox?.height === nextPopupAnchorBox?.height
      ) {
        return { state, effects: [] };
      }
      return {
        state: {
          ...state,
          sourceRevision: action.sourceRevision,
          session: {
            ...session,
            sceneTextId: nextSceneTextId,
            sourceSpan: reconciledSourceSpan,
            workingSource: action.source,
            paragraphId: nextParagraphId,
            renderSourceText: nextRenderSourceText,
            layoutKind: nextLayoutKind,
            region: nextRegion,
            popupAnchorBox: nextPopupAnchorBox
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
