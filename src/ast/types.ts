import type { OptionListAst } from "../options/types.js";

export type Span = { from: number; to: number };

export type TikzFigure = {
  kind: "Figure";
  span: Span;
  options?: OptionListAst;
  body: Statement[];
};

export type Statement =
  | PathStatement
  | ScopeStatement
  | ForeachStatement
  | MacroDefinitionStatement
  | MacroAliasStatement
  | MacroCommandDefinitionStatement
  | UnknownStatement;

export type PathStatement = {
  kind: "Path";
  id: string;
  span: Span;
  command: PathCommand;
  options?: OptionListAst;
  items: PathItem[];
};

export type ScopeStatement = {
  kind: "Scope";
  id: string;
  span: Span;
  options?: OptionListAst;
  body: Statement[];
};

export type ForeachStatement = {
  kind: "Foreach";
  id: string;
  span: Span;
  options?: OptionListAst;
  optionsSpan?: Span;
  headerSpan?: Span;
  headerRaw?: string;
  variablesRaw?: string;
  listRaw?: string;
  prefixRaw: string;
  bodyRaw: string;
};

export type MacroDefinitionStatement = {
  kind: "MacroDefinition";
  id: string;
  span: Span;
  raw: string;
  commandRaw: "\\def";
  nameRaw: string;
  nameSpan?: Span;
  valueRaw: string;
  valueSpan?: Span;
};

export type MacroAliasStatement = {
  kind: "MacroAlias";
  id: string;
  span: Span;
  raw: string;
  commandRaw: "\\let";
  nameRaw: string;
  nameSpan?: Span;
  targetRaw: string;
  targetSpan?: Span;
};

export type MacroCommandDefinitionStatement = {
  kind: "MacroCommandDefinition";
  id: string;
  span: Span;
  raw: string;
  commandRaw: "\\newcommand" | "\\renewcommand";
  nameRaw: string;
  nameSpan?: Span;
  arity: number;
  aritySpan?: Span;
  optionalDefaultRaw?: string;
  optionalDefaultSpan?: Span;
  bodyRaw: string;
  bodySpan?: Span;
  starred: boolean;
};

export type PathCommand =
  | "path"
  | "draw"
  | "fill"
  | "filldraw"
  | "pattern"
  | "clip"
  | "shade"
  | "shadedraw"
  | "useasboundingbox"
  | "node"
  | "coordinate";

export type PathItem =
  | CoordinateItem
  | NodeItem
  | PathForeachItem
  | PathCommentItem
  | PathOptionItem
  | PathKeywordItem
  | ToOperationItem
  | EdgeOperationItem
  | SvgOperationItem
  | LetOperationItem
  | DecorateOperationItem
  | CoordinateOperationItem
  | UnknownPathItem;

export type CoordinateItem = {
  kind: "Coordinate";
  id: string;
  span: Span;
  optionsSpan?: Span;
  options?: OptionListAst;
  relativePrefix?: RelativeCoordinatePrefix;
  x: string;
  y: string;
  z?: string;
  raw: string;
  form: CoordinateForm;
};

export type NodeItem = {
  kind: "Node";
  id: string;
  span: Span;
  raw: string;
  templateRaw: string;
  name?: string;
  aliases?: string[];
  optionsSpan?: Span;
  options?: OptionListAst;
  foreachClauses?: NodeForeachClause[];
  atSpan?: Span;
  atRaw?: string;
  atRelativePrefix?: RelativeCoordinatePrefix;
  textSource: "group" | "option";
  textSpan: Span;
  text: string;
};

export type NodeForeachClause = {
  kind: "NodeForeachClause";
  id: string;
  span: Span;
  raw: string;
  headerRaw: string;
  variablesRaw?: string;
  listRaw?: string;
  optionsSpan?: Span;
  options?: OptionListAst;
};

export type PathOptionItem = {
  kind: "PathOption";
  id: string;
  span: Span;
  raw: string;
  options: OptionListAst;
};

export type PathCommentItem = {
  kind: "PathComment";
  id: string;
  span: Span;
  raw: string;
};

export type PathKeywordItem = {
  kind: "PathKeyword";
  id: string;
  span: Span;
  keyword: string;
};

export type PathForeachItem = {
  kind: "PathForeach";
  id: string;
  span: Span;
  raw: string;
  commandRaw: "foreach" | "\\foreach";
  headerRaw: string;
  variablesRaw?: string;
  listRaw?: string;
  optionsSpan?: Span;
  options?: OptionListAst;
  bodyRaw: string;
};

export type ToOperationItem = {
  kind: "ToOperation";
  id: string;
  span: Span;
  optionsSpan?: Span;
  options?: OptionListAst;
  nodes?: NodeItem[];
  target?: ToOperationTarget;
  raw: string;
};

export type EdgeOperationItem = {
  kind: "EdgeOperation";
  id: string;
  span: Span;
  optionsSpan?: Span;
  options?: OptionListAst;
  nodes?: NodeItem[];
  target?: ToOperationTarget;
  raw: string;
};

export type SvgOperationItem = {
  kind: "SvgOperation";
  id: string;
  span: Span;
  optionsSpan?: Span;
  options?: OptionListAst;
  dataSpan?: Span;
  dataRaw: string;
};

export type LetOperationItem = {
  kind: "LetOperation";
  id: string;
  span: Span;
  raw: string;
};

export type CoordinateOperationItem = {
  kind: "CoordinateOperation";
  id: string;
  span: Span;
  optionsSpan?: Span;
  options?: OptionListAst;
  name?: string;
  nameSpan?: Span;
  placementSpan?: Span;
  raw: string;
};

export type DecorateOperationItem = {
  kind: "DecorateOperation";
  id: string;
  span: Span;
  optionsSpan?: Span;
  options?: OptionListAst;
  subpathSpan: Span;
  subpathRaw: string;
  raw: string;
};

export type ToOperationTarget =
  | {
      kind: "coordinate";
      raw: string;
      relativePrefix?: RelativeCoordinatePrefix;
      span?: Span;
    }
  | {
      kind: "cycle";
      span?: Span;
    };

export type UnknownStatement = {
  kind: "UnknownStatement";
  id: string;
  span: Span;
  raw: string;
};

export type UnknownPathItem = {
  kind: "UnknownPathItem";
  id: string;
  span: Span;
  raw: string;
};

export type CoordinateForm = "cartesian" | "xyz" | "polar" | "named" | "calc" | "explicit" | "unknown";

export type RelativeCoordinatePrefix = "+" | "++";
