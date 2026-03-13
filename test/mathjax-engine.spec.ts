import { afterEach, describe, expect, it, vi } from "vitest";

const RETRY_MESSAGE =
  "MathJax retry -- an asynchronous action is required; try using one of the promise-based functions and await its resolution.";

type GlobalsSnapshot = {
  window: unknown;
  document: unknown;
  mathJax: unknown;
  self: unknown;
};

function snapshotGlobals(): GlobalsSnapshot {
  const target = globalThis as {
    window?: unknown;
    document?: unknown;
    MathJax?: unknown;
    self?: unknown;
  };
  return {
    window: target.window,
    document: target.document,
    mathJax: target.MathJax,
    self: target.self
  };
}

function restoreGlobals(snapshot: GlobalsSnapshot): void {
  const target = globalThis as {
    window?: unknown;
    document?: unknown;
    MathJax?: unknown;
    self?: unknown;
  };

  if (snapshot.window === undefined) {
    delete target.window;
  } else {
    target.window = snapshot.window;
  }

  if (snapshot.document === undefined) {
    delete target.document;
  } else {
    target.document = snapshot.document;
  }

  if (snapshot.mathJax === undefined) {
    delete target.MathJax;
  } else {
    target.MathJax = snapshot.mathJax;
  }

  if (snapshot.self === undefined) {
    delete target.self;
  } else {
    target.self = snapshot.self;
  }
}

describe("mathjax node text engine", () => {
  const initialGlobals = snapshotGlobals();

  afterEach(() => {
    restoreGlobals(initialGlobals);
    vi.resetModules();
  });

  it("treats MathJax async retry as transient during validation", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };

    const tex2svgPromise = vi.fn(async () => ({
      tagName: "svg",
      getAttribute: (name: string) => (name === "viewBox" ? "0 0 1000 1000" : null),
      innerHTML: "<g></g>"
    }));

    target.window = {};
    target.document = {};
    target.MathJax = {
      tex2svg: () => {
        throw new Error(RETRY_MESSAGE);
      },
      tex2svgPromise,
      startup: {}
    };

    const { createMathJaxNodeTextEngine } = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await createMathJaxNodeTextEngine();

    const issue = engine.validate(String.raw`$\ell^2$`);

    expect(issue).toBeNull();
    expect(tex2svgPromise.mock.calls.length).toBeGreaterThan(6);
  });

  it("still returns invalid-node-tex for hard TeX errors", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };

    target.window = {};
    target.document = {};
    target.MathJax = {
      tex2svg: () => {
        throw new Error("Undefined control sequence");
      },
      startup: {}
    };

    const { createMathJaxNodeTextEngine } = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await createMathJaxNodeTextEngine();

    const issue = engine.validate(String.raw`$\unknownmacro$`);

    expect(issue).toEqual({
      code: "invalid-node-tex",
      message: "Undefined control sequence"
    });
  });

  it("reports finalized cache keys from flushPending", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };

    target.window = {};
    target.document = {};
    target.MathJax = {
      tex2svg: () => {
        throw new Error(RETRY_MESSAGE);
      },
      tex2svgPromise: async () => ({
        tagName: "svg",
        getAttribute: (name: string) => (name === "viewBox" ? "0 0 1000 500" : null),
        innerHTML: "<g data-test='pending'></g>"
      }),
      startup: {}
    };

    const { createMathJaxNodeTextEngine } = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await createMathJaxNodeTextEngine();

    const measured = engine.measure({
      text: String.raw`$\ell^2$`,
      textWidthPt: null,
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: 10
    });
    expect(measured).toBeNull();

    const changedKeys = await engine.flushPending?.();
    expect(changedKeys).toBeDefined();
    expect(changedKeys?.length ?? 0).toBeGreaterThan(0);
    for (const cacheKey of changedKeys ?? []) {
      expect(engine.renderFromCache(cacheKey)).not.toBeNull();
    }
  });

  it("initializes MathJax runtime in worker-like environments without browser globals", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
      self?: unknown;
    };

    delete target.window;
    delete target.document;
    target.self = target;

    const { createMathJaxNodeTextEngine } = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await createMathJaxNodeTextEngine();

    const issue = engine.validate(String.raw`$x+y$`);
    expect(issue).toBeNull();
  });
});
