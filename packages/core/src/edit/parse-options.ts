import { parseTikz, type ParseTikzResult } from "../parser/index.js";
import type { EditAnalysisSession, EditAnalysisView } from "./analysis.js";
import { incrementProfilingCounter } from "../profiling.js";

export type EditParseOptions = {
  activeFigureId?: string | null;
  analysisSession?: EditAnalysisSession | null;
  analysisView?: EditAnalysisView | null;
  colorAliases?: ReadonlyMap<string, string> | null;
  indentSize?: 2 | 4;
};

export function parseTikzForEdit(source: string, options: EditParseOptions = {}): ParseTikzResult {
  incrementProfilingCounter("parseTikzForEditCalls");
  if (
    options.analysisView &&
    options.analysisView.source === source &&
    options.analysisView.activeFigureId === options.activeFigureId
  ) {
    return options.analysisView.parseResult;
  }
  if (options.analysisSession) {
    return options.analysisSession.ensure(source, {
      activeFigureId: options.activeFigureId
    }).parseResult;
  }
  return parseTikz(source, {
    recover: true,
    activeFigureId: options.activeFigureId,
    // Edit queries resolve scene/source ids produced by the main compute path,
    // so they must preserve the same statement numbering.
    includeContextDefinitions: true
  });
}
