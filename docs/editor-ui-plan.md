# Editor UI Plan

## Guiding Principles

1. **Source as truth.** The TikZ source string is the single source of truth. All visual state is derived from it.
2. **Pure functions everywhere.** Edit operations, inspector descriptors, and element templates live in `src/` as pure functions — testable with Vitest, no DOM required.
3. **Thin React layer.** Components are pure renderers of derived state. Business logic does not live in components.
4. **Testable without simulation.** The reducer, edit actions, and inspector descriptors are unit-testable as plain TypeScript.

---

## Layer Overview

```
┌──────────────────────────────────────────────────┐
│  React UI  (web/src/ui/)                         │
│  Toolbar, SourcePanel, CanvasPanel, Inspector    │
├──────────────────────────────────────────────────┤
│  Editor Store  (web/src/store/)                  │
│  Pure reducer + Zustand binding                  │
├──────────────────────────────────────────────────┤
│  Compute Service  (web/src/compute.ts)           │
│  Async interface over parse + semantic + SVG     │
│  Synchronous initially; swappable to Web Worker  │
│  Request IDs + cancellation semantics            │
├──────────────────────────────────────────────────┤
│  Edit Core  (src/edit/)  ← new additions         │
│  EditAction, InspectorDescriptor,                │
│  ElementTemplates, StyleChain, moveElement,      │
│  DocumentSymbols (completion)                    │
├──────────────────────────────────────────────────┤
│  Existing Core  (src/)                           │
│  EditorSession, applyEditIntent, rewrite,        │
│  evaluate, emitSvg, parse                        │
└──────────────────────────────────────────────────┘
```

---

## New Core Library Additions (`src/edit/`)

### `src/semantic/style-chain.ts` — style inheritance chain (implemented)

This has been implemented as a traced style system. The semantic evaluator emits full per-layer style trace metadata on each `SceneElement` and uses a single canonical traced resolver path.

The real cascade order for a node is roughly:
1. Global TikZ defaults
2. Named styles referenced by the element (`\tikzset{mystyle/.style={...}}`)
3. `every node/.style`
4. `every <shape> node/.style` (e.g., `every rectangle node/.style`)
5. Enclosing scope options
6. Inline command options

`StyleChainEntry` uses a **discriminated union** to capture this granularity:

```typescript
type StyleSourceRef = {
  sourceId: string;
  sourceSpan?: Span;
  sourceKind: string;
  label?: string;
};

type StyleChainEntry =
  | {
      kind: "global" | "every-node" | "scope" | "command";
      sourceRef?: StyleSourceRef;
      rawOptions: OptionListAst[];
      before: ResolvedStyle;
      after: ResolvedStyle;
      resolvedContributions: Partial<ResolvedStyle>;
    }
  | {
      kind: "named-style";
      styleName: string;
      sourceRef?: StyleSourceRef;
      rawOptions: OptionListAst[];
      before: ResolvedStyle;
      after: ResolvedStyle;
      resolvedContributions: Partial<ResolvedStyle>;
    }
  | {
      kind: "every-shape";
      shape: string;
      sourceRef?: StyleSourceRef;
      rawOptions: OptionListAst[];
      before: ResolvedStyle;
      after: ResolvedStyle;
      resolvedContributions: Partial<ResolvedStyle>;
    };

type ResolvedStyleTrace = {
  style: ResolvedStyle;
  transform: Matrix2D;
  chain: StyleChainEntry[];
  diagnostics: string[];
  expandedOptionLists: OptionListAst[];
};

// Scene elements now require:
// styleChain: StyleChainEntry[]
```

Implementation details 
- `resolveContextDelta` now uses traced layer input as the single engine of truth.
- Custom styles (`.style`, `.append style`, `.prefix style`) are stored with provenance and emitted as independently traceable `named-style` layers.
- Frame `every-*` style buckets now carry provenance (`options + sourceRef`) instead of bare option lists.
- Root semantic context seeds an explicit global style layer.
- `EditHandle.sourceId` is now implemented and populated.

Dedicated style-chain coverage was added in `semantic.spec.ts` (ordering, before/after snapshots, contributions, source provenance, edge/pin-edge, matrix cells, and foreach handle/source coherence).

### `src/edit/actions.ts` — unified edit action type (Phase 0 baseline implemented)

