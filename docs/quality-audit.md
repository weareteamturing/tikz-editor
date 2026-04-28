# Quality Audit: Silent Failure and Type Escape Hatches

Date: 2026-04-28

This audit was prompted by a real defect where `insertPathPoint` was accidentally changed to
`insertPathWorldPoint`. TypeScript did not catch it because the call crossed a permissive hook
argument boundary, and the behavior stayed quiet at runtime.

## Current State

- TypeScript is already running with `strict: true` in the root, core, and web configs.
- There is no ESLint, Biome, or equivalent lint configuration in the repository.
- The highest-risk pattern is not lack of strict mode. It is local escape hatches:
  - hook/view arg bags typed as `{ [key: string]: any }`
  - `as any` and `as unknown as` casts
  - empty or broad `catch` blocks
  - fallback paths that silently preserve UI flow after an invariant breaks

## Source Scan Summary

Counts below exclude generated public docs, paper fixtures, and profiling trace output.

| Area | Files | `any` tokens | `as any` / `as unknown as` | `[key: string]: any` | catches | bare `catch {}` | ignore/no-op comments | fallback returns |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `packages/app/src` | 150 | 59 | 2 | 10 | 58 | 33 | 10 | 35 |
| `packages/core/src` | 247 | 94 | 17 | 0 | 19 | 6 | 0 | 80 |
| `apps/web/src` | 3 | 0 | 2 | 0 | 8 | 7 | 1 | 0 |
| `apps/desktop/src` | 3 | 8 | 0 | 0 | 1 | 1 | 0 | 0 |
| `apps/landing/src` | 23 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `apps/web/e2e` | 14 | 0 | 48 | 0 | 5 | 5 | 1 | 10 |
| `test` | 139 | 34 | 32 | 0 | 1 | 0 | 1 | 0 |

These counts are directional, not a quality verdict. Some fallbacks are intentional product behavior,
and some casts are reasonable test scaffolding. The risk is concentrated where these patterns sit on
editor runtime paths.

## Highest-Risk Hotspots

### 1. Canvas Hook Arg Bags

These files expose large, destructured inputs through `{ [key: string]: any }`:

- `packages/app/src/ui/canvas-panel/useCanvasToolInteractions.ts`
- `packages/app/src/ui/canvas-panel/useCanvasElementInteractions.ts`
- `packages/app/src/ui/canvas-panel/useCanvasHandleInteractions.ts`
- `packages/app/src/ui/canvas-panel/useCanvasSelectionDerivedState.ts`
- `packages/app/src/ui/canvas-panel/useCanvasDerivedState.ts`
- `packages/app/src/ui/canvas-panel/CanvasPanelView.tsx`
- `packages/app/src/ui/canvas-panel/useCanvasViewportEffects.ts`
- `packages/app/src/ui/canvas-panel/useCanvasSelectionInteractions.ts`
- `packages/app/src/ui/canvas-panel/useCanvasKeyboardClipboard.ts`
- `packages/app/src/ui/canvas-panel/useCanvasTextEditingEffects.ts`

This is the same class of boundary that allowed an invalid edit action discriminant to compile.
These should be converted to explicit prop/arg interfaces first.

### 2. Silent Catch Blocks

Top files by catch count:

- `packages/core/src/text/mathjax-engine.ts` - 10 catches
- `packages/app/src/ui/editor-clipboard.ts` - 9 catches, all bare
- `apps/web/src/platform/browser-platform.ts` - 8 catches, 7 bare
- `packages/app/src/store/workspace-storage.ts` - 6 catches, persistence-oriented
- `packages/app/src/ui/AssistantPanel.tsx` - 6 catches
- `packages/app/src/ui/canvas-panel/useCanvasKeyboardClipboard.ts` - 5 catches
- `packages/app/src/ui/svg-import.ts` - 5 catches
- `packages/app/src/ui/App.tsx` - 5 catches
- `packages/app/src/ui/export-commands.ts` - 5 catches

Persistence, clipboard, export, and platform bridges legitimately need recovery paths, but they should
generally report diagnostics or route errors to user-visible feedback. Bare catches in interaction code
should be treated as suspicious by default.

### 3. Fallback-Heavy Runtime Logic

Top files by fallback returns:

- `packages/core/src/parser/incremental.ts` - 13
- `packages/core/src/semantic/nodes/named-coordinates.ts` - 13
- `packages/core/src/edit/inspector.ts` - 9
- `packages/core/src/semantic/nodes/shape-geometry.ts` - 8
- `packages/app/src/ui/CanvasPanel.tsx` - 7
- `packages/core/src/semantic/decorations/engine.ts` - 6
- `packages/core/src/edit/element-templates.ts` - 4
- `packages/core/src/text/knuth-plass/editor/hitmap.ts` - 4

Some of these are domain-correct approximations. The audit target is not "remove all fallbacks";
it is "make fallback use observable when it protects an invariant rather than representing normal
TikZ semantics."

### 4. `any` Concentrations

Top source files by explicit `any` count:

