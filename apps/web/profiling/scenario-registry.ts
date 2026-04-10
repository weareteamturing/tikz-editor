import type { ProfilingScenarioManifest } from "./framework";

export const PROFILING_SCENARIOS: ProfilingScenarioManifest[] = [
  {
    id: "actions",
    category: "actions",
    description: "Menu and keyboard action profiling for editor commands.",
    specPath: "profiling/profile-actions.spec.ts"
  },
  {
    id: "basic-drag",
    category: "basic-drag",
    description: "Basic canvas drag profiling for move, resize, and shape creation.",
    specPath: "profiling/profile-drag.spec.ts"
  },
  {
    id: "paper-selection",
    category: "paper",
    description: "Selection hover and click profiling on the paper fixture.",
    specPath: "profiling/profile-paper-selection.spec.ts"
  },
  {
    id: "paper-drag",
    category: "paper",
    description: "Path endpoint drag profiling on the paper fixture.",
    specPath: "profiling/profile-paper-drag.spec.ts"
  },
  {
    id: "paper-color",
    category: "paper",
    description: "Inspector color change profiling on the paper fixture.",
    specPath: "profiling/profile-paper-color.spec.ts"
  },
  {
    id: "scope-edit",
    category: "canvas-edit",
    description: "Scope drag and resize profiling on nested scope content.",
    specPath: "profiling/profile-scope-edit.spec.ts"
  },
  {
    id: "dense-path-edit",
    category: "canvas-edit",
    description: "Dense path selection and endpoint editing profiling.",
    specPath: "profiling/profile-dense-path-edit.spec.ts"
  },
  {
    id: "path-tool",
    category: "canvas-edit",
    description: "Bucket fill and multi-segment path creation profiling.",
    specPath: "profiling/profile-path-tool.spec.ts"
  },
  {
    id: "node-text-edit",
    category: "canvas-edit",
    description: "Canvas node text editing profiling for single-line, wrapped, and explicit multiline nodes.",
    specPath: "profiling/profile-node-text-edit.spec.ts"
  }
];

export function getProfilingScenarioById(id: string): ProfilingScenarioManifest | null {
  return PROFILING_SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}
