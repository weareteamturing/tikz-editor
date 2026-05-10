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
    texCalls: string[];
  } {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };
    target.window = {};
    target.document = {};

    const reports: Array<Record<string, unknown>> = [];
    const texCalls: string[] = [];
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
      tex2svg: (tex: string) => {
        texCalls.push(tex);
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

    return { outputJax, texCalls };
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

  it("finishes queued async renders for explicit multiline text", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };
    const reports: Array<Record<string, unknown>> = [];
    const outputJax = {
      linebreaks: {
        getReports: () => reports
      }
    };
    const makeNode = (paragraphId: string) => ({
      tagName: "svg",
      getAttribute: (name: string) => (name === "viewBox" ? "0 0 1000 500" : null),
      innerHTML: `<g data-paragraph-id="${paragraphId}"></g>`
    });
    const tex2svgPromise = vi.fn(async () => {
      const paragraphId = `async:${reports.length + 1}`;
      reports.push({
        paragraphId,
        width: 1200,
        alignment: "ragged-right",
        layoutMode: "fixed-lines",
        lines: [{ naturalWidth: 1100 }],
        runs: [{ width: 1100 }],
        errors: [],
        internalMode: "canonical",
        internalDegradeReason: null,
        externalFallbackUsed: false,
        linebreakingMode: "feasible"
      });
      return makeNode(paragraphId);
    });

    target.window = {};
    target.document = {};
    target.MathJax = {
      tex2svg: () => {
        throw new Error(RETRY_MESSAGE);
      },
      tex2svgPromise,
      startup: {
        output: outputJax
      }
    };

    const { createMathJaxNodeTextEngine } = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await createMathJaxNodeTextEngine();

    expect(engine.validate(String.raw`Alpha \\ Beta`)).toBeNull();
    const changedKeys = await engine.flushPending?.();

    expect(changedKeys?.length).toBe(1);
    expect(tex2svgPromise.mock.calls.length).toBeGreaterThan(4);
    expect(engine.renderFromCache(changedKeys?.[0] ?? "")?.body).toContain("async:");
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

  it("normalizes legacy font switches and records wrapped text gap metadata", async () => {
    const { outputJax, texCalls } = installFakeBrowserMathJax();

    const { createMathJaxNodeTextEngine } = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await createMathJaxNodeTextEngine();

    const measured = engine.measure({
      text: String.raw`\ttfamily First.  Next \normalfont plain \bfseries bold \mdseries medium \itshape italic \upshape upright`,
      textWidthPt: 72,
      alignment: "center",
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: 20
    });

    expect(measured?.width).toBeCloseTo(20);
    expect(outputJax.knuthPlassOptions?.alignment).toBe("center");
    expect(outputJax.knuthPlassOptions?.layoutMode).toBe("wrap");
    expect(outputJax.knuthPlassOptions?.wrappedTextGaps).toContainEqual({
      sourceStart: 7,
      widthEm: 0.5
    });
    expect(texCalls.at(-1)).toMatch(/\\parbox\[t\]\{35\.865504pt\}/);
    expect(texCalls.at(-1)).not.toContain(String.raw`\ttfamily`);
    expect(texCalls.at(-1)).not.toContain(String.raw`\bfseries`);
    expect(texCalls.at(-1)).toContain(String.raw`\hspace{0.5em}`);
  });

  it("configures and loads MathJax through a browser startup script", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };
    const reports: Array<Record<string, unknown>> = [];
    const outputJax = {
      linebreaks: {
        getReports: () => reports
      },
      knuthPlassOptions: {}
    };
    const makeNode = (paragraphId: string) => ({
      tagName: "mjx-container",
      querySelector: () => ({
        getAttribute: (name: string) => (name === "viewBox" ? "0 0 800 400" : null),
        innerHTML: `<g data-paragraph-id="${paragraphId}"></g>`
      })
    });
    const adaptor = {
      firstChild: (node: { querySelector: () => unknown }) => node.querySelector(),
      getAttribute: (node: { getAttribute: (name: string) => string | null }, name: string) => node.getAttribute(name),
      innerHTML: (node: { innerHTML: string }) => node.innerHTML
    };
    const listeners = new Map<string, () => void>();
    const script = {
      setAttribute: vi.fn(),
      addEventListener: (name: string, listener: () => void) => {
        listeners.set(name, listener);
      },
      removeEventListener: vi.fn()
    };

    target.window = {};
    delete target.MathJax;
    target.document = {
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => script),
      head: {
        appendChild: vi.fn(() => {
          target.MathJax = {
            tex2svg: () => {
              const paragraphId = `script:${reports.length + 1}`;
              reports.push({
                paragraphId,
                width: 3,
                alignment: "ragged-right",
                layoutMode: outputJax.knuthPlassOptions.layoutMode ?? "wrap",
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
              promise: Promise.resolve(),
              adaptor,
              output: outputJax,
              document: { outputJax }
            }
          };
          listeners.get("load")?.();
        })
      }
    };

    const { createMathJaxNodeTextEngine, getActiveMathJaxOutputJax } = await import(
      "../packages/core/src/text/mathjax-engine.js"
    );
    const engine = await createMathJaxNodeTextEngine({ font: "mathjax-stix2" });
    const measured = engine.measure({
      text: "Loaded runtime",
      textWidthPt: 40,
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: 10
    });

    expect(script.setAttribute).toHaveBeenCalledWith("data-tikz-editor-mathjax", "startup");
    expect(getActiveMathJaxOutputJax()).toBe(outputJax);
    expect(measured?.paragraphId).toBe("script:1");
    expect(outputJax.knuthPlassOptions.layoutMode).toBe("wrap");
  });
});
