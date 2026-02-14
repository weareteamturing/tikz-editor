# TikZ Editor Architecture

## Pipeline
1. `parseTikz` (`/Users/dominik/GitHub/tikz-editor/src/parser/index.ts`) returns syntax tree + AST figure + diagnostics.
2. `evaluateTikzFigure` (`/Users/dominik/GitHub/tikz-editor/src/semantic/evaluate.ts`) turns AST statements into semantic scene elements.
3. `emitSvg` (`/Users/dominik/GitHub/tikz-editor/src/svg/emit.ts`) serializes scene elements into `<svg>...</svg>`.
4. `renderTikzToSvg` (`/Users/dominik/GitHub/tikz-editor/src/render/index.ts`) wires all layers together.

## AST Layer
`/Users/dominik/GitHub/tikz-editor/src/ast/types.ts` models:
1. Structural statements (`Path`, `Scope`, `Foreach`, `UnknownStatement`).
2. Path item variants (`Coordinate`, `Node`, `PathKeyword`, operations).
3. Structured options via `OptionListAst`.

## Options Layer
`/Users/dominik/GitHub/tikz-editor/src/options/parse.ts` parses raw option lists while preserving:
1. Raw text and spans.
2. Key/value and flag entries.
3. Unknown tokens for forward compatibility.

## Semantic Layer
`/Users/dominik/GitHub/tikz-editor/src/semantic` provides:
1. Context stack with inherited style + transform.
2. Coordinate evaluation (cartesian, relative, polar; named coordinates partial).
3. Foreach expansion pass (`statement`, `path`, and `node` forms) before geometry evaluation.
4. Path semantics for `--`, `-|`, `|-`, `cycle`, `rectangle`, `circle`.
5. Scene provenance metadata (`origin.foreachStack`) that links expanded instances back to loop bindings.
6. Unsupported-feature diagnostics for still-partial slices (`to`, `svg`, `let`, some advanced keywords).

Internal units use `pt` and y-up geometry; y inversion happens only in SVG emission.

## SVG Layer
`/Users/dominik/GitHub/tikz-editor/src/svg` contains:
1. Viewbox computation from scene bounds.
2. SVG emission for path/circle/text.
3. Arrow marker support for minimal style resolver output.

## Capability Governance
Capability state is explicit and enforced:
1. Feature IDs: `/Users/dominik/GitHub/tikz-editor/src/capabilities/feature-ids.ts`
2. Matrix statuses and fixture references: `/Users/dominik/GitHub/tikz-editor/src/capabilities/matrix.ts`
3. Layer registries: `/Users/dominik/GitHub/tikz-editor/src/capabilities/registries.ts`
4. Guard tests: `/Users/dominik/GitHub/tikz-editor/test/capabilities.spec.ts`

The capability test suite fails when matrix rows, layer registries, and fixture behavior diverge.
