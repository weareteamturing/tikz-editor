import type { CoordinateForm } from "../../ast/types.js";

export type ParsedCoordinate = {
  x: string;
  y: string;
  form: CoordinateForm;
  isWellFormed: boolean;
};
