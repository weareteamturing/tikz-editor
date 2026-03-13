import { useEffect, useMemo, useState } from "react";
import { parser } from "tikz-editor/syntax/grammar/tikz-parser";
import { BASIC_PICKER_COLOR_SET } from "./color-palette";
import { collectDeclaredColors } from "./source-color-detection";
import { useEditorStore } from "./store/store";

export type NamedColorSwatch = {
  token: string;
  cssColor: string;
};

let lastSource = "__project-named-colors:uninitialized__";
let lastSwatches: NamedColorSwatch[] = [];

export function collectProjectNamedColorSwatches(source: string): NamedColorSwatch[] {
  if (source.trim().length === 0) {
    return [];
  }

  const tree = parser.parse(source);
  const declaredColors = collectDeclaredColors(source, tree);
  const swatches: NamedColorSwatch[] = [];
  const seen = new Set<string>();

  for (const [token, cssColor] of declaredColors.entries()) {
    const normalizedToken = token.trim().toLowerCase();
    if (
      normalizedToken.length === 0 ||
      seen.has(normalizedToken) ||
      BASIC_PICKER_COLOR_SET.has(normalizedToken)
    ) {
      continue;
    }
    seen.add(normalizedToken);
    swatches.push({
      token: normalizedToken,
      cssColor
    });
  }

  return swatches;
}

export function resolveProjectNamedColorSwatches(source: string): NamedColorSwatch[] {
  if (source === lastSource) {
    return lastSwatches;
  }
  lastSource = source;
  lastSwatches = collectProjectNamedColorSwatches(source);
  return lastSwatches;
}

export function useProjectNamedColorSwatches(source: string): NamedColorSwatch[] {
  const activeCanvasDragKind = useEditorStore((s) => s.activeCanvasDragKind);
  const activeSourceScrubSourceId = useEditorStore((s) => s.activeSourceScrubSourceId);
  const shouldFreeze =
    activeSourceScrubSourceId != null ||
    activeCanvasDragKind === "element" ||
    activeCanvasDragKind === "resize" ||
    activeCanvasDragKind === "rotate" ||
    activeCanvasDragKind === "handle";
  const [stableSource, setStableSource] = useState(source);

  useEffect(() => {
    if (!shouldFreeze) {
      setStableSource(source);
    }
  }, [shouldFreeze, source]);

  return useMemo(
    () => resolveProjectNamedColorSwatches(stableSource),
    [stableSource]
  );
}