Extends the existing `EditIntent` concept to cover all editor operations. Actions operate at two levels:

- **Element-level** (`moveElement`, `deleteElement`, `addElement`, `setProperty`, `resizeElement`): operate on a scene element by `sourceId`.
- **Handle-level** (`moveHandle`): operates on a single `EditHandle` by `handleId`, preserving the existing fine-grained control needed for path point editing, rectangle corner adjustment, etc.

Both levels coexist. The UI decides which to use based on what the pointer hits: clicking an element's body triggers element-level actions; clicking a visible handle indicator triggers handle-level actions.

```typescript
type EditAction =
  | { kind: "moveElement"; elementId: string; delta: Point }
  | { kind: "moveHandle"; handleId: string; newWorld: Point }
  | { kind: "setProperty"; elementId: string; level: StyleLevel; key: string; value: string }
  | { kind: "addElement"; template: ElementTemplate; at: Point }
  | { kind: "deleteElement"; elementId: string }
  | { kind: "resizeElement"; elementId: string; role: ResizeRole; newWorld: Point };

// Pure function, fully testable
function applyEditAction(
  source: string,
  editHandles: EditHandle[],
  action: EditAction
): EditActionResult;
// EditActionResult: { kind: "success"; newSource: string; patches: SourcePatch[] }
//                 | { kind: "partial"; newSource: string; patches: SourcePatch[]; skippedHandles: string[]; reason: string }
//                 | { kind: "unsupported"; reason: string }
//                 | { kind: "error"; message: string }
```

`moveElement` finds all handles belonging to `elementId`, applies the same world-space delta to each, and returns a single set of patches. This handles paths with multiple endpoints correctly. `moveHandle` wraps the existing `applyEditIntent` logic for single-handle movement.

Prerequisite change status: done. `EditHandle` now has `sourceId: string` and `createEditHandle` stores it.

Phase 0 implementation scope:
- `moveElement` and `moveHandle` are implemented and covered by tests.
- `setProperty`, `addElement`, `deleteElement`, and `resizeElement` currently return `unsupported` until later phases.

Note: `moveElement` only moves handles with `rewriteMode !== "unsupported"` — i.e., cartesian, polar, and relative-delta forms. Handles for xyz, named, calc, and other unsupported forms are left in place, and the result is marked as partial (the element may shift inconsistently). The UI should warn the user in this case.

### `src/edit/inspector.ts` — inspector descriptor

A pure function that maps a scene element (plus its style chain) to a structured description of editable properties. The UI renders this descriptor — no business logic in the inspector component.

```typescript
type InspectorDescriptor = {
  elementKind: "path" | "node" | "scope" | ...;
  sections: InspectorSection[];
};

type InspectorSection = {
  title: string;             // "Stroke", "Fill", "Arrow Tips", "Font", ...
  sourceLevel: StyleLevel;   // where this style originates
  properties: InspectorProperty[];
};

type InspectorProperty =
  | { kind: "color"; key: string; value: Color | null; inheritedFrom?: StyleLevel }
  | { kind: "lineWidth"; key: string; value: number }
  | { kind: "arrowTip"; direction: "start" | "end"; value: ArrowMarkerSpec | null }
  | { kind: "enum"; key: string; value: string; options: string[] }
  | { kind: "text"; key: string; value: string };

function getInspectorDescriptor(
  element: SceneElement,
  snapshot: SessionSnapshot
): InspectorDescriptor;
```

### `src/completion/index.ts` — symbol index for code completion

A pure function that extracts all named symbols from the current session, used by CodeMirror autocomplete (Phase 6) and potentially by the inspector (to suggest node names for edges, re-use colors, etc.).

```typescript
type DocumentSymbols = {
  nodeNames: string[];        // from \node (name) at ...
  styleNames: string[];       // from \tikzset{mystyle/.style={...}}
  coordinateNames: string[];  // from \coordinate (name) at ...
};

function collectSymbols(snapshot: SessionSnapshot): DocumentSymbols;
```

Being in `src/` (not `web/`) keeps this testable and reusable outside the web app.

### `src/edit/element-templates.ts` — add-element templates

