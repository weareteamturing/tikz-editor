import { DEFAULT_TEXT_FONT_SIZE } from "../semantic/style/resolve.js";
import {
  KnuthPlassVisitor,
  getKnuthPlassReportsFromOutputJax,
  installKnuthPlassVisitor,
  setKnuthPlassOptionsOnOutputJax
} from "./knuth-plass/index.js";
import type {
  NodeTextEngine,
  NodeTextMeasureRequest,
  NodeTextMetrics,
  NodeTextParagraphAlignment,
  NodeTextRenderPayload,
  NodeTextValidationIssue
} from "./types.js";

type MathJaxAdaptor = {
  firstChild(node: unknown): unknown;
  getAttribute(node: unknown, name: string): string | null;
  innerHTML(node: unknown): string;
};

type MathJaxRuntime = {
  tex2svg(tex: string, options: { display: boolean }): unknown;
  tex2svgPromise?: (tex: string, options: { display: boolean }) => Promise<unknown>;
  outputJax?: unknown;
  startup?: {
    adaptor?: MathJaxAdaptor;
    output?: unknown;
    document?: { outputJax?: unknown } | null;
    promise?: Promise<unknown>;
  };
};

type MathJaxEntrypoint = {
  init(config: Record<string, unknown>): Promise<MathJaxRuntime>;
};

type CachedRenderEntry = {
  payload: NodeTextRenderPayload;
  baseWidthPt: number;
  baseHeightPt: number;
  baseLineYPt: number;
  midLineYPt: number;
  paragraphId: string | null;
  renderSourceText: string;
};

type TextFontOptions = {
  fontStyle: "normal" | "italic";
  fontWeight: "normal" | "bold";
  fontFamily: "serif" | "sans" | "monospace";
};

type FontSwitchRule = {
  pattern: RegExp;
  apply: (font: TextFontOptions) => void;
};

export type MathJaxFont =
  | "mathjax-newcm"
  | "mathjax-asana"
  | "mathjax-bonum"
  | "mathjax-dejavu"
  | "mathjax-fira"
  | "mathjax-modern"
  | "mathjax-pagella"
  | "mathjax-schola"
  | "mathjax-stix2"
  | "mathjax-termes"
  | "mathjax-tex";

const DEFAULT_FONT: MathJaxFont = "mathjax-newcm";
const SINGLE_LINE_RENDER_WIDTH_FUDGE_PT = 2;
const MIDLINE_FROM_BASELINE_RATIO = 0.215;
const BROWSER_STARTUP_COMPONENT_URL = "https://cdn.jsdelivr.net/npm/mathjax@4/startup.js";
const BROWSER_STARTUP_COMPONENT_ID = "tikz-editor-mathjax-startup";
const SCRIPT_LOADED_MARKER = "__tikzMathJaxLoaded";
const SCRIPT_ERROR_MARKER = "__tikzMathJaxLoadError";

const FONT_SWITCH_RULES: FontSwitchRule[] = [
  {
    pattern: /\\(?:sffamily|pgfutil@font@sffamily)(?=(?:[^A-Za-z@]|$))/g,
    apply: (font) => {
      font.fontFamily = "sans";
    }
  },
  {
    pattern: /\\(?:ttfamily|pgfutil@font@ttfamily)(?=(?:[^A-Za-z@]|$))/g,
    apply: (font) => {
      font.fontFamily = "monospace";
    }
  },
  {
    pattern: /\\(?:rmfamily|pgfutil@font@rmfamily|normalfont)(?=(?:[^A-Za-z@]|$))/g,
    apply: (font) => {
      font.fontFamily = "serif";
      font.fontStyle = "normal";
      font.fontWeight = "normal";
    }
  },
  {
    pattern: /\\(?:bfseries|pgfutil@font@bfseries)(?=(?:[^A-Za-z@]|$))/g,
    apply: (font) => {
      font.fontWeight = "bold";
    }
  },
  {
    pattern: /\\(?:mdseries|pgfutil@font@mdseries)(?=(?:[^A-Za-z@]|$))/g,
    apply: (font) => {
      font.fontWeight = "normal";
    }
  },
  {
    pattern: /\\(?:itshape|slshape|pgfutil@font@itshape|pgfutil@font@slshape)(?=(?:[^A-Za-z@]|$))/g,
    apply: (font) => {
      font.fontStyle = "italic";
    }
  },
  {
    pattern: /\\(?:upshape|pgfutil@font@upshape)(?=(?:[^A-Za-z@]|$))/g,
    apply: (font) => {
      font.fontStyle = "normal";
    }
  }
];

let sharedEnginePromise: Promise<NodeTextEngine> | null = null;
let browserRuntimePromise: Promise<MathJaxRuntime> | null = null;
let moduleWorkerRuntimePromise: Promise<MathJaxRuntime> | null = null;
let activeBrowserFont: MathJaxFont = DEFAULT_FONT;

type WorkerFontLoader = (name: string) => Promise<unknown>;
let workerFontLoader: WorkerFontLoader | null = null;
const EXPLICIT_LINE_BREAK_TOKEN_PATTERN = /\\\\(?:\[[^\]]*\])?/;
const EXPLICIT_LINE_BREAK_BOUNDARY_PATTERN = /[ \t\r\n]*\\\\(?:\[[^\]]*\])?[ \t\r\n]*/g;
const EXPLICIT_LINE_BREAK_CANONICAL_PATTERN = /[ \t\r\n]*(\\\\(?:\[[^\]]*\])?)[ \t\r\n]*/g;
const EXPLICIT_LINE_BREAK_WITH_LEADING_PATTERN = /[ \t\r\n]*\\\\(?:\[([^\]]*)\])?[ \t\r\n]*/g;
const MATHJAX_ARRAY_VERTICAL_PADDING_UNITS = 175;

