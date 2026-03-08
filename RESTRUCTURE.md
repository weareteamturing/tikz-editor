# Plan for Restructuring `tikz-editor` into Shared Core/App + Web + Tauri Desktop

This document proposes a phased plan for restructuring `DominikPeters/tikz-editor` so that the same editor application can power both the web app and a future Tauri v2 desktop app, while also preparing for a multi-file tabbed interface and a sensible testing strategy.

The proposal is based on the repo’s current split between a reusable TikZ engine in the root `src/` and a React/Vite app under `web/`. The current core pipeline is parser → semantic evaluator → SVG emitter → render orchestration, and the web app already imports from that shared code.   

---

## 1. Goals

The restructuring should achieve six things.

1. Preserve and strengthen the reusable TikZ engine.
2. Extract the editor application into a shared layer that both web and desktop can use.
3. Keep platform-specific code small and isolated.
4. Prepare the app for multi-document tabs, open/save flows, and workspace state.
5. Make room for better tests, especially app-level and e2e tests.
6. Introduce real package boundaries rather than relying on TypeScript path aliases as an architectural substitute.

---

## 2. Architectural target

The target architecture should be:

* `packages/core`: reusable TikZ engine
* `packages/app`: shared editor application
* `apps/web`: browser shell
* `apps/desktop`: Tauri shell

The intended dependency direction is:

* `app` depends on `core`
* `web` depends on `app`
* `desktop` depends on `app`

The shells should not duplicate application logic. They should mainly provide platform services such as filesystem access, native menus, persistence, clipboard integration, and window lifecycle hooks.

These boundaries should be expressed as actual packages with normal package imports. Avoid using TypeScript path aliases as the thing that defines ownership across layers. Path aliases can still be convenient inside a package, but package boundaries should carry the architectural meaning.

---

## 3. What belongs in each layer

### 3.1 `packages/core`

This should contain the pure TikZ/document engine:

* parser
* semantic evaluation
* SVG emission
* render orchestration
* capabilities matrix and related tests
* text/math/layout helpers that are part of rendering
* pure document-level types and transformations

This corresponds to the current root `src/` architecture. 

`core` should know how to process one TikZ document. It should not know about tabs, windows, menus, file dialogs, recent files, or app UI.

### 3.2 `packages/app`

This should contain the shared editor application:

* React UI
* panels, toolbar, inspector, status bar
* command runtime
* menu definitions and command ids
* workspace state
* per-document editor session state
* settings model
* compute orchestration and scheduler
* app-level persistence model
* abstraction over platform services

This layer should own the concept of “editor application”, including future multi-document tabs.

### 3.3 `apps/web`

This should be a thin browser shell:

* Vite entrypoint
* browser platform adapter
* browser persistence
* browser open/save/export integration
* browser clipboard and drag/drop peculiarities
* custom menu rendering if needed

### 3.4 `apps/desktop`

This should be a thin Tauri v2 shell:

* Tauri bootstrapping
* native menu hookup
* filesystem dialogs
* recent files
* native window state
* native clipboard integration if needed
* updater / single-instance / desktop lifecycle later

The desktop shell should reuse the same shared app UI and logic as the web app.

---

## 4. Packaging choice

Use a workspace monorepo with **npm workspaces**.

This is the simplest fit because the repository already uses npm, with a root `package.json`, a `web/package.json`, and an npm lockfile.   

A “package” here should mean a folder with its own `package.json`, typically also its own `tsconfig.json`, managed as part of the workspace.

Recommended top-level layout:

```text
package.json
packages/
  core/
  app/
apps/
  web/
  desktop/
```

Do not introduce extra micro-packages yet. In particular, there is no need for a separate `commands/contracts` package at this stage. Menu definitions and command ids can live in `packages/app`.

---

## 5. Recommended future folder layout

```text
package.json
packages/
  core/
    package.json
    tsconfig.json
    src/
    test/
  app/
    package.json
    tsconfig.json
    src/
    test/
apps/
  web/
    package.json
    tsconfig.json
    src/
    e2e/
  desktop/
    package.json
    tsconfig.json
    src/
    e2e/
    src-tauri/
```

