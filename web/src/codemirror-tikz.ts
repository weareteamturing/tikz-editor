import { LRLanguage, LanguageSupport } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import { parser } from "tikz-editor/syntax/grammar/tikz-parser";

const tikzHighlighting = styleTags({
  Comment: t.lineComment,
  "DrawCmd PathCmd FillDrawCmd FillCmd PatternCmd ClipCmd ShadeCmd ShadeDrawCmd UseAsBoundingBoxCmd NodeCmd CoordinateCmd":
    t.keyword,
  CommandName: t.processingInstruction,
  NodeKw: t.keyword,
  PathKeyword: t.keyword,
  "BeginTikz EndTikz": t.keyword,
  Number: t.number,
  Identifier: t.variableName,
  Coordinate: t.special(t.variableName),
  "CoordPart/Number": t.number,
  "( )": t.paren,
  "[ ]": t.squareBracket,
  "{ }": t.brace,
  PathOperator: t.operator,
  "OptionPunct GroupPunct StraySymbol": t.punctuation,
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