/**
 * Register a font loader for the worker runtime. Must be called before the first
 * render so that mathjax.asyncLoad can route bare-specifier font imports through
 * Vite-bundled lazy chunks instead of failing with a module resolution error.
 */
export function setWorkerFontLoader(loader: WorkerFontLoader): void {
  workerFontLoader = loader;
}

export async function createMathJaxNodeTextEngine(options?: { font?: MathJaxFont }): Promise<NodeTextEngine> {
  const font = options?.font ?? DEFAULT_FONT;
  if (hasBrowserDomGlobals() && font !== activeBrowserFont) {
    activeBrowserFont = font;
    sharedEnginePromise = null;
    browserRuntimePromise = null;
    resetBrowserMathJax();
  }
  if (!sharedEnginePromise) {
    sharedEnginePromise = initializeEngine(font);
  }
  try {
    return await sharedEnginePromise;
  } catch (error) {
    sharedEnginePromise = null;
    throw error;
  }
}

export function getActiveMathJaxOutputJax(): unknown | null {
  const browserRuntime = (globalThis as { MathJax?: MathJaxRuntime }).MathJax;
  return (
    browserRuntime?.outputJax ??
    browserRuntime?.startup?.output ??
    browserRuntime?.startup?.document?.outputJax ??
    null
  );
}

async function initializeEngine(font: MathJaxFont): Promise<NodeTextEngine> {
  const runtime = hasBrowserDomGlobals()
    ? await initializeBrowserRuntime(font)
    : hasWorkerRuntimeGlobals()
      ? await initializeWorkerRuntime()
      : await initializeNodeRuntime();
  await preloadMathJaxWarmupExpressions(runtime);

  const cache = new Map<string, CachedRenderEntry>();
  const validationCache = new Map<string, NodeTextValidationIssue | null>();
  const pendingAsyncRenders = new Set<Promise<void>>();
  const finalizedPendingCacheKeys = new Set<string>();

  return {
    validate(text: string): NodeTextValidationIssue | null {
      if (validationCache.has(text)) {
        return validationCache.get(text) ?? null;
      }

      const prepared = normalizeMathJaxTextInput(text, {
        fontStyle: "normal",
        fontWeight: "normal",
        fontFamily: "serif"
      });
      const defaultMeasureKey = measurementKey("text", prepared.text, null, prepared.font, null);

      try {
        if (!cache.has(defaultMeasureKey)) {
          const entry = buildMeasuredCacheEntry({
            runtime,
            cacheKey: defaultMeasureKey,
            sourceText: prepared.text,
            textWidthPt: null,
            font: prepared.font,
            mode: "text",
            alignment: null
          });
          if (entry) {
            cache.set(defaultMeasureKey, entry);
          }
        }
        validationCache.set(text, null);
        return null;
      } catch (error) {
        if (isMathJaxAsyncRetryError(error)) {
          queueAsyncCachePopulate(runtime, cache, pendingAsyncRenders, finalizedPendingCacheKeys, {
            cacheKey: defaultMeasureKey,
            sourceText: prepared.text,
            textWidthPt: null,
            font: prepared.font,
            mode: "text",
            alignment: null
          });
          validationCache.set(text, null);
          return null;
        }
        const issue = {
          code: "invalid-node-tex",
          message: sanitizeErrorMessage(error)
        };
        validationCache.set(text, issue);
        return issue;
      }
    },
    measure(request: NodeTextMeasureRequest): NodeTextMetrics | null {
      const scale = computeFontScale(request.fontSizePt);
      const normalizedWidth = request.textWidthPt == null ? null : request.textWidthPt / scale;
      const mode = request.mode ?? "text";
      const prepared = normalizeMathJaxTextInput(request.text, {
        fontStyle: request.fontStyle,
        fontWeight: request.fontWeight,
        fontFamily: request.fontFamily
      });
      const alignment = resolveParagraphAlignment(request.textWidthPt, request.alignment);
      const cacheKey = measurementKey(mode, prepared.text, normalizedWidth, prepared.font, alignment);

      let entry: CachedRenderEntry | null = cache.get(cacheKey) ?? null;
      if (!entry) {
        try {
          entry = buildMeasuredCacheEntry({
            runtime,
            cacheKey,
            sourceText: prepared.text,
            textWidthPt: normalizedWidth,
            font: prepared.font,
            mode,
            alignment
          });
          if (!entry) {
            return null;
          }
          cache.set(cacheKey, entry);
          validationCache.set(request.text, null);
        } catch (error) {
          if (isMathJaxAsyncRetryError(error)) {
            queueAsyncCachePopulate(runtime, cache, pendingAsyncRenders, finalizedPendingCacheKeys, {
              cacheKey,
              sourceText: prepared.text,
              textWidthPt: normalizedWidth,
              font: prepared.font,
              mode,
              alignment
            });
            validationCache.set(request.text, null);
          }
          return null;
        }
      }

      return {
        cacheKey,
        width: entry.baseWidthPt * scale,
        height: entry.baseHeightPt * scale,
        baselineY: entry.baseLineYPt * scale,
        midLineY: entry.midLineYPt * scale,
        paragraphId: entry.paragraphId,
        renderSourceText: entry.renderSourceText
      };
    },
    renderFromCache(cacheKey: string): NodeTextRenderPayload | null {
      return cache.get(cacheKey)?.payload ?? null;
    },
    async flushPending(): Promise<readonly string[]> {
      if (pendingAsyncRenders.size > 0) {
        do {
          const batch = [...pendingAsyncRenders];
          await Promise.allSettled(batch);
        } while (pendingAsyncRenders.size > 0);
      }
      if (finalizedPendingCacheKeys.size === 0) {
        return [];
      }
      const changedKeys = [...finalizedPendingCacheKeys].sort();
      finalizedPendingCacheKeys.clear();
      return changedKeys;
    }
  };
}

