import type { TikzFigure, Statement } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { FEATURE_IDS } from "../capabilities/feature-ids.js";
import type { OptionListAst } from "../options/types.js";
import { createSemanticContext, currentFrame, popFrame, pushFrame } from "./context.js";
import { evaluatePathStatement } from "./path/evaluate.js";
import { defaultStyle, commandDefaultStyle, parseStyleValueAsOptionList, resolveContextDelta } from "./style/resolve.js";
import { identityMatrix } from "./transform.js";
import type { Bounds, EvaluateOptions, FeatureUsage, FeatureUsageState, SceneElement, SceneFigure } from "./types.js";

export type EvaluateTikzResult = {
  scene: SceneFigure;
  diagnostics: Diagnostic[];
  featureUsage: FeatureUsage;
};

export function evaluateTikzFigure(figure: TikzFigure, _source: string, _opts: EvaluateOptions = {}): EvaluateTikzResult {
  const diagnostics: Diagnostic[] = [];
  const featureUsage = initializeFeatureUsage();
  const context = createSemanticContext(defaultStyle(), identityMatrix());

  if (figure.options) {
    markFeature(featureUsage, "options_structured", "supported");
    const parent = currentFrame(context);
    const rootDelta = resolveContextDelta(parent.style, parent.transform, [figure.options]);
    const rootMeta = resolveFrameMeta(parent, [figure.options]);
    pushFrame(context, {
      style: rootDelta.style,
      transform: rootDelta.transform,
      namePrefix: rootMeta.namePrefix,
      nameSuffix: rootMeta.nameSuffix,
      nodeLayerMode: rootMeta.nodeLayerMode,
      transformShape: rootMeta.transformShape,
      everyNodeStyles: rootMeta.everyNodeStyles,
      everyRectangleNodeStyles: rootMeta.everyRectangleNodeStyles,
      everyCircleNodeStyles: rootMeta.everyCircleNodeStyles
    });
    for (const code of rootDelta.diagnostics) {
      diagnostics.push({
        severity: "warning",
        code,
        message: `Figure option issue: ${code}`,
        span: figure.options.span
      });
    }
  }

  const elements: SceneElement[] = [];
  for (const statement of figure.body) {
    elements.push(...evaluateStatement(statement, context, diagnostics, featureUsage));
  }

  if (figure.options) {
    popFrame(context);
  }

  return {
    scene: {
      kind: "SceneFigure",
      span: figure.span,
      elements,
      bounds: computeBounds(elements)
    },
    diagnostics,
    featureUsage
  };
}

