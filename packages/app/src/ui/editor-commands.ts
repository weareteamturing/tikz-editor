import { applyEditAction, type ReorderDirection } from "tikz-editor/edit/actions";
import { getEditActionAvailability } from "tikz-editor/edit/action-availability";
import { PT_PER_CM } from "tikz-editor/edit/format";
import {
  parseStatementSnapshot,
  resolveStatementRefs,
  statementSnippet
} from "tikz-editor/edit/statement-ops";
import { parseEditableTargetId } from "tikz-editor/edit/editable-targets";
import { resolvePropertyTarget } from "tikz-editor/edit/property-target";
import type { EditHandle, SceneFigure } from "tikz-editor/semantic/types";
import type { EditorAction } from "../store/types";
import {
  buildSelectionSvgSync,
  buildSelectionSvg,
  createClipboardPayload,
  readClipboardPayloadFromDataTransfer,
  readClipboardPayloadFromSystemClipboard,
  type ClipboardPasteBehavior,
  type ClipboardReadFailureReason,
  type TikzClipboardPayload,
  writePayloadToDataTransfer,
  writeClipboardPayload
} from "./editor-clipboard";

type Dispatch = (action: EditorAction) => void;

type SelectionCommandContext = {
  source: string;
  snapshotSource: string | null;
  scene: SceneFigure | null;
  editHandles: readonly EditHandle[];
  selectedElementIds: ReadonlySet<string>;
  dispatch: Dispatch;
};

type PasteCommandContext = SelectionCommandContext;

type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";
type DistributeAxis = "horizontal" | "vertical";
const DEFAULT_PASTE_OFFSET_PT = 0.25 * PT_PER_CM;

export type PasteSelectionResult =
  | { kind: "success" }
  | { kind: "failure"; reason: ClipboardReadFailureReason | "unsupported" };

export function isCodeMirrorEventTarget(target: EventTarget | null): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null;
  return element?.closest?.(".cm-editor") != null;
}

export async function copySelection(
  context: SelectionCommandContext,
  options?: { pasteBehavior?: ClipboardPasteBehavior }
): Promise<boolean> {
  if (!canCopySelection(context)) {
    return false;
  }

  const snippets = selectedSnippets(context.source, context.selectedElementIds);
  if (snippets.length === 0) {
    return false;
  }
  const payload = createClipboardPayload(snippets, options?.pasteBehavior ?? "offset", 0);
  if (!payload) {
    return false;
  }
  const svgText = await buildSelectionSvg(payload.snippets);
  return writeClipboardPayload(payload, { svgText });
}

export function copySelectionToClipboardData(
  context: SelectionCommandContext,
  dataTransfer: DataTransfer | null,
  options?: { pasteBehavior?: ClipboardPasteBehavior }
): boolean {
  if (!canCopySelection(context)) {
    return false;
  }
  const snippets = selectedSnippets(context.source, context.selectedElementIds);
  const payload = createClipboardPayload(snippets, options?.pasteBehavior ?? "offset", 0);
  if (!payload) {
    return false;
  }
  const svgText = buildSelectionSvgSync(payload.snippets);
  return writePayloadToDataTransfer(payload, dataTransfer, { svgText });
}

export function deleteSelection(context: SelectionCommandContext): boolean {
  if (!canDeleteSelection(context)) {
    return false;
  }

  const ids = [...context.selectedElementIds];
  if (ids.length === 1 && parseEditableTargetId(ids[0]!).kind === "node-adornment") {
    context.dispatch({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "deleteAdornment",
        targetId: ids[0]!
      }
    });
    context.dispatch({ type: "CLEAR_SELECTION" });
    return true;
  }
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action: ids.length === 1
      ? {
          kind: "deleteElement",
          elementId: ids[0]!
        }
      : {
          kind: "deleteElements",
          elementIds: ids
        }
  });
  context.dispatch({ type: "CLEAR_SELECTION" });
  return true;
}

export async function cutSelection(context: SelectionCommandContext): Promise<boolean> {
  if (!canCutSelection(context)) {
    return false;
  }

  const didCopy = await copySelection(context, { pasteBehavior: "preserve" });
  if (!didCopy) {
    return false;
  }
  return deleteSelection(context);
}

