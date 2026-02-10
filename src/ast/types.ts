export type Span = { from: number; to: number };

export type TikzFigure = {
  kind: "Figure";
  span: Span;
  body: Statement[];
};

export type Statement = PathStatement | UnknownStatement;

export type PathStatement = {
  kind: "Path";
  id: string;
  span: Span;
  command: PathCommand;
  items: PathItem[];
};

export type PathCommand = "path" | "draw" | "fill" | "filldraw" | "clip" | "shade" | "node" | "coordinate";

export type PathItem = CoordinateItem | NodeItem | PathOptionItem | PathKeywordItem | UnknownPathItem;

export type CoordinateItem = {
  kind: "Coordinate";
  id: string;
  span: Span;
  x: string;
  y: string;
  raw: string;
  form: CoordinateForm;
};

export type NodeItem = {
  kind: "Node";
  id: string;
  span: Span;
  optionsSpan?: Span;
  textSpan: Span;
  text: string;
};

export type PathOptionItem = {
  kind: "PathOption";
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

export type CoordinateForm = "cartesian" | "polar" | "named" | "calc" | "unknown";
