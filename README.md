# tikz-editor
A WYSIWYG editor foundation for TikZ with a layered parser -> semantic IR -> SVG pipeline.

## Architecture
1. Parser (`/Users/dominik/GitHub/tikz-editor/src/parser`) parses TikZ into a lossless AST with diagnostics.
2. Semantic evaluator (`/Users/dominik/GitHub/tikz-editor/src/semantic`) resolves styles, transforms, coordinates, and path semantics into a scene graph.
3. SVG backend (`/Users/dominik/GitHub/tikz-editor/src/svg`) emits pure SVG from scene elements.
4. Render convenience API (`/Users/dominik/GitHub/tikz-editor/src/render`) provides end-to-end source -> SVG orchestration.

More detail is in `/Users/dominik/GitHub/tikz-editor/docs/architecture.md`.

## Capability Matrix
Capabilities are tracked explicitly in:
1. `/Users/dominik/GitHub/tikz-editor/src/capabilities/feature-ids.ts`
2. `/Users/dominik/GitHub/tikz-editor/src/capabilities/matrix.ts`
3. `/Users/dominik/GitHub/tikz-editor/src/capabilities/registries.ts`

Capability drift is CI-gated by `/Users/dominik/GitHub/tikz-editor/test/capabilities.spec.ts`.

## Scripts
1. `npm test` runs all tests.
2. `npm run test:capabilities` runs capability matrix guards only.
3. `npm run build` builds the parser package.
4. `cd /Users/dominik/GitHub/tikz-editor/web && npm run build` builds the playground.

## Corpus Source
The repository includes `pgf-docs/`, a local corpus extracted from PGF/TikZ documentation used for parser and regression coverage in `/Users/dominik/GitHub/tikz-editor/test/corpus.spec.ts`.
