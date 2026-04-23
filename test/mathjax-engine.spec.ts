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

  function installFakeBrowserMathJax(): {
    outputJax: {
      linebreaks: { getReports: () => Array<Record<string, unknown>> };
      knuthPlassOptions?: Record<string, unknown>;
    };
  } {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };
    target.window = {};
    target.document = {};

    const reports: Array<Record<string, unknown>> = [];
    const outputJax: {
      linebreaks: { getReports: () => Array<Record<string, unknown>> };
      knuthPlassOptions?: Record<string, unknown>;
    } = {
      linebreaks: {
        getReports: () => reports
      }
    };

    const makeNode = (paragraphId: string) => ({
      tagName: "mjx-container",
      querySelector: () => ({
        getAttribute: (name: string) => (name === "viewBox" ? "0 0 1000 500" : null),
        innerHTML: `<g data-paragraph-id="${paragraphId}"></g>`
      })
    });

    target.MathJax = {
      tex2svg: () => {
        const paragraphId = `paragraph:${reports.length + 1}`;
        reports.push({
          paragraphId,
          width: 4,
          alignment: "ragged-right",
          layoutMode: outputJax.knuthPlassOptions?.layoutMode ?? "wrap",
          lines: [],
          runs: [],
          errors: [],
          internalMode: "canonical",
          internalDegradeReason: null,
          externalFallbackUsed: false,
          linebreakingMode: "feasible"
        });
        return makeNode(paragraphId);
      },
      startup: {
        adaptor: {
          firstChild: (node: { querySelector: () => unknown }) => node.querySelector(),
          getAttribute: (node: { getAttribute: (name: string) => string | null }, name: string) => node.getAttribute(name),
          innerHTML: (node: { innerHTML: string }) => node.innerHTML
        },
        output: outputJax,
        document: { outputJax }
      }
    };

    return { outputJax };
  }

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

  it("reports fixed-lines layout mode for explicit multiline without text width", async () => {
    installFakeBrowserMathJax();

    const { createMathJaxNodeTextEngine, getActiveMathJaxOutputJax } = await import("../packages/core/src/text/mathjax-engine.js");
    const { getKnuthPlassReportsFromOutputJax } = await import("../packages/core/src/text/knuth-plass/index.js");
    const engine = await createMathJaxNodeTextEngine();

    const measured = engine.measure({
      text: String.raw`a \\ variable`,
      textWidthPt: null,
      alignment: "ragged-right",
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: 10
    });

    expect(measured?.paragraphId).toBeTruthy();
    const reports = getKnuthPlassReportsFromOutputJax(getActiveMathJaxOutputJax());
    const report = reports.find((entry) => entry.paragraphId === measured?.paragraphId);
    expect(report?.layoutMode).toBe("fixed-lines");
  });

  it("reports wrapped-explicit layout mode for explicit multiline with text width", async () => {
    installFakeBrowserMathJax();

    const { createMathJaxNodeTextEngine, getActiveMathJaxOutputJax } = await import("../packages/core/src/text/mathjax-engine.js");
    const { getKnuthPlassReportsFromOutputJax } = await import("../packages/core/src/text/knuth-plass/index.js");
    const engine = await createMathJaxNodeTextEngine();

    const measured = engine.measure({
      text: String.raw`Alpha \\[10pt] Beta \\ Gamma Delta`,
      textWidthPt: 120,
      alignment: "center",
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: 10
    });

    expect(measured?.paragraphId).toBeTruthy();
    const reports = getKnuthPlassReportsFromOutputJax(getActiveMathJaxOutputJax());
    const report = reports.find((entry) => entry.paragraphId === measured?.paragraphId);
    expect(report?.layoutMode).toBe("wrapped-explicit");
  });
});
