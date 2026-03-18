# Development

This document is for contributors to tikz-editor.

## Architecture

The core library uses a layered pipeline:

1. **Parser** (`packages/core/src/parser`) — Parses TikZ into a lossless AST with diagnostics
2. **Semantic Evaluator** (`packages/core/src/semantic`) — Resolves styles, transforms, coordinates, and path semantics into a scene graph
3. **SVG Backend** (`packages/core/src/svg`) — Emits pure SVG from scene elements
4. **Render API** (`packages/core/src/render`) — End-to-end source → SVG orchestration

See `docs/architecture.md` for detailed documentation.

## Apps

- **Web app** (`apps/web`) — Vite + React
- **Desktop app** (`apps/desktop`) — Tauri v2

## Scripts

```bash
# Type checking
npm run typecheck

# Run all tests
npm test

# Capability matrix tests only
npm run test:capabilities

# PGF corpus regression tests
npm run test:corpus

# Web e2e tests (Playwright)
npm run test:e2e

# Desktop e2e tests
npm run test:desktop:e2e

# Build core package
npm run build

# Build web app
cd apps/web && npm run build
```

### Renderer Comparison Scripts

Compare our renderer against TeX reference output:

```bash
# Single snippet
npm run compare:renderers -- --input path/to/snippet.tex

# PGF manual snippets (generates side-by-side gallery)
npm run compare:pgf-docs -- --source-file pgfmanual-en-tikz-paths.tex
```

Outputs go to `artifacts/renderer-compare/`.

## Capability Matrix

Capabilities are tracked in:
- `packages/core/src/capabilities/feature-ids.ts`
- `packages/core/src/capabilities/matrix.ts`
- `packages/core/src/capabilities/registries.ts`

CI enforces capability drift via `test/capabilities.spec.ts`.

## Corpus

The repository includes `pgf-docs/`, a copy of the PGF manual source files used for testing and capability tracking. `pgf-src/` contains PGF source files for reference.

## Codespaces

`.devcontainer/devcontainer.json` runs `npm run codespaces:startup` on creation, which installs Tauri Linux dependencies and builds prerequisites.

## Profiling

Performance profiling scripts are in `apps/web/profiling/`. Run from `apps/web/`:

```bash
npx playwright test --config profiling/playwright.config.ts profiling/profile-paper-drag.spec.ts
```

Set `TIKZ_PROFILE_VERBOSE=1` for verbose output. Analyze profiles with:

```bash
node scripts/analyze-cpuprofile.mjs apps/web/profiling/traces/paper-drag-visible.cpuprofile
```
