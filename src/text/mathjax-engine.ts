import { DEFAULT_TEXT_FONT_SIZE } from "../semantic/style/resolve.js";
import type {
  NodeTextEngine,
  NodeTextMeasureRequest,
  NodeTextMetrics,
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
  startup: {
    adaptor: MathJaxAdaptor;
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
};

const MIDLINE_FROM_BASELINE_RATIO = 0.215;

let sharedEnginePromise: Promise<NodeTextEngine> | null = null;

export async function createMathJaxNodeTextEngine(): Promise<NodeTextEngine> {
  if (!sharedEnginePromise) {
    sharedEnginePromise = initializeEngine();
  }
  try {
    return await sharedEnginePromise;
  } catch (error) {
    sharedEnginePromise = null;
    throw error;
  }
}

async function initializeEngine(): Promise<NodeTextEngine> {
  const module = (await import("mathjax")) as { default?: MathJaxEntrypoint };
  const entrypoint = module.default;
  if (!entrypoint || typeof entrypoint.init !== "function") {
    throw new Error("MathJax entrypoint is unavailable.");
  }

  const runtime = await entrypoint.init({
    loader: {
      load: ["input/tex", "output/svg"]
    },
    tex: {
      packages: {
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
    }
  });
  await preloadMathJaxWarmupExpressions(runtime);

  const adaptor = runtime.startup?.adaptor;
  if (!adaptor) {
    throw new Error("MathJax adaptor is unavailable.");
  }

  const cache = new Map<string, CachedRenderEntry>();

  return {
    validate(text: string): NodeTextValidationIssue | null {
      try {
        const tex = buildWrappedTeX(text, null, "normal");
        runtime.tex2svg(tex, { display: false });
        return null;
      } catch (error) {
        return {
          code: "invalid-node-tex",
          message: sanitizeErrorMessage(error)
        };
      }
    },
    measure(request: NodeTextMeasureRequest): NodeTextMetrics | null {
      const scale = computeFontScale(request.fontSizePt);
      const normalizedWidth = request.textWidthPt == null ? null : request.textWidthPt / scale;
      const cacheKey = measurementKey(request.text, normalizedWidth, request.fontStyle);

      let entry: CachedRenderEntry | null = cache.get(cacheKey) ?? null;
      if (!entry) {
        try {
          const tex = buildWrappedTeX(request.text, normalizedWidth, request.fontStyle);
          const node = runtime.tex2svg(tex, { display: false });
          entry = buildCacheEntry(cacheKey, node, adaptor);
          if (!entry) {
            return null;
          }
          cache.set(cacheKey, entry);
        } catch {
          return null;
        }
      }

      return {
        cacheKey,
        width: entry.baseWidthPt * scale,
        height: entry.baseHeightPt * scale,
        baselineY: entry.baseLineYPt * scale,
        midLineY: entry.midLineYPt * scale
      };
    },
    renderFromCache(cacheKey: string): NodeTextRenderPayload | null {
      return cache.get(cacheKey)?.payload ?? null;
    }
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

function buildCacheEntry(cacheKey: string, containerNode: unknown, adaptor: MathJaxAdaptor): CachedRenderEntry | null {
  const svgNode = adaptor.firstChild(containerNode);
  if (!svgNode) {
    return null;
  }

  const viewBoxRaw = adaptor.getAttribute(svgNode, "viewBox");
  const viewBox = parseViewBox(viewBoxRaw);
  if (!viewBox) {
    return null;
  }

  const body = adaptor.innerHTML(svgNode);
  const baseWidthPt = (viewBox.width / 1000) * DEFAULT_TEXT_FONT_SIZE;
  const baseHeightPt = (viewBox.height / 1000) * DEFAULT_TEXT_FONT_SIZE;
  const ascentUnits = Math.max(0, -viewBox.y);
  const descentUnits = Math.max(0, viewBox.height - ascentUnits);
  const baseLineYPt = -(((ascentUnits - descentUnits) / 2) / 1000) * DEFAULT_TEXT_FONT_SIZE;
  const midLineYPt = baseLineYPt + DEFAULT_TEXT_FONT_SIZE * MIDLINE_FROM_BASELINE_RATIO;

  return {
    payload: {
      cacheKey,
      viewBox,
      body
    },
    baseWidthPt,
    baseHeightPt,
    baseLineYPt,
    midLineYPt
  };
}

function measurementKey(text: string, textWidthPt: number | null, fontStyle: "normal" | "italic"): string {
  return JSON.stringify({
    text,
    textWidthPt: textWidthPt == null ? null : formatPt(textWidthPt),
    fontStyle
  });
}

function buildWrappedTeX(text: string, textWidthPt: number | null, fontStyle: "normal" | "italic"): string {
  const styledText = fontStyle === "italic" ? `\\textit{${text}}` : text;
  if (textWidthPt == null) {
    return `\\mbox{${styledText}}`;
  }
  return `\\parbox{${formatPt(textWidthPt)}pt}{${styledText}}`;
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
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim() || "Invalid TeX in node text.";
}