---

## 6. Platform boundary

The shared app should not directly call browser APIs or Tauri APIs. Instead it should depend on an injected platform interface.

Conceptually, the platform interface should cover:

* file open/save/save-as/export
* clipboard read/write
* settings/session persistence
* menu command hookup
* window title / dirty-state integration
* optional recent files / reopen-on-startup features

This keeps the shared app independent of whether it runs in the browser or in Tauri.

The platform boundary should also be small enough to support adapter contract tests. A small shared suite should assert the app's expectations for open/save, persistence, clipboard behavior, and menu hookup so that web and desktop adapters can be validated without leaning entirely on platform-specific e2e coverage.

A good rule is:

* app issues intents such as “open document” or “save active document”
* platform adapter decides how that happens on web or desktop

---

## 7. Menu and command ownership

Menu and command items should move out of `core` and into `app`.

The current command ids include things like export, toggle panels, open settings, and show compiled picture, which are clearly editor-application concerns rather than TikZ-engine concerns. 

Recommended split:

* `core`: no menu model
* `app`: command ids, menu definitions, command runtime
* `web` and `desktop`: platform-specific menu wiring

The menu tree can still be shared across web and desktop, but it should be shared as part of the application layer, not the engine layer.

---

## 8. Multi-file tabs and workspace model

The upcoming multi-file/tabbed interface belongs in `packages/app`.

A useful distinction is:

* `core` handles one TikZ document
* `app` manages many open documents, tabs, dirty state, active document, save targets, recent files, and workspace restoration
* `web`/`desktop` decide how documents are opened and saved

The current app is organized around one global editor state with one `source`, one `snapshot`, and one compute pipeline.    That should evolve into:

* a workspace state
* multiple document sessions
* one active document
* per-document compute state and undo/redo state

Recommended state shape:

* `WorkspaceState`

  * `workspaceVersion`
  * persisted workspace data:
    * open docs
    * active tab
    * file references
    * recent items
    * settings
    * optional unsaved recovery buffers
  * ephemeral UI state:
    * hover
    * drag state
    * panel widths
    * transient selections
    * pending compute
    * in-flight dialogs
  * `documents`
  * `tabOrder`
  * `activeDocumentId`
* `DocumentSession`

  * source
  * snapshot
  * dirty state
  * file backing reference
  * undo/redo state
  * selection/tool mode if document-scoped

Compute scheduling should eventually become document-scoped rather than globally app-scoped.

The important design constraint is to separate persisted workspace data from live UI state. Otherwise session restoration becomes messy and web/desktop persistence behavior will drift. The current store can tolerate some mixing while the app is single-document, but the multi-document design should split durable state from ephemeral interaction state deliberately.

Persistence should also be schema-versioned from day one. Once tabs and restoration exist, migrations are inevitable. The stored workspace/settings format should therefore include:

* `workspaceVersion`
* `settingsVersion`
* migration functions
* tolerant parsing of stored data

Workspace and settings should have separate version numbers and separate migration paths. They will evolve at different speeds, and keeping them independent avoids coupling unrelated persistence changes.

That is much easier to establish early than to retrofit later.

---

## 9. Does multi-file make sense for the web version?

Yes.

The web app can still benefit from tabs and multi-document workflows even if filesystem capabilities vary by browser. The right mental model is:

* tabs/workspace are an app feature
* real filesystem backing is a platform capability

So the web version can support:

* untitled in-memory documents
* examples opened as tabs
* persisted local workspace state
* real file handles where supported
* import/export fallback elsewhere

This makes tabs worthwhile on web even without perfect desktop-style file management.

---

## 10. Testing strategy

Tests should be split by architectural layer.

### 10.1 `packages/core`

Keep and expand logic tests here:

* parser tests
* semantic/render tests
* regression fixtures
* capability matrix tests

### 10.2 `packages/app`

Add app-level tests here:

