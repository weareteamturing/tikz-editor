/** @vitest-environment jsdom */

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorAction } from "../../packages/app/src/store/types.js";

type MockStatusBarState = {
  snapshot: {
    parseResult: { diagnostics: unknown[] };
    semanticResult: { diagnostics: unknown[] };
    incremental: null;
    scene: { elements: unknown[] };
    figures: unknown[];
  };
  activeFigureId: string | null;
  activeDocumentId: string;
  documents: Record<string, { dirty: boolean }>;
  canvasTransform: { translateX: number; translateY: number; scale: number };
  fitToContentModeActive: boolean;
  showGrid: boolean;
  selectedElementIds: Set<string>;
  pendingRequestId: string | null;
  activeCanvasDragKind: null;
  canvasStatusHint: string | null;
  dispatch: (action: EditorAction) => void;
};

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn<(action: EditorAction) => void>();
  const storeState: MockStatusBarState = {
    snapshot: {
      parseResult: { diagnostics: [] },
      semanticResult: { diagnostics: [] },
      incremental: null,
      scene: { elements: [{}, {}] },
      figures: []
    },
    activeFigureId: null,
    activeDocumentId: "doc-1",
    documents: { "doc-1": { dirty: false } },
    canvasTransform: { translateX: 0, translateY: 0, scale: 1 },
    fitToContentModeActive: false,
    showGrid: true,
    selectedElementIds: new Set(),
    pendingRequestId: null,
    activeCanvasDragKind: null,
    canvasStatusHint: null,
    dispatch
  };
  return { dispatch, storeState };
});

vi.mock("../../packages/app/src/store/store", () => ({
  useEditorStore: (selector: (state: MockStatusBarState) => unknown) => selector(mocks.storeState)
}));

vi.mock("../../packages/app/src/ui/useFrameTimingStats", () => ({
  useFrameTimingStats: () => ({
    fps: null,
    p95FrameMs: null,
    maxFrameMs: null,
    frameCount: 0,
    dragFps: null,
    dragP95FrameMs: null,
    dragMaxFrameMs: null,
    dragFrameCount: 0
  })
}));

import { StatusBar } from "../../packages/app/src/ui/StatusBar";

describe("StatusBar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.dispatch.mockReset();
    mocks.storeState.fitToContentModeActive = false;
    mocks.storeState.showGrid = true;
    mocks.storeState.canvasTransform = { translateX: 0, translateY: 0, scale: 1 };
    mocks.storeState.canvasStatusHint = null;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("requests fit to content when the fit toggle is off", async () => {
    await act(async () => {
      root.render(React.createElement(StatusBar));
    });

    const fitButton = container.querySelector<HTMLButtonElement>('button[aria-label="Fit to content"]');
    expect(fitButton).not.toBeNull();
    expect(fitButton?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      fitButton?.click();
    });

    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "REQUEST_FIT_TO_CONTENT" });
  });

  it("turns fit tracking off without requesting a fit when the fit toggle is on", async () => {
    mocks.storeState.fitToContentModeActive = true;

    await act(async () => {
      root.render(React.createElement(StatusBar));
    });

    const fitButton = container.querySelector<HTMLButtonElement>('button[aria-label="Fit to content"]');
    expect(fitButton).not.toBeNull();
    expect(fitButton?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      fitButton?.click();
    });

    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SET_FIT_TO_CONTENT_MODE", active: false });
  });

  it("dispatches the existing grid toggle from the grid button", async () => {
    await act(async () => {
      root.render(React.createElement(StatusBar));
    });

    const gridButton = container.querySelector<HTMLButtonElement>('button[aria-label="Hide grid"]');
    expect(gridButton).not.toBeNull();
    expect(gridButton?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      gridButton?.click();
    });

    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "TOGGLE_CANVAS_AID", aid: "grid" });
  });

  it("shows canvas guidance from shared UI state", async () => {
    mocks.storeState.canvasStatusHint = "Double-click path to add a point.";

    await act(async () => {
      root.render(React.createElement(StatusBar));
    });

    expect(container.textContent).toContain("Double-click path to add a point.");
  });
});