async function initializeNodeRuntime(): Promise<MathJaxRuntime> {
  const moduleId = "mathjax";
  const module = (await import(/* @vite-ignore */ moduleId)) as { default?: MathJaxEntrypoint };
  const entrypoint = module.default;
  if (!entrypoint || typeof entrypoint.init !== "function") {
    throw new Error("MathJax entrypoint is unavailable.");
  }
  return entrypoint.init(createMathJaxConfig());
}

async function initializeWorkerRuntime(): Promise<MathJaxRuntime> {
  if (!moduleWorkerRuntimePromise) {
    moduleWorkerRuntimePromise = initializeWorkerRuntimeOnce();
  }
  try {
    return await moduleWorkerRuntimePromise;
  } catch (error) {
    moduleWorkerRuntimePromise = null;
    throw error;
  }
}

async function initializeWorkerRuntimeOnce(): Promise<MathJaxRuntime> {
  const [
    { mathjax },
    { TeX },
    { SVG },
    { liteAdaptor },
    { RegisterHTMLHandler }
  ] = await Promise.all([
    import("@mathjax/src/js/mathjax.js"),
    import("@mathjax/src/js/input/tex.js"),
    import("@mathjax/src/js/output/svg.js"),
    import("@mathjax/src/js/adaptors/liteAdaptor.js"),
    import("@mathjax/src/js/handlers/html.js"),
    import("@mathjax/src/js/util/asyncLoad/esm.js"),
    import("@mathjax/src/js/input/tex/base/BaseConfiguration.js"),
    import("@mathjax/src/js/input/tex/ams/AmsConfiguration.js"),
    import("@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js"),
    import("@mathjax/src/js/input/tex/color/ColorConfiguration.js"),
    import("@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js"),
  ]);

  // Override mathjax.asyncLoad (set by asyncLoad/esm.js) so that bare-specifier
  // font imports are routed through the registered workerFontLoader (Vite lazy
  // chunks) rather than a raw import() that fails without an import map.
  // Falls back silently for any specifier not handled by the loader.
  const mjx = mathjax as { asyncLoad?: (name: string) => Promise<unknown> };
  if (typeof mjx.asyncLoad === "function") {
    const origAsyncLoad = mjx.asyncLoad;
    mjx.asyncLoad = async (name: string) => {
      if (workerFontLoader) {
        try {
          return await workerFontLoader(name);
        } catch {
          // Font subset not in the loader map; fall through to silent failure.
        }
      }
      try {
        return await origAsyncLoad(name);
      } catch {
        console.warn(`[tikz-editor] MathJax could not load dynamic font subset: ${name}`);
        return {};
      }
    };
  }

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);

  const tex = new TeX({
    packages: ["base", "ams", "newcommand", "color", "textmacros"],
    formatError: (_jax: unknown, err: Error) => {
      throw err;
    }
  });
  const svg = new SVG({
    fontCache: "none",
    linebreaks: {
      inline: false,
      LinebreakVisitor: KnuthPlassVisitor
    }
  });
  const document = mathjax.document("", {
    InputJax: tex,
    OutputJax: svg
  });

  const tex2svg = (input: string, options: { display: boolean }): unknown => {
    return document.convert(input, {
      display: options.display
    });
  };

  const runtime: MathJaxRuntime = {
    tex2svg,
    tex2svgPromise: async (input, options) => tex2svg(input, options),
    outputJax: svg,
    startup: {
      output: svg,
      adaptor: {
        firstChild(node: unknown): unknown {
          return adaptor.firstChild(node as never);
        },
        getAttribute(node: unknown, name: string): string | null {
          const value = adaptor.getAttribute(node as never, name);
          return value == null ? null : String(value);
        },
        innerHTML(node: unknown): string {
          return adaptor.innerHTML(node as never);
        }
      }
    }
  };

  const warmup = tex2svg("\\mbox{0}", { display: false });
  if (!runtime.startup?.adaptor?.firstChild(warmup)) {
    throw new Error("MathJax worker runtime did not produce SVG output.");
  }
  return runtime;
}

async function initializeBrowserRuntime(font: MathJaxFont): Promise<MathJaxRuntime> {
  if (!browserRuntimePromise) {
    browserRuntimePromise = initializeBrowserRuntimeOnce(font);
  }
  try {
    return await browserRuntimePromise;
  } catch (error) {
    browserRuntimePromise = null;
    throw error;
  }
}

async function initializeBrowserRuntimeOnce(font: MathJaxFont): Promise<MathJaxRuntime> {
  const preloadedRuntime = await readBrowserRuntime(150);
  if (preloadedRuntime) {
    return preloadedRuntime;
  }

  configureBrowserMathJaxGlobal(font);
  await ensureBrowserStartupComponentLoaded();

  const runtime = await readBrowserRuntime(5000);
  if (!runtime) {
    const observed = (globalThis as { MathJax?: unknown }).MathJax;
    throw new Error(`MathJax browser runtime is unavailable. ${formatMathJaxShape(observed)}`);
  }
  return runtime;
}

function hasBrowserDomGlobals(): boolean {
  const candidate = globalThis as { window?: unknown; document?: unknown };
  return candidate.window != null && candidate.document != null;
}

function hasWorkerImportScripts(): boolean {
  const candidate = globalThis as { importScripts?: unknown };
  return typeof candidate.importScripts === "function";
}

function hasWorkerRuntimeGlobals(): boolean {
  if (hasWorkerImportScripts()) {
    return true;
  }
  const candidate = globalThis as { window?: unknown; document?: unknown; self?: unknown };
  return candidate.window == null && candidate.document == null && candidate.self === globalThis;
}

function createMathJaxConfig(): Record<string, unknown> {
  const config = {
    loader: {
      load: ["input/tex", "output/svg", "[tex]/color", "[tex]/html"]
    },
    tex: {
      macros: {
        textsc: ["\\style{font-variant-caps: small-caps}{#1}", 1]
      },
      packages: {
        "[+]": ["color", "html"],
        "[-]": ["noundefined"]
      },
      formatError: (_jax: unknown, err: Error) => {
        throw err;
      }
    },
    svg: {
      fontCache: "none",
      linebreaks: {
        inline: false
      }
    },
    startup: {
      typeset: false
    }
  };
  installKnuthPlassVisitor(config, ["svg"]);
  return config;
}