function evaluateStatement(
  statement: Statement,
  context: ReturnType<typeof createSemanticContext>,
  diagnostics: Diagnostic[],
  featureUsage: FeatureUsage
): SceneElement[] {
  if (statement.kind === "Path") {
    markFeature(featureUsage, "path_statement", "supported");
    const parent = currentFrame(context);
    const baseStyle = { ...parent.style, ...commandDefaultStyle(statement.command, parent.style) };
    const optionLists = statement.options ? [statement.options] : [];
    if (optionLists.length > 0) {
      markFeature(featureUsage, "options_structured", "supported");
    }
    const resolved = resolveContextDelta(baseStyle, parent.transform, optionLists);
    const frameMeta = resolveFrameMeta(parent, optionLists);

    for (const code of resolved.diagnostics) {
      diagnostics.push({
        severity: "warning",
        code,
        message: `Path option issue: ${code}`,
        span: statement.span
      });
    }

    pushFrame(context, {
      style: resolved.style,
      transform: resolved.transform,
      namePrefix: frameMeta.namePrefix,
      nameSuffix: frameMeta.nameSuffix,
      nodeLayerMode: frameMeta.nodeLayerMode,
      transformShape: frameMeta.transformShape,
      everyNodeStyles: frameMeta.everyNodeStyles,
      everyRectangleNodeStyles: frameMeta.everyRectangleNodeStyles,
      everyCircleNodeStyles: frameMeta.everyCircleNodeStyles
    });
    const elements = evaluatePathStatement(
      statement,
      context,
      resolved.style,
      (featureId, status) => markFeature(featureUsage, featureId, status),
      (code, message, from, to) => {
        diagnostics.push({
          severity: code.startsWith("unsupported") ? "warning" : "error",
          code,
          message,
          span: { from, to }
        });
      }
    );
    popFrame(context);
    return elements;
  }

  if (statement.kind === "Scope") {
    markFeature(featureUsage, "scope_statement", "supported");
    const parent = currentFrame(context);
    const optionLists = statement.options ? [statement.options] : [];
    if (optionLists.length > 0) {
      markFeature(featureUsage, "options_structured", "supported");
    }
    const resolved = resolveContextDelta(parent.style, parent.transform, optionLists);
    const frameMeta = resolveFrameMeta(parent, optionLists);
    pushFrame(context, {
      style: resolved.style,
      transform: resolved.transform,
      namePrefix: frameMeta.namePrefix,
      nameSuffix: frameMeta.nameSuffix,
      nodeLayerMode: frameMeta.nodeLayerMode,
      transformShape: frameMeta.transformShape,
      everyNodeStyles: frameMeta.everyNodeStyles,
      everyRectangleNodeStyles: frameMeta.everyRectangleNodeStyles,
      everyCircleNodeStyles: frameMeta.everyCircleNodeStyles
    });
    for (const code of resolved.diagnostics) {
      diagnostics.push({
        severity: "warning",
        code,
        message: `Scope option issue: ${code}`,
        span: statement.span
      });
    }
    const nested = statement.body.flatMap((entry) => evaluateStatement(entry, context, diagnostics, featureUsage));
    popFrame(context);
    return nested;
  }

  if (statement.kind === "Foreach") {
    markFeature(featureUsage, "foreach_statement", "unsupported");
    diagnostics.push({
      severity: "warning",
      code: "unsupported-foreach",
      message: "Foreach statements are parsed but not semantically expanded yet.",
      span: statement.span
    });
    return [];
  }

  markFeature(featureUsage, "unknown_statement", "unsupported");
  diagnostics.push({
    severity: "warning",
    code: "unsupported-statement",
    message: "Unknown statements are ignored by the semantic evaluator.",
    span: statement.span
  });
  return [];
}

function computeBounds(elements: SceneElement[]): Bounds | undefined {
  const points: Array<{ x: number; y: number }> = [];

  for (const element of elements) {
    if (element.kind === "Path") {
      for (const command of element.commands) {
        if (command.kind === "M" || command.kind === "L") {
          points.push(command.to);
        } else if (command.kind === "C") {
          points.push(command.c1);
          points.push(command.c2);
          points.push(command.to);
        } else if (command.kind === "A") {
          points.push(command.to);
        }
      }
      continue;
    }

    if (element.kind === "Circle") {
      points.push({ x: element.center.x - element.radius, y: element.center.y - element.radius });
      points.push({ x: element.center.x + element.radius, y: element.center.y + element.radius });
      continue;
    }

    if (element.kind === "Ellipse") {
      const rotation = ((element.rotation ?? 0) * Math.PI) / 180;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const extentX = Math.sqrt(element.rx * element.rx * cos * cos + element.ry * element.ry * sin * sin);
      const extentY = Math.sqrt(element.rx * element.rx * sin * sin + element.ry * element.ry * cos * cos);
      points.push({ x: element.center.x - extentX, y: element.center.y - extentY });
      points.push({ x: element.center.x + extentX, y: element.center.y + extentY });
      continue;
    }

    points.push(element.position);
  }

  if (points.length === 0) {
    return undefined;
  }

  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));

  return { minX, minY, maxX, maxY };
}

function initializeFeatureUsage(): FeatureUsage {
  const usage: FeatureUsage = {};
  for (const featureId of FEATURE_IDS) {
    usage[featureId] = "unused";
  }
  return usage;
}

function markFeature(featureUsage: FeatureUsage, featureId: string, status: "supported" | "unsupported"): void {
  if (!(featureId in featureUsage)) {
    return;
  }

  const current = featureUsage[featureId] as FeatureUsageState;
  if (status === "unsupported") {
    featureUsage[featureId] = "used-unsupported";
    return;
  }

  if (current !== "used-unsupported") {
    featureUsage[featureId] = "used-supported";
  }
}

