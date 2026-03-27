/** @vitest-environment jsdom */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "../../packages/app/src/store/store";
import { renderTikzToSvg } from "../../packages/core/src/render";
import {
  clickAndTypeRawValue,
  clickButton,
  commitEditableInput,
  mountStylesPanel,
  seedStylesPanelState,
  unmountStylesPanel
} from "./styles-panel-test-helpers";

vi.mock("../../packages/app/src/edit-analysis-manager", () => ({
  getSharedEditAnalysisView: () => ({ kind: "test-analysis" }),
  getSharedEditAnalysisSession: () => null
}));

vi.mock("../../packages/app/src/project-named-colors", () => ({
  useProjectNamedColorSwatches: () => []
}));

function firstPathIds(source: string, count: number): string[] {
  const rendered = renderTikzToSvg(source, { parse: { recover: true } });
  const ids = rendered.semantic.scene.elements
    .filter((entry) => entry.kind === "Path")
    .slice(0, count)
    .map((entry) => entry.sourceRef.sourceId);
  if (ids.length !== count) {
    throw new Error(`Expected ${count} path ids, got ${ids.length}`);
  }
  return ids;
}

describe("StylesPanel integration", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.querySelectorAll(".menuFixed").forEach((entry) => entry.remove());
  });

  it("updates source when renaming a flag key", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fooflag,draw=red] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [pathId] = firstPathIds(source, 1);
    seedStylesPanelState(source, [pathId]);

      const { container, root } = await mountStylesPanel();
    try {
      const keyInputs = Array.from(container.querySelectorAll('input[aria-label="Property name"]')) as HTMLInputElement[];
      const flagInput = keyInputs.find((entry) => entry.value === "fooflag");
      expect(flagInput).toBeDefined();

      await commitEditableInput(flagInput!, "barflag");

      const updatedSource = useEditorStore.getState().source;
      expect(updatedSource).toContain("barflag");
      expect(updatedSource).not.toContain("fooflag");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("updates source when deleting an option", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red,line width=1pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [pathId] = firstPathIds(source, 1);
    seedStylesPanelState(source, [pathId]);

    const { container, root } = await mountStylesPanel();
    try {
      const deleteButton = container.querySelector('button[aria-label="Delete draw"]') as HTMLButtonElement | null;
      expect(deleteButton).not.toBeNull();

      await clickButton(deleteButton!);

      const updatedSource = useEditorStore.getState().source;
      expect(updatedSource).not.toContain("draw=red");
      expect(updatedSource).toContain("line width=1pt");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("updates raw unsupported option values", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[foo=bar,draw=red] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [pathId] = firstPathIds(source, 1);
    seedStylesPanelState(source, [pathId]);

    const { container, root } = await mountStylesPanel();
    try {
      const valueButton = Array.from(container.querySelectorAll("button"))
        .find((entry) => entry.textContent?.trim() === "bar") as HTMLButtonElement | undefined;
      expect(valueButton).toBeDefined();

      await clickAndTypeRawValue(valueButton!, "bar", "baz");
      const updated = useEditorStore.getState().source;
      expect(updated).toContain("foo=baz");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("adds known template properties with default values", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [pathId] = firstPathIds(source, 1);
    seedStylesPanelState(source, [pathId]);

    const { container, root } = await mountStylesPanel();
    try {
      const addButton = Array.from(container.querySelectorAll("button"))
        .find((entry) => entry.textContent?.trim() === "+") as HTMLButtonElement | undefined;
      expect(addButton).toBeDefined();
      await clickButton(addButton!);

      const newPropInput = container.querySelector('input[aria-label="New property name"]') as HTMLInputElement | null;
      expect(newPropInput).not.toBeNull();
      await commitEditableInput(newPropInput!, "line width");

      const updated = useEditorStore.getState().source;
      expect(updated).toContain("line width=");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("adds unknown properties as flags", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [pathId] = firstPathIds(source, 1);
    seedStylesPanelState(source, [pathId]);

    const { container, root } = await mountStylesPanel();
    try {
      const addButton = Array.from(container.querySelectorAll("button"))
        .find((entry) => entry.textContent?.trim() === "+") as HTMLButtonElement | undefined;
      expect(addButton).toBeDefined();
      await clickButton(addButton!);

      const newPropInput = container.querySelector('input[aria-label="New property name"]') as HTMLInputElement | null;
      expect(newPropInput).not.toBeNull();
      await commitEditableInput(newPropInput!, "foobarflag");

      const updated = useEditorStore.getState().source;
      expect(updated).toContain("foobarflag");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("updates displayed raw values on external source refresh", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[foo=bar,help lines] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [pathId] = firstPathIds(source, 1);
    seedStylesPanelState(source, [pathId]);

    const { container, root } = await mountStylesPanel();
    try {
      const barBefore = Array.from(container.querySelectorAll("button"))
        .find((entry) => entry.textContent?.trim() === "bar");
      expect(barBefore).toBeDefined();

      const refreshedSource = String.raw`\begin{tikzpicture}
  \draw[foo=baz,help lines] (0,0) -- (1,0);
\end{tikzpicture}`;
      await act(async () => {
        seedStylesPanelState(refreshedSource, [pathId]);
      });

      const barAfter = Array.from(container.querySelectorAll("button"))
        .find((entry) => entry.textContent?.trim() === "baz");
      expect(barAfter).toBeDefined();
      expect(useEditorStore.getState().source).toContain("foo=baz");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("applies shared-cascade edits across multi-selection", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fooflag,draw=red] (0,0) -- (1,0);
  \draw[fooflag,draw=red] (0,1) -- (1,1);
\end{tikzpicture}`;
    const pathIds = firstPathIds(source, 2);
    seedStylesPanelState(source, pathIds);

    const { container, root } = await mountStylesPanel();
    try {
      const keyInputs = Array.from(container.querySelectorAll('input[aria-label="Property name"]')) as HTMLInputElement[];
      const flagInput = keyInputs.find((entry) => entry.value === "fooflag");
      expect(flagInput).toBeDefined();

      await commitEditableInput(flagInput!, "barflag");

      const updatedSource = useEditorStore.getState().source;
      expect((updatedSource.match(/barflag/g) ?? []).length).toBe(2);
      expect(updatedSource).not.toContain("fooflag");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });
});