async function readBrowserRuntime(timeoutMs: number): Promise<MathJaxRuntime | null> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  do {
    const candidate = (globalThis as { MathJax?: unknown }).MathJax;
    const runtime = await coerceBrowserRuntime(candidate);
    if (runtime) {
      return runtime;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await waitForNextTurn();
  } while (true);
}

async function coerceBrowserRuntime(candidate: unknown): Promise<MathJaxRuntime | null> {
  if (!isRecord(candidate)) {
    return null;
  }

  if (typeof candidate.tex2svg !== "function") {
    return null;
  }

  const startup = isRecord(candidate.startup) ? startupFromRecord(candidate.startup) : null;
  if (startup?.promise && isPromiseLike(startup.promise)) {
    await startup.promise;
  }

  return {
    tex2svg: candidate.tex2svg as MathJaxRuntime["tex2svg"],
    tex2svgPromise:
      typeof candidate.tex2svgPromise === "function" ? (candidate.tex2svgPromise as MathJaxRuntime["tex2svgPromise"]) : undefined,
    outputJax: startup?.output ?? startup?.document?.outputJax,
    startup: startup ?? undefined
  };
}

function configureBrowserMathJaxGlobal(font: MathJaxFont): void {
  const globals = globalThis as { MathJax?: Record<string, unknown> };
  const existing = isRecord(globals.MathJax) ? globals.MathJax : {};
  const existingLoader = isRecord(existing.loader) ? existing.loader : {};
  const existingTex = isRecord(existing.tex) ? existing.tex : {};
  const existingSvg = isRecord(existing.svg) ? existing.svg : {};
  const existingOutput = isRecord(existing.output) ? existing.output : {};
  const existingStartup = isRecord(existing.startup) ? existing.startup : {};
  const existingTexMacros = isRecord(existingTex.macros) ? existingTex.macros : {};
  const existingTexPackages = isRecord(existingTex.packages) ? existingTex.packages : {};
  const existingSvgLinebreaks = isRecord(existingSvg.linebreaks) ? existingSvg.linebreaks : {};

  const loaderLoad = uniqueStrings([...toStringArray(existingLoader.load), "input/tex", "output/svg", "[tex]/color", "[tex]/html"]);
  const enabledPackages = uniqueStrings([...toStringArray(existingTexPackages["[+]"]), "color", "html"]);
  const disabledPackages = uniqueStrings([...toStringArray(existingTexPackages["[-]"]), "noundefined"]);

  const config = {
    ...existing,
    output: {
      ...existingOutput,
      font
    },
    loader: {
      ...existingLoader,
      load: loaderLoad
    },
    tex: {
      ...existingTex,
      macros: {
        ...existingTexMacros,
        textsc: ["\\style{font-family: serif; font-variant-caps: small-caps}{#1}", 1]
      },
      packages: {
        ...existingTexPackages,
        "[+]": enabledPackages,
        "[-]": disabledPackages
      },
      formatError: (_jax: unknown, err: Error) => {
        throw err;
      }
    },
    svg: {
      ...existingSvg,
      fontCache: "none",
      linebreaks: {
        ...existingSvgLinebreaks,
        inline: false
      }
    },
    startup: {
      ...existingStartup,
      typeset: false
    }
  };
  installKnuthPlassVisitor(config, ["svg"]);
  globals.MathJax = config;
}

function resetBrowserMathJax(): void {
  const documentRef = getBrowserDocument();
  if (documentRef && typeof documentRef.getElementById === "function") {
    const script = documentRef.getElementById(BROWSER_STARTUP_COMPONENT_ID);
    if (isRecord(script) && typeof (script as { remove?: () => void }).remove === "function") {
      (script as { remove: () => void }).remove();
    }
  }
  delete (globalThis as { MathJax?: unknown }).MathJax;
}

async function ensureBrowserStartupComponentLoaded(): Promise<void> {
  const documentRef = getBrowserDocument();
  if (!documentRef) {
    throw new Error("Browser document is unavailable while loading MathJax startup component.");
  }

  const existingScript =
    typeof documentRef.getElementById === "function"
      ? toScriptRecord(documentRef.getElementById(BROWSER_STARTUP_COMPONENT_ID))
      : null;

  if (existingScript) {
    await waitForScriptLoad(existingScript);
    return;
  }

  if (typeof documentRef.createElement !== "function") {
    throw new Error("Browser document.createElement is unavailable for MathJax startup component.");
  }
  const createdScript = toScriptRecord(documentRef.createElement("script"));
  if (!createdScript) {
    throw new Error("Unable to create MathJax startup script element.");
  }

  setScriptStringField(createdScript, "id", BROWSER_STARTUP_COMPONENT_ID);
  setScriptStringField(createdScript, "src", BROWSER_STARTUP_COMPONENT_URL);
  setScriptBooleanField(createdScript, "async", true);
  setScriptBooleanField(createdScript, "defer", true);
  if (typeof createdScript.setAttribute === "function") {
    createdScript.setAttribute("data-tikz-editor-mathjax", "startup");
  }

  const headRef = documentRef.head;
  if (!isRecord(headRef) || typeof headRef.appendChild !== "function") {
    throw new Error("Browser document.head is unavailable for MathJax startup component.");
  }

  const loadPromise = waitForScriptLoad(createdScript);
  headRef.appendChild(createdScript);
  await loadPromise;
}

function getBrowserDocument(): BrowserDocumentLike | null {
  const candidate = (globalThis as { document?: unknown }).document;
  if (!isRecord(candidate)) {
    return null;
  }
  return candidate as BrowserDocumentLike;
}

