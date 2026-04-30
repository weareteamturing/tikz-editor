import type { Span, Statement } from "../ast/types.js";
import { renderTikzToSvg } from "../render/index.js";
import { replaceSpan } from "./patch.js";
import { parseTikzForEdit, type EditParseOptions, type PropertyWriteInteractionMode } from "./parse-options.js";
import { resolvePropertyTarget } from "./property-target.js";
import type { SourcePatch } from "./types.js";
import { normalizeOptionKey } from "./option-key.js";
import type { SetPropertyAction } from "./actions/set-property.js";
import { applySetPropertyActionRaw } from "./actions/set-property.js";
import {
  isDefaultOmissionEligible,
  propertyCleanupKinds,
  propertyIdForWriteKey
} from "./property-registry.js";

type EditActionResultLike =
  | { kind: "success"; newSource: string; patches: SourcePatch[]; selectedSourceIds?: string[]; changedSourceIds?: string[] }
  | {
      kind: "partial";
      newSource: string;
      patches: SourcePatch[];
      skippedHandles: string[];
      reason: string;
      selectedSourceIds?: string[];
      changedSourceIds?: string[];
    }
  | { kind: "unsupported"; reason: string }
  | { kind: "error"; message: string };

export type CleanupCertificate =
  | {
      accepted: true;
      reason: string;
      candidate: string;
    }
  | {
      accepted: false;
      reason: string;
      candidate: string;
    };

export type PropertyWriteRequest = {
  source: string;
  action: SetPropertyAction;
  parseOptions?: EditParseOptions;
  mode?: PropertyWriteInteractionMode;
};

export type PropertyWritePlan = {
  conservative: EditActionResultLike;
  selected: EditActionResultLike;
  certificates: CleanupCertificate[];
};

type CleanupCandidate = {
  source: string;
  reason: string;
};

type PaintOptions = {
  draw: string | null;
  fill: string | null;
  drawDisabled: boolean;
  fillDisabled: boolean;
};

export function applyPlannedSetPropertyAction(
  source: string,
  action: SetPropertyAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  return planPropertyWrite({ source, action, parseOptions }).selected;
}

export const PROPERTY_WRITE_CLEANUP_NOOP_REASON = "Property write cleanup would not change the source.";

export function cleanupIdiomaticPropertyWrites(
  source: string,
  parseOptions: EditParseOptions = {},
  elementIds?: readonly string[]
): EditActionResultLike {
  let current = source;
  const parsed = parseTikzForEdit(source, parseOptions);
  const pathIds = filterCleanupPathIds(collectPathStatementIds(parsed.figure.body), elementIds);
  for (const elementId of pathIds) {
    const candidates = buildPaintCommandCleanupCandidates(
      current,
      {
        elementId,
        key: "draw",
        value: "true"
      },
      parseOptions
    );
    for (const candidate of candidates) {
      if (candidate.source === current) {
        continue;
      }
      if (certifyEquivalentSource(current, candidate.source, parseOptions) && sourceLooksCleaner(candidate.source, current)) {
        current = candidate.source;
        break;
      }
    }
  }

  if (current === source) {
    return { kind: "unsupported", reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON };
  }

  return {
    kind: "success",
    newSource: current,
    patches: deriveSingleSourcePatch(source, current)
  };
}

function filterCleanupPathIds(pathIds: readonly string[], elementIds: readonly string[] | undefined): string[] {
  if (!elementIds) {
    return [...pathIds];
  }
  const targetIds = new Set(elementIds.map((id) => id.trim()).filter((id) => id.length > 0));
  if (targetIds.size === 0) {
    return [];
  }
  return pathIds.filter((pathId) => targetIds.has(pathId));
}

export function planPropertyWrite(request: PropertyWriteRequest): PropertyWritePlan {
  const parseOptions = request.parseOptions ?? {};
  const mode = request.mode ?? parseOptions.propertyWriteMode ?? "commit";
  const conservative = applySetPropertyActionRaw(request.source, request.action, parseOptions);
  if (conservative.kind !== "success" && conservative.kind !== "partial") {
    return { conservative, selected: conservative, certificates: [] };
  }
  if (mode === "preview" || mode === "drag-frame" || request.action.commentMode) {
    return { conservative, selected: conservative, certificates: [] };
  }

  const candidates = buildCleanupCandidates(request.source, conservative.newSource, request.action, parseOptions);
  if (candidates.length === 0) {
    return { conservative, selected: conservative, certificates: [] };
  }

  const certificates: CleanupCertificate[] = [];
  let selectedSource = conservative.newSource;
  let selectedReason: string | null = null;
  for (const candidate of candidates) {
    if (candidate.source === request.source || candidate.source === selectedSource) {
      continue;
    }
    const accepted = certifyEquivalentSource(conservative.newSource, candidate.source, parseOptions);
    certificates.push({
      accepted,
      reason: accepted ? candidate.reason : "candidate changed semantic render output",
      candidate: candidate.source
    });
    if (accepted && sourceLooksCleaner(candidate.source, selectedSource)) {
      selectedSource = candidate.source;
      selectedReason = candidate.reason;
    }
  }

  if (!selectedReason || selectedSource === conservative.newSource) {
    return { conservative, selected: conservative, certificates };
  }

  return {
    conservative,
    selected: {
      ...conservative,
      newSource: selectedSource,
      patches: deriveSingleSourcePatch(request.source, selectedSource)
    },
    certificates
  };
}