```typescript
type ElementTemplate =
  | { kind: "node"; text?: string }
  | { kind: "line"; hasArrow?: boolean }
  | { kind: "rectangle" }
  | { kind: "circle" }
  | { kind: "filledCircle" };

// Generates TikZ source for an element at a position
function generateElementSource(template: ElementTemplate, at: Point): string;

// Inserts a snippet into existing source (at end of tikzpicture body)
function insertElementIntoSource(source: string, snippet: string): string;
```

---

## Compute Service (`web/src/compute.ts`)

The parse → semantic → SVG pipeline is exposed through an async interface. Initially this runs synchronously on the main thread (behind a `Promise`); the interface is designed so a Web Worker can be swapped in later without changing any store or UI code.

```typescript
// The async interface used by the store
type ComputeRequest = {
  id: string;          // UUID; the store uses this to discard stale responses
  source: string;
};

// Plain data record, structured-clone compatible (ready for worker transfer)
type SessionSnapshot = {
  source: string;
  revision: number;
  editHandles: EditHandle[];
  scene: SceneFigure | null;
  svg: EmitSvgResult | null;
  parseResult: ParseTikzResult | null;
  semanticResult: EvaluateTikzResult | null;
};

type ComputeResponse = {
  id: string;          // matches the request
  snapshot: SessionSnapshot;
  diagnostics: Diagnostic[];
};

// Phase 0: synchronous implementation
async function computeSnapshot(request: ComputeRequest): Promise<ComputeResponse>;
```

The store holds `SessionSnapshot`, not the `EditorSession` class — class instances with private fields cannot be transferred across a worker boundary via structured clone. All store and UI code works against `SessionSnapshot`, making the worker swap transparent.

The store tracks a `pendingRequestId`. When a new source arrives, it cancels any in-flight request by checking `response.id !== pendingRequestId` on receipt. This means rapid typing only triggers one full recompute — the last one wins.

### Future: Web Worker migration

When the pipeline becomes a performance bottleneck on the main thread (likely with complex diagrams), `computeSnapshot` is replaced with a worker-based implementation that posts `ComputeRequest` messages and resolves promises on `ComputeResponse`. The store code does not change. Key considerations for the migration:
- `SessionSnapshot` is already structured-clone compatible (no class instances, no functions).
- The request-ID cancellation pattern works identically whether computation is synchronous or in a worker.
- The worker will internally create an `EditorSession` and return only the plain snapshot.

## Editor Store (`web/src/store/`)

### Slices

The store is a single Zustand store with one `EditorState` type, organized into six conceptual slices. There is one pure `editorReducer(state, action) → state` function (tested independently), and Zustand is a thin binding around it.

| Slice | Fields |
|-------|--------|
| `document` | `source: string`, `snapshot: SessionSnapshot`, `pendingRequestId: string \| null` |
| `history` | `entries: HistoryEntry[]`, `index: number` |
| `selection` | `selectedElementIds: ReadonlySet<string>` |
| `canvas` | `toolMode: ToolMode`, `canvasTransform: CanvasTransform`, `hoveredElementId: string \| null` |
| `layout` | `leftPanelWidth`, `rightPanelWidth`, `showSourcePanel`, `showInspectorPanel` |
| `debug` | `showDevPanel: boolean` |

Notes:
- Codex proposed an `inspector` slice. We drop it: section expanded/collapsed state is local component state in `InspectorPanel` (fine to reset on re-mount), and the inspector write-target is implicit from interaction (see Inspector section).
- Codex proposed `interaction` — renamed to `canvas` since it specifically governs canvas state.
- **Ephemeral drag state** (pointer position during a drag, drag start coordinates) lives as React local state in `CanvasInteractionLayer`, not in the store. It changes at 60 fps and must not trigger global re-renders.

### State

```typescript
type EditorState = {
  // document slice
  source: string;
  snapshot: SessionSnapshot;         // updated asynchronously via worker
  pendingRequestId: string | null;   // used to drop stale compute responses

  // history slice
  history: HistoryEntry[];
  historyIndex: number;

  // selection slice
  selectedElementIds: ReadonlySet<string>;  // SceneElement.sourceId

  // canvas slice
  toolMode: ToolMode;                // "select" | "addNode" | "addLine" | ...
  canvasTransform: CanvasTransform;  // { translateX, translateY, scale }
  hoveredElementId: string | null;

  // layout slice
  leftPanelWidth: number;
  rightPanelWidth: number;
  showSourcePanel: boolean;
  showInspectorPanel: boolean;

  // debug slice
  showDevPanel: boolean;
};
```

