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

## Scripts
1. `npm test` runs all tests.
2. `npm run test:capabilities` runs capability matrix guards only.
3. `npm run build` builds the parser package.
4. `cd /Users/dominik/GitHub/tikz-editor/apps/web && npm run build` builds the playground.
5. `npm run compare:renderers -- --input path/to/snippet.tex` runs our renderer and a TeX reference render, then writes a comparison manifest.
6. `npm run compare:pgf-docs -- --source-file pgfmanual-en-tikz-paths.tex` renders snippets from one PGF doc source file and writes an `index.html` side-by-side gallery. It generates side-by-side.png files that can be visually inspected for render accuracy.

## Corpus Source
The repository includes `pgf-docs/`, a copy of the PGF manual source files. It also includes `pgf-src/`, a copy of the PGF source files. Both should be used to check the intended rendering of TikZ features against the reference implementation. The `pgf-docs/` snippets are also used for testing and capability tracking.

## Testing note
vitest doesn’t support --runInBand in this environment.