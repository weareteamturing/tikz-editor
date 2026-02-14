Support is feasible, and the codebase is already close to a good architecture for it, but it should be phased.

## Implementation Status (2026-02-14)

### Phase 1 (`\def` + `\let`) progress
1. ✅ Added dedicated semicolon-less parser statements for `\def` and `\let`.
   - Grammar now recognizes macro definition/alias statements directly (instead of relying on `UnknownStatement`).
   - Added AST statement kinds: `MacroDefinition`, `MacroAlias`.
2. ✅ Added semantic macro binding registry, scoped with semantic frames.
   - Macro bindings now inherit through nested scopes and roll back when scope exits.
3. ✅ Added macro expansion in coordinate evaluation.
   - `\def\x{3}` now works in coordinate components such as `(\x,2)`.
4. ✅ Added macro expansion in node text before layout/MathJax rendering.
   - Zero-arg text macros now render in node content.
5. ✅ Reduced false `invalid-node-tex` failures in async render mode when user macro definitions are present.
   - Default parse-time node-text validation is skipped when macro-defining commands are detected in source.
6. ✅ Added tests for parser/semantic/render coverage of the above.

### Remaining Phase 1 follow-ups
1. ⏳ Improve MathJax integration from “skip validator when macros are present” to explicit macro-aware validation/render preamble wiring.
2. ⏳ Expand macro use in additional value paths (style/distance/option expression contexts) where practical.

### Planned later phases
1. Phase 2: `\newcommand` fixed-argument support.
2. Phase 3: optional arguments, constrained TikZ-fragment macro expansion, and richer provenance.

**What I found**
1. Parser/AST currently has no macro statement type, only `Path|Scope|Foreach|UnknownStatement` in `/Users/dominik/GitHub/tikz-editor/src/ast/types.ts:12`.
2. `UnknownStatement` requires a trailing `;` (`/Users/dominik/GitHub/tikz-editor/src/syntax/grammar/tikz.grammar:213`) and its payload excludes `Group` (`/Users/dominik/GitHub/tikz-editor/src/syntax/grammar/tikz.grammar:233`), so `\def\x{3}` does not parse cleanly.
3. `#` placeholders are not tokenized in groups (`/Users/dominik/GitHub/tikz-editor/src/syntax/grammar/tikz.grammar:346`), which blocks normal `\newcommand` bodies like `#1`.
4. Semantic evaluation expands `\foreach` first (`/Users/dominik/GitHub/tikz-editor/src/semantic/evaluate.ts:35`) and only then evaluates statements.
5. Standalone unknown statements are already interpreted for `\tikzset`, `\pgfkeys`, font size, etc. (`/Users/dominik/GitHub/tikz-editor/src/semantic/evaluate.ts:255`), which is a good hook for macro definitions.
6. Provenance currently only tracks `foreachStack` (`/Users/dominik/GitHub/tikz-editor/src/semantic/types.ts:119`), but the pattern is reusable.
7. MathJax integration has no macro context in API (`/Users/dominik/GitHub/tikz-editor/src/text/types.ts:43`) and wraps text directly (`/Users/dominik/GitHub/tikz-editor/src/text/mathjax-engine.ts:610`).
8. Parse-time node validation runs before semantic context (`/Users/dominik/GitHub/tikz-editor/src/render/index.ts:84`), so custom macros would currently show false TeX errors.
9. Numeric parsing only understands numbers/idents/functions (`/Users/dominik/GitHub/tikz-editor/src/semantic/coords/parse-length.ts:222`), so `(\x,2)` fails without expansion.

I also ran quick probes: `\def\x{3}` currently yields parse errors; `\let` without strong statement boundaries can absorb following code.

**Feasibility by scope**
1. `\def` zero-arg scalar macros like `\def\x{3}` used in coordinates/options: high feasibility.
2. `\let` aliasing (`\let\y\x`): high feasibility.
3. `\newcommand` with fixed args (no optional args first): medium feasibility.
4. `\newcommand` with optional args: medium/high complexity.
5. Reusable TikZ-fragment macros expanding to statements/path fragments: feasible but high complexity and should be a later phase.
6. Arbitrary TeX macro hackery (`\expandafter`, catcodes, delimited params, `\csname`, etc.): not realistic for this project scope.

**Recommended implementation plan**
1. Add explicit macro statements in parser:
   - New grammar branches for `\def`, `\let`, `\newcommand` in `/Users/dominik/GitHub/tikz-editor/src/syntax/grammar/tikz.grammar`.
   - New AST statement types in `/Users/dominik/GitHub/tikz-editor/src/ast/types.ts`.
   - Map them in `/Users/dominik/GitHub/tikz-editor/src/domains/statements/parse.ts`.
2. Add a macro registry to semantic context:
   - Extend frame state in `/Users/dominik/GitHub/tikz-editor/src/semantic/context.ts`.
   - Handle macro-definition statements similarly to existing standalone command handling in `/Users/dominik/GitHub/tikz-editor/src/semantic/evaluate.ts`.
3. Apply macro expansion where values are consumed:
   - Coordinate/length parsing (`/Users/dominik/GitHub/tikz-editor/src/semantic/coords/evaluate.ts`, `/Users/dominik/GitHub/tikz-editor/src/semantic/coords/parse-length.ts`).
   - Node text rendering path (`/Users/dominik/GitHub/tikz-editor/src/semantic/nodes/layout.ts` + MathJax engine).
4. MathJax macro propagation:
   - Either extend text-engine request API with macro preamble, or prepend macro prelude internally before measure/validate.
   - Adjust parse-time validation strategy in `/Users/dominik/GitHub/tikz-editor/src/render/index.ts` to avoid false `invalid-node-tex` when user macros are present.
5. Provenance:
   - Extend `SceneElementOrigin` with optional `macroStack` next to `foreachStack` in `/Users/dominik/GitHub/tikz-editor/src/semantic/types.ts`.
   - Attribute expanded/influenced elements similarly to current foreach attribution flow in `/Users/dominik/GitHub/tikz-editor/src/semantic/evaluate.ts:821`.
6. Capability governance:
   - Add macro feature IDs and matrix rows in `/Users/dominik/GitHub/tikz-editor/src/capabilities/feature-ids.ts`, `/Users/dominik/GitHub/tikz-editor/src/capabilities/matrix.ts`, `/Users/dominik/GitHub/tikz-editor/src/capabilities/registries.ts`.
   - Add fixtures + guards via `/Users/dominik/GitHub/tikz-editor/test/capability-fixtures.ts` and `/Users/dominik/GitHub/tikz-editor/test/capabilities.spec.ts`.

**Suggested rollout**
1. Phase 1: `\def` + `\let` + MathJax pass-through for zero-arg text macros.
2. Phase 2: `\newcommand` fixed-arg support.
3. Phase 3: optional-arg `\newcommand` and constrained TikZ-fragment macro expansion with provenance.

If you want, I can start implementing Phase 1 directly in this branch.