### History model

WYSIWYG actions and code edits use **separate undo stacks** (Phase 0). CodeMirror keeps its own built-in history for code edits (correctly handling IME, composition, and text-input grouping). The store maintains a separate undo stack for WYSIWYG actions.

```typescript
type HistoryEntry = {
  kind: "move" | "move-handle" | "set-property" | "add-element" | "delete" | "resize";
  label: string;              // "Moved node", "Changed fill color"
  backward: SourcePatch[];    // patches to apply for undo
  forward: SourcePatch[];     // patches to apply for redo
  sourceBefore: string;       // Phase 0 fallback undo/redo source snapshots
  sourceAfter: string;
};
```

Current behavior note: on direct code edits (`CODE_EDITED`), WYSIWYG history is cleared to avoid stale canvas undo entries restoring outdated source text.

**Ctrl+Z/Y routing:**
- **In the code panel** (CodeMirror has focus): delegated to CodeMirror's built-in undo/redo.
- **On the canvas or toolbar**: handled by the store's WYSIWYG undo stack.

**WYSIWYG → CodeMirror synchronization:**
- When a WYSIWYG action updates the source, the change is dispatched to CodeMirror with `Transaction.addToHistory.of(false)`. This applies the change without creating a CM undo entry. CM's existing history entries are automatically remapped through the change (CM handles this natively).
- The update is wrapped with `isolateHistory` annotations (`"before"` then `"after"`) so post-canvas typing starts a fresh undo group.

**Limitation (Phase 0):** Undo does not interleave across the two stacks. The user undoes canvas actions on the canvas and code edits in the editor. This matches how tools like Figma handle context-specific undo.

**Future: unified undo stack.** A single undo stack using CM's `ChangeSet` objects for all entries (both WYSIWYG and code edits) would allow a single Ctrl+Z sequence to walk through everything in order. This requires disabling CM's history and replicating its IME/composition grouping, which is non-trivial. Deferred to a later phase.

### Actions

```typescript
type EditorAction =
  | { type: "CODE_EDITED"; source: string }
  | { type: "APPLY_EDIT_ACTION"; action: EditAction }
  | { type: "COMPUTE_REQUESTED"; requestId: string }
  | { type: "SNAPSHOT_READY"; requestId: string; snapshot: SessionSnapshot }
  | { type: "SELECT"; id: string; additive: boolean }
  | { type: "SELECT_RANGE"; ids: string[] }
  | { type: "CLEAR_SELECTION" }
  | { type: "SET_TOOL_MODE"; mode: ToolMode }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SET_CANVAS_TRANSFORM"; transform: CanvasTransform }
  | { type: "SET_HOVERED_ELEMENT"; id: string | null }
  | { type: "SET_PANEL_WIDTH"; panel: "left" | "right"; width: number }
  | { type: "TOGGLE_PANEL"; panel: "source" | "inspector" }
  | { type: "TOGGLE_DEV_PANEL" };
```

The reducer is a pure function `editorReducer(state, action) → state`, tested independently. Zustand holds an instance of this state and exposes a single `dispatch` method — it is purely a React binding with no logic of its own.

---

## Canvas Architecture

### Fixed coordinate system