export function cutSelectionToClipboardData(
  context: SelectionCommandContext,
  dataTransfer: DataTransfer | null
): boolean {
  const copied = copySelectionToClipboardData(context, dataTransfer, { pasteBehavior: "preserve" });
  if (!copied) {
    return false;
  }
  return deleteSelection(context);
}

export async function pasteSelectionFromClipboardData(
  context: PasteCommandContext,
  dataTransfer: DataTransfer | null
): Promise<PasteSelectionResult> {
  const parsed = readClipboardPayloadFromDataTransfer(dataTransfer);
  if (parsed.kind === "failure") {
    return parsed;
  }
  const didPaste = runPasteFromPayload(context, parsed.payload);
  return didPaste ? { kind: "success" } : { kind: "failure", reason: "unsupported" };
}

export async function pasteSelectionFromSystemClipboard(
  context: PasteCommandContext
): Promise<PasteSelectionResult> {
  const readResult = await readClipboardPayloadFromSystemClipboard();
  if (readResult.kind === "failure") {
    return readResult;
  }
  const didPaste = runPasteFromPayload(context, readResult.payload);
  return didPaste ? { kind: "success" } : { kind: "failure", reason: "unsupported" };
}

export function pasteSnippetsWithOffset(
  context: PasteCommandContext,
  snippets: readonly string[],
  options: { pasteCount?: number } = {}
): boolean {
  const payload = createClipboardPayload(snippets, "offset", options.pasteCount ?? 0);
  if (!payload) {
    return false;
  }
  return runPasteFromPayload(context, payload);
}

function runPasteFromPayload(context: PasteCommandContext, payload: TikzClipboardPayload): boolean {
  if (!canPasteSelection(context)) {
    return false;
  }

  const refs = selectedStatementRefs(context.source, context.selectedElementIds);
  const anchor = refs.length > 0 ? refs[refs.length - 1] : null;
  const pasteCount = Math.max(0, Math.floor(payload.pasteCount));
  const offset = DEFAULT_PASTE_OFFSET_PT * (pasteCount + 1);
  const delta = payload.pasteBehavior === "preserve"
    ? { x: 0, y: 0 }
    : { x: offset, y: -offset };
  const action = {
    kind: "pasteStatements" as const,
    snippets: [...payload.snippets],
    anchorElementId: anchor?.id,
    delta
  };
  const precomputedResult = applyEditAction(context.source, context.editHandles as EditHandle[], action);
  if (precomputedResult.kind !== "success" && precomputedResult.kind !== "partial") {
    return false;
  }

  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action,
    precomputedResult
  });

  if (payload.pasteBehavior === "offset") {
    const nextPayload = {
      ...payload,
      pasteCount: pasteCount + 1
    };
    void buildSelectionSvg(nextPayload.snippets).then((svgText) => writeClipboardPayload(nextPayload, { svgText }));
  }

  return true;
}

export function duplicateSelection(context: SelectionCommandContext): boolean {
  if (!canDuplicateSelection(context)) {
    return false;
  }

  const ids = [...context.selectedElementIds];
  if (ids.length === 1 && parseEditableTargetId(ids[0]!).kind === "node-adornment") {
    context.dispatch({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "duplicateAdornment",
        targetId: ids[0]!
      }
    });
    return true;
  }
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action: {
      kind: "duplicateElements",
      elementIds: ids
    }
  });
  return true;
}

export function reorderSelection(
  context: SelectionCommandContext,
  direction: ReorderDirection
): boolean {
  if (!canReorderSelection(context, direction)) {
    return false;
  }

  const ids = [...context.selectedElementIds];
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action: {
      kind: "reorderElements",
      elementIds: ids,
      direction
    }
  });
  return true;
}

export function alignSelection(context: SelectionCommandContext, mode: AlignMode): boolean {
  const actionId =
    mode === "left"
      ? "align-left"
      : mode === "center"
        ? "align-center"
        : mode === "right"
          ? "align-right"
          : mode === "top"
            ? "align-top"
            : mode === "middle"
              ? "align-middle"
              : "align-bottom";

  const availability = availabilityFor(context);
  if (!availability[actionId].enabled) {
    return false;
  }

  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action: {
      kind: "alignElements",
      elementIds: [...context.selectedElementIds],
      mode
    }
  });
  return true;
}

