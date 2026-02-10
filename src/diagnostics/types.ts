import type { Span } from "../ir/types.js";

export type Severity = "error" | "warning";

export type Diagnostic = {
  severity: Severity;
  message: string;
  span: Span;
  code?: string;
};