- `packages/core/src/text/knuth-plass/paragraph/applyBreaks.ts` - 28
- `packages/core/src/text/knuth-plass/KnuthPlassVisitor.ts` - 24
- `packages/core/src/text/knuth-plass/editor/hitmap.ts` - 18
- `apps/desktop/src/platform/desktop-platform.ts` - 8
- `packages/app/src/ui/canvas-panel/useCanvasHandleInteractions.ts` - 8
- `packages/app/src/ui/inspector-panel/InspectorSections.tsx` - 8
- `packages/core/src/text/knuth-plass/editor/mathPrefix.ts` - 8
- `packages/app/src/ui/inspector-panel/property-renderers.tsx` - 7

Knuth-Plass may be integrating with weakly typed MathJax structures, so not every `any` there is equally
actionable. The canvas and inspector UI code is more immediately useful to harden.

## Replacement-Error Follow-Up

After the `Point -> WorldPoint` replacement issue, these targeted scans were run:

- identifiers/discriminants containing `WorldPoint` in action-like strings
- `setWorldPointerCapture` / `releaseWorldPointerCapture` / related DOM API-shaped names
- same-file pairs of `FooWorldPoint` and `FooPoint`

Findings fixed:

- `insertPathWorldPoint` -> `insertPathPoint`
- `setWorldPointerCapture` -> `setPointerCapture`
- internal aliases `DeletePathWorldPointAction` / `InsertPathWorldPointAction` renamed to
  `DeletePathPointAction` / `InsertPathPointAction`

The targeted suspicious scans are clean after those changes.

## Recommended Linting Stack

Use ESLint, not Biome alone, for this project. Biome is good for formatting and some fast linting,
but the bugs we care about require type-aware TypeScript rules.

Install:

```sh
npm install -D eslint typescript-eslint @eslint/js globals eslint-plugin-react-hooks eslint-plugin-react-refresh
```

Optional but useful later:

```sh
npm install -D eslint-plugin-unicorn eslint-plugin-vitest
```

`eslint-plugin-vitest` is the better next plugin once test-specific linting is useful. It can catch
focused/skipped tests, invalid async expectations, and common Vitest assertion mistakes. It should be
added with test-only overrides rather than applied to production code.

`eslint-plugin-unicorn` is useful, but it is much noisier. It is best treated as a later cleanup pass
after the TypeScript-aware baseline has been ratcheted down, with most stylistic rules disabled at
first.

Add scripts at the root:

```json
{
  "scripts": {
    "lint": "eslint .",
    "lint:ci": "eslint . --quiet"
  }
}
```

Suggested `eslint.config.mjs` baseline:

```js
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "packages/core/dist/**",
      "apps/web/dist/**",
      "apps/desktop/src-tauri/target/**",
      "packages/app/public/docs/**",
      "test/papers/**",
      "apps/web/profiling/traces/**",
      "pgf-docs/**",
      "pgf-src/**",
      "tauri-docs/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/switch-exhaustiveness-check": "warn",
      "no-empty": ["warn", { "allowEmptyCatch": false }],
      "no-fallthrough": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": "off"
    }
  },
  {
    files: ["test/**", "apps/web/e2e/**", "apps/web/profiling/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off"
    }
  }
);
```

The applied baseline is intentionally warning-heavy: `npm run lint` reports the cleanup inventory,
while `npm run lint:ci` fails only on hard errors. Once warnings are reduced per directory,
`lint:ci` can move to `eslint . --max-warnings=0`.

## Adoption Plan

1. Add ESLint with the baseline above, but do not immediately require zero warnings for unsafe rules.
2. Keep only very low-noise rules as hard errors at first:
   - fallthrough
   - rules of hooks
3. Ratchet these warning rules into errors once the current inventory is triaged:
   - empty catch blocks
   - floating promises
   - misused promises
   - switch exhaustiveness
4. Convert the canvas hook arg bags to explicit interfaces.
5. Add local allowlists for intentional browser/clipboard/storage catches.
6. Ratchet the unsafe rules per directory:
   - first `packages/app/src/ui/canvas-panel`
   - then `packages/app/src/ui`
   - then `packages/core/src/edit`
   - then parser/semantic core
7. Add a small custom audit script if needed for project-specific strings:
   - edit action `kind` values must match `EditAction`
   - no DOM API names containing `WorldPoint`, `WorldPointer`, etc.
   - no `catch {}` except in an explicit allowlist

## Concrete First Cleanup Targets

1. Type `UseCanvasElementInteractionsArgs`.
2. Type `UseCanvasToolInteractionsArgs`.
3. Type `UseCanvasHandleInteractionsArgs`.
4. Replace bare catches in `editor-clipboard.ts` with explicit typed fallback results or debug logging.
5. Review `browser-platform.ts` catches and require comments that state which browser limitation is being handled.
6. Add tests for unsupported edit actions and hint/action consistency.

The highest return is the canvas arg typing. That is where user-facing editing behavior, stringly typed
actions, synthetic events, and fallback behavior intersect.
