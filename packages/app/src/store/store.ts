import { create } from "zustand";
import { editorReducer, makeInitialState } from "./reducer";
import type { EditorState, EditorAction } from "./types";
import { loadWorkspaceSeed, saveWorkspace } from "./workspace-storage";
import { workspaceStateFromEditorState } from "./workspace-state";

export type EditorStore = EditorState & {
  dispatch: (action: EditorAction) => void;
};

export const useEditorStore = create<EditorStore>((set) => ({
  ...makeInitialState(loadWorkspaceSeed() ?? undefined),
  dispatch: (action: EditorAction) => set((state) => {
    const next = editorReducer(state, action);
    if (shouldSaveWorkspace(state, next)) {
      saveWorkspace(workspaceStateFromEditorState(next));
    }
    return next;
  })
}));

function shouldSaveWorkspace(previous: EditorState, next: EditorState): boolean {
  return (
    previous.workspaceVersion !== next.workspaceVersion ||
    previous.documents !== next.documents ||
    previous.tabOrder !== next.tabOrder ||
    previous.activeDocumentId !== next.activeDocumentId ||
    previous.recentDocumentIds !== next.recentDocumentIds
  );
}
