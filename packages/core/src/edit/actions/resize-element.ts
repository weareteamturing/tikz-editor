import type {
  EditHandle,
  EvaluateOptions,
  Point,
  SceneCircle,
  SceneElement,
  SceneEllipse,
  ScenePath,
  ScenePathShapeHint
} from "../../semantic/types.js";
import type { CoordinateItem, PathItem, PathOptionItem, Statement, Span } from "../../ast/types.js";
import type { PropertyTarget } from "../property-target.js";
import { resolvePropertyTarget } from "../property-target.js";
import { parseTikz } from "../../parser/index.js";
import { evaluateTikzFigure } from "../../semantic/evaluate.js";
import { parseCircleRadiusFromCoordinateRaw, parseEllipseRadiiFromCoordinateRaw } from "../../semantic/path/parsers.js";
import { parseLength } from "../../semantic/coords/parse-length.js";
import { applyMatrix } from "../../semantic/transform.js";
import { collectSourceWorldBounds } from "../snapping/index.js";
import { worldToLocal } from "../coords.js";
import { replaceSpan } from "../patch.js";
import { rewriteCoordinate } from "../rewrite.js";
import { CM_PER_PT, formatNumber } from "../format.js";
import { applyTextReplacements } from "../statement-ops.js";
import {
  applyOptionMutationsToTarget,
  rewriteOptionListMutations,
  serializeOptionEntry,
  type OptionMutation,
  type OptionMutationApplyResult
} from "../option-mutations.js";
import type { SourcePatch } from "../types.js";

const RESIZE_EPSILON = 1e-3;

type ResizeRole =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top"
  | "bottom"
  | "left"
  | "right";

export type ResizeElementAction = {
  elementId: string;
  role: ResizeRole;
  newWorld: Point;
  preserveAspect?: boolean;
  preserveAspectRatio?: number;
};

type EditActionResultLike =
  | { kind: "success"; newSource: string; patches: SourcePatch[]; selectedSourceIds?: string[]; changedSourceIds?: string[] }
  | { kind: "unsupported"; reason: string }
  | { kind: "error"; message: string };

export function applyResizeElementAction(
  source: string,
  action: ResizeElementAction,
  evaluateOptions: EvaluateOptions | undefined
): EditActionResultLike {
  const elementId = action.elementId.trim();
  if (elementId.length === 0) {
    return { kind: "unsupported", reason: "Missing element id for resizeElement." };
  }

  const resolved = resolvePropertyTarget(source, elementId);
  if (resolved.kind === "not-found") {
    return { kind: "unsupported", reason: resolved.reason };
  }

  const parsed = parseTikz(source, { recover: true });
  const semantic = evaluateTikzFigure(parsed.figure, source, evaluateOptions);
  const hasNodePositionHandle = semantic.editHandles.some(
    (handle) => handle.sourceRef.sourceId === elementId && handle.kind === "node-position"
  );
  if (!hasNodePositionHandle) {
    const rectangleContext = resolvePathRectangleResizeContext(
      parsed.figure.body,
      semantic.scene.elements,
      semantic.editHandles,
      elementId
    );
    if (rectangleContext.kind === "found") {
      return applyResizePathRectangle(source, action, rectangleContext);
    }
    if (rectangleContext.kind === "unsupported") {
      return rectangleContext;
    }

    return applyResizePathCircleOrEllipse(
      source,
      action,
      parsed.figure.body,
      semantic.scene.elements,
      semantic.editHandles
    );
  }

  const resizeTarget = resolveResizePropertyTarget(source, parsed.figure.body, elementId, resolved.target);
  const currentBoundsBySource = collectSourceWorldBounds(semantic.scene.elements);
  const currentBounds = currentBoundsBySource.get(elementId);
  if (!currentBounds) {
    return { kind: "unsupported", reason: "No geometry bounds were found for the selected node." };
  }

  const center = {
    x: (currentBounds.minX + currentBounds.maxX) / 2,
    y: (currentBounds.minY + currentBounds.maxY) / 2
  };
  const rotation = resolveNodeResizeRotationDegrees(semantic.scene.elements, elementId);

  const floorMutations = new Map<string, OptionMutation>([
    ["minimum width", { kind: "remove" }],
    ["minimum height", { kind: "remove" }]
  ]);
  const floorRewrite = applyOptionMutationsToTarget(source, resizeTarget, floorMutations);
  const floorSource = floorRewrite ? floorRewrite.source : source;
  const floorParsed = parseTikz(floorSource, { recover: true });
  const floorSemantic = evaluateTikzFigure(floorParsed.figure, floorSource, evaluateOptions);
  const floorBoundsBySource = collectSourceWorldBounds(floorSemantic.scene.elements);
  const floorBounds = floorBoundsBySource.get(elementId);
  if (!floorBounds) {
    return { kind: "unsupported", reason: "Could not resolve intrinsic node bounds for resize." };
  }

  const affectsWidth = action.role.includes("left") || action.role.includes("right");
  const affectsHeight = action.role.includes("top") || action.role.includes("bottom");
  if (!affectsWidth && !affectsHeight) {
    return { kind: "unsupported", reason: `Unsupported resize role: ${action.role}` };
  }

  const pointerDelta = {
    x: action.newWorld.x - center.x,
    y: action.newWorld.y - center.y
  };
  const localPointerDelta = rotateVector(pointerDelta, -rotation);
  const requestedWidth = 2 * Math.abs(localPointerDelta.x);
  const requestedHeight = 2 * Math.abs(localPointerDelta.y);
  const intrinsicWidth = floorBounds.maxX - floorBounds.minX;
  const intrinsicHeight = floorBounds.maxY - floorBounds.minY;

  const resizeMutations = new Map<string, OptionMutation>();
  if (affectsWidth) {
    if (requestedWidth > intrinsicWidth + RESIZE_EPSILON) {
      resizeMutations.set("minimum width", { kind: "set", value: `${formatNumber(requestedWidth)}pt` });
    } else {
      resizeMutations.set("minimum width", { kind: "remove" });
    }
  }

  if (affectsHeight) {
    if (requestedHeight > intrinsicHeight + RESIZE_EPSILON) {
      resizeMutations.set("minimum height", { kind: "set", value: `${formatNumber(requestedHeight)}pt` });
    } else {
      resizeMutations.set("minimum height", { kind: "remove" });
    }
  }

  const rewritten = applyOptionMutationsToTarget(source, resizeTarget, resizeMutations);
  if (!rewritten) {
    return { kind: "unsupported", reason: "Resize would not change node constraints." };
  }

  return {
    kind: "success",
    newSource: rewritten.source,
    patches: [rewritten.patch]
  };
}

