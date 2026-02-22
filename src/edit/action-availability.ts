import type { EditHandle, SceneFigure } from "../semantic/types.js";
import { collectSourceWorldBounds } from "./snapping/index.js";
import { planAlignDeltas, planDistributeDeltas, type AlignMode, type DistributeAxis } from "./arrange.js";

export const EDIT_ACTION_IDS = [
  "copy",
  "paste",
  "duplicate",
  "delete",
  "reorder-sendToBack",
  "reorder-sendBackward",
  "reorder-bringForward",
  "reorder-bringToFront",
  "align-left",
  "align-center",
  "align-right",
  "align-top",
  "align-middle",
  "align-bottom",
  "distribute-horizontal",
  "distribute-vertical"
] as const;

export type EditActionId = (typeof EDIT_ACTION_IDS)[number];

export type ActionAvailability = {
  enabled: boolean;
  reason: string | null;
};

export type EditActionAvailability = Record<EditActionId, ActionAvailability>;

export type GetEditActionAvailabilityInput = {
  source: string;
  snapshotSource: string | null;
  selectedSourceIds: readonly string[];
  scene: SceneFigure | null;
  editHandles: readonly EditHandle[];
  hasClipboardContent?: boolean;
};

type AvailabilityFacts = {
  source: string;
  snapshotMatchesSource: boolean;
  selectedSourceIds: string[];
  selectedSet: Set<string>;
  hasClipboardContent: boolean;
  scene: SceneFigure | null;
  boundsBySource: Map<string, { minX: number; minY: number; maxX: number; maxY: number }>;
  selectedHandlesBySource: Map<string, EditHandle[]>;
  selectedMissingBounds: string[];
  selectedMissingHandles: string[];
  selectedUnsupportedSources: string[];
};

type AvailabilityRule = (facts: AvailabilityFacts) => string | null;

const RULES: Record<EditActionId, AvailabilityRule> = {
  copy: (facts) =>
    facts.selectedSourceIds.length > 0
      ? null
      : "Select at least one element to copy.",
  paste: (facts) =>
    facts.hasClipboardContent
      ? null
      : "Clipboard is empty.",
  duplicate: (facts) =>
    facts.selectedSourceIds.length > 0
      ? null
      : "Select at least one element to duplicate.",
  delete: (facts) =>
    facts.selectedSourceIds.length > 0
      ? null
      : "Select at least one element to delete.",
  "reorder-sendToBack": (facts) =>
    facts.selectedSourceIds.length > 0
      ? null
      : "Select at least one element to reorder.",
  "reorder-sendBackward": (facts) =>
    facts.selectedSourceIds.length > 0
      ? null
      : "Select at least one element to reorder.",
  "reorder-bringForward": (facts) =>
    facts.selectedSourceIds.length > 0
      ? null
      : "Select at least one element to reorder.",
  "reorder-bringToFront": (facts) =>
    facts.selectedSourceIds.length > 0
      ? null
      : "Select at least one element to reorder.",
  "align-left": makeAlignRule("left"),
  "align-center": makeAlignRule("center"),
  "align-right": makeAlignRule("right"),
  "align-top": makeAlignRule("top"),
  "align-middle": makeAlignRule("middle"),
  "align-bottom": makeAlignRule("bottom"),
  "distribute-horizontal": makeDistributeRule("horizontal"),
  "distribute-vertical": makeDistributeRule("vertical")
};

export function getEditActionAvailability(
  input: GetEditActionAvailabilityInput,
  actionIds?: readonly EditActionId[]
): EditActionAvailability {
  const facts = deriveFacts(input);
  const requested = actionIds ? new Set(actionIds) : null;

  const availability = {} as EditActionAvailability;
  for (const actionId of EDIT_ACTION_IDS) {
    if (requested && !requested.has(actionId)) {
      // Keep the interface unified by returning all actions even when the caller
      // requests a subset.
      availability[actionId] = evaluateRule(actionId, facts);
      continue;
    }
    availability[actionId] = evaluateRule(actionId, facts);
  }

  return availability;
}

function evaluateRule(actionId: EditActionId, facts: AvailabilityFacts): ActionAvailability {
  const rule = RULES[actionId];
  const reason = rule(facts);
  return {
    enabled: reason == null,
    reason
  };
}

