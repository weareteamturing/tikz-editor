import type { Span } from "../ast/types.js";

export type OptionEntry =
  | {
      kind: "kv";
      key: string;
      valueRaw: string;
      span: Span;
      raw: string;
    }
  | {
      kind: "flag";
      key: string;
      span: Span;
      raw: string;
    }
  | {
      kind: "unknown";
      span: Span;
      raw: string;
    };

export type OptionListAst = {
  span: Span;
  raw: string;
  entries: OptionEntry[];
};

