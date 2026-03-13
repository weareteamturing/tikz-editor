import { beforeEach, describe, expect, it } from "vitest";
import { setActiveEditorPlatform } from "../packages/app/src/platform/current.js";
import { loadWorkspaceSeed, saveWorkspace } from "../packages/app/src/store/workspace-storage.js";

function setupMemoryPersistence(seed?: string) {
  const map = new Map<string, string>();
  if (seed) {
    map.set("tikz-editor:workspace", seed);
  }
  setActiveEditorPlatform({
    id: "test",
    persistence: {
      load: (key) => map.get(key) ?? null,
      save: (key, value) => {
        map.set(key, value);
      }
    }
  });
  return map;
}

describe("workspace storage migration", () => {
  beforeEach(() => {
    setupMemoryPersistence();
  });

  it("migrates v1 fileRef payloads into current seed shape", () => {
    const map = setupMemoryPersistence(JSON.stringify({
      workspaceVersion: 1,
      documents: [
        {
          id: "doc-1",
          title: "Doc",
          source: "\\draw (0,0)--(1,1);",
          savedSource: "\\draw (0,0)--(1,1);",
          fileRef: { kind: "file", name: "old.tex" },
          assistantThreadId: "thr_123",
          assistantWorkspacePath: "/tmp/codex/doc-1",
          assistantFigurePath: "/tmp/codex/doc-1/figure.tex",
          assistantPreviewPath: "/tmp/codex/doc-1/current.png"
        }
      ],
      tabOrder: ["doc-1"],
      activeDocumentId: "doc-1",
      recentDocumentIds: ["doc-1"]
    }));
    expect(map.get("tikz-editor:workspace")).toBeTruthy();

    const seed = loadWorkspaceSeed();
    expect(seed).not.toBeNull();
    expect(seed?.workspaceVersion).toBe(3);
    expect(seed?.documents[0]?.fileRef?.kind).toBe("file");
    expect(seed?.documents[0]?.fileRef?.name).toBe("old.tex");
    expect(seed?.documents[0]?.assistantThreadId).toBe("thr_123");
  });

  it("round-trips browser file refs with handle metadata", () => {
    saveWorkspace({
      workspaceVersion: 3,
      documents: {
        "doc-1": {
          id: "doc-1",
          title: "Doc",
          source: "\\draw (0,0)--(1,1);",
          activeFigureId: null,
          savedSource: "\\draw (0,0)--(1,1);",
          fileRef: {
            kind: "browser-file",
            name: "bound.tex",
            handleId: "handle-123",
            provider: "browser-fsa"
          },
          assistantThreadId: "thr_saved",
          assistantWorkspacePath: "/tmp/codex/doc-1",
          assistantFigurePath: "/tmp/codex/doc-1/figure.tex",
          assistantPreviewPath: "/tmp/codex/doc-1/current.png"
        }
      },
      tabOrder: ["doc-1"],
      activeDocumentId: "doc-1",
      recentDocumentIds: ["doc-1"]
    });

    const seed = loadWorkspaceSeed();
    expect(seed?.documents[0]?.fileRef).toEqual({
      kind: "browser-file",
      name: "bound.tex",
      handleId: "handle-123",
      provider: "browser-fsa"
    });
    expect(seed?.documents[0]?.assistantThreadId).toBe("thr_saved");
    expect(seed?.recentDocumentIds).toEqual(["doc-1"]);
  });
});