function deriveFacts(input: GetEditActionAvailabilityInput): AvailabilityFacts {
  const selectedSourceIds = normalizeSourceIds(input.selectedSourceIds);
  const selectedSet = new Set(selectedSourceIds);

  const selectedHandlesBySource = new Map<string, EditHandle[]>();
  for (const handle of input.editHandles) {
    if (!selectedSet.has(handle.sourceId)) {
      continue;
    }
    const handles = selectedHandlesBySource.get(handle.sourceId);
    if (handles) {
      handles.push(handle);
    } else {
      selectedHandlesBySource.set(handle.sourceId, [handle]);
    }
  }

  const selectedMissingHandles: string[] = [];
  const selectedUnsupportedSources: string[] = [];
  for (const sourceId of selectedSourceIds) {
    const handles = selectedHandlesBySource.get(sourceId) ?? [];
    if (handles.length === 0) {
      selectedMissingHandles.push(sourceId);
      continue;
    }
    if (handles.some((handle) => handle.rewriteMode === "unsupported")) {
      selectedUnsupportedSources.push(sourceId);
    }
  }

  const boundsBySource = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
  const selectedMissingBounds: string[] = [];
  if (input.scene) {
    const worldBounds = collectSourceWorldBounds(input.scene.elements);
    for (const [sourceId, bounds] of worldBounds.entries()) {
      boundsBySource.set(sourceId, {
        minX: bounds.minX,
        minY: bounds.minY,
        maxX: bounds.maxX,
        maxY: bounds.maxY
      });
    }
  }

  for (const sourceId of selectedSourceIds) {
    if (!boundsBySource.has(sourceId)) {
      selectedMissingBounds.push(sourceId);
    }
  }

  return {
    source: input.source,
    snapshotMatchesSource: input.snapshotSource != null && input.snapshotSource === input.source,
    selectedSourceIds,
    selectedSet,
    hasClipboardContent: Boolean(input.hasClipboardContent),
    scene: input.scene,
    boundsBySource,
    selectedHandlesBySource,
    selectedMissingBounds,
    selectedMissingHandles,
    selectedUnsupportedSources
  };
}

function normalizeSourceIds(sourceIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of sourceIds) {
    const sourceId = raw.trim();
    if (sourceId.length === 0 || seen.has(sourceId)) {
      continue;
    }
    seen.add(sourceId);
    normalized.push(sourceId);
  }

  return normalized;
}

function makeAlignRule(mode: AlignMode): AvailabilityRule {
  return (facts) => {
    const preflight = checkArrangePreconditions(facts, 2);
    if (preflight) {
      return preflight;
    }

    const plan = planAlignDeltas(facts.boundsBySource, facts.selectedSourceIds, mode);
    if (plan.kind === "unsupported") {
      return plan.reason;
    }

    return null;
  };
}

function makeDistributeRule(axis: DistributeAxis): AvailabilityRule {
  return (facts) => {
    const preflight = checkArrangePreconditions(facts, 3);
    if (preflight) {
      return preflight;
    }

    const plan = planDistributeDeltas(facts.boundsBySource, facts.selectedSourceIds, axis);
    if (plan.kind === "unsupported") {
      return plan.reason;
    }

    return null;
  };
}

function checkArrangePreconditions(
  facts: AvailabilityFacts,
  minSelection: number
): string | null {
  if (facts.selectedSourceIds.length < minSelection) {
    return minSelection === 2
      ? "Select at least 2 elements to align."
      : "Select at least 3 elements to distribute.";
  }

  if (!facts.snapshotMatchesSource) {
    return "Wait for recompute to finish before arranging.";
  }

  if (!facts.scene) {
    return "No scene geometry is available for arranging.";
  }

  if (facts.selectedMissingBounds.length > 0) {
    return "One or more selected elements are missing geometry bounds.";
  }

  if (facts.selectedMissingHandles.length > 0) {
    return "One or more selected elements cannot be moved because no edit handles are available.";
  }

  if (facts.selectedUnsupportedSources.length > 0) {
    return "One or more selected elements use unsupported coordinate forms.";
  }

  return null;
}