type PathShapeResizeSyntax = {
  keyword: "circle" | "ellipse";
  keywordSpan: Span;
  optionItems: PathOptionItem[];
  payloadCoordinate: CoordinateItem | null;
};

type PathShapeResizeContext = {
  kind: "found";
  shapeKind: "circle" | "ellipse";
  center: Point;
  syntax: PathShapeResizeSyntax;
  centerHandle: EditHandle;
};

type RectangleCornerRole = "top-left" | "top-right" | "bottom-left" | "bottom-right";

type PathRectangleResizeContext = {
  kind: "found";
  startHandle: EditHandle;
  oppositeHandle: EditHandle;
};

type PathRectangleResizeResolution =
  | PathRectangleResizeContext
  | { kind: "not-rectangle" }
  | { kind: "unsupported"; reason: string };

function applyResizePathRectangle(
  source: string,
  action: ResizeElementAction,
  context: PathRectangleResizeContext
): EditActionResultLike {
  const affectsWidth = action.role.includes("left") || action.role.includes("right");
  const affectsHeight = action.role.includes("top") || action.role.includes("bottom");
  if (!affectsWidth && !affectsHeight) {
    return { kind: "unsupported", reason: `Unsupported resize role: ${action.role}` };
  }

  const transform = context.startHandle.transform;
  const localPointer = worldToLocal(action.newWorld, transform);
  const startLocal = context.startHandle.local ?? worldToLocal(context.startHandle.world, transform);
  const oppositeLocal = context.oppositeHandle.local ?? worldToLocal(context.oppositeHandle.world, transform);
  if (!localPointer || !startLocal || !oppositeLocal) {
    return { kind: "unsupported", reason: "Could not resolve local geometry for rectangle resize." };
  }

  const roleCorners = resolveRectangleRoleCorners(startLocal, oppositeLocal);
  const currentMinX = Math.min(startLocal.x, oppositeLocal.x);
  const currentMaxX = Math.max(startLocal.x, oppositeLocal.x);
  const currentMinY = Math.min(startLocal.y, oppositeLocal.y);
  const currentMaxY = Math.max(startLocal.y, oppositeLocal.y);

  let minX = currentMinX;
  let maxX = currentMaxX;
  let minY = currentMinY;
  let maxY = currentMaxY;

  if (isRectangleCornerRole(action.role)) {
    const fixedLocal = roleCorners[oppositeRectangleCornerRole(action.role)];
    minX = Math.min(fixedLocal.x, localPointer.x);
    maxX = Math.max(fixedLocal.x, localPointer.x);
    minY = Math.min(fixedLocal.y, localPointer.y);
    maxY = Math.max(fixedLocal.y, localPointer.y);
  } else if (action.role === "left" || action.role === "right") {
    const fixedX = action.role === "left"
      ? (roleCorners["top-right"].x + roleCorners["bottom-right"].x) / 2
      : (roleCorners["top-left"].x + roleCorners["bottom-left"].x) / 2;
    minX = Math.min(fixedX, localPointer.x);
    maxX = Math.max(fixedX, localPointer.x);
  } else if (action.role === "top" || action.role === "bottom") {
    const fixedY = action.role === "top"
      ? (roleCorners["bottom-left"].y + roleCorners["bottom-right"].y) / 2
      : (roleCorners["top-left"].y + roleCorners["top-right"].y) / 2;
    minY = Math.min(fixedY, localPointer.y);
    maxY = Math.max(fixedY, localPointer.y);
  }

  const startUsesMinX = startLocal.x <= oppositeLocal.x;
  const startUsesMinY = startLocal.y <= oppositeLocal.y;

  const nextStartLocal: Point = {
    x: startUsesMinX ? minX : maxX,
    y: startUsesMinY ? minY : maxY
  };
  const nextOppositeLocal: Point = {
    x: startUsesMinX ? maxX : minX,
    y: startUsesMinY ? maxY : minY
  };

  const nextStartWorld = applyMatrix(transform, nextStartLocal);
  const nextOppositeWorld = applyMatrix(transform, nextOppositeLocal);
  let oppositeRewriteHandle = context.oppositeHandle;
  if (
    oppositeRewriteHandle.rewriteMode === "delta" &&
    oppositeRewriteHandle.relativeBaseWorld &&
    pointDistanceSquared(oppositeRewriteHandle.relativeBaseWorld, context.startHandle.world) <= 1e-6
  ) {
    oppositeRewriteHandle = {
      ...oppositeRewriteHandle,
      relativeBaseWorld: nextStartWorld
    };
  }

  const rewriteTargets: Array<{ handle: EditHandle; newWorld: Point }> = [
    { handle: context.startHandle, newWorld: nextStartWorld },
    { handle: oppositeRewriteHandle, newWorld: nextOppositeWorld }
  ];

  const replacementBySpan = new Map<string, { span: Span; text: string }>();
  for (const target of rewriteTargets) {
    const handle = target.handle;
    const actualText = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
    if (actualText !== handle.sourceText) {
      return { kind: "unsupported", reason: "Some selected handles are stale. Wait for recompute and try again." };
    }

    const text = rewriteCoordinate(target.newWorld, handle, source);
    if (text == null) {
      return { kind: "unsupported", reason: "Could not rewrite one or more rectangle coordinates." };
    }
    if (text === actualText) {
      continue;
    }

    const spanKey = `${handle.sourceRef.sourceSpan.from}:${handle.sourceRef.sourceSpan.to}`;
    const existing = replacementBySpan.get(spanKey);
    if (existing) {
      if (existing.text !== text) {
        return { kind: "unsupported", reason: "Rectangle resize produced conflicting rewrites for a shared coordinate." };
      }
      continue;
    }

    replacementBySpan.set(spanKey, {
      span: handle.sourceRef.sourceSpan,
      text
    });
  }

  const replacements = [...replacementBySpan.values()];
  if (replacements.length === 0) {
    return { kind: "unsupported", reason: "Resize would not change node constraints." };
  }

  const applied = applyTextReplacements(source, replacements);
  if (applied.source === source) {
    return { kind: "unsupported", reason: "Resize would not change node constraints." };
  }

  return {
    kind: "success",
    newSource: applied.source,
    patches: applied.patches
  };
}