function buildCleanupCandidates(
  originalSource: string,
  conservativeSource: string,
  action: SetPropertyAction,
  parseOptions: EditParseOptions
): CleanupCandidate[] {
  const candidates: CleanupCandidate[] = [];
  const removal = buildDefaultOmissionCandidate(conservativeSource, action, parseOptions);
  if (removal && removal !== conservativeSource && removal !== originalSource) {
    candidates.push({ source: removal, reason: "remove default-equivalent local property" });
  }

  for (const candidate of buildPaintCommandCleanupCandidates(conservativeSource, action, parseOptions)) {
    if (candidate.source !== conservativeSource && candidate.source !== originalSource) {
      candidates.push(candidate);
    }
  }

  return dedupeCandidates(candidates);
}

function collectPathStatementIds(statements: readonly Statement[]): string[] {
  const ids: string[] = [];
  for (const statement of statements) {
    if (statement.kind === "Path") {
      ids.push(statement.id);
    } else if (statement.kind === "Scope") {
      ids.push(...collectPathStatementIds(statement.body));
    }
  }
  return ids;
}

function buildDefaultOmissionCandidate(
  source: string,
  action: SetPropertyAction,
  parseOptions: EditParseOptions
): string | null {
  if (action.value.trim().length === 0 || !isDefaultOmissionEligible(action.propertyId ?? propertyIdForWriteKey(action.key))) {
    return null;
  }
  const result = applySetPropertyActionRaw(
    source,
    {
      ...action,
      value: "",
      clearKeys: undefined
    },
    parseOptions
  );
  return result.kind === "success" || result.kind === "partial" ? result.newSource : null;
}

function buildPaintCommandCleanupCandidates(
  source: string,
  action: SetPropertyAction,
  parseOptions: EditParseOptions
): CleanupCandidate[] {
  if (!propertyCleanupKinds(action.propertyId ?? propertyIdForWriteKey(action.key)).includes("paint-command")) {
    return [];
  }
  const resolved = resolvePropertyTarget(source, action.elementId, parseOptions);
  if (resolved.kind !== "found" || resolved.target.kind !== "path-statement") {
    return [];
  }
  const command = normalizedPaintCommand(resolved.target.pathCommand);
  if (!command) {
    return [];
  }

  const paint = resolvePaintOptions(source, action.elementId, parseOptions);
  if (!paint) {
    return [];
  }

  const commands = chooseCandidateCommands(command, paint);
  const candidates: CleanupCandidate[] = [];
  for (const nextCommand of commands) {
    const candidate = rewritePaintCommand(source, action.elementId, nextCommand, paint, parseOptions);
    if (candidate && candidate !== source) {
      candidates.push({
        source: candidate,
        reason: `rewrite paint command to \\\\${nextCommand}`
      });
    }
  }
  return candidates;
}

function chooseCandidateCommands(
  currentCommand: "path" | "draw" | "fill" | "filldraw",
  paint: PaintOptions
): Array<"path" | "draw" | "fill"> {
  const drawEnabled = paint.draw != null && !paint.drawDisabled;
  const fillEnabled = paint.fill != null && !paint.fillDisabled;
  const candidates: Array<"path" | "draw" | "fill"> = [];
  if (!drawEnabled && !fillEnabled) {
    candidates.push("path");
  }
  if (fillEnabled && !drawEnabled) {
    candidates.push("fill");
  }
  if (drawEnabled) {
    candidates.push("draw");
  }
  if (candidates.length === 0) {
    candidates.push(currentCommand === "filldraw" ? "draw" : currentCommand);
  }
  return candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
}

function normalizedPaintCommand(command: string | undefined): "path" | "draw" | "fill" | "filldraw" | null {
  const normalized = command?.trim().toLowerCase();
  return normalized === "path" || normalized === "draw" || normalized === "fill" || normalized === "filldraw"
    ? normalized
    : null;
}