The canvas renders in a fixed world coordinate system in **pt** (matching the semantic evaluator's internal unit). The user can pan and zoom; the TikZ picture is embedded at a stable position unless `FIT_TO_CONTENT` is explicitly invoked. This allows:
- Stable layout that does not jump when content changes
- Rulers on top/left edges (tick labels displayed in cm, since that is what users write in TikZ source, but the underlying values are pt)
- Optional grid overlay
- Snapping to grid, to other elements, and to ruler guides (future)

The SVG output from `emitSvg()` uses its own `viewBox` (also in pt, y-down), mapped into the fixed canvas coordinate system via `canvasTransform`. The interaction layer uses the same transform. Note: the semantic world is y-up; the SVG/canvas coordinate system is y-down (inversion happens in `emitSvg`).

### Two-layer canvas

```
CanvasPanel
├── CanvasSVGLayer         — renders SVG output via dangerouslySetInnerHTML, no event handlers
└── CanvasInteractionLayer — transparent SVG overlay, owns all pointer events
    ├── HitRegions         — invisible shapes per SceneElement, driven by semantic data
    ├── HandleIndicators   — visible circles/squares for draggable EditHandles
    ├── SelectionOverlay   — dashed bounding boxes for selected elements
    ├── ResizeHandles      — 8-handle overlay for resizable elements (Phase 4)
    └── ToolPreview        — ghost preview while placing/drawing a new element (Phase 3)
```

The `CanvasSVGLayer` renders the SVG string via `dangerouslySetInnerHTML`. This is safe because the SVG is generated by our own emitter pipeline (which HTML-escapes all user-controlled values). The layer is display-only and stateless.

**Hit regions are driven by semantic data** (from `SessionSnapshot`), not by DOM queries on the rendered SVG. This decouples the interaction layer from the rendering layer, making the display approach swappable. Hit region shapes vary by element type:

| Element type | Hit region shape |
|---|---|
| `ScenePath` (line-like: lines, curves) | Invisible stroke along the path with a generous stroke-width (~8px screen-space), `pointer-events: stroke` |
| `ScenePath` (filled: rectangle, filled circle) | The filled shape itself, `pointer-events: fill` or `all` |
| `SceneCircle` / `SceneEllipse` | The shape, `pointer-events: fill` or `all` |
| `SceneText` (node) | Bounding box rect (text bounds are known from layout) |

The interaction layer shares the same `viewBox` as the SVG layer and uses `getScreenCTM().inverse()` for pointer-to-world coordinate conversion.

### Drag-to-move flow (element body)

1. `pointerdown` on hit region (in `select` mode) → store element id and pointer start position
2. `pointermove` → compute world-space delta → dispatch `APPLY_EDIT_ACTION { kind: "moveElement" }` → pure function moves all handles of that element → new source emitted → re-render
3. `pointerup` → finalize with a `HistoryEntry` labeled "Moved [element kind]"

### Drag-to-move flow (individual handle)

1. `pointerdown` on a handle indicator → store handle id and pointer start position
2. `pointermove` → compute new world position → dispatch `APPLY_EDIT_ACTION { kind: "moveHandle" }` → rewrites that single coordinate → new source emitted → re-render
3. `pointerup` → finalize with a `HistoryEntry` labeled "Edited [element kind]"

Handle indicators are visible on selected elements. For paths, they appear at each editable point. For rectangles, at corners. For nodes, at the position anchor.

### Click-to-place flow (add-element tool modes)

1. `pointermove` → show ghost preview (ToolPreview) at pointer world position
2. `click` → `generateElementSource(template, at)` + `insertElementIntoSource()` → dispatch `SET_SOURCE_CHECKPOINT` → switch back to `select` mode

---

## UI Component Tree

```
App
├── Toolbar
│   ├── ToolModeButtons       select, add node, add line, add rect, add arrow, ...
│   ├── UndoRedoButtons
│   └── ExportButton
│
├── ResizableLayout           three-pane with draggable dividers
│   ├── SourcePanel
│   │   └── CodeMirrorEditor
│   │       ├── TikZ syntax highlighting  (existing)
│   │       ├── Number scrubber           (existing, extend later)
│   │       ├── Diagnostic decorations    (existing)
│   │       └── Autocomplete              (Phase 6)
│   │
│   ├── CanvasPanel
│   │   ├── Rulers                        (top + left, drawn in world coords)
│   │   ├── CanvasSVGLayer
│   │   └── CanvasInteractionLayer
│   │       ├── GridOverlay               (optional, snapping in future)
│   │       ├── HitRegions
│   │       ├── SelectionOverlay
│   │       ├── ResizeHandles             (Phase 4)
│   │       └── ToolPreview               (Phase 3)
│   │
│   └── InspectorPanel
│       ├── NoSelectionHint
│       └── ElementInspector              (driven by InspectorDescriptor from core)
│           ├── TransformSection          position, size — numeric inputs
│           ├── StyleSection[]            one per InspectorSection in descriptor
│           │   ├── ColorProperty         custom xcolor-aware picker
│           │   ├── LineWidthProperty     slider with visual preview of line thickness
│           │   ├── ArrowTipProperty      grid of rendered previews
│           │   └── EnumProperty          dropdown
│           └── CascadeToggle             show/hide inheritance chain (Phase 7)
│
└── StatusBar                 element type, world coordinates, error count
```

---

## Inspector — DevTools-Style Cascade View

### Phase 2: computed values only

The basic inspector (Phase 2) shows only the final computed/effective value for each property. Editing a property always writes to the **inline layer** — i.e., it adds or modifies options directly on the selected `\draw`/`\node` command. This is the right default because it is the most specific level and least likely to affect other elements.

If a property is not editable at the inline level (e.g., it originates inside a `\foreach` expansion or macro), the control is shown read-only with a brief explanation.

### Phase 7: cascade view

The full cascade view shows how each property is resolved, similar to Chrome DevTools:

```
▼ Stroke                                          [command]
    color       ████ blue
    line width  ─── 0.4pt

▼ Fill                                            [scope]
    color       ████ gray!20

▼ Stroke (inherited)                  [\tikzset: thin]
    ~~line width~~  ─── 0.8pt         (overridden above)
```

Each `StyleChainEntry` is a row group. Properties overridden at a more-specific level are shown struck through. There is **no separate "write target" control**: the write target is implicit from where the user clicks. Clicking a property value at the `[command]` row edits the inline options; clicking at the `[\tikzset]` row edits the style definition there. For a property that appears only as a global default (no explicit declaration), clicking to edit creates a new inline option on the command.

This means the UI never needs to ask the user to specify a target — the cascade display makes the choice self-evident, matching the mental model of DevTools.

---

## Capability Matrix Integration

Toolbar tool buttons and inspector controls are keyed by feature IDs from `src/capabilities/feature-ids.ts`. A pure function maps a tool or property to its capability status:

```typescript
function getToolCapabilityStatus(toolMode: ToolMode, matrix: CapabilityMatrix): CapabilityStatus;
// → "supported" | "partial" | "unsupported"
```

When status is `"unsupported"`, the toolbar button is disabled. When `"partial"`, the button is enabled but annotated (e.g., a small warning badge with a tooltip). This means the existing capability matrix directly drives UI affordances — the toolbar cannot offer operations that will always silently fail.

The same applies in the inspector: a property control for a feature marked unsupported is shown read-only with a note. This is implemented in Phase 3 alongside the toolbar.

---

## Styling

- **CSS Modules** for all component styles (scoped, refactorable, portable to Tauri).
- No CSS utility framework (Tailwind).
- No third-party component library initially — build a small set of primitives in-house (`Button`, `Slider`, `NumberInput`, `Dropdown`, `Tooltip`). This keeps the app portable to a native Tauri skin later.
- **Color picker**: fully custom implementation following xcolor philosophy (named colors, `color1!50!color2` mix syntax, `color!30!white` tinting). This is not representable as a standard RGB hex picker.

---

## Implementation Roadmap

### Phase -1: styleChain (pure backend work)
- Status: complete (implemented on February 19, 2026)
- Added `src/semantic/style-chain.ts` with `StyleSourceRef`, `StyleChainEntry`, `ResolvedStyleTrace`, clone/diff helpers
- Hard-cutover resolver path in `src/semantic/style/resolve.ts` now emits style + transform + ordered chain
- Propagated style chains through path/node/matrix/edge/pin-edge outputs
- Added provenance-aware custom-style registry and provenance-aware `every-*` frame layers
- Added `sourceId` to `EditHandle` and aligned foreach-attribution remapping for handles
- Added dedicated style-chain assertions in `test/semantic.spec.ts`

### Phase 0: Foundation
- Status: complete
- Completed: decomposed `web/src/App.tsx` into the component tree above (CSS Modules)
- Completed: added `src/edit/actions.ts` with `applyEditAction` baseline (`moveElement` + `moveHandle`) and tests
- Completed: set up editor store (pure reducer + Zustand binding) with document/history/selection/canvas/layout (+ debug) slices
- Completed: implemented compute service (`web/src/compute.ts`) behind async interface with request-ID stale-response filtering
- Completed: implemented WYSIWYG undo/redo stack in store (code undo remains in CodeMirror)
- Completed: wired WYSIWYG source changes to CodeMirror with `Transaction.addToHistory.of(false)` and `isolateHistory` grouping
- Completed: reducer tests now cover all current action types

### Phase 1: Canvas interaction (from scratch)
- Status: complete
- Implement fixed coordinate system + `canvasTransform` in store
- `CanvasSVGLayer` (dangerouslySetInnerHTML, display-only) / `CanvasInteractionLayer` (SVG overlay, all pointer events)
- Hit regions driven by semantic data (element-type-specific shapes: fat strokes for lines, fill regions for shapes, bounding box rects for text nodes)
- Handle indicators on selected elements (visible draggable points)
- Click-to-select (source-level entity via hit region)
- Selection bounding box overlay
- Drag-to-move element body via `moveElement` action (handles all rewritable coordinate forms: cartesian, polar, relative delta; xyz/named/calc handles are skipped with a UI warning)
- Drag individual handles via `moveHandle` action (for path point editing, rectangle corners, etc.)
- Keyboard: Delete, Escape, Ctrl+Z/Y (routed by focus context), arrow-key nudge
- `FIT_TO_CONTENT` on initial load
- Rulers + optional grid overlay

### Phase 2: Inspector (basic)
- Status: complete
- `getInspectorDescriptor()` in `src/edit/inspector.ts` + tests
- `InspectorPanel` with property editors:
  - Color picker (start basic with only named colors, no mixing or tinting)
  - Line width with visual thickness preview and label (`thin` etc)
  - Arrow tip selector with rendered previews
  - Numeric position/size inputs in TransformSection
- Inspector edits write back to source via `setProperty` action

### Phase 3: Toolbar & add element
- Status: complete
- Tool mode buttons in Toolbar
- Capability matrix integration: disabled/annotated buttons via `getToolCapabilityStatus()`
- `src/edit/element-templates.ts` + `insertElementIntoSource` + tests
- Click-to-place: node 
- Drag-to-create: rectangle, circle, line with/without arrow
- Ghost preview (ToolPreview) while placing. Use crosshair cursor
- Deferred: Code-snippet path for complex elements (matrix etc.) — opens code panel with template inserted at cursor

### Phase 4: Resize handles
- Status: deferred
- Resize overlay on selected elements (only for element types where resize is meaningful)
- Applicable to: **nodes with shapes** (adjust `minimum width`/`minimum height`), **rectangle paths** (adjust corner coordinates), **circle/ellipse paths** (adjust radius)
- Not applicable to line-like paths (those use handle dragging from Phase 1)
- `resizeElement` edit action (adjusts the relevant source properties per element type)
- Constrained resize (Shift = preserve aspect ratio)

### Phase 5: Multi-select
- Status: complete
- Shift-click to add/remove from selection
- Marquee (rubber-band) selection on canvas
- Move multiple selected elements simultaneously
- Inspector: show shared properties; blank inputs for differing values
- Implement `deleteElement` action and wire to Delete key for single- and multi-element deletion

### Phase 6: Code editor enhancements
- `src/completion/index.ts`: `collectSymbols()` pure function + tests
- CodeMirror autocomplete: option keys, color names, node/coordinate/style names from `collectSymbols()`, coordinate forms
- Support `tab` key press while in editor for adding 2 spaces (soft indent) instead of jumping focus
- Canvas ↔ source cross-highlighting: select element on canvas → selects its source span in source editor (without moving focus to the editor); cursor in source → select corresponding element (without focus shift). Similarly, hover on canvas → highlight (but not select) source span, and hover in source → highlight corresponding element on canvas.
- Double clicking a \node on canvas selects its text content and moves focus to the code editor for quick text editing

### Phase 7: Inspector cascade view
- Consume `styleChain` payload from evaluator (already populated from Phase -1, including `sourceRef`, `before/after`, and `resolvedContributions`)
- Cascade section groups with inherited properties struck through
- Edit-at-level: clicking a property at a specific level opens an edit control for that level
- Source navigation: click cascade row → jump to that option in the code panel

### Phase 8+: Advanced
- In-canvas text editing (double-click a node to edit label)
- `\tikzset` style definitions panel
- Snapping: to grid, to other elements' bounding boxes, to guide lines
- Guide lines (drag from ruler to place)
- Tauri target: native window chrome, adapted CSS skin
- Export: copy TikZ source, render to SVG/PDF/PNG preview
