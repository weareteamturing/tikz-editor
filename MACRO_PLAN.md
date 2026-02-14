Support is feasible and now implemented in two slices, with optional/default-arg TeX behavior intentionally deferred.

## Implementation Status (2026-02-14)

### Phase 1 (`\def` + `\let`) completed
1. ✅ Added dedicated semicolon-less parser statements for `\def` and `\let`.
2. ✅ Added scoped semantic macro bindings (`SemanticContextFrame.macroBindings`).
3. ✅ Expanded macros in coordinate evaluation.
4. ✅ Expanded macros in node text (including matrix cells) before layout/MathJax rendering.
5. ✅ Added parser/semantic/render coverage for the above.

### Phase 2 (`\newcommand` fixed-arity + provenance) completed
1. ✅ Added parser/AST support for:
   - `\newcommand{\foo}[n]{...}`
   - `\newcommand\foo[n]{...}`
   - `\renewcommand...`
2. ✅ Added `#` token support in grouped content so `#1` placeholders parse cleanly.
3. ✅ Upgraded macro bindings from plain strings to typed bindings:
   - zero-arg text bindings (`text`)
   - fixed-arity callable bindings (`callable`)
4. ✅ Implemented fixed-arity argument expansion (`#1..#9`) in macro engine.
5. ✅ Implemented callable aliasing via `\let` (aliases preserve callable behavior).
6. ✅ Added macro provenance metadata:
   - `SceneElementOrigin.macroStack` now records macro definition frames used during expansion.
7. ✅ Added stability guard:
   - default macro recursion/expansion depth limit is now **100** (`DEFAULT_MACRO_EXPANSION_MAX_DEPTH`).

## Test Coverage Added
1. Parser:
   - `\newcommand` grouped and ungrouped forms
   - `\renewcommand` mapping
2. Semantic:
   - fixed-arity coordinate expansion
   - callable alias via `\let`
   - scoped `\renewcommand` override behavior
   - macro provenance attribution on emitted elements
   - recursion limit integration behavior in semantic node text
3. Render (async MathJax path):
   - fixed-arity `\newcommand` expansion inside math node text
4. Macro engine unit tests:
   - braced and single-token argument forms
   - boundary preservation
   - provenance trace capture
   - recursion depth cap = 100

## Remaining Work
1. Optional/default-argument macro forms (`\newcommand` with `[default]`) are not implemented yet.
2. TeX fragment macros that expand to statement/path snippets are still deferred.
3. Parse-time MathJax validation still uses the current coarse skip when user macros are present; explicit macro-aware validator preamble wiring remains a follow-up.
4. Macro expansion is currently focused on coordinates/node text; broader option-expression expansion can be incrementally extended.