function resolvePathRectangleResizeContext(
  statements: readonly Statement[],
  elements: readonly SceneElement[],
  editHandles: readonly EditHandle[],
  elementId: string
): PathRectangleResizeResolution {
  const pathStatement = findPathStatementById(statements, elementId);
  if (!pathStatement) {
    return { kind: "not-rectangle" };
  }

  const sourceElements = elements.filter((element) => element.sourceRef.sourceId === elementId && !element.adornment);
  const nonTextElements = sourceElements.filter((element) => element.kind !== "Text");
  if (nonTextElements.length !== 1) {
    return { kind: "not-rectangle" };
  }

  const rectangle = nonTextElements[0];
  if (!rectangle || rectangle.kind !== "Path") {
    return { kind: "not-rectangle" };
  }
  if (resolveScenePathShapeHint(rectangle, pathStatement) !== "rectangle") {
    return { kind: "not-rectangle" };
  }

  const pathPointHandles = editHandles.filter(
    (handle) => handle.sourceRef.sourceId === elementId && handle.kind === "path-point"
  );
  if (pathPointHandles.length !== 2) {
    return {
      kind: "unsupported",
      reason: "Resize requires rectangles with explicit start and target coordinates."
    };
  }

  const [startHandle, oppositeHandle] = pathPointHandles;
  if (!startHandle || !oppositeHandle) {
    return {
      kind: "unsupported",
      reason: "Resize requires rectangles with explicit start and target coordinates."
    };
  }

  if (startHandle.rewriteMode === "unsupported" || oppositeHandle.rewriteMode === "unsupported") {
    return {
      kind: "unsupported",
      reason: "Rectangle resize requires rewritable rectangle coordinates."
    };
  }

  if (
    startHandle.sourceRef.sourceSpan.from === oppositeHandle.sourceRef.sourceSpan.from &&
    startHandle.sourceRef.sourceSpan.to === oppositeHandle.sourceRef.sourceSpan.to
  ) {
    return {
      kind: "unsupported",
      reason: "Rectangle resize cannot target shared coordinate spans."
    };
  }

  if (!transformsApproximatelyEqual(startHandle.transform, oppositeHandle.transform)) {
    return {
      kind: "unsupported",
      reason: "Rectangle resize requires matching coordinate transforms."
    };
  }

  return {
    kind: "found",
    startHandle,
    oppositeHandle
  };
}

