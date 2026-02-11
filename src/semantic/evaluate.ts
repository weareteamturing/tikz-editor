import type { TikzFigure, Statement } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { FEATURE_IDS } from "../capabilities/feature-ids.js";
import { createSemanticContext, currentFrame, popFrame, pushFrame } from "./context.js";
import { evaluatePathStatement } from "./path/evaluate.js";
import { defaultStyle, commandDefaultStyle, resolveContextDelta } from "./style/resolve.js";
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
    const rootDelta = resolveContextDelta(currentFrame(context).style, currentFrame(context).transform, [figure.options]);
    pushFrame(context, {
      style: rootDelta.style,
      transform: rootDelta.transform
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
    const baseStyle = { ...parent.style, ...commandDefaultStyle(statement.command) };
    const optionLists = statement.options ? [statement.options] : [];
    if (optionLists.length > 0) {
      markFeature(featureUsage, "options_structured", "supported");
    }
    const resolved = resolveContextDelta(baseStyle, parent.transform, optionLists);

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
      transform: resolved.transform
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
    pushFrame(context, {
      style: resolved.style,
      transform: resolved.transform
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
      points.push({ x: element.center.x - element.rx, y: element.center.y - element.ry });
      points.push({ x: element.center.x + element.rx, y: element.center.y + element.ry });
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
