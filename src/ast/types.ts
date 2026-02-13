import type { OptionListAst } from "../options/types.js";

export type Span = { from: number; to: number };

export type TikzFigure = {
  kind: "Figure";
  span: Span;
  options?: OptionListAst;
  body: Statement[];
};

export type Statement = PathStatement | ScopeStatement | ForeachStatement | UnknownStatement;

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
  prefixRaw: string;
  bodyRaw: string;
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
  | PathCommentItem
  | PathOptionItem
  | PathKeywordItem
  | ToOperationItem
  | SvgOperationItem
  | LetOperationItem
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
  name?: string;
  aliases?: string[];
  optionsSpan?: Span;
  options?: OptionListAst;
  atSpan?: Span;
  atRaw?: string;
  atRelativePrefix?: RelativeCoordinatePrefix;
  textSource: "group" | "option";
  textSpan: Span;
  text: string;
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
