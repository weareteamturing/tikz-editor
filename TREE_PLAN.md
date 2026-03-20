# Tree Editing Implementation Plan

## Goal

Add WYSIWYG editing support for TikZ trees (`child` operation), using the scope-based interaction model established by matrices.

Target capabilities, in priority order:
- Edit child node text/properties via inspector (after drilling in)
- Tree layout options (level/sibling distance, grow direction) in inspector when root is selected
- Add/remove children via context menu
- Move entire tree by dragging root node

## Current State

### What already works
- **Parser**: `ChildOperationItem` fully parsed with `id`, `options`, `body`, `bodySpan`, `foreachClauses` (ast/types.ts L366-378).
- **Semantic**: Complete tree layout evaluation in `evaluate-tree.ts`. Child clustering, positioning (level/sibling distance, grow direction), auto-naming, edge-from-parent all work. Child nodes already get synthetic sourceIds: `${statement.id}:tree-child:${index}:${child.id}`.
- **SVG**: Trees render correctly with all layout options.
- **Edit**: `edit: "none"` for all 9 tree feature IDs.

### Important current behavior
- A tree is a single `PathStatement` — the root node followed by `child { ... }` operations.
- Child nodes are evaluated as synthetic `PathStatement`s with composite sourceIds (evaluate-tree.ts L309-316).
- Child scene elements share the parent statement's `sourceRef` structure but get their own sourceId.
- `splitChildBodyAndTrailingEdgeFromParent()` (tree-child.ts L25-77) separates child body from edge-from-parent.
- Tree children currently fall into the "non-matrix, non-scope" category in move actions — no virtual scope grouping.
- Edge-from-parent elements connect parent to child; they are separate scene elements.

## High-Level Design

Mirror the matrix approach: **virtual scopes for interaction** + **first-class tree-child edit targets for writes**.

Key differences from matrices:
- Trees are **recursive** — a child can itself have children, creating nested virtual scopes.
- Children are separate `ChildOperationItem`s with their own AST ids (not parsed from text like matrix cells).
- Per-child options already exist syntactically: `child[options] { node[options] {text} }`.
- Tree layout is governed by inherited style keys, not grid structure.

## Phase 1: Scene Metadata for Tree Children

### 1a. Add TreeChildInfo type

File: `packages/core/src/semantic/types.ts`

```ts
export type TreeChildInfo = {
  treeRootSourceId: string;      // sourceId of the root path statement
  parentSourceId: string;        // sourceId of the immediate parent (root or another child)
  childOperationId: string;      // AST id of the ChildOperationItem
  childSourceId: string;         // synthetic sourceId of this child's statement
  childIndex: number;            // 0-based index among siblings
  level: number;                 // tree depth (0 = root's direct children)
  bodySpan: Span;                // span of child body { ... }
  childOperationSpan: Span;      // span of entire `child [...] { ... }`
  optionsSpan?: Span;            // span of child-level [options] if present
};
```

Add `treeChild?: TreeChildInfo` to `ScenePath`, `SceneCircle`, `SceneEllipse`, `SceneText`.

### 1b. Stamp child scene elements during evaluation

File: `packages/core/src/semantic/path/evaluate-tree.ts`

After evaluating the child's synthetic PathStatement (L317-321), stamp all returned scene elements with `treeChild` metadata. Also stamp edge-from-parent elements with the same metadata so they can be associated with their child.

### 1c. Expose tree-level metadata