function resolveScenePathShapeHint(
  path: ScenePath,
  pathStatement: Extract<Statement, { kind: "Path" }>
): ScenePathShapeHint | null {
  return path.shapeHint ?? resolvePathShapeHintFromItems(pathStatement.items);
}

function resolvePathShapeHintFromItems(items: readonly PathItem[]): ScenePathShapeHint | null {
  const hints = new Set<ScenePathShapeHint>();
  collectPathShapeHints(items, hints);
  if (hints.size !== 1) {
    return null;
  }
  return [...hints][0] ?? null;
}

function collectPathShapeHints(items: readonly PathItem[], hints: Set<ScenePathShapeHint>): void {
  for (const item of items) {
    if (item.kind === "PathKeyword") {
      if (item.keyword === "rectangle") {
        hints.add("rectangle");
      } else if (item.keyword === "circle") {
        hints.add("circle");
      } else if (item.keyword === "ellipse") {
        hints.add("ellipse");
      }
      continue;
    }
    if (item.kind === "ChildOperation") {
      collectPathShapeHints(item.body, hints);
    }
  }
}

function applyResizePathCircleOrEllipse(
  source: string,
  action: ResizeElementAction,
  statements: readonly Statement[],
  elements: readonly SceneElement[],
  editHandles: readonly EditHandle[]
): EditActionResultLike {
  const elementId = action.elementId.trim();
  const context = resolvePathShapeResizeContext(statements, elements, editHandles, elementId);
  if (context.kind === "unsupported") {
    return context;
  }

  const affectsWidth = action.role.includes("left") || action.role.includes("right");
  const affectsHeight = action.role.includes("top") || action.role.includes("bottom");
  if (!affectsWidth && !affectsHeight) {
    return { kind: "unsupported", reason: `Unsupported resize role: ${action.role}` };
  }

  const localPointer = worldToLocal(action.newWorld, context.centerHandle.transform);
  const localCenter =
    context.centerHandle.local ?? worldToLocal(context.center, context.centerHandle.transform);
  if (!localPointer || !localCenter) {
    return { kind: "unsupported", reason: "Could not resolve local geometry for circle/ellipse resize." };
  }

  const localDx = Math.abs(localPointer.x - localCenter.x);
  const localDy = Math.abs(localPointer.y - localCenter.y);
  const currentLocalRadii = resolveCurrentLocalShapeRadii(context.syntax);
  if ((!affectsWidth || !affectsHeight) && !currentLocalRadii) {
    return { kind: "unsupported", reason: "Resize requires explicit circle/ellipse radii for single-axis drags." };
  }

  let nextRxLocal = affectsWidth ? localDx : (currentLocalRadii?.rx ?? localDx);
  let nextRyLocal = affectsHeight ? localDy : (currentLocalRadii?.ry ?? localDy);
  if (context.shapeKind === "circle") {
    const currentRadius = currentLocalRadii?.rx ?? Math.max(nextRxLocal, nextRyLocal);
    const nextRadius = Math.max(
      affectsWidth ? localDx : currentRadius,
      affectsHeight ? localDy : currentRadius
    );
    nextRxLocal = nextRadius;
    nextRyLocal = nextRadius;
  } else if (context.shapeKind === "ellipse" && action.preserveAspect) {
    const fallbackAspectRatio =
      currentLocalRadii && currentLocalRadii.rx > RESIZE_EPSILON && currentLocalRadii.ry > RESIZE_EPSILON
        ? currentLocalRadii.ry / currentLocalRadii.rx
        : null;
    const fixedAspectRatio =
      Number.isFinite(action.preserveAspectRatio) && (action.preserveAspectRatio ?? 0) > RESIZE_EPSILON
        ? action.preserveAspectRatio!
        : fallbackAspectRatio;
    if (!fixedAspectRatio || fixedAspectRatio <= RESIZE_EPSILON) {
      return { kind: "unsupported", reason: "Resize requires explicit ellipse radii to preserve aspect ratio." };
    }

    if (affectsWidth && affectsHeight) {
      nextRxLocal = Math.max(localDx, localDy / fixedAspectRatio);
      nextRyLocal = nextRxLocal * fixedAspectRatio;
    } else if (affectsWidth) {
      nextRxLocal = localDx;
      nextRyLocal = nextRxLocal * fixedAspectRatio;
    } else {
      nextRyLocal = localDy;
      nextRxLocal = nextRyLocal / fixedAspectRatio;
    }
  }

  nextRxLocal = Math.max(nextRxLocal, RESIZE_EPSILON);
  nextRyLocal = Math.max(nextRyLocal, RESIZE_EPSILON);

  const payloadRewrite = rewriteShapePayloadCoordinate(context.syntax, nextRxLocal, nextRyLocal);
  if (payloadRewrite) {
    const rewritten = applySpanTextReplacement(source, payloadRewrite.span, payloadRewrite.text);
    if (!rewritten) {
      return { kind: "unsupported", reason: "Resize would not change node constraints." };
    }
    return {
      kind: "success",
      newSource: rewritten.source,
      patches: [rewritten.patch]
    };
  }

  const radiusMutations = buildShapeRadiusMutations(context, nextRxLocal, nextRyLocal);
  const optionTarget = pickPathShapeResizeOptionTarget(context.syntax.optionItems);
  if (optionTarget) {
    const replacement = rewriteOptionListMutations(optionTarget.options, radiusMutations);
    const rewritten = applySpanTextReplacement(source, optionTarget.span, replacement);
    if (!rewritten) {
      return { kind: "unsupported", reason: "Resize would not change node constraints." };
    }
    return {
      kind: "success",
      newSource: rewritten.source,
      patches: [rewritten.patch]
    };
  }

  const entries: string[] = [];
  for (const [key, mutation] of radiusMutations.entries()) {
    if (mutation.kind === "set") {
      entries.push(serializeOptionEntry(key, mutation.value));
    }
  }
  if (entries.length === 0) {
    return { kind: "unsupported", reason: "Resize would not change node constraints." };
  }

  const inserted = `[${entries.join(", ")}]`;
  const rewritten = applySpanTextReplacement(source, {
    from: context.syntax.keywordSpan.to,
    to: context.syntax.keywordSpan.to
  }, inserted);
  if (!rewritten) {
    return { kind: "unsupported", reason: "Resize would not change node constraints." };
  }

  return {
    kind: "success",
    newSource: rewritten.source,
    patches: [rewritten.patch]
  };
}

