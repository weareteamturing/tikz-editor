import { describe, expect, it } from "vitest";
import { editorReducer, makeInitialState } from "../packages/app/src/store/reducer.js";

describe("workspace model", () => {
  it("initializes one active document session", () => {
    const state = makeInitialState();
    expect(state.tabOrder).toHaveLength(1);
    expect(state.documents[state.activeDocumentId]).toBeDefined();
    expect(state.source).toBe(state.documents[state.activeDocumentId]?.source);
    expect(state.workspaceVersion).toBe(2);
  });

  it("creates and switches documents", () => {
    const initial = makeInitialState();
    const withSecond = editorReducer(initial, { type: "NEW_DOCUMENT", source: "\\draw (0,0)--(1,0);", title: "Doc B" });
    expect(withSecond.tabOrder).toHaveLength(2);
    expect(withSecond.documents[withSecond.activeDocumentId]?.title).toBe("Doc B");

    const firstId = initial.activeDocumentId;
    const switched = editorReducer(withSecond, { type: "SWITCH_DOCUMENT", documentId: firstId });
    expect(switched.activeDocumentId).toBe(firstId);
    expect(switched.source).toBe(initial.source);
  });

  it("keeps history/source isolated per document", () => {
    const initial = makeInitialState();
    const firstId = initial.activeDocumentId;
    const withSecond = editorReducer(initial, { type: "NEW_DOCUMENT", source: "\\draw (2,2)--(3,3);", title: "Doc B" });
    const secondId = withSecond.activeDocumentId;

    const editedSecond = editorReducer(withSecond, { type: "CODE_EDITED", source: "\\draw (9,9)--(10,10);" });
    expect(editedSecond.documents[secondId]?.source).toContain("(9,9)");

    const switchedBack = editorReducer(editedSecond, { type: "SWITCH_DOCUMENT", documentId: firstId });
    expect(switchedBack.source).toBe(initial.source);
  });

  it("closes tabs and falls back to a fresh doc after close-all", () => {
    const initial = makeInitialState();
    const withSecond = editorReducer(initial, { type: "NEW_DOCUMENT", source: "\\draw (2,2)--(3,3);", title: "Doc B" });
    const closedActive = editorReducer(withSecond, { type: "CLOSE_DOCUMENT" });
    expect(closedActive.tabOrder).toHaveLength(1);

    const closedAll = editorReducer(closedActive, { type: "CLOSE_ALL_DOCUMENTS" });
    expect(closedAll.tabOrder).toHaveLength(1);
    expect(closedAll.documents[closedAll.activeDocumentId]?.title).toContain("Untitled");
  });

  it("tracks dirty and save transitions per document", () => {
    const initial = makeInitialState();
    const edited = editorReducer(initial, { type: "CODE_EDITED", source: `${initial.source}\n% changed` });
    expect(edited.documents[edited.activeDocumentId]?.dirty).toBe(true);

    const saved = editorReducer(edited, {
      type: "MARK_DOCUMENT_SAVED",
      fileRef: { kind: "file", name: "diagram.tex" }
    });
    expect(saved.documents[saved.activeDocumentId]?.dirty).toBe(false);
    expect(saved.documents[saved.activeDocumentId]?.title).toBe("diagram.tex");
  });

  it("opens examples in a new tab session", () => {
    const initial = makeInitialState();
    const next = editorReducer(initial, {
      type: "OPEN_EXAMPLE_IN_NEW_TAB",
      source: "\\begin{tikzpicture}\\draw (0,0) circle (1);\\end{tikzpicture}",
      title: "Circle Example"
    });
    expect(next.tabOrder).toHaveLength(2);
    expect(next.documents[next.activeDocumentId]?.title).toBe("Circle Example");
  });
});