function rewritePaintCommand(
  source: string,
  elementId: string,
  nextCommand: "path" | "draw" | "fill",
  paint: PaintOptions,
  parseOptions: EditParseOptions
): string | null {
  let current = rewritePathCommandToken(source, elementId, nextCommand, parseOptions);
  if (!current) {
    return null;
  }

  if (nextCommand === "path") {
    if (paint.drawDisabled) {
      current = applyOptionalPropertyMutation(current, elementId, "draw", "", parseOptions) ?? current;
    }
    if (paint.fillDisabled) {
      current = applyOptionalPropertyMutation(current, elementId, "fill", "", parseOptions) ?? current;
    }
    return current;
  }

  if (nextCommand === "fill") {
    if (paint.fill && !paint.fillDisabled) {
      current = applyOptionalPropertyMutation(current, elementId, "fill", paint.fill, parseOptions) ?? current;
    }
    if (paint.drawDisabled) {
      current = applyOptionalPropertyMutation(current, elementId, "draw", "", parseOptions) ?? current;
    }
    return current;
  }

  if (paint.draw && !paint.drawDisabled) {
    current = applyOptionalPropertyMutation(current, elementId, "draw", paint.draw, parseOptions) ?? current;
  }
  if (paint.fillDisabled) {
    current = applyOptionalPropertyMutation(current, elementId, "fill", "", parseOptions) ?? current;
  }
  return current;
}

function applyOptionalPropertyMutation(
  source: string,
  elementId: string,
  key: string,
  value: string,
  parseOptions: EditParseOptions
): string | null {
  const result = applySetPropertyActionRaw(
    source,
    {
      elementId,
      key,
      value
    },
    parseOptions
  );
  return result.kind === "success" || result.kind === "partial" ? result.newSource : null;
}

function rewritePathCommandToken(
  source: string,
  elementId: string,
  nextCommand: "path" | "draw" | "fill",
  parseOptions: EditParseOptions
): string | null {
  const resolved = resolvePropertyTarget(source, elementId, parseOptions);
  if (resolved.kind !== "found" || resolved.target.kind !== "path-statement" || !resolved.target.pathCommand) {
    return null;
  }
  const commandSpan = findPathCommandTokenSpan(source, resolved.target.span, resolved.target.pathCommand);
  if (!commandSpan) {
    return null;
  }
  return replaceSpan(source, commandSpan, `\\${nextCommand}`).source;
}

function findPathCommandTokenSpan(source: string, statementSpan: Span, command: string): Span | null {
  const pattern = new RegExp(String.raw`\\?${escapeRegex(command)}\b`, "u");
  const statementSource = source.slice(statementSpan.from, statementSpan.to);
  const match = pattern.exec(statementSource);
  if (!match || match.index == null) {
    return null;
  }
  return {
    from: statementSpan.from + match.index,
    to: statementSpan.from + match.index + match[0].length
  };
}

function resolvePaintOptions(
  source: string,
  elementId: string,
  parseOptions: EditParseOptions
): PaintOptions | null {
  const resolved = resolvePropertyTarget(source, elementId, parseOptions);
  if (resolved.kind !== "found" || !resolved.target.options) {
    return {
      draw: null,
      fill: null,
      drawDisabled: false,
      fillDisabled: false
    };
  }
  let draw: string | null = null;
  let fill: string | null = null;
  for (const entry of resolved.target.options.entries) {
    if (entry.kind === "kv") {
      const key = normalizeOptionKey(entry.key);
      if (key === "draw" || key === "color") {
        draw = normalizeOptionValue(entry.valueRaw);
      }
      if (key === "fill") {
        fill = normalizeOptionValue(entry.valueRaw);
      }
      continue;
    }
    if (entry.kind === "flag") {
      const key = normalizeOptionKey(entry.key);
      if (key === "draw") {
        draw = "true";
      } else if (key === "fill") {
        fill = "true";
      }
    }
  }
  return {
    draw,
    fill,
    drawDisabled: isDisabledPaintValue(draw),
    fillDisabled: isDisabledPaintValue(fill)
  };
}

function normalizeOptionValue(value: string): string {
  return value.trim().replace(/^\{|\}$/gu, "").trim();
}

function isDisabledPaintValue(value: string | null): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized === "none" || normalized === "false";
}

function certifyEquivalentSource(leftSource: string, rightSource: string, parseOptions: EditParseOptions): boolean {
  try {
    const left = renderTikzToSvg(leftSource, {
      parse: {
        recover: true,
        activeFigureId: parseOptions.activeFigureId,
        includeContextDefinitions: true
      }
    });
    const right = renderTikzToSvg(rightSource, {
      parse: {
        recover: true,
        activeFigureId: parseOptions.activeFigureId,
        includeContextDefinitions: true
      }
    });
    return (
      diagnosticsSignature(left.parse.diagnostics) === diagnosticsSignature(right.parse.diagnostics) &&
      semanticSignature(left.semantic.scene.elements) === semanticSignature(right.semantic.scene.elements) &&
      left.svg.svg === right.svg.svg
    );
  } catch {
    return false;
  }
}

