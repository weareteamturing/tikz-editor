import { parseTikz, type ParseTikzResult } from "../parser/index.js";

export type EditParseOptions = {
  activeFigureId?: string | null;
};

export function parseTikzForEdit(source: string, options: EditParseOptions = {}): ParseTikzResult {
  return parseTikz(source, {
    recover: true,
    activeFigureId: options.activeFigureId
  });
}
