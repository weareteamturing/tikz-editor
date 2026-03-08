import { create } from "zustand";
import { editorReducer, makeInitialState } from "./reducer";
import type { EditorState, EditorAction } from "./types";

export type EditorStore = EditorState & {
  dispatch: (action: EditorAction) => void;
};

export const useEditorStore = create<EditorStore>((set) => ({
  ...makeInitialState(),
  dispatch: (action: EditorAction) => set((state) => editorReducer(state, action))
}));