export function distributeSelection(context: SelectionCommandContext, axis: DistributeAxis): boolean {
  const actionId = axis === "horizontal" ? "distribute-horizontal" : "distribute-vertical";
  const availability = availabilityFor(context);
  if (!availability[actionId].enabled) {
    return false;
  }

  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action: {
      kind: "distributeElements",
      elementIds: [...context.selectedElementIds],
      axis
    }
  });
  return true;
}

export function canCopySelection(context: SelectionCommandContext): boolean {
  return availabilityFor(context).copy.enabled;
}

export function canDuplicateSelection(context: SelectionCommandContext): boolean {
  return availabilityFor(context).duplicate.enabled;
}

export function canCutSelection(context: SelectionCommandContext): boolean {
  const availability = availabilityFor(context);
  return availability.cut.enabled && availability.delete.enabled;
}

export function canDeleteSelection(context: SelectionCommandContext): boolean {
  return availabilityFor(context).delete.enabled;
}

export function canReorderSelection(
  context: SelectionCommandContext,
  direction: ReorderDirection = "bringForward"
): boolean {
  return availabilityFor(context)[reorderActionId(direction)].enabled;
}

export function canPasteSelection(context: PasteCommandContext): boolean {
  return availabilityFor(context).paste.enabled;
}

export function canAlignSelection(context: SelectionCommandContext, mode: AlignMode): boolean {
  const actionId =
    mode === "left"
      ? "align-left"
      : mode === "center"
        ? "align-center"
        : mode === "right"
          ? "align-right"
          : mode === "top"
            ? "align-top"
            : mode === "middle"
              ? "align-middle"
              : "align-bottom";
  return availabilityFor(context)[actionId].enabled;
}

export function canDistributeSelection(context: SelectionCommandContext, axis: DistributeAxis): boolean {
  const actionId = axis === "horizontal" ? "distribute-horizontal" : "distribute-vertical";
  return availabilityFor(context)[actionId].enabled;
}

export function actionAvailability(
  context: SelectionCommandContext
) {
  return availabilityFor(context);
}

function selectedSnippets(source: string, selectedElementIds: ReadonlySet<string>): string[] {
  if (selectedElementIds.size === 0) {
    return [];
  }

  const statementIds: string[] = [];
  const snippets: string[] = [];
  for (const id of selectedElementIds) {
    const parsed = parseEditableTargetId(id);
    if (parsed.kind === "node-adornment") {
      const resolved = resolvePropertyTarget(source, id);
      if (resolved.kind === "found" && resolved.target.optionSpan) {
        const snippet = source.slice(resolved.target.optionSpan.from, resolved.target.optionSpan.to).trim();
        if (snippet.length > 0) {
          snippets.push(snippet);
        }
      }
      continue;
    }
    statementIds.push(id);
  }

  if (statementIds.length > 0) {
    const snapshot = parseStatementSnapshot(source);
    const refs = resolveStatementRefs(snapshot, statementIds);
    refs.sort((left, right) => {
      if (left.span.from !== right.span.from) {
        return left.span.from - right.span.from;
      }
      return left.span.to - right.span.to;
    });
    snippets.push(...refs.map((ref) => statementSnippet(source, ref)));
  }

  return snippets;
}

function selectedStatementRefs(source: string, selectedElementIds: ReadonlySet<string>) {
  if (selectedElementIds.size === 0) {
    return [];
  }

  const statementIds = [...selectedElementIds].filter((id) => parseEditableTargetId(id).kind === "statement");
  const snapshot = parseStatementSnapshot(source);
  const refs = resolveStatementRefs(snapshot, statementIds);
  refs.sort((left, right) => {
    if (left.span.from !== right.span.from) {
      return left.span.from - right.span.from;
    }
    return left.span.to - right.span.to;
  });
  return refs;
}

function availabilityFor(context: SelectionCommandContext) {
  return getEditActionAvailability({
    source: context.source,
    snapshotSource: context.snapshotSource,
    selectedSourceIds: [...context.selectedElementIds],
    scene: context.scene,
    editHandles: context.editHandles,
    hasClipboardContent: true
  });
}

function reorderActionId(direction: ReorderDirection) {
  switch (direction) {
    case "sendToBack":
      return "reorder-sendToBack" as const;
    case "sendBackward":
      return "reorder-sendBackward" as const;
    case "bringForward":
      return "reorder-bringForward" as const;
    case "bringToFront":
      return "reorder-bringToFront" as const;
  }
}
