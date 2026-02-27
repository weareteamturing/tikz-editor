import type { StyleLevel } from "./actions.js";
import { resolvePropertyTarget } from "./property-target.js";
import type { EditHandle, SceneElement, ScenePathCommand } from "../semantic/types.js";

export type ArrowDirectionPreset = "-" | "->" | "<-" | "<->";

export type InspectorSnapshot = {
  source: string;
  editHandles?: EditHandle[];
};

export type SetPropertyWriteTarget = {
  mode: "setProperty";
  elementId: string;
  level: StyleLevel;
  key: string;
  writable: boolean;
  reason?: string;
};

export type MoveAxisWriteTarget = {
  mode: "moveAxis";
  elementId: string;
  axis: "x" | "y";
  baseX: number;
  baseY: number;
  writable: boolean;
  reason?: string;
};

export type InspectorProperty =
  | {
      kind: "number";
      id: string;
      label: string;
      value: number;
      step: number;
      unit?: string;
      write?: MoveAxisWriteTarget;
      readOnlyReason?: string;
    }
  | {
      kind: "color";
      id: string;
      label: string;
      value: string | null;
      options: string[];
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "lineWidth";
      id: string;
      label: string;
      value: number;
      min: number;
      max: number;
      step: number;
      presetLabel: string | null;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "arrowTip";
      id: string;
      label: string;
      value: ArrowDirectionPreset;
      options: Array<{ value: ArrowDirectionPreset; label: string; preview: string }>;
      write: SetPropertyWriteTarget;
    };

export type InspectorSection = {
  id: string;
  title: string;
  sourceLevel: StyleLevel;
  properties: InspectorProperty[];
};

export type InspectorDescriptor = {
  elementKind: "path" | "circle" | "ellipse" | "text";
  elementId: string;
  writeTargetId: string | null;
  readOnlyReason?: string;
  sections: InspectorSection[];
};

const COLOR_OPTIONS = [
  "none",
  "black",
  "darkgray",
  "gray",
  "lightgray",
  "white",
  "red",
  "green",
  "blue",
  "cyan",
  "magenta",
  "yellow",
  "lime",
  "olive",
  "orange",
  "pink",
  "violet",
  "purple",
  "teal",
  "brown"
];

const HEX_TO_NAMED_COLOR: Record<string, string> = {
  "#000000": "black",
  "#404040": "darkgray",
  "#808080": "gray",
  "#bfbfbf": "lightgray",
  "#ffffff": "white",
  "#ff0000": "red",
  "#00ff00": "green",
  "#0000ff": "blue",
  "#00ffff": "cyan",
  "#ff00ff": "magenta",
  "#ffff00": "yellow",
  "#bfff00": "lime",
  "#808000": "olive",
  "#ff8000": "orange",
  "#ffbfbf": "pink",
  "#800080": "violet",
  "#bf0040": "purple",
  "#008080": "teal",
  "#bf8040": "brown"
};

export const LINE_WIDTH_PRESETS: Array<{ label: string; value: number }> = [
  { label: "ultra thin", value: 0.1 },
  { label: "very thin", value: 0.2 },
  { label: "thin", value: 0.4 },
  { label: "semithick", value: 0.6 },
  { label: "thick", value: 0.8 },
  { label: "very thick", value: 1.2 },
  { label: "ultra thick", value: 1.6 }
];