Add a `TreeInfo` structure to the semantic result (or as metadata on the root node's scene elements):
- `treeRootSourceId`
- `childCount` (direct children of root)
- `totalDescendants`
- Layout keys: `levelDistance`, `siblingDistance`, `growDirection`

This supports the inspector showing tree-level properties.

## Phase 2: Virtual Scope Overlay for Trees

File: `packages/app/src/ui/canvas-panel/scope-overlay.ts`

### 2a. Add `augmentScopeOverlayWithTrees()`

Following the `augmentScopeOverlayWithMatrices()` pattern (scope-overlay.ts L84-159):

1. Scan scene elements for `treeChild` metadata.
2. For each unique `treeRootSourceId`, create a virtual scope node.
3. For recursive trees: children that themselves have children become nested virtual scopes.
4. Register ancestor relationships for all tree children.

### 2b. Handle recursive nesting

Unlike matrices (flat grid), trees can nest arbitrarily. The scope overlay must support:
- Root scope contains direct children.
- A child with its own children becomes a nested scope.
- Drill path: root → child → grandchild → ...

### 2c. Bounds computation

Compute tree scope bounds as the union of all descendant element bounds, plus the root node bounds. Include edge-from-parent elements in the bounds.

## Phase 3: Selection, Drill-In, and Dragging

Files:
- `packages/app/src/ui/canvas-panel/hit-regions.ts`
- `packages/app/src/ui/canvas-panel/useCanvasElementInteractions.ts`
- `packages/app/src/ui/canvas-panel/useCanvasSelectionDerivedState.ts`

### 3a. Selection behavior

Once children have their own sourceIds and the virtual scope exists:
1. Clicking any tree element selects the root tree scope.
2. Clicking again drills to the specific child.
3. For nested trees, further clicks drill deeper.

### 3b. Dragging

- **Root selected**: Drag moves the entire tree (rewrite root's `at` coordinate).
- **Child selected (drilled)**: Children should NOT be independently draggable — their position is layout-computed.

Add tree root sourceIds to `movableScopeSourceIds`. Explicitly exclude tree child sourceIds from draggable sets.

### 3c. Edit handles

Verify that `createEditHandle` does not generate position handles for tree child nodes. If it does (because children go through `evaluatePathStatement`), suppress handles for elements with `treeChild` metadata.

## Phase 4: Tree-Child Property Target Resolution

Files:
- `packages/core/src/edit/property-target.ts`
- `packages/core/src/edit/inspector.ts`

### 4a. Add "tree-child" property target kind

```ts
type PropertyTargetKind = ... | "tree-child";
```

Resolution from a tree-child sourceId should provide:
- The `ChildOperationItem` AST node (for child-level options)
- The `NodeItem` inside the child body (for node-level options)
- Source spans for both

### 4b. Dual-level option editing

Tree children have two option sites:
- **Child-level**: `child[level distance=2cm, ...] { ... }` — layout overrides
- **Node-level**: `child { node[fill=red, ...] {text} }` — visual properties

The property target must resolve which level to write to based on the property key:
- Layout keys (level distance, sibling distance) → child-level options
- Visual keys (fill, draw, shape, text color) → node-level options

### 4c. Inspector descriptor for drilled child

When a tree child is drilled-to, the inspector should show:
- **Node properties**: fill, draw, shape, text color (from the child's node)
- **Child-specific layout overrides**: level distance, sibling distance (from child options)

## Phase 5: Tree-Level Inspector

File: `packages/core/src/edit/inspector.ts`

When the root tree scope is selected (not drilled), show:
- **Layout section**: level distance, sibling distance, grow direction
- **Root node properties**: fill, draw, shape of the root node
- **Transform**: position of the root node (for moving)

Layout properties should write to the root path statement's options (or the root node's options, depending on where they're currently specified).

## Phase 6: Child Node Text Editing

Files:
- `packages/app/src/ui/CanvasPanel.tsx`
- `packages/core/src/edit/actions.ts`

### 6a. Double-click to edit child node text

When a drilled-to tree child is double-clicked, enter text editing mode for that child's node. Resolve the text span from the `NodeItem` inside the child body.

### 6b. Extend updateNodeText for tree children

The `applyUpdateNodeText` action should recognize tree-child sourceIds and resolve to the correct `NodeItem.textSpan` inside the child body.

## Phase 7: Add/Remove Children via Context Menu

Files:
- `packages/app/src/context-menu/canvas-context-menu.ts`
- `packages/core/src/edit/actions.ts`

### 7a. New edit actions

```ts
| { kind: "addTreeChild"; parentSourceId: string; afterChildIndex?: number }
| { kind: "removeTreeChild"; childSourceId: string }
| { kind: "addTreeSibling"; siblingSourceId: string; position: "before" | "after" }
```

### 7b. Context menu entries

When a tree child is selected (drilled):
- "Add child" — inserts `child { node {} }` inside this child's body
- "Add sibling before" / "Add sibling after" — inserts adjacent child operation
- "Delete" — removes the entire `child { ... }` block

When the root tree is selected (not drilled):
- "Add child" — appends `child { node {} }` to the root

### 7c. Implementation details

**Adding a child**: Insert ` child { node {New} }` at the appropriate position:
- As sibling: after the closing `}` of the reference child operation
- As sub-child: before the closing `}` of the parent child's body
- Respect existing indentation/formatting

**Removing a child**: Delete the entire `child [...] { ... }` span from source. Handle whitespace cleanup.

### 7d. Edge cases to handle
- Removing the last child of a node (tree becomes a plain node)
- Adding a child to a node that has no children yet (first `child` after the root node)
- `child foreach` — should be excluded from add/remove for now
- `missing` children — should be deletable but flagged in context menu

## Phase 8: Capability and Test Coverage

Files:
- `packages/core/src/capabilities/matrix.ts`
- `test/edit-actions.spec.ts`
- `test/edit-inspector.spec.ts`

Update `child_operation.edit` to `"partial"` once:
- Tree selection/drill works
- Child text editing works
- Basic child inspector works
- Add/remove child works

Also update related features (`tree_layout_keys.edit`, etc.) as appropriate.

## Suggested Implementation Order

1. Scene metadata (`TreeChildInfo`) and stamping
2. Virtual scope overlay for trees
3. Selection/drill integration
4. Tree-child property target resolution
5. Inspector for drilled child nodes
6. Tree-level inspector (layout options)
7. Child text editing
8. Add/remove children (context menu)
9. Capability bump and test coverage

## Key Risks and Mitigations

### Recursive scope nesting complexity
**Risk**: Deeply nested trees create many scope levels, making drill-in tedious.
**Mitigation**: Consider a "flatten" mode or keyboard shortcut to jump directly to a clicked node regardless of depth. Start with strict recursive drill; improve UX later.

### Edit handle suppression for children
**Risk**: Tree children get synthetic PathStatements that produce position handles, making them appear draggable.
**Mitigation**: Explicitly suppress edit handles for elements with `treeChild` metadata.

### Dual-level option editing confusion
**Risk**: Users confused about whether a property edit goes to child options vs node options.
**Mitigation**: Inspector sections clearly labeled "Child Layout" vs "Node Style". Write to the correct level automatically based on property key.

### Edge-from-parent interaction
**Risk**: Edge elements between parent and child need to be associated with the correct scope level for selection.
**Mitigation**: Stamp edge elements with `treeChild` of the child they connect to. When clicking an edge, select the parent scope (not drill to the edge itself).

### foreach children
**Risk**: `child foreach \x in {a,b,c} { node {\x} }` generates multiple children from one AST item.
**Mitigation**: Defer foreach editing support. Mark foreach children as read-only in the inspector. Exclude them from add/remove context menu.

## Key Files to Change

- `packages/core/src/semantic/types.ts` — TreeChildInfo type
- `packages/core/src/semantic/path/evaluate-tree.ts` — stamp metadata
- `packages/app/src/ui/canvas-panel/scope-overlay.ts` — virtual scopes for trees
- `packages/app/src/ui/canvas-panel/useCanvasSelectionDerivedState.ts` — tree scope integration
- `packages/core/src/edit/property-target.ts` — tree-child target kind
- `packages/core/src/edit/inspector.ts` — tree inspector descriptors
- `packages/core/src/edit/actions.ts` — add/remove child actions, text editing
- `packages/app/src/context-menu/canvas-context-menu.ts` — context menu entries
- `packages/core/src/capabilities/matrix.ts` — capability updates