function resolvePathShapeResizeContext(
  statements: readonly Statement[],
  elements: readonly SceneElement[],
  editHandles: readonly EditHandle[],
  elementId: string
): PathShapeResizeContext | { kind: "unsupported"; reason: string } {
  const pathStatement = findPathStatementById(statements, elementId);
  if (!pathStatement) {
    return { kind: "unsupported", reason: "resizeElement currently supports only node-like or shape-path elements." };
  }

  const sourceElements = elements.filter((element) => element.sourceRef.sourceId === elementId && !element.adornment);
  const nonTextElements = sourceElements.filter((element) => element.kind !== "Text");
  const explicitShapeElements = nonTextElements.filter(
    (element): element is SceneCircle | SceneEllipse => element.kind === "Circle" || element.kind === "Ellipse"
  );

  let shapeKind: "circle" | "ellipse" | null = null;
  let center: Point | null = null;
  let requireSingleCenterHandle = false;

  if (explicitShapeElements.length === 1 && nonTextElements.length === 1) {
    const explicitShape = explicitShapeElements[0]!;
    shapeKind = explicitShape.kind === "Circle" ? "circle" : "ellipse";
    center = explicitShape.center;
  } else if (explicitShapeElements.length === 0 && nonTextElements.length === 1 && nonTextElements[0]?.kind === "Path") {
    const pathElement = nonTextElements[0];
    const hint = resolveScenePathShapeHint(pathElement, pathStatement);
    if (hint === "circle" || hint === "ellipse") {
      shapeKind = hint;
      requireSingleCenterHandle = true;
    }
  }

  if (!shapeKind) {
    return { kind: "unsupported", reason: "Resize supports exactly one circle/ellipse primitive per statement." };
  }

  const syntax = resolvePathShapeResizeSyntax(pathStatement.items);
  if (!syntax) {
    return { kind: "unsupported", reason: "Could not resolve editable circle/ellipse source syntax." };
  }

  const candidateHandles = editHandles.filter(
    (handle) => handle.sourceRef.sourceId === elementId && handle.kind === "path-point"
  );
  if (candidateHandles.length === 0) {
    return { kind: "unsupported", reason: "No editable center handle was found for this circle/ellipse." };
  }
  if (requireSingleCenterHandle && candidateHandles.length !== 1) {
    return { kind: "unsupported", reason: "Resize requires circle/ellipse paths with explicit center coordinates." };
  }

  let centerHandle = candidateHandles[0]!;
  if (center) {
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (const handle of candidateHandles) {
      const dx = handle.world.x - center.x;
      const dy = handle.world.y - center.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        centerHandle = handle;
      }
    }
  }

  return {
    kind: "found",
    shapeKind,
    center: center ?? centerHandle.world,
    syntax,
    centerHandle
  };
}