function resolveFrameMeta(
  base: {
    namePrefix: string;
    nameSuffix: string;
    nodeLayerMode: "front" | "behind";
    transformShape: boolean;
    everyNodeStyles: OptionListAst[];
    everyRectangleNodeStyles: OptionListAst[];
    everyCircleNodeStyles: OptionListAst[];
  },
  optionLists: OptionListAst[]
): {
  namePrefix: string;
  nameSuffix: string;
  nodeLayerMode: "front" | "behind";
  transformShape: boolean;
  everyNodeStyles: OptionListAst[];
  everyRectangleNodeStyles: OptionListAst[];
  everyCircleNodeStyles: OptionListAst[];
} {
  let namePrefix = base.namePrefix;
  let nameSuffix = base.nameSuffix;
  let nodeLayerMode = base.nodeLayerMode;
  let transformShape = base.transformShape;
  let everyNodeStyles = [...base.everyNodeStyles];
  let everyRectangleNodeStyles = [...base.everyRectangleNodeStyles];
  let everyCircleNodeStyles = [...base.everyCircleNodeStyles];

  for (const list of optionLists) {
    for (const entry of list.entries) {
      if (entry.kind === "flag") {
        if (entry.key === "behind path") {
          nodeLayerMode = "behind";
        } else if (entry.key === "in front of path") {
          nodeLayerMode = "front";
        } else if (entry.key === "transform shape") {
          transformShape = true;
        }
        continue;
      }

      if (entry.kind !== "kv") {
        continue;
      }

      if (entry.key === "name prefix") {
        namePrefix = stripWrappingBraces(entry.valueRaw);
        continue;
      }
      if (entry.key === "name suffix") {
        nameSuffix = stripWrappingBraces(entry.valueRaw);
        continue;
      }

      if (entry.key === "behind path") {
        const parsed = parseBoolish(entry.valueRaw);
        if (parsed != null) {
          nodeLayerMode = parsed ? "behind" : "front";
        }
        continue;
      }

      if (entry.key === "in front of path") {
        const parsed = parseBoolish(entry.valueRaw);
        if (parsed != null) {
          nodeLayerMode = parsed ? "front" : "behind";
        }
        continue;
      }

      if (entry.key === "transform shape") {
        const parsed = parseBoolish(entry.valueRaw);
        if (parsed != null) {
          transformShape = parsed;
        }
        continue;
      }

      if (entry.key === "every node/.style") {
        const parsed = parseStyleValueAsOptionList(entry.valueRaw);
        if (parsed) {
          everyNodeStyles = [parsed];
        }
        continue;
      }
      if (entry.key === "every node/.append style") {
        const parsed = parseStyleValueAsOptionList(entry.valueRaw);
        if (parsed) {
          everyNodeStyles = [...everyNodeStyles, parsed];
        }
        continue;
      }
      if (entry.key === "every rectangle node/.style") {
        const parsed = parseStyleValueAsOptionList(entry.valueRaw);
        if (parsed) {
          everyRectangleNodeStyles = [parsed];
        }
        continue;
      }
      if (entry.key === "every rectangle node/.append style") {
        const parsed = parseStyleValueAsOptionList(entry.valueRaw);
        if (parsed) {
          everyRectangleNodeStyles = [...everyRectangleNodeStyles, parsed];
        }
        continue;
      }
      if (entry.key === "every circle node/.style") {
        const parsed = parseStyleValueAsOptionList(entry.valueRaw);
        if (parsed) {
          everyCircleNodeStyles = [parsed];
        }
        continue;
      }
      if (entry.key === "every circle node/.append style") {
        const parsed = parseStyleValueAsOptionList(entry.valueRaw);
        if (parsed) {
          everyCircleNodeStyles = [...everyCircleNodeStyles, parsed];
        }
      }
    }
  }

  return {
    namePrefix,
    nameSuffix,
    nodeLayerMode,
    transformShape,
    everyNodeStyles,
    everyRectangleNodeStyles,
    everyCircleNodeStyles
  };
}

function parseBoolish(raw: string): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "no" || normalized === "0") {
    return false;
  }
  return null;
}

function stripWrappingBraces(raw: string): string {
  let value = raw.trim();
  while (value.startsWith("{") && value.endsWith("}") && isWrappedBySingleBracePair(value)) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function isWrappedBySingleBracePair(raw: string): boolean {
  let depth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && index !== raw.length - 1) {
        return false;
      }
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}
