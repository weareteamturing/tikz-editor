import { create } from "zustand";
import { editorReducer, makeInitialState } from "./reducer";
import type { EditorState, EditorAction } from "./types";
import { loadWorkspaceSeed, saveWorkspace } from "./workspace-storage";

export type EditorStore = EditorState & {
  dispatch: (action: EditorAction) => void;
};

export const useEditorStore = create<EditorStore>((set) => ({
  ...makeInitialState(loadWorkspaceSeed() ?? undefined),
  dispatch: (action: EditorAction) => set((state) => {
    const next = editorReducer(state, action);
    saveWorkspace({
      workspaceVersion: next.workspaceVersion,
      documents: next.documents,
      tabOrder: next.tabOrder,
      activeDocumentId: next.activeDocumentId
    });
    return next;
  })
}));