function resolvePathShapeResizeSyntax(items: readonly PathItem[]): PathShapeResizeSyntax | null {
  const keywordItems = items.filter(
    (item): item is Extract<PathItem, { kind: "PathKeyword" }> =>
      item.kind === "PathKeyword" && (item.keyword === "circle" || item.keyword === "ellipse")
  );
  if (keywordItems.length !== 1) {
    return null;
  }
  const keywordItem = keywordItems[0]!;
  const keywordIndex = items.findIndex((item) => item.id === keywordItem.id);
  if (keywordIndex < 0) {
    return null;
  }

  const optionItems: PathOptionItem[] = [];
  let payloadCoordinate: CoordinateItem | null = null;
  for (let index = keywordIndex + 1; index < items.length; index += 1) {
    const next = items[index];
    if (!next || next.kind === "PathComment") {
      continue;
    }
    if (next.kind === "PathOption" && !payloadCoordinate) {
      optionItems.push(next);
      continue;
    }
    if (next.kind === "Coordinate" && !payloadCoordinate) {
      const parsed =
        keywordItem.keyword === "circle"
          ? parseCircleRadiusFromCoordinateRaw(next.raw) != null
          : parseEllipseRadiiFromCoordinateRaw(next.raw) != null;
      if (parsed) {
        payloadCoordinate = next;
      }
      break;
    }
    break;
  }

  return {
    keyword: keywordItem.keyword === "ellipse" ? "ellipse" : "circle",
    keywordSpan: keywordItem.span,
    optionItems,
    payloadCoordinate
  };
}

function resolveCurrentLocalShapeRadii(
  syntax: PathShapeResizeSyntax
): { rx: number; ry: number } | null {
  const payload = syntax.payloadCoordinate;
  if (payload) {
    if (syntax.keyword === "circle") {
      const radius = parseCircleRadiusFromCoordinateRaw(payload.raw);
      if (radius != null) {
        return { rx: radius, ry: radius };
      }
    } else {
      const radii = parseEllipseRadiiFromCoordinateRaw(payload.raw);
      if (radii) {
        return radii;
      }
    }
  }

  if (syntax.keyword === "circle") {
    let radius: number | null = null;
    let radii: { rx: number; ry: number } | null = null;
    for (const item of syntax.optionItems) {
      const parsed = parseCircleRadiiFromOptionItem(item);
      if (parsed.kind === "radius") {
        radius = parsed.radius;
        radii = null;
      } else if (parsed.kind === "radii") {
        radius = null;
        radii = { rx: parsed.rx, ry: parsed.ry };
      }
    }
    if (radius != null) {
      return { rx: radius, ry: radius };
    }
    return radii;
  }

  let radii: { rx: number; ry: number } | null = null;
  for (const item of syntax.optionItems) {
    const parsed = parseEllipseRadiiFromOptionItem(item);
    if (parsed) {
      radii = parsed;
    }
  }
  return radii;
}