export function getInspectorDescriptor(element: SceneElement, snapshot: InspectorSnapshot): InspectorDescriptor {
  const inlineTarget = resolveInlineWriteTarget(element, snapshot.source);
  const metrics = computeElementMetrics(element);
  const moveWrite = resolveMoveWriteTarget(element, snapshot.editHandles, metrics);
  const strokeColor = normalizeInspectorColorValue(element.style.stroke);
  const fillColor = normalizeInspectorColorValue(element.style.fill);
  const textColor = normalizeInspectorColorValue(element.style.textColor);

  const sections: InspectorSection[] = [
    {
      id: "transform",
      title: "Transform",
      sourceLevel: "command",
      properties: [
        {
          kind: "number",
          id: "x",
          label: "X",
          value: metrics.centerX,
          step: 0.1,
          unit: "pt",
          write: moveWrite.x
        },
        {
          kind: "number",
          id: "y",
          label: "Y",
          value: metrics.centerY,
          step: 0.1,
          unit: "pt",
          write: moveWrite.y
        },
        {
          kind: "number",
          id: "width",
          label: "Width",
          value: metrics.width,
          step: 0.1,
          unit: "pt",
          readOnlyReason: "Resize from canvas corner handles."
        },
        {
          kind: "number",
          id: "height",
          label: "Height",
          value: metrics.height,
          step: 0.1,
          unit: "pt",
          readOnlyReason: "Resize from canvas corner handles."
        }
      ]
    },
    {
      id: "stroke",
      title: "Stroke",
      sourceLevel: "command",
      properties: [
        {
          kind: "color",
          id: "stroke-color",
          label: "Color",
          value: strokeColor,
          options: colorOptionsForValue(strokeColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "draw")
        },
        {
          kind: "lineWidth",
          id: "line-width",
          label: "Line width",
          value: element.style.lineWidth,
          min: 0.1,
          max: 6,
          step: 0.1,
          presetLabel: lineWidthPresetLabel(element.style.lineWidth),
          write: makeSetPropertyWriteTarget(inlineTarget, "line width")
        }
      ]
    },
    {
      id: "fill",
      title: "Fill",
      sourceLevel: "command",
      properties: [
        {
          kind: "color",
          id: "fill-color",
          label: "Color",
          value: fillColor,
          options: colorOptionsForValue(fillColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "fill")
        }
      ]
    }
  ];

  if (element.kind === "Path") {
    sections.push({
      id: "arrows",
      title: "Arrow Tips",
      sourceLevel: "command",
      properties: [
        {
          kind: "arrowTip",
          id: "arrow-direction",
          label: "Direction",
          value: arrowDirectionPreset(element),
          options: [
            { value: "-", label: "None", preview: "\u2014" },
            { value: "->", label: "End", preview: "\u2192" },
            { value: "<-", label: "Start", preview: "\u2190" },
            { value: "<->", label: "Both", preview: "\u2194" }
          ],
          write: makeSetPropertyWriteTarget(inlineTarget, "arrows")
        }
      ]
    });
  }

  if (element.kind === "Text") {
    sections.push({
      id: "text",
      title: "Text",
      sourceLevel: "command",
      properties: [
        {
          kind: "color",
          id: "text-color",
          label: "Color",
          value: textColor,
          options: colorOptionsForValue(textColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "text")
        }
      ]
    });
  }

  return {
    elementKind: normalizeElementKind(element.kind),
    elementId: element.sourceId,
    writeTargetId: inlineTarget.targetId,
    readOnlyReason: inlineTarget.reason,
    sections
  };
}

function makeSetPropertyWriteTarget(
  inlineTarget: { targetId: string | null; writable: boolean; reason?: string },
  key: string
): SetPropertyWriteTarget {
  return {
    mode: "setProperty",
    elementId: inlineTarget.targetId ?? "",
    level: "command",
    key,
    writable: inlineTarget.writable && inlineTarget.targetId != null,
    reason: inlineTarget.reason
  };
}

function resolveInlineWriteTarget(
  element: SceneElement,
  source: string
): { targetId: string | null; writable: boolean; reason?: string } {
  if (element.origin?.foreachStack && element.origin.foreachStack.length > 0) {
    return {
      targetId: null,
      writable: false,
      reason: "This element comes from a \\foreach expansion and is read-only in the Phase 2 inspector."
    };
  }

  if (element.origin?.macroStack && element.origin.macroStack.length > 0) {
    return {
      targetId: null,
      writable: false,
      reason: "This element comes from a macro expansion and is read-only in the Phase 2 inspector."
    };
  }

  const commandEntry = [...element.styleChain].reverse().find((entry) => entry.kind === "command");
  const targetId = commandEntry?.sourceRef?.sourceId ?? element.sourceId;
  const resolved = resolvePropertyTarget(source, targetId);

  if (resolved.kind === "not-found") {
    return {
      targetId,
      writable: false,
      reason: "Inline command options could not be resolved for this element."
    };
  }

  return { targetId, writable: true };
}