function toScriptRecord(value: unknown): ScriptRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  return value as ScriptRecord;
}

async function waitForScriptLoad(script: ScriptRecord): Promise<void> {
  const maybeLoaded = script[SCRIPT_LOADED_MARKER];
  if (maybeLoaded === true) {
    return;
  }

  const existingError = script[SCRIPT_ERROR_MARKER];
  if (existingError instanceof Error) {
    throw existingError;
  }

  await new Promise<void>((resolve, reject) => {
    const onLoad = () => {
      script[SCRIPT_LOADED_MARKER] = true;
      cleanup();
      resolve();
    };
    const onError = () => {
      const error = new Error(`Unable to load MathJax startup component from ${BROWSER_STARTUP_COMPONENT_URL}.`);
      script[SCRIPT_ERROR_MARKER] = error;
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      if (typeof script.removeEventListener === "function") {
        script.removeEventListener("load", onLoad);
        script.removeEventListener("error", onError);
      }
      const currentOnLoad = script.onload;
      if (currentOnLoad === onLoad) {
        script.onload = null;
      }
      const currentOnError = script.onerror;
      if (currentOnError === onError) {
        script.onerror = null;
      }
    };

    if (typeof script.addEventListener === "function") {
      script.addEventListener("load", onLoad, { once: true });
      script.addEventListener("error", onError, { once: true });
      return;
    }

    script.onload = onLoad;
    script.onerror = onError;
  });
}

function setScriptStringField(script: ScriptRecord, field: "id" | "src", value: string): void {
  script[field] = value;
}

function setScriptBooleanField(script: ScriptRecord, field: "async" | "defer", value: boolean): void {
  script[field] = value;
}

function isMathJaxAdaptor(value: unknown): value is MathJaxAdaptor {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.firstChild === "function" &&
    typeof value.getAttribute === "function" &&
    typeof value.innerHTML === "function"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return isRecord(value) && typeof value.then === "function";
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function waitForNextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function formatMathJaxShape(value: unknown): string {
  if (!isRecord(value)) {
    return "globalThis.MathJax is missing.";
  }

  const rootKeys = summarizeKeys(value);
  const startup = isRecord(value.startup) ? value.startup : null;
  const startupKeys = startup ? summarizeKeys(startup) : "(missing)";
  const hasTex2svg = typeof value.tex2svg === "function";
  const hasStartupPromise = startup ? isPromiseLike(startup.promise) : false;
  const hasAdaptor = startup ? isMathJaxAdaptor(startup.adaptor) : false;

  return (
    `MathJax keys: ${rootKeys}; ` +
    `startup keys: ${startupKeys}; ` +
    `tex2svg: ${hasTex2svg}; startup.promise: ${hasStartupPromise}; startup.adaptor: ${hasAdaptor}.`
  );
}

function summarizeKeys(value: Record<string, unknown>): string {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return "(none)";
  }
  return `[${keys.slice(0, 12).join(", ")}${keys.length > 12 ? ", ..." : ""}]`;
}

function startupFromRecord(value: Record<string, unknown>): MathJaxRuntime["startup"] {
  return {
    adaptor: isMathJaxAdaptor(value.adaptor) ? value.adaptor : undefined,
    document: isRecord(value.document) ? (value.document as { outputJax?: unknown }) : null,
    output: isRecord(value.output) ? value.output : undefined,
    promise: isPromiseLike(value.promise) ? (value.promise as Promise<unknown>) : undefined
  };
}

async function preloadMathJaxWarmupExpressions(runtime: MathJaxRuntime): Promise<void> {
  if (typeof runtime.tex2svgPromise !== "function") {
    return;
  }

  const warmupExpressions = [
    "\\mbox{\\textsf{0}}",
    "\\mbox{\\texttt{0}}",
    "\\mbox{\\textrm{0}}",
    "\\mbox{\\textbf{0}}",
    "\\mbox{\\textit{0}}",
    "\\mbox{$\\mathstrut a$}"
  ];

  for (const expression of warmupExpressions) {
    try {
      await runtime.tex2svgPromise(expression, { display: false });
    } catch {
      // Fall back silently; measure/validate will still guard individual failures.
    }
  }
}

function isMathJaxAsyncRetryError(error: unknown): boolean {
  const message = sanitizeErrorMessage(error).toLowerCase();
  return (
    message.includes("mathjax retry") ||
    (message.includes("asynchronous action is required") && message.includes("promise-based"))
  );
}

function queueAsyncCachePopulate(
  runtime: MathJaxRuntime,
  cache: Map<string, CachedRenderEntry>,
  pendingAsyncRenders: Set<Promise<void>>,
  finalizedPendingCacheKeys: Set<string>,
  params: {
    cacheKey: string;
    sourceText: string;
    textWidthPt: number | null;
    font: TextFontOptions;
    mode: "text" | "math";
    alignment: NodeTextParagraphAlignment | null;
  }
): void {
  if (typeof runtime.tex2svgPromise !== "function") {
    return;
  }

  let renderTask: Promise<unknown>;
  try {
    renderTask = renderMeasuredNodeWithPromise(runtime, params);
  } catch {
    return;
  }

  const task = renderTask
    .then((node) => {
      if (cache.has(params.cacheKey)) {
        return;
      }
      const trimArrayVerticalPadding = shouldUseExplicitMultilineArrayRendering(
        params.mode,
        params.textWidthPt,
        hasExplicitMultilineBreaks(params.sourceText),
        params.alignment
      );
      const entry = buildCacheEntryWithMetadata(
        params.cacheKey,
        node,
        runtime.startup?.adaptor ?? null,
        params.sourceText,
        resolveLatestParagraphId(runtime),
        { trimArrayVerticalPadding }
      );
      if (entry) {
        cache.set(params.cacheKey, entry);
        finalizedPendingCacheKeys.add(params.cacheKey);
      }
    })
    .catch(() => {
      // Retry remains best-effort and should not surface parser diagnostics.
    });
  pendingAsyncRenders.add(task);
  void task.finally(() => {
    pendingAsyncRenders.delete(task);
  });
}