function parseCircleRadiiFromOptionItem(
  item: PathOptionItem
): { kind: "none" } | { kind: "radius"; radius: number } | { kind: "radii"; rx: number; ry: number } {
  let radius: number | null = null;
  let rx: number | null = null;
  let ry: number | null = null;

  for (const entry of item.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "radius") {
      radius = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "x radius") {
      rx = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "y radius") {
      ry = parseLength(entry.valueRaw, "cm");
    }
  }

  if (radius != null) {
    return { kind: "radius", radius };
  }
  if (rx != null && ry != null) {
    return { kind: "radii", rx, ry };
  }
  return { kind: "none" };
}

function parseEllipseRadiiFromOptionItem(item: PathOptionItem): { rx: number; ry: number } | null {
  let rx: number | null = null;
  let ry: number | null = null;
  let radius: number | null = null;
  for (const entry of item.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "x radius") {
      rx = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "y radius") {
      ry = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "radius") {
      radius = parseLength(entry.valueRaw, "cm");
    }
  }
  if (radius != null) {
    return { rx: radius, ry: radius };
  }
  if (rx != null && ry != null) {
    return { rx, ry };
  }
  return null;
}

function rewriteShapePayloadCoordinate(
  syntax: PathShapeResizeSyntax,
  nextRxLocal: number,
  nextRyLocal: number
): { span: Span; text: string } | null {
  if (!syntax.payloadCoordinate) {
    return null;
  }

  if (syntax.keyword === "circle") {
    if (parseCircleRadiusFromCoordinateRaw(syntax.payloadCoordinate.raw) == null) {
      return null;
    }
    return {
      span: syntax.payloadCoordinate.span,
      text: formatCircleRadiusCoordinateRaw(syntax.payloadCoordinate.raw, nextRxLocal)
    };
  }

  if (parseEllipseRadiiFromCoordinateRaw(syntax.payloadCoordinate.raw) == null) {
    return null;
  }
  return {
    span: syntax.payloadCoordinate.span,
    text: formatEllipseRadiiCoordinateRaw(syntax.payloadCoordinate.raw, nextRxLocal, nextRyLocal)
  };
}

function formatCircleRadiusCoordinateRaw(oldRaw: string, radiusPt: number): string {
  const value = `${formatNumber(radiusPt * CM_PER_PT)}cm`;
  const exact = oldRaw.match(/^\((\s*)([^)]*)(\s*)\)$/s);
  if (exact) {
    return `(${exact[1]}${value}${exact[3]})`;
  }
  return `(${value})`;
}

function formatEllipseRadiiCoordinateRaw(oldRaw: string, rxPt: number, ryPt: number): string {
  const rx = `${formatNumber(rxPt * CM_PER_PT)}cm`;
  const ry = `${formatNumber(ryPt * CM_PER_PT)}cm`;
  const exact = oldRaw.match(/^\((\s*)([^)]*?)(\s+and\s+)([^)]*?)(\s*)\)$/is);
  if (exact) {
    return `(${exact[1]}${rx}${exact[3]}${ry}${exact[5]})`;
  }
  return `(${rx} and ${ry})`;
}

function buildShapeRadiusMutations(
  context: PathShapeResizeContext,
  nextRxLocal: number,
  nextRyLocal: number
): Map<string, OptionMutation> {
  const mutations = new Map<string, OptionMutation>();
  if (context.shapeKind === "circle") {
    const radiusValue = `${formatNumber(nextRxLocal * CM_PER_PT)}cm`;
    mutations.set("radius", { kind: "set", value: radiusValue });
    mutations.set("x radius", { kind: "remove" });
    mutations.set("y radius", { kind: "remove" });
    return mutations;
  }

  mutations.set("x radius", { kind: "set", value: `${formatNumber(nextRxLocal * CM_PER_PT)}cm` });
  mutations.set("y radius", { kind: "set", value: `${formatNumber(nextRyLocal * CM_PER_PT)}cm` });
  mutations.set("radius", { kind: "remove" });
  return mutations;
}

function pickPathShapeResizeOptionTarget(
  optionItems: readonly PathOptionItem[]
): PathOptionItem | null {
  if (optionItems.length === 0) {
    return null;
  }
  for (let index = optionItems.length - 1; index >= 0; index -= 1) {
    const item = optionItems[index];
    if (!item) {
      continue;
    }
    const hasRadiusEntry = item.options.entries.some(
      (entry) =>
        entry.kind === "kv" &&
        (entry.key === "radius" || entry.key === "x radius" || entry.key === "y radius")
    );
    if (hasRadiusEntry) {
      return item;
    }
  }
  return optionItems[optionItems.length - 1] ?? null;
}

function applySpanTextReplacement(
  source: string,
  span: Span,
  replacement: string
): OptionMutationApplyResult | null {
  const previous = source.slice(span.from, span.to);
  if (previous === replacement) {
    return null;
  }
  const updated = replaceSpan(source, span, replacement);
  return {
    source: updated.source,
    patch: {
      oldSpan: span,
      newSpan: updated.changedSpan,
      replacement
    }
  };
}

