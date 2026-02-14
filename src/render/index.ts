import { parseTikz } from "../parser/index.js";
import type { ParseTikzOptions, ParseTikzResult } from "../parser/index.js";
import { evaluateTikzFigure } from "../semantic/evaluate.js";
import type { EvaluateOptions, EvaluateTikzResult } from "../semantic/index.js";
import { emitSvg } from "../svg/emit.js";
import type { EmitSvgOptions, EmitSvgResult } from "../svg/index.js";
import { createMathJaxNodeTextEngine } from "../text/mathjax-engine.js";
import type { NodeTextEngine } from "../text/types.js";

let mathJaxEngineUnavailable = false;

export type RenderTikzOptions = {
  parse?: ParseTikzOptions;
  evaluate?: EvaluateOptions;
  svg?: EmitSvgOptions;
  textEngine?: NodeTextEngine | null;
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

export async function renderTikzToSvgAsync(source: string, opts: RenderTikzOptions = {}): Promise<RenderTikzToSvgResult> {
  const providedEngine = opts.textEngine ?? opts.evaluate?.textEngine ?? opts.svg?.textEngine ?? null;
  let textEngine = providedEngine;
  if (!textEngine && !mathJaxEngineUnavailable) {
    try {
      textEngine = await createMathJaxNodeTextEngine();
    } catch {
      textEngine = null;
      mathJaxEngineUnavailable = true;
    }
  }

  const parseOpts: ParseTikzOptions = {
    ...(opts.parse ?? {}),
    nodeTextValidator:
      opts.parse?.nodeTextValidator ??
      (textEngine
        ? ({ node }) => {
            return textEngine?.validate(node.text) ?? null;
          }
        : undefined)
  };

  const evaluateOpts: EvaluateOptions = {
    ...(opts.evaluate ?? {}),
    textEngine: opts.evaluate?.textEngine ?? textEngine
  };

  const svgOpts: EmitSvgOptions = {
    ...(opts.svg ?? {}),
    textEngine: opts.svg?.textEngine ?? textEngine
  };

  const parseResult = parseTikz(source, parseOpts);
  const semanticResult = evaluateTikzFigure(parseResult.figure, parseResult.source, evaluateOpts);
  const svgResult = emitSvg(semanticResult.scene, svgOpts);

  return {
    parse: parseResult,
    semantic: semanticResult,
    svg: svgResult
  };
}