function buildCacheEntry(cacheKey: string, containerNode: unknown, adaptor: MathJaxAdaptor | null): CachedRenderEntry | null {
  return buildCacheEntryWithMetadata(cacheKey, containerNode, adaptor, "", null);
}

function buildCacheEntryWithMetadata(
  cacheKey: string,
  containerNode: unknown,
  adaptor: MathJaxAdaptor | null,
  renderSourceText: string,
  paragraphId: string | null,
  options?: {
    trimArrayVerticalPadding?: boolean;
  }
): CachedRenderEntry | null {
  const extracted = extractSvgPayload(containerNode, adaptor);
  if (!extracted) {
    return null;
  }

  const viewBox = parseViewBox(extracted.viewBoxRaw);
  if (!viewBox) {
    return null;
  }

  const body = extracted.body;
  const effectiveViewBox = options?.trimArrayVerticalPadding ? trimArrayVerticalPaddingFromViewBox(viewBox) : viewBox;
  const resolvedParagraphId = paragraphId ?? extractParagraphIdFromSvgBody(body);
  const baseWidthPt = (effectiveViewBox.width / 1000) * DEFAULT_TEXT_FONT_SIZE;
  const baseHeightPt = (effectiveViewBox.height / 1000) * DEFAULT_TEXT_FONT_SIZE;
  const ascentUnits = Math.max(0, -effectiveViewBox.y);
  const descentUnits = Math.max(0, effectiveViewBox.height - ascentUnits);
  const baseLineYPt = -(((ascentUnits - descentUnits) / 2) / 1000) * DEFAULT_TEXT_FONT_SIZE;
  const midLineYPt = baseLineYPt + DEFAULT_TEXT_FONT_SIZE * MIDLINE_FROM_BASELINE_RATIO;

  return {
    payload: {
      cacheKey,
      viewBox: effectiveViewBox,
      body
    },
    baseWidthPt,
    baseHeightPt,
    baseLineYPt,
    midLineYPt,
    paragraphId: resolvedParagraphId,
    renderSourceText
  };
}

function trimArrayVerticalPaddingFromViewBox(viewBox: NodeTextRenderPayload["viewBox"]): NodeTextRenderPayload["viewBox"] {
  const trim = MATHJAX_ARRAY_VERTICAL_PADDING_UNITS;
  if (viewBox.height <= trim * 2 + 1) {
    return viewBox;
  }
  return {
    ...viewBox,
    y: viewBox.y + trim,
    height: viewBox.height - trim * 2
  };
}

function buildMeasuredCacheEntry(params: {
  runtime: MathJaxRuntime;
  cacheKey: string;
  sourceText: string;
  textWidthPt: number | null;
  font: TextFontOptions;
  mode: "text" | "math";
  alignment: NodeTextParagraphAlignment | null;
}): CachedRenderEntry | null {
  const { runtime, cacheKey, sourceText, textWidthPt, font, mode, alignment } = params;
  const adaptor = runtime.startup?.adaptor ?? null;
  const explicitMultiline = hasExplicitMultilineBreaks(sourceText);
  if (shouldUseExplicitMultilineArrayRendering(mode, textWidthPt, explicitMultiline, alignment)) {
    const tex = buildExplicitMultilineTeX(sourceText, font, alignment);
    const node = runtime.tex2svg(tex, { display: false });
    return buildCacheEntryWithMetadata(cacheKey, node, adaptor, sourceText, resolveLatestParagraphId(runtime), {
      trimArrayVerticalPadding: true
    });
  }

  const measuredWidth =
    textWidthPt ??
    (explicitMultiline
      ? measureExplicitMultilineNaturalWidth(runtime, sourceText, font, mode)
      : measureNaturalWidth(runtime, sourceText, font, mode));
  if (!(Number.isFinite(measuredWidth) && measuredWidth > 0)) {
    return null;
  }
  const renderWidth =
    textWidthPt == null && !explicitMultiline
      ? measuredWidth + SINGLE_LINE_RENDER_WIDTH_FUDGE_PT
      : measuredWidth;
  const tex = buildWrappedTeX(sourceText, renderWidth, font, mode);
  applyKnuthPlassRuntimeOptions(runtime, alignment);
  const node = runtime.tex2svg(tex, { display: false });
  return buildCacheEntryWithMetadata(cacheKey, node, adaptor, sourceText, resolveLatestParagraphId(runtime));
}

function measureNaturalWidth(
  runtime: MathJaxRuntime,
  sourceText: string,
  font: TextFontOptions,
  mode: "text" | "math"
): number {
  const adaptor = runtime.startup?.adaptor ?? null;
  const naturalTex = buildWrappedTeX(sourceText, null, font, mode);
  const node = runtime.tex2svg(naturalTex, { display: false });
  const entry = buildCacheEntryWithMetadata("__measure__", node, adaptor, sourceText, null);
  return entry?.baseWidthPt ?? Number.NaN;
}

function measureExplicitMultilineNaturalWidth(
  runtime: MathJaxRuntime,
  sourceText: string,
  font: TextFontOptions,
  mode: "text" | "math"
): number {
  const lines = splitExplicitMultilineSource(sourceText);
  if (lines.length === 0) {
    return Number.NaN;
  }

  let maxWidth = 0;
  for (const line of lines) {
    if (line.length === 0) {
      continue;
    }
    const width = measureNaturalWidth(runtime, line, font, mode);
    if (Number.isFinite(width)) {
      maxWidth = Math.max(maxWidth, width);
    }
  }

  return maxWidth > 0 ? maxWidth : measureNaturalWidth(runtime, sourceText.replace(EXPLICIT_LINE_BREAK_BOUNDARY_PATTERN, ""), font, mode);
}

