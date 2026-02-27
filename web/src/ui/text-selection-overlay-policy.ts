export type TextSelectionOverlayResolution = "apply" | "clear" | "preserve";

export type ResolveTextSelectionOverlayResolutionInput = {
  hasSourceId: boolean;
  hasTarget: boolean;
  offsetsInRange: boolean;
  allowTransientPreserve: boolean;
  snapshotMatchesSource: boolean;
};

export function resolveTextSelectionOverlayResolution(
  input: ResolveTextSelectionOverlayResolutionInput
): TextSelectionOverlayResolution {
  if (input.hasSourceId && input.hasTarget && input.offsetsInRange) {
    return "apply";
  }
  if (input.allowTransientPreserve && !input.snapshotMatchesSource) {
    return "preserve";
  }
  return "clear";
}