* workspace reducer/store tests
* command-runtime tests
* tab lifecycle tests
* dirty-state/save-state transitions
* per-document undo/redo tests
* settings/workspace restoration tests
* component tests where useful

This layer is especially important once multi-document support is introduced.

### 10.3 `apps/web/e2e`

Add browser e2e tests here:

* launch app
* open example
* create document/tab
* edit source
* switch tabs
* export
* open/save via browser APIs where supported

Use Playwright explicitly for the web e2e layer.

### 10.4 `apps/desktop/e2e`

Later add desktop-specific e2e tests here:

* app launch
* native menu commands
* file open/save dialogs
* dirty close flow
* recent files
* window lifecycle behavior

Web e2e should come first. Desktop e2e can be narrower and focused on truly desktop-specific behavior.

### 10.5 Platform adapter contract tests

Add a small cross-platform contract suite for the web and desktop adapters:

* open/save expectations
* persistence semantics
* clipboard integration
* menu hookup behavior

This should stay intentionally small. The goal is to reduce how much desktop-only e2e coverage is needed later, not to duplicate all integration testing at a lower level.

---

# 11. Phased implementation plan

## Phase 1 — Establish package boundaries

### Goal

Create the structural separation between engine, app, and shells without changing behavior much.

### Tasks

1. Convert the repo into an npm workspace monorepo.
2. Create `packages/core`.
3. Move the current root `src/` into `packages/core/src`.
4. Create `packages/app`.
5. Leave `apps/web` as the existing web app, but prepare it to depend on `packages/app`.
6. Create a placeholder `apps/desktop` package for future Tauri integration.
7. Prefer `git mv` over plain `mv` when relocating tracked files so history remains easier to follow.

### Deliverables

* workspace root config
* `packages/core`
* `packages/app`
* `apps/web`
* `apps/desktop` placeholder
* builds still succeed

### Notes

This phase should be mostly mechanical. Avoid redesigning all app logic at once.

---

## Phase 2 — Extract the shared editor application

### Goal

Move reusable editor-app logic out of the web shell and into `packages/app`.

### Tasks

1. Move the React app, panels, toolbar, store, settings, command runtime, and compute orchestration into `packages/app`.
2. Move menu and command definitions from the current core area into `packages/app`.
3. Define a platform interface for:

   * open/save/export
   * clipboard
   * persistence
   * menu hookup
   * optional window integration
4. Add a small adapter contract test suite for web and desktop platform implementations.
5. Update `apps/web` so it becomes a thin entrypoint that creates a browser platform adapter and mounts the shared app.

### Deliverables

* `packages/app` contains the actual editor application
* `apps/web` mostly becomes bootstrap + browser adapter
* menu/commands live in app, not core

### Notes

At the end of this phase, the browser app should behave essentially the same as before, but the boundaries will be cleaner.

---

## Phase 3 — Introduce a workspace model while keeping single-document UI

### Goal

Refactor the application state to support multiple documents internally, even before the full tab UI is exposed.

### Tasks

1. Introduce `WorkspaceState` and `DocumentSession`.
2. Separate persisted workspace data from ephemeral UI state instead of mixing both concerns in one store model.
3. Add separate schema versioning, migration functions, and tolerant parsing for stored workspace and settings data.
4. Migrate the current single-document state into “active document session” state.
5. Make compute state document-scoped.
6. Make undo/redo document-scoped.
7. Add app-level tests for workspace/document transitions.
8. Keep the visible UI largely single-document for now if that helps reduce risk.

### Deliverables

* workspace-aware state model
* per-document session abstraction
* tests covering workspace logic

### Notes

This is the key enabling step for tabs and file workflows.

---

## Phase 4 — Add multi-file tabs and document lifecycle

### Goal

Expose the new workspace model to users.

### Tasks

1. Add tab strip UI.
2. Add actions for:

   * new document
   * close document
   * switch active document
   * reopen example in new tab
3. Track dirty state per document.
4. Introduce abstract app commands for:

   * open
   * save
   * save as
   * close
   * close all
5. Add tests for tab behavior and dirty-state flows.

### Deliverables