function renderMeasuredNodeWithPromise(
  runtime: MathJaxRuntime,
  params: {
    sourceText: string;
    textWidthPt: number | null;
    font: TextFontOptions;
    mode: "text" | "math";
    alignment: NodeTextParagraphAlignment | null;
  }
): Promise<unknown> {
  if (typeof runtime.tex2svgPromise !== "function") {
    return Promise.reject(new Error("MathJax promise renderer is unavailable."));
  }

  const runMeasuredRender = (resolvedWidthPt: number): Promise<unknown> => {
    const tex = buildWrappedTeX(params.sourceText, resolvedWidthPt, params.font, params.mode);
    applyKnuthPlassRuntimeOptions(runtime, params.alignment);
    return runtime.tex2svgPromise!(tex, { display: false });
  };

  if (
    shouldUseExplicitMultilineArrayRendering(
      params.mode,
      params.textWidthPt,
      hasExplicitMultilineBreaks(params.sourceText),
      params.alignment
    )
  ) {
    const tex = buildExplicitMultilineTeX(params.sourceText, params.font, params.alignment);
    return runtime.tex2svgPromise!(tex, { display: false });
  }

  if (params.textWidthPt != null) {
    return runMeasuredRender(params.textWidthPt);
  }

  const tex = buildWrappedTeX(params.sourceText, null, params.font, params.mode);
  return runtime.tex2svgPromise!(tex, { display: false });
}

function resolveLatestParagraphId(runtime: MathJaxRuntime): string | null {
  const outputJax = runtime.outputJax ?? runtime.startup?.output ?? runtime.startup?.document?.outputJax;
  const reports = getKnuthPlassReportsFromOutputJax(outputJax);
  const latest = reports.length > 0 ? reports[reports.length - 1] : null;
  return latest?.paragraphId ?? null;
}

function extractParagraphIdFromSvgBody(body: string): string | null {
  const match = body.match(/data-paragraph-id="([^"]+)"/);
  return match?.[1] ?? null;
}

function hasExplicitMultilineBreaks(text: string): boolean {
  return EXPLICIT_LINE_BREAK_TOKEN_PATTERN.test(text);
}

function splitExplicitMultilineSource(text: string): string[] {
  return splitExplicitMultilineSegments(text).lines;
}

function splitExplicitMultilineSegments(
  text: string
): { lines: string[]; breakLeadings: Array<string | null> } {
  const lines: string[] = [];
  const breakLeadings: Array<string | null> = [];
  let cursor = 0;

  EXPLICIT_LINE_BREAK_WITH_LEADING_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXPLICIT_LINE_BREAK_WITH_LEADING_PATTERN.exec(text)) !== null) {
    lines.push(text.slice(cursor, match.index));
    const rawLeading = typeof match[1] === "string" ? match[1].trim() : "";
    breakLeadings.push(rawLeading.length > 0 ? rawLeading : null);
    cursor = match.index + match[0].length;
  }

  lines.push(text.slice(cursor));
  return { lines, breakLeadings };
}

function shouldUseExplicitMultilineArrayRendering(
  mode: "text" | "math",
  textWidthPt: number | null,
  explicitMultiline: boolean,
  alignment: NodeTextParagraphAlignment | null
): boolean {
  if (mode !== "text" || !explicitMultiline) {
    return false;
  }
  if (textWidthPt == null) {
    return true;
  }
  return alignment === "center" || alignment === "ragged-left";
}

function extractSvgPayload(
  containerNode: unknown,
  adaptor: MathJaxAdaptor | null
): { viewBoxRaw: string | null; body: string } | null {
  if (adaptor) {
    const svgNode = adaptor.firstChild(containerNode);
    if (!svgNode) {
      return null;
    }
    return {
      viewBoxRaw: adaptor.getAttribute(svgNode, "viewBox"),
      body: adaptor.innerHTML(svgNode)
    };
  }

  const svgNode = findSvgElement(containerNode);
  if (!svgNode) {
    return null;
  }

  return {
    viewBoxRaw: readAttr(svgNode, "viewBox"),
    body: readInnerHtml(svgNode)
  };
}

function findSvgElement(value: unknown): unknown | null {
  if (!isRecord(value)) {
    return null;
  }

  const tagName = typeof value.tagName === "string" ? value.tagName.toLowerCase() : "";
  if (tagName === "svg") {
    return value;
  }

  const querySelector = value.querySelector;
  if (typeof querySelector === "function") {
    const nested = querySelector.call(value, "svg");
    return nested ?? null;
  }

  return null;
}

function readAttr(node: unknown, name: string): string | null {
  if (!isRecord(node) || typeof node.getAttribute !== "function") {
    return null;
  }
  const value = node.getAttribute.call(node, name);
  return typeof value === "string" ? value : value == null ? null : String(value);
}

function readInnerHtml(node: unknown): string {
  if (!isRecord(node)) {
    return "";
  }
  const value = node.innerHTML;
  if (typeof value === "string") {
    return value;
  }
  return "";
}

type ScriptRecord = {
  id?: string;
  src?: string;
  async?: boolean;
  defer?: boolean;
  onload?: (() => void) | null;
  onerror?: (() => void) | null;
  setAttribute?: (name: string, value: string) => void;
  addEventListener?: (name: string, listener: () => void, options?: { once?: boolean }) => void;
  removeEventListener?: (name: string, listener: () => void) => void;
  [SCRIPT_LOADED_MARKER]?: boolean;
  [SCRIPT_ERROR_MARKER]?: unknown;
  [key: string]: unknown;
};

type BrowserDocumentLike = {
  getElementById?: (id: string) => unknown;
  createElement?: (tag: string) => unknown;
  head?: { appendChild?: (node: unknown) => unknown } | null;
};