function resolveMoveWriteTarget(
  element: SceneElement,
  editHandles: EditHandle[] | undefined,
  metrics: { centerX: number; centerY: number }
): { x: MoveAxisWriteTarget; y: MoveAxisWriteTarget } {
  const hasHandle = (editHandles ?? []).some((handle) => handle.sourceId === element.sourceId);
  const foreachReadonly = element.origin?.foreachStack && element.origin.foreachStack.length > 0;
  const macroReadonly = element.origin?.macroStack && element.origin.macroStack.length > 0;

  let reason: string | undefined;
  if (foreachReadonly) {
    reason = "Position editing is disabled for foreach-expanded elements.";
  } else if (macroReadonly) {
    reason = "Position editing is disabled for macro-expanded elements.";
  } else if (!hasHandle) {
    reason = "No editable handles were found for this element.";
  }

  const writable = reason == null;
  return {
    x: {
      mode: "moveAxis",
      elementId: element.sourceId,
      axis: "x",
      baseX: metrics.centerX,
      baseY: metrics.centerY,
      writable,
      reason
    },
    y: {
      mode: "moveAxis",
      elementId: element.sourceId,
      axis: "y",
      baseX: metrics.centerX,
      baseY: metrics.centerY,
      writable,
      reason
    }
  };
}

function normalizeElementKind(kind: SceneElement["kind"]): InspectorDescriptor["elementKind"] {
  if (kind === "Path") return "path";
  if (kind === "Circle") return "circle";
  if (kind === "Ellipse") return "ellipse";
  return "text";
}

function computeElementMetrics(element: SceneElement): {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
} {
  if (element.kind === "Circle") {
    return {
      centerX: element.center.x,
      centerY: element.center.y,
      width: element.radius * 2,
      height: element.radius * 2
    };
  }

  if (element.kind === "Ellipse") {
    return {
      centerX: element.center.x,
      centerY: element.center.y,
      width: element.rx * 2,
      height: element.ry * 2
    };
  }

  if (element.kind === "Text") {
    return {
      centerX: element.position.x,
      centerY: element.position.y,
      width: element.textBlockWidth ?? 0,
      height: element.textBlockHeight ?? 0
    };
  }

  const bounds = pathBounds(element.commands);
  return {
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerY: (bounds.minY + bounds.maxY) / 2,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY
  };
}

function pathBounds(commands: ScenePathCommand[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const points: Array<{ x: number; y: number }> = [];
  for (const command of commands) {
    if (command.kind === "M" || command.kind === "L" || command.kind === "A") {
      points.push(command.to);
      continue;
    }
    if (command.kind === "C") {
      points.push(command.c1, command.c2, command.to);
    }
  }

  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
}

function lineWidthPresetLabel(value: number): string | null {
  for (const preset of LINE_WIDTH_PRESETS) {
    if (Math.abs(preset.value - value) <= 0.02) {
      return preset.label;
    }
  }
  return null;
}

function normalizeInspectorColorValue(value: string | null): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized in HEX_TO_NAMED_COLOR) {
    return HEX_TO_NAMED_COLOR[normalized];
  }
  return normalized;
}

function colorOptionsForValue(value: string | null): string[] {
  if (!value) {
    return COLOR_OPTIONS;
  }
  if (COLOR_OPTIONS.includes(value)) {
    return COLOR_OPTIONS;
  }
  return [value, ...COLOR_OPTIONS];
}

function arrowDirectionPreset(element: Extract<SceneElement, { kind: "Path" }>): ArrowDirectionPreset {
  const hasStart = (element.style.markerStart?.tips.length ?? 0) > 0;
  const hasEnd = (element.style.markerEnd?.tips.length ?? 0) > 0;
  if (hasStart && hasEnd) {
    return "<->";
  }
  if (hasStart) {
    return "<-";
  }
  if (hasEnd) {
    return "->";
  }
  return "-";
}
