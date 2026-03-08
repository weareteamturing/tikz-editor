# tikz-editor
A WYSIWYG editor foundation for TikZ with a layered parser -> semantic IR -> SVG pipeline.

## Architecture
1. Parser (`/Users/dominik/GitHub/tikz-editor/packages/core/src/parser`) parses TikZ into a lossless AST with diagnostics.
2. Semantic evaluator (`/Users/dominik/GitHub/tikz-editor/packages/core/src/semantic`) resolves styles, transforms, coordinates, and path semantics into a scene graph.
3. SVG backend (`/Users/dominik/GitHub/tikz-editor/packages/core/src/svg`) emits pure SVG from scene elements.
4. Render convenience API (`/Users/dominik/GitHub/tikz-editor/packages/core/src/render`) provides end-to-end source -> SVG orchestration.

More detail is in `/Users/dominik/GitHub/tikz-editor/docs/architecture.md`.

## Capability Matrix
Capabilities are tracked explicitly in:
1. `/Users/dominik/GitHub/tikz-editor/packages/core/src/capabilities/feature-ids.ts`
2. `/Users/dominik/GitHub/tikz-editor/packages/core/src/capabilities/matrix.ts`
3. `/Users/dominik/GitHub/tikz-editor/packages/core/src/capabilities/registries.ts`

Capability drift is CI-gated by `/Users/dominik/GitHub/tikz-editor/test/capabilities.spec.ts`.

Foreach constructs (`\foreach`, path `foreach`, and `node foreach`) are expanded in the semantic stage with per-element loop provenance in `origin.foreachStack`.

## Scripts
1. `npm test` runs all tests.
2. `npm run test:capabilities` runs capability matrix guards only.
3. `npm run build` builds the parser package.
4. `cd /Users/dominik/GitHub/tikz-editor/apps/web && npm run build` builds the playground.
5. `npm run compare:renderers -- --input path/to/snippet.tex` runs our renderer and a TeX reference render, then writes a comparison manifest. Use `--reference-mode pdf-png` (default), `--reference-mode dvisvgm-svg`, or `--reference-mode dvisvgm-svg-png`.
6. `npm run compare:arrows` regenerates renderer-vs-TeX comparisons for all files under `docs/comparison-inputs/` and writes `artifacts/renderer-compare/arrow-comparison-manifest.json`. Add `-- --with-timestamp` to keep historical run directories.
7. `npm run compare:pgf-docs -- --source-file pgfmanual-en-tikz-paths.tex` renders snippets from one PGF doc source file and writes an `index.html` side-by-side gallery. It also supports `--reference-mode pdf-png|dvisvgm-svg|dvisvgm-svg-png`.

Comparison outputs are written under `artifacts/renderer-compare/<run>-<timestamp>/`:
1. `ours.svg` and `ours.png`
2. `latex-standalone.tex`, plus:
3. `latex-standalone.pdf` + `latex-standalone.png` in `pdf-png` mode, or
4. `latex-standalone.dvi` + `latex-standalone.svg` in `dvisvgm-svg` mode, or
5. `latex-standalone.dvi` + `latex-standalone.svg` + `latex-standalone.png` in `dvisvgm-svg-png` mode
6. `compare-report.json` with diagnostics and tool status

Corpus comparison gallery outputs are written under `artifacts/renderer-compare-docs/<run>-<timestamp>/`:
1. `index.html` side-by-side gallery
2. `comparison-manifest.json` with per-snippet status
3. one subdirectory per snippet with `compare-report.json` and renderer artifacts

## Corpus Source
The repository includes `pgf-docs/`, a local corpus extracted from PGF/TikZ documentation used for parser and regression coverage in `/Users/dominik/GitHub/tikz-editor/test/corpus.spec.ts`.

## Development Roadmap
See `/Users/dominik/GitHub/tikz-editor/docs/roadmap.md`.
