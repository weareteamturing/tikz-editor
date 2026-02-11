import { parseTikz } from "../parser/index.js";
import type { ParseTikzOptions, ParseTikzResult } from "../parser/index.js";
import { evaluateTikzFigure } from "../semantic/evaluate.js";
import type { EvaluateOptions, EvaluateTikzResult } from "../semantic/index.js";
import { emitSvg } from "../svg/emit.js";
import type { EmitSvgOptions, EmitSvgResult } from "../svg/index.js";

export type RenderTikzOptions = {
  parse?: ParseTikzOptions;
  evaluate?: EvaluateOptions;
  svg?: EmitSvgOptions;
};

export type RenderTikzToSvgResult = {
  parse: ParseTikzResult;
  semantic: EvaluateTikzResult;
  svg: EmitSvgResult;
};

export function renderTikzToSvg(source: string, opts: RenderTikzOptions = {}): RenderTikzToSvgResult {
  const parseResult = parseTikz(source, opts.parse);
  const semanticResult = evaluateTikzFigure(parseResult.figure, parseResult.source, opts.evaluate);
  const svgResult = emitSvg(semanticResult.scene, opts.svg);

  return {
    parse: parseResult,
    semantic: semanticResult,
    svg: svgResult
  };
}

