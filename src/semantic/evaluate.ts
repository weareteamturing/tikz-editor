import type { TikzFigure, Statement } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { FEATURE_IDS } from "../capabilities/feature-ids.js";
import type { FeatureId } from "../capabilities/feature-ids.js";
import type { OptionListAst } from "../options/types.js";
import { createSemanticContext, currentFrame, popFrame, pushFrame, type NodeDistanceSpec } from "./context.js";
import { evaluatePathStatement } from "./path/evaluate.js";
import { parseNodeDistance } from "./path/node-positioning.js";
import { DEFAULT_TEXT_FONT_SIZE, defaultStyle, commandDefaultStyle, parseStyleValueAsOptionList, resolveContextDelta } from "./style/resolve.js";
import { identityMatrix } from "./transform.js";
import type {
  Bounds,
  EvaluateOptions,
  FeatureUsage,
  FeatureUsageState,
  SceneElement,
  SceneFigure,
  ScenePathCommand
} from "./types.js";

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
      onGrid: rootMeta.onGrid,
      nodeDistance: rootMeta.nodeDistance,
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
    if (resolved.style.markerStart || resolved.style.markerEnd) {
      markFeature(featureUsage, "arrow_tips", "supported");
    }

    pushFrame(context, {
      style: resolved.style,
      transform: resolved.transform,
      namePrefix: frameMeta.namePrefix,
      nameSuffix: frameMeta.nameSuffix,
      nodeLayerMode: frameMeta.nodeLayerMode,
      onGrid: frameMeta.onGrid,
      nodeDistance: frameMeta.nodeDistance,
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
    if (
      elements.some(
        (element) => element.kind === "Path" && (element.style.markerStart != null || element.style.markerEnd != null)
      )
    ) {
      markFeature(featureUsage, "arrow_tips", "supported");
    }
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
      onGrid: frameMeta.onGrid,
      nodeDistance: frameMeta.nodeDistance,
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

  if (applyStandaloneCommandStatement(statement.raw, context)) {
    markFeature(featureUsage, "unknown_statement", "supported");
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

const STANDALONE_FONT_SIZE_FACTORS: Record<string, number> = {
  "\\tiny": 0.5,
  "\\scriptsize": 0.7,
  "\\footnotesize": 0.8,
  "\\small": 0.9,
  "\\normalsize": 1,
  "\\large": 1.2,
  "\\Large": 1.44,
  "\\LARGE": 1.728,
  "\\huge": 2.074,
  "\\Huge": 2.488
};

function applyStandaloneCommandStatement(raw: string, context: ReturnType<typeof createSemanticContext>): boolean {
  const command = parseStandaloneCommand(raw);
  if (!command) {
    return false;
  }

  const fontFactor = STANDALONE_FONT_SIZE_FACTORS[command];
  if (fontFactor == null) {
    return false;
  }

  const frame = currentFrame(context);
  frame.style = {
    ...frame.style,
    fontSize: DEFAULT_TEXT_FONT_SIZE * fontFactor
  };
  return true;
}

function parseStandaloneCommand(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const maybeSemicolon = trimmed.endsWith(";") ? trimmed.slice(0, -1).trim() : trimmed;
  if (!/^\\[A-Za-z@]+$/.test(maybeSemicolon)) {
    return null;
  }
  return maybeSemicolon;
}

function computeBounds(elements: SceneElement[]): Bounds | undefined {
  const points: Array<{ x: number; y: number }> = [];

  for (const element of elements) {
    if (element.kind === "Path") {
      points.push(...pathBoundsPoints(element.commands));
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

    const lineCount = Math.max(1, element.text.split("\n").length);
    const textHeight = lineCount * element.style.fontSize * 1.15;
    const textWidth = element.textBlockWidth ?? estimateTextWidth(element.text, element.style.fontSize);
    points.push({ x: element.position.x - textWidth / 2, y: element.position.y - textHeight / 2 });
    points.push({ x: element.position.x + textWidth / 2, y: element.position.y + textHeight / 2 });
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

function estimateTextWidth(text: string, fontSize: number): number {
  const lines = text.split("\n");
  const maxChars = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return maxChars * fontSize * 0.7;
}

function pathBoundsPoints(commands: ScenePathCommand[]): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  let current: { x: number; y: number } | null = null;
  let subpathStart: { x: number; y: number } | null = null;

  for (const command of commands) {
    if (command.kind === "M") {
      current = command.to;
      subpathStart = command.to;
      points.push(command.to);
      continue;
    }

    if (command.kind === "L") {
      current = command.to;
      points.push(command.to);
      continue;
    }

    if (command.kind === "C") {
      points.push(command.c1, command.c2, command.to);
      current = command.to;
      continue;
    }

    if (command.kind === "A") {
      points.push(command.to);
      if (current) {
        points.push(...arcExtremaPoints(current, command));
      }
      current = command.to;
      continue;
    }

    if (command.kind === "Z" && subpathStart) {
      points.push(subpathStart);
      current = subpathStart;
    }
  }

  return points;
}

function arcExtremaPoints(
  from: { x: number; y: number },
  arc: { rx: number; ry: number; xAxisRotation: number; largeArc: boolean; sweep: boolean; to: { x: number; y: number } }
): Array<{ x: number; y: number }> {
  const solution = solveArcCenter(from, arc);
  if (!solution) {
    return [];
  }

  const { center, rx, ry, phi, theta1, deltaTheta } = solution;
  const theta2 = theta1 + deltaTheta;
  const candidates = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  const points: Array<{ x: number; y: number }> = [];

  for (const candidate of candidates) {
    if (!angleOnArc(candidate, theta1, theta2, arc.sweep)) {
      continue;
    }
    points.push(pointOnEllipse(center, rx, ry, phi, candidate));
  }

  return points;
}

function solveArcCenter(
  from: { x: number; y: number },
  arc: { rx: number; ry: number; xAxisRotation: number; largeArc: boolean; sweep: boolean; to: { x: number; y: number } }
): {
  center: { x: number; y: number };
  rx: number;
  ry: number;
  phi: number;
  theta1: number;
  deltaTheta: number;
} | null {
  let rx = Math.abs(arc.rx);
  let ry = Math.abs(arc.ry);
  if (rx <= 1e-9 || ry <= 1e-9) {
    return null;
  }

  const phi = (arc.xAxisRotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (from.x - arc.to.x) / 2;
  const dy2 = (from.y - arc.to.y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;
  const denominator = rx2 * y1p2 + ry2 * x1p2;
  if (denominator <= 1e-12) {
    return null;
  }

  const sign = arc.largeArc === arc.sweep ? -1 : 1;
  const factorBase = Math.max(0, (rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2) / denominator);
  const factor = sign * Math.sqrt(factorBase);
  const cxp = factor * ((rx * y1p) / ry);
  const cyp = factor * (-(ry * x1p) / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (from.x + arc.to.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (from.y + arc.to.y) / 2;

  const startUnit = { x: (x1p - cxp) / rx, y: (y1p - cyp) / ry };
  const endUnit = { x: (-x1p - cxp) / rx, y: (-y1p - cyp) / ry };
  const theta1 = angleFromUnit(startUnit);
  let deltaTheta = angleBetweenUnits(startUnit, endUnit);

  if (!arc.sweep && deltaTheta > 0) {
    deltaTheta -= 2 * Math.PI;
  } else if (arc.sweep && deltaTheta < 0) {
    deltaTheta += 2 * Math.PI;
  }

  return {
    center: { x: cx, y: cy },
    rx,
    ry,
    phi,
    theta1,
    deltaTheta
  };
}

function pointOnEllipse(
  center: { x: number; y: number },
  rx: number,
  ry: number,
  phi: number,
  theta: number
): { x: number; y: number } {
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  return {
    x: center.x + rx * cosTheta * cosPhi - ry * sinTheta * sinPhi,
    y: center.y + rx * cosTheta * sinPhi + ry * sinTheta * cosPhi
  };
}

function angleFromUnit(unit: { x: number; y: number }): number {
  return Math.atan2(unit.y, unit.x);
}

function angleBetweenUnits(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const cross = from.x * to.y - from.y * to.x;
  const dot = from.x * to.x + from.y * to.y;
  return Math.atan2(cross, dot);
}

function normalizeAngle(angle: number): number {
  const twoPi = 2 * Math.PI;
  let normalized = angle % twoPi;
  if (normalized < 0) {
    normalized += twoPi;
  }
  return normalized;
}

function angleOnArc(angle: number, start: number, end: number, sweep: boolean): boolean {
  const epsilon = 1e-9;
  const a = normalizeAngle(angle);
  const s = normalizeAngle(start);
  let e = normalizeAngle(end);

  if (sweep) {
    if (e < s) {
      e += 2 * Math.PI;
    }
    const aa = a < s ? a + 2 * Math.PI : a;
    return aa >= s - epsilon && aa <= e + epsilon;
  }

  if (e > s) {
    e -= 2 * Math.PI;
  }
  const aa = a > s ? a - 2 * Math.PI : a;
  return aa <= s + epsilon && aa >= e - epsilon;
}

function initializeFeatureUsage(): FeatureUsage {
  const usage: FeatureUsage = {};
  for (const featureId of FEATURE_IDS) {
    usage[featureId] = "unused";
  }
  return usage;
}

function markFeature(featureUsage: FeatureUsage, featureId: FeatureId, status: "supported" | "unsupported"): void {
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
    onGrid: boolean;
    nodeDistance: NodeDistanceSpec;
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
  onGrid: boolean;
  nodeDistance: NodeDistanceSpec;
  transformShape: boolean;
  everyNodeStyles: OptionListAst[];
  everyRectangleNodeStyles: OptionListAst[];
  everyCircleNodeStyles: OptionListAst[];
} {
  let namePrefix = base.namePrefix;
  let nameSuffix = base.nameSuffix;
  let nodeLayerMode = base.nodeLayerMode;
  let onGrid = base.onGrid;
  let nodeDistance = base.nodeDistance;
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
        } else if (entry.key === "on grid") {
          onGrid = true;
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

      if (entry.key === "on grid") {
        const parsed = parseBoolish(entry.valueRaw);
        if (parsed != null) {
          onGrid = parsed;
        }
        continue;
      }

      if (entry.key === "node distance") {
        const parsed = parseNodeDistance(entry.valueRaw);
        if (parsed) {
          nodeDistance = parsed;
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
    onGrid,
    nodeDistance,
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