function measurementKey(
  mode: "text" | "math",
  text: string,
  textWidthPt: number | null,
  font: TextFontOptions,
  alignment: NodeTextParagraphAlignment | null
): string {
  return JSON.stringify({
    mode,
    text,
    textWidthPt: textWidthPt == null ? null : formatPt(textWidthPt),
    alignment,
    fontStyle: font.fontStyle,
    fontWeight: font.fontWeight,
    fontFamily: font.fontFamily
  });
}

function resolveParagraphAlignment(
  textWidthPt: number | null,
  alignment: NodeTextParagraphAlignment | undefined
): NodeTextParagraphAlignment | null {
  if (textWidthPt == null) {
    return alignment ?? null;
  }
  return alignment ?? "ragged-right";
}

function applyKnuthPlassRuntimeOptions(
  runtime: MathJaxRuntime,
  alignment: NodeTextParagraphAlignment | null
): void {
  if (!alignment) {
    return;
  }

  const outputJax = runtime.outputJax ?? runtime.startup?.output ?? runtime.startup?.document?.outputJax;
  if (outputJax && typeof outputJax === "object") {
    setKnuthPlassOptionsOnOutputJax(outputJax, { alignment });
    return;
  }

  // Best-effort fallback for runtimes that do not expose the active output jax.
  KnuthPlassVisitor.configure({ alignment });
}

function buildWrappedTeX(
  text: string,
  textWidthPt: number | null,
  font: TextFontOptions,
  mode: "text" | "math" = "text"
): string {
  let styledText = text;
  if (mode === "text" && font.fontFamily === "sans") {
    styledText = `\\textsf{${styledText}}`;
  } else if (mode === "text" && font.fontFamily === "monospace") {
    styledText = `\\texttt{${styledText}}`;
  }
  if (mode === "text" && font.fontWeight === "bold") {
    styledText = `\\textbf{${styledText}}`;
  }
  if (mode === "text" && font.fontStyle === "italic") {
    styledText = `\\textit{${styledText}}`;
  }
  if (mode === "math") {
    if (textWidthPt == null) {
      return styledText;
    }
    return `\\parbox{${formatPt(textWidthPt)}pt}{$${styledText}$}`;
  }
  if (textWidthPt == null) {
    return `\\mbox{${styledText}}`;
  }
  return `\\parbox[t]{${formatPt(textWidthPt)}pt}{${styledText}}`;
}

function buildExplicitMultilineTeX(
  text: string,
  font: TextFontOptions,
  alignment: NodeTextParagraphAlignment | null
): string {
  const { lines, breakLeadings } = splitExplicitMultilineSegments(text);
  const aligned = explicitMultilineStackAlignment(alignment);
  const columnSpec = `@{}${aligned}@{}`;
  const rowBlocks = lines.map((line) => `\\mbox{${applyTextFontSwitches(line, font)}}`);
  let rows = rowBlocks[0] ?? "";
  for (let i = 1; i < rowBlocks.length; i++) {
    const breakLeading = breakLeadings[i - 1];
    rows += `\\\\${breakLeading ? `[${breakLeading}]` : ""}${rowBlocks[i]}`;
  }
  return `{\\def\\arraystretch{0.8}\\begin{array}{${columnSpec}}${rows}\\end{array}}`;
}

function explicitMultilineStackAlignment(alignment: NodeTextParagraphAlignment | null): "l" | "c" | "r" {
  if (alignment === "center") {
    return "c";
  }
  if (alignment === "ragged-left") {
    return "r";
  }
  return "l";
}

function applyTextFontSwitches(text: string, font: TextFontOptions): string {
  let styledText = text;
  if (font.fontFamily === "sans") {
    styledText = `\\textsf{${styledText}}`;
  } else if (font.fontFamily === "monospace") {
    styledText = `\\texttt{${styledText}}`;
  }
  if (font.fontWeight === "bold") {
    styledText = `\\textbf{${styledText}}`;
  }
  if (font.fontStyle === "italic") {
    styledText = `\\textit{${styledText}}`;
  }
  return styledText;
}

function normalizeMathJaxTextInput(
  text: string,
  font: TextFontOptions
): { text: string; font: TextFontOptions } {
  const resolvedFont: TextFontOptions = { ...font };
  let resolvedText = text;

  for (const rule of FONT_SWITCH_RULES) {
    resolvedText = resolvedText.replace(rule.pattern, () => {
      rule.apply(resolvedFont);
      return "";
    });
  }
  resolvedText = resolvedText.replace(EXPLICIT_LINE_BREAK_CANONICAL_PATTERN, "$1");
  resolvedText = resolvedText.replace(/\r\n?/g, "\n").replace(/\n/g, " ");

  return {
    text: resolvedText,
    font: resolvedFont
  };
}

function formatPt(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function computeFontScale(fontSizePt: number): number {
  if (!Number.isFinite(fontSizePt) || fontSizePt <= 0) {
    return 1;
  }
  const scale = fontSizePt / DEFAULT_TEXT_FONT_SIZE;
  if (!Number.isFinite(scale) || scale <= 0) {
    return 1;
  }
  return scale;
}

function parseViewBox(raw: string | null): NodeTextRenderPayload["viewBox"] | null {
  if (!raw) {
    return null;
  }
  const parts = raw
    .trim()
    .split(/\s+/)
    .map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return {
    x: parts[0],
    y: parts[1],
    width: parts[2],
    height: parts[3]
  };
}

function sanitizeErrorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  if (message === "[object Object]" && isRecord(error)) {
    if (typeof error.message === "string" && error.message.trim().length > 0) {
      message = error.message;
    } else if (typeof error.msg === "string" && error.msg.trim().length > 0) {
      message = error.msg;
    } else if (typeof error.reason === "string" && error.reason.trim().length > 0) {
      message = error.reason;
    } else {
      try {
        const serialized = JSON.stringify(error);
        if (typeof serialized === "string" && serialized !== "{}") {
          message = serialized;
        }
      } catch {
        // Keep the fallback message.
      }
    }
  }
  return message.replace(/\s+/g, " ").trim() || "Invalid TeX in node text.";
}
