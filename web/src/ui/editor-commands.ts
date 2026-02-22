import type { ReorderDirection } from "tikz-editor/edit/actions";
import {
  parseStatementSnapshot,
  resolveStatementRefs,
  statementSnippet
} from "tikz-editor/edit/statement-ops";
import type { EditorAction, InternalClipboard } from "../store/types";

type Dispatch = (action: EditorAction) => void;

type SelectionCommandContext = {
  source: string;
  selectedElementIds: ReadonlySet<string>;
  dispatch: Dispatch;
};

type PasteCommandContext = SelectionCommandContext & {
  internalClipboard: InternalClipboard | null;
};

export function isCodeMirrorEventTarget(target: EventTarget | null): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null;
  return element?.closest?.(".cm-editor") != null;
}

export async function copySelection(context: SelectionCommandContext): Promise<boolean> {
  const refs = selectedStatementRefs(context.source, context.selectedElementIds);
  if (refs.length === 0) {
    return false;
  }

  const snippets = refs.map((ref) => statementSnippet(context.source, ref));
  const plainText = snippets.join("\n");
  context.dispatch({
    type: "SET_INTERNAL_CLIPBOARD",
    clipboard: {
      snippets,
      plainText,
      copiedAt: Date.now()
    }
  });

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(plainText);
    }
  } catch {
    // Keep internal clipboard even if system clipboard write fails.
  }

  return true;
}

export function pasteSelectionAnchor(context: PasteCommandContext): boolean {
  const clipboard = context.internalClipboard;
  if (!clipboard || clipboard.snippets.length === 0) {
    return false;
  }

  const refs = selectedStatementRefs(context.source, context.selectedElementIds);
  const anchor = refs.length > 0 ? refs[refs.length - 1] : null;
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action: {
      kind: "pasteStatements",
      snippets: [...clipboard.snippets],
      anchorElementId: anchor?.id
    }
  });
  return true;
}

export function duplicateSelection(context: SelectionCommandContext): boolean {
  const ids = [...context.selectedElementIds];
  if (ids.length === 0) {
    return false;
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
  const ids = [...context.selectedElementIds];
  if (ids.length === 0) {
    return false;
  }

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

export function canCopySelection(selectedElementIds: ReadonlySet<string>): boolean {
  return selectedElementIds.size > 0;
}

export function canDuplicateSelection(selectedElementIds: ReadonlySet<string>): boolean {
  return selectedElementIds.size > 0;
}

export function canReorderSelection(selectedElementIds: ReadonlySet<string>): boolean {
  return selectedElementIds.size > 0;
}

export function canPasteSelection(clipboard: InternalClipboard | null): boolean {
  return Boolean(clipboard && clipboard.snippets.length > 0);
}

function selectedStatementRefs(source: string, selectedElementIds: ReadonlySet<string>) {
  if (selectedElementIds.size === 0) {
    return [];
  }

  const snapshot = parseStatementSnapshot(source);
  const refs = resolveStatementRefs(snapshot, [...selectedElementIds]);
  refs.sort((left, right) => {
    if (left.span.from !== right.span.from) {
      return left.span.from - right.span.from;
    }
    return left.span.to - right.span.to;
  });
  return refs;
}