* tabbed editor UI
* multi-document workflows inside app
* commands ready for platform-specific file handling

### Notes

At this point, the web shell can still implement some file operations as import/download fallback if needed.

---

## Phase 5 — Implement browser platform features cleanly

### Goal

Make the web app a proper multi-document browser editor.

### Tasks

1. Implement browser platform adapter for:

   * local workspace persistence
   * file open/save where available
   * import/download fallback elsewhere
   * browser clipboard integration
2. Decide how examples should appear:

   * open in current tab
   * open in new tab
   * duplicate to editable doc
3. Add browser e2e tests for main workflows.

### Deliverables

* robust `apps/web`
* web e2e coverage
* sensible browser-specific document lifecycle

### Notes

This is probably the first moment where the web version starts to feel like a full editor rather than just a demo surface.

---

## Phase 6 — Add Tauri v2 desktop shell

### Goal

Bring up the desktop app with maximal reuse of the shared app.

### Tasks

1. Create the Tauri v2 app in `apps/desktop`.
2. Reuse the same shared `packages/app` UI.
3. Implement desktop platform adapter for:

   * open/save/save-as
   * native menus
   * recent files
   * window title and dirty-state integration
   * clipboard hooks if needed
4. Keep the TikZ compute/render pipeline in TypeScript for now.
5. Add a small desktop e2e suite for desktop-only flows.

### Deliverables

* first working Tauri desktop app
* native file/menu integration
* minimal desktop-specific tests

### Notes

Do not move the compute pipeline into Rust yet. The current async compute boundary already makes later workerization possible. 

---

## Phase 7 — Improve performance and background compute

### Goal

Make the shared app more scalable and responsive.

### Tasks

1. Replace direct compute execution with a worker-backed implementation.
2. Preserve the same compute interface inside `packages/app`.
3. Decide whether inactive tabs should:

   * keep stale snapshots
   * recompute lazily
   * prewarm when idle
4. Add performance-focused tests or instrumentation.

### Deliverables

* worker-backed compute path
* better responsiveness for large documents
* clearer policy for active vs inactive tab rendering

### Notes

This should be done after the core restructuring is stable.

---

## Phase 8 — Desktop polish and optional advanced features

### Goal

Add desktop niceties once the architecture is proven.

### Possible tasks

1. recent files and reopen-on-startup
2. file associations
3. single-instance behavior
4. updater
5. native “unsaved changes” handling
6. export integration improvements
7. optional future Rust-side services if truly needed

### Deliverables

* polished desktop UX
* platform-specific improvements without contaminating shared app logic

---

# 12. Order of work recommendation

Recommended execution order:

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7
8. Phase 8

In other words:

* establish package boundaries first
* then extract the shared app
* then redesign state for multi-document support
* then add tabs/file flows
* then bring up desktop

This avoids building multi-file behavior into the old browser-specific structure and then having to untangle it again.

---

# 13. Summary of key decisions

The plan assumes the following decisions.

1. Use npm workspaces, not a more complicated monorepo tool.
2. Create only two shared packages at first: `core` and `app`.
3. Keep menu/command definitions in `app`, not `core`.
4. Treat multi-document tabs as an app-layer concern.
5. Treat filesystem behavior as a platform concern.
6. Add web e2e before desktop e2e.
7. Keep compute/render in TypeScript initially; do not prematurely move logic into Rust.
8. Use real package boundaries rather than TS path aliases to define architecture.
9. Separate persisted workspace data from ephemeral UI state.
10. Add separate schema versioning and migrations for persisted workspace data and persisted settings data from the start.
11. Add a small platform adapter contract test suite.
12. Use Playwright for web e2e.

---

# 14. Immediate next steps

The most sensible immediate next steps are:

1. create the workspace package structure
2. move the current engine into `packages/core`
3. create `packages/app`
4. move menu/app/store/UI logic into `packages/app`
5. make `apps/web` a thin browser shell
6. then begin the workspace/document-session refactor for tabs

That sequence should give the cleanest path to both multi-document web editing and a Tauri v2 desktop app.