function resolveRectangleRoleCorners(
  startLocal: Point,
  oppositeLocal: Point
): Record<RectangleCornerRole, Point> {
  const minX = Math.min(startLocal.x, oppositeLocal.x);
  const maxX = Math.max(startLocal.x, oppositeLocal.x);
  const minY = Math.min(startLocal.y, oppositeLocal.y);
  const maxY = Math.max(startLocal.y, oppositeLocal.y);

  return {
    "top-left": { x: minX, y: maxY },
    "top-right": { x: maxX, y: maxY },
    "bottom-left": { x: minX, y: minY },
    "bottom-right": { x: maxX, y: minY }
  };
}

function isRectangleCornerRole(role: ResizeRole): role is RectangleCornerRole {
  return role === "top-left" || role === "top-right" || role === "bottom-left" || role === "bottom-right";
}

function oppositeRectangleCornerRole(role: RectangleCornerRole): RectangleCornerRole {
  switch (role) {
    case "top-left":
      return "bottom-right";
    case "top-right":
      return "bottom-left";
    case "bottom-left":
      return "top-right";
    case "bottom-right":
      return "top-left";
  }
}

function pointDistanceSquared(left: Point, right: Point): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function resolveNodeResizeRotationDegrees(elements: readonly SceneElement[], sourceId: string): number {
  const sourceElements = elements.filter((element) => element.sourceRef.sourceId === sourceId && !element.adornment);
  const textElements = sourceElements.filter(
    (element): element is Extract<SceneElement, { kind: "Text" }> => element.kind === "Text"
  );
  if (textElements.length === 1) {
    return normalizeDegrees(textElements[0]?.rotation ?? 0);
  }

  const ellipseElements = sourceElements.filter(
    (element): element is Extract<SceneElement, { kind: "Ellipse" }> => element.kind === "Ellipse"
  );
  if (ellipseElements.length === 1) {
    return normalizeDegrees(ellipseElements[0]?.rotation ?? 0);
  }

  return 0;
}

function rotateVector(vector: Point, degrees: number): Point {
  if (Math.abs(degrees) <= 1e-9) {
    return vector;
  }
  const theta = (degrees * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos
  };
}

function normalizeDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) {
    return 0;
  }
  const normalized = ((degrees % 360) + 360) % 360;
  return normalized > 180 ? normalized - 360 : normalized;
}

function transformsApproximatelyEqual(
  left: EditHandle["transform"],
  right: EditHandle["transform"],
  epsilon = 1e-9
): boolean {
  return (
    Math.abs(left.a - right.a) <= epsilon &&
    Math.abs(left.b - right.b) <= epsilon &&
    Math.abs(left.c - right.c) <= epsilon &&
    Math.abs(left.d - right.d) <= epsilon &&
    Math.abs(left.e - right.e) <= epsilon &&
    Math.abs(left.f - right.f) <= epsilon
  );
}

function resolveResizePropertyTarget(
  source: string,
  statements: readonly Statement[],
  elementId: string,
  defaultTarget: PropertyTarget
): PropertyTarget {
  if (defaultTarget.kind !== "path-statement") {
    return defaultTarget;
  }

  const pathStatement = findPathStatementById(statements, elementId);
  if (!pathStatement) {
    return defaultTarget;
  }

  const nodeIds = collectPathNodeIds(pathStatement.items);
  if (nodeIds.length !== 1) {
    return defaultTarget;
  }

  const nodeTarget = resolvePropertyTarget(source, nodeIds[0]!);
  if (nodeTarget.kind === "found") {
    return nodeTarget.target;
  }

  return defaultTarget;
}

function findPathStatementById(
  statements: readonly Statement[],
  elementId: string
): Extract<Statement, { kind: "Path" }> | null {
  for (const statement of statements) {
    if (statement.kind === "Path" && statement.id === elementId) {
      return statement;
    }
    if (statement.kind === "Scope") {
      const nested = findPathStatementById(statement.body, elementId);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function collectPathNodeIds(items: readonly PathItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.kind === "Node") {
      ids.push(item.id);
      continue;
    }

    if (
      (item.kind === "ToOperation" || item.kind === "EdgeOperation" || item.kind === "EdgeFromParentOperation") &&
      item.nodes
    ) {
      ids.push(...item.nodes.map((node) => node.id));
      continue;
    }

    if (item.kind === "ChildOperation") {
      ids.push(...collectPathNodeIds(item.body));
    }
  }

  return [...new Set(ids)];
}
