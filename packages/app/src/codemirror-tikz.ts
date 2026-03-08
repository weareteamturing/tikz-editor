import { LRLanguage, LanguageSupport } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import { parser } from "tikz-editor/syntax/grammar/tikz-parser";

const tikzHighlighting = styleTags({
  Comment: t.lineComment,

  // Environment delimiters
  "BeginTikz EndTikz BeginScope EndScope": t.keyword,

  // Path commands (\draw, \fill, etc.)
  "DrawCmd PathCmd FillDrawCmd FillCmd PatternCmd ClipCmd ShadeCmd ShadeDrawCmd UseAsBoundingBoxCmd MatrixCmd ColorletCmd DefineColorCmd":
    t.keyword,

  // \node and \coordinate commands
  "NodeCmd CoordinateCmd": t.keyword,

  // Inline keywords: node, coordinate, edge, to
  "NodeKw CoordinateKw EdgeKw ToKw": t.keyword,

  // Shape/operation keywords: circle, rectangle, arc, etc.
  "CircleKw RectangleKw EllipseKw ArcKw GridKw ParabolaKw SinKw CosKw PlotKw SvgKw": t.typeName,

  // Modifier keywords: at, bend, cycle, controls, and
  "AtKw BendKw CycleKw ControlsKw AndKw": t.keyword,

  // Foreach / let / in — loop constructs
  "ForeachCmd ForeachKw LetKw InKw": t.keyword,

  // Font size commands
  FontSizeCmd: t.keyword,

  // Unknown commands (\somecommand) — meta color (#404740)
  CommandName: t.meta,

  // Literals
  Number: t.literal,
  QuotedSvg: t.string,

  // Identifiers in option lists — labelName (#219, blue)
  "OptionPart/*/Identifier": t.labelName,

  // Node text content — string color (#a11)
  // NodeItem/Group covers inline `node {text}`, PathItem/Group covers `\node ... {text}`
  "NodeItem/Group/... PathItem/Group/...": t.string,

  // General identifiers (fallback) — className (#167, dark teal)
  Identifier: t.className,

  // Coordinates get a distinct look
  "Coordinate/( Coordinate/)": t.special(t.paren),
  "CoordPart/Number": t.literal,

  // Brackets
  "( )": t.paren,
  "[ ]": t.squareBracket,
  "{ }": t.brace,

  // Operators
  PathOperator: t.operator,
  GroupPathOperator: t.operator,
  RelativePrefix: t.operator,
  LetPunct: t.operator,

  // Punctuation
  "OptionPunct GroupPunct": t.punctuation,
  "MatrixRowSepCmd EscapedAmpersandCmd": t.punctuation,
  StraySymbol: t.punctuation,

  // Errors
  "⚠": t.invalid,
});

const tikzLRLanguage = LRLanguage.define({
  parser: parser.configure({
    props: [tikzHighlighting],
  }),
  languageData: {
    commentTokens: { line: "%" },
  },
});

export function tikzLanguage(): LanguageSupport {
  return new LanguageSupport(tikzLRLanguage);
}
