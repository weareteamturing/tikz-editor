import { parser } from "tikz-editor/syntax/grammar/tikz-parser";
import { BASIC_PICKER_COLOR_SET } from "./color-palette";
import { collectDeclaredColors } from "./source-color-detection";

export type NamedColorSwatch = {
  token: string;
  cssColor: string;
};

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
