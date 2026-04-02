export type TikzEditorProfilingCounter =
  | "parseTikzCalls"
  | "parseTikzForEditCalls"
  | "resolvePropertyTargetCalls"
  | "buildStylesCascadeModelCalls"
  | "resolveColorSyntaxValueCalls";

export type TikzEditorProfilingComputeTiming = {
  requestId: string;
  kind: string;
  trigger?: string | null;
  durationMs: number;
  changedSourceCount?: number;
  incremental?: boolean;
  parseStrategy?: string | null;
  semanticStrategy?: string | null;
  recomputedStatementCount?: number | null;
  reusedStatementCount?: number | null;
};

export type TikzEditorProfilingSvgPatchTiming = {
  durationMs: number;
  operationCount: number;
  forceReplaceAll: boolean;
  hasReplaceAll: boolean;
  hasReplaceDefs: boolean;
  fallbackReason?: string | null;
};

export type TikzEditorProfilingRecorder = {
  incrementCounter: (counter: TikzEditorProfilingCounter, amount?: number) => void;
  recordComputeTiming: (timing: TikzEditorProfilingComputeTiming) => void;
  recordSvgPatchTiming: (timing: TikzEditorProfilingSvgPatchTiming) => void;
};

declare global {
  // eslint-disable-next-line no-var
  var __TIKZ_EDITOR_PROFILING_RECORDER__: TikzEditorProfilingRecorder | undefined;
}

function getRecorder(): TikzEditorProfilingRecorder | null {
  return globalThis.__TIKZ_EDITOR_PROFILING_RECORDER__ ?? null;
}

export function incrementProfilingCounter(counter: TikzEditorProfilingCounter, amount = 1): void {
  getRecorder()?.incrementCounter(counter, amount);
}

export function recordProfilingComputeTiming(timing: TikzEditorProfilingComputeTiming): void {
  getRecorder()?.recordComputeTiming(timing);
}

export function recordProfilingSvgPatchTiming(timing: TikzEditorProfilingSvgPatchTiming): void {
  getRecorder()?.recordSvgPatchTiming(timing);
}