function semanticSignature(value: unknown): string {
  return JSON.stringify(sanitizeSemanticValue(value));
}

function sanitizeSemanticValue(value: unknown, geometricStyle = false): unknown {
  if (Array.isArray(value)) {
    return value.filter((entry) => !isInvisibleSceneElement(entry)).map((entry) => sanitizeSemanticValue(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const isGeometricElement = input.kind === "Path" || input.kind === "Circle" || input.kind === "Ellipse";
  for (const [key, entryValue] of Object.entries(input)) {
    if (
      key === "span" ||
      key === "id" ||
      key === "runtimeId" ||
      key === "sourceSpan" ||
      key === "sourceFingerprint" ||
      key === "styleChain" ||
      key === "rawOptions" ||
      (geometricStyle && key === "textColor")
    ) {
      continue;
    }
    output[key] = sanitizeSemanticValue(entryValue, isGeometricElement && key === "style");
  }
  return output;
}

function isInvisibleSceneElement(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const element = value as Record<string, unknown>;
  if (element.kind !== "Path" && element.kind !== "Circle" && element.kind !== "Ellipse") {
    return false;
  }
  const style = element.style;
  if (!style || typeof style !== "object") {
    return false;
  }
  const styleRecord = style as Record<string, unknown>;
  return (
    !hasRenderableStroke(styleRecord) &&
    !hasRenderableFill(styleRecord) &&
    !hasRenderableEffect(styleRecord)
  );
}

function hasRenderableStroke(style: Record<string, unknown>): boolean {
  return (
    isRenderableColor(style.stroke) &&
    numericStyleValue(style.opacity, 1) > 0 &&
    numericStyleValue(style.strokeOpacity, 1) > 0 &&
    numericStyleValue(style.lineWidth, 0.4) > 0
  );
}

function hasRenderableFill(style: Record<string, unknown>): boolean {
  return (
    (isRenderableColor(style.fill) || style.fillPattern != null || style.shadeEnabled === true) &&
    numericStyleValue(style.opacity, 1) > 0 &&
    numericStyleValue(style.fillOpacity, 1) > 0
  );
}

function hasRenderableEffect(style: Record<string, unknown>): boolean {
  return (
    style.clip === true ||
    style.useAsBoundingBox === true ||
    style.doubleStroke === true ||
    style.markerStart != null ||
    style.markerEnd != null ||
    hasEnabledDecoration(style.decoration) ||
    hasNonEmptyArray(style.decorationPreActions) ||
    hasNonEmptyArray(style.decorationPostActions) ||
    hasNonEmptyArray(style.shadowLayers)
  );
}

function isRenderableColor(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.trim().toLowerCase() !== "none";
}

function numericStyleValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function hasEnabledDecoration(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as Record<string, unknown>).enabled === true);
}

function hasNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function diagnosticsSignature(diagnostics: readonly { severity: string; message: string }[]): string {
  return diagnostics.map((diagnostic) => `${diagnostic.severity}:${diagnostic.message}`).join("\n");
}

function sourceLooksCleaner(candidate: string, current: string): boolean {
  if (candidate.length !== current.length) {
    return candidate.length < current.length;
  }
  return sourceNoiseScore(candidate) < sourceNoiseScore(current);
}

function sourceNoiseScore(source: string): number {
  return countOccurrences(source, "draw=none")
    + countOccurrences(source, "fill=none")
    + countOccurrences(source, "decorate=false")
    + countOccurrences(source, "sharp corners");
}

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let index = source.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = source.indexOf(needle, index + needle.length);
  }
  return count;
}

function deriveSingleSourcePatch(previous: string, next: string): SourcePatch[] {
  if (previous === next) {
    return [];
  }
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) {
    prefix += 1;
  }
  let previousSuffix = previous.length;
  let nextSuffix = next.length;
  while (
    previousSuffix > prefix &&
    nextSuffix > prefix &&
    previous[previousSuffix - 1] === next[nextSuffix - 1]
  ) {
    previousSuffix -= 1;
    nextSuffix -= 1;
  }
  return [
    {
      oldSpan: { from: prefix, to: previousSuffix },
      newSpan: { from: prefix, to: nextSuffix },
      replacement: next.slice(prefix, nextSuffix)
    }
  ];
}

function dedupeCandidates(candidates: CleanupCandidate[]): CleanupCandidate[] {
  const seen = new Set<string>();
  const unique: CleanupCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.source)) {
      continue;
    }
    seen.add(candidate.source);
    unique.push(candidate);
  }
  return unique;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
