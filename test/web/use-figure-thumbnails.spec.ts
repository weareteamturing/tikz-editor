/** @vitest-environment jsdom */

import React, { createElement, useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFigureThumbnails } from "../../packages/app/src/ui/useFigureThumbnails";

vi.mock("../../packages/app/src/ui/workers/thumbnail-worker-client", () => ({
  requestThumbnail: vi.fn(),
  cancelGroup: vi.fn()
}));

import { cancelGroup, requestThumbnail } from "../../packages/app/src/ui/workers/thumbnail-worker-client";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type FigureEntry = {
  id: string;
  span: { from: number; to: number };
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function Harness(props: {
  source: string;
  figures: readonly FigureEntry[];
  onUpdate: (value: ReadonlyMap<string, string>) => void;
}) {
  const thumbnails = useFigureThumbnails(props.source, props.figures as any, {
    maxToRender: 4,
    refreshDelayMs: 0
  });

  useEffect(() => {
    props.onUpdate(new Map(thumbnails));
  }, [thumbnails, props]);

  return null;
}

describe("useFigureThumbnails", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("cancels stale groups and ignores stale results after source changes", async () => {
    const pendingOld = createDeferred<any>();
    const pendingNew = createDeferred<any>();
    vi.mocked(requestThumbnail)
      .mockReturnValueOnce(pendingOld.promise)
      .mockReturnValueOnce(pendingNew.promise);

    let latest = new Map<string, string>();
    const figure = { id: "figure:0", span: { from: 0, to: 1000 } };
    const figures = [figure] as const;
    const sourceA = "\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}";
    const sourceB = "\\begin{tikzpicture}\\draw (0,0)--(2,2);\\end{tikzpicture}\n%changed";

    await act(async () => {
      root.render(createElement(Harness, {
        source: sourceA,
        figures,
        onUpdate: (value: ReadonlyMap<string, string>) => { latest = value; }
      }));
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });
    expect(requestThumbnail).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(createElement(Harness, {
        source: sourceB,
        figures,
        onUpdate: (value: ReadonlyMap<string, string>) => { latest = value; }
      }));
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });

    await waitForCondition(() => vi.mocked(requestThumbnail).mock.calls.length >= 2);
    expect(requestThumbnail).toHaveBeenCalledTimes(2);
    expect(vi.mocked(cancelGroup).mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(latest.get("figure:0")).toBeUndefined();

    pendingOld.resolve({
      type: "result",
      ok: true,
      requestId: "old",
      groupId: "old-group",
      figureId: "figure:0",
      figureSignature: "old-sig",
      svg: "<svg>old</svg>"
    });
    await act(async () => {
      await flushMicrotasks();
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });
    expect(latest.get("figure:0")).toBeUndefined();

    pendingNew.resolve({
      type: "result",
      ok: true,
      requestId: "new",
      groupId: "new-group",
      figureId: "figure:0",
      figureSignature: "new-sig",
      svg: "<svg>new</svg>"
    });
    await act(async () => {
      await flushMicrotasks();
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });

    expect(latest.get("figure:0")).toContain("%3Csvg%3Enew%3C%2Fsvg%3E");
  });

  it("keeps last thumbnail visible while next render is pending", async () => {
    const pendingFirst = createDeferred<any>();
    const pendingSecond = createDeferred<any>();
    vi.mocked(requestThumbnail)
      .mockReturnValueOnce(pendingFirst.promise)
      .mockReturnValueOnce(pendingSecond.promise);

    let latest = new Map<string, string>();
    const figure = { id: "figure:0", span: { from: 0, to: 1000 } };
    const figures = [figure] as const;
    const sourceA = "\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}";
    const sourceB = "\\begin{tikzpicture}\\draw (0,0)--(3,3);\\end{tikzpicture}\n%changed";

    await act(async () => {
      root.render(createElement(Harness, {
        source: sourceA,
        figures,
        onUpdate: (value: ReadonlyMap<string, string>) => { latest = value; }
      }));
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });

    pendingFirst.resolve({
      type: "result",
      ok: true,
      requestId: "first",
      groupId: "grp-1",
      figureId: "figure:0",
      figureSignature: "sig-1",
      svg: "<svg>first</svg>"
    });
    await act(async () => {
      await flushMicrotasks();
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });
    await waitForCondition(() => latest.get("figure:0") != null);
    const firstUrl = latest.get("figure:0");
    expect(firstUrl).toContain("%3Csvg%3Efirst%3C%2Fsvg%3E");

    await act(async () => {
      root.render(createElement(Harness, {
        source: sourceB,
        figures,
        onUpdate: (value: ReadonlyMap<string, string>) => { latest = value; }
      }));
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });

    await waitForCondition(() => vi.mocked(requestThumbnail).mock.calls.length >= 2);
    expect(requestThumbnail).toHaveBeenCalledTimes(2);
    expect(latest.get("figure:0")).toBe(firstUrl);

    pendingSecond.resolve({
      type: "result",
      ok: true,
      requestId: "second",
      groupId: "grp-2",
      figureId: "figure:0",
      figureSignature: "sig-2",
      svg: "<svg>second</svg>"
    });
    await act(async () => {
      await flushMicrotasks();
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });

    expect(latest.get("figure:0")).toContain("%3Csvg%3Esecond%3C%2Fsvg%3E");
  });
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForCondition(predicate: () => boolean, maxAttempts = 30): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (predicate()) {
      return;
    }
    await act(async () => {
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });
  }
  throw new Error("Timed out waiting for condition");
}
