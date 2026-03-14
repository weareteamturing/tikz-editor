import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useSettingsStore } from "../settings/useSettingsStore";
import { autocompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import {
  Compartment,
  EditorSelection,
  EditorState as CMState,
  Prec,
  Transaction,
  StateEffect,
  StateField
} from "@codemirror/state";
import {
  deleteLine,
  isolateHistory,
  indentLess,
  indentMore
} from "@codemirror/commands";
import {
  EditorView,
  Decoration,
  type DecorationSet,
  hoverTooltip,
  keymap
} from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import type { PathItem, Span, Statement } from "tikz-editor/ast/types";
import { collectSymbols, type DocumentSymbols } from "tikz-editor/completion/index";
import type { SceneElement } from "tikz-editor/semantic/types";
import { NAMED_COLORS, NON_STYLE_OPTION_FLAGS, NON_STYLE_OPTION_KEYS } from "tikz-editor/semantic/style/constants";
import { patchesMatchSourceTransition } from "tikz-editor/edit/source-patches";
import { tikzLanguage } from "../codemirror-tikz";
import { colorSwatches } from "../color-swatches";
import { numberScrubber } from "../number-scrubber";
import { useProjectNamedColorSwatches } from "../project-named-colors";
import { useEditorStore } from "../store/store";
import { ColorPicker } from "./ColorPicker";
import {
  notifySourceSelectionChanged,
  SOURCE_FORMAT_REQUEST_EVENT,
  SOURCE_SELECTION_REQUEST_EVENT,
  type SourceSelectionRequestDetail
} from "./source-sync";
import css from "./SourcePanel.module.css";
import { formatTikzSource } from "tikz-editor/edit/source-format";

// ── Dynamic configuration compartments ──────────────────────────────────────

const wordWrapCompartment = new Compartment();
const fontSizeCompartment = new Compartment();
const tabSizeCompartment = new Compartment();
const editableCompartment = new Compartment();
const highlightCompartment = new Compartment();

// ── Theme-aware highlight styles ─────────────────────────────────────────────

const darkHighlightStyle = HighlightStyle.define([
  { tag: t.keyword,        color: "#569cd6", fontWeight: "bold" },
  { tag: t.typeName,       color: "#4ec9b0" },
  { tag: t.lineComment,    color: "#6a9955", fontStyle: "italic" },
  { tag: t.blockComment,   color: "#6a9955", fontStyle: "italic" },
  { tag: t.string,         color: "#ce9178" },
  { tag: t.number,         color: "#b5cea8" },
  { tag: t.variableName,   color: "#9cdcfe" },
  { tag: t.attributeName,  color: "#9cdcfe" },
  { tag: t.propertyName,   color: "#9cdcfe" },
  { tag: t.operator,       color: "#d4d4d4" },
  { tag: t.punctuation,    color: "#d4d4d4" },
  { tag: t.bracket,        color: "#ffd700" },
  { tag: t.name,           color: "#d4d4d4" },
]);

function buildHighlightExtension(dark: boolean) {
  return dark ? [Prec.highest(syntaxHighlighting(darkHighlightStyle))] : [];
}

// ── CodeMirror state effects ────────────────────────────────────────────────

const setHighlight = StateEffect.define<[number, number] | null>();
const setDiagnostics = StateEffect.define<DiagnosticInput[]>();
const setFigureOverlay = StateEffect.define<DecorationSet>();

type DiagnosticSeverity = "error" | "warning";

type DiagnosticInput = {
  from: number;
  to: number;
  severity: DiagnosticSeverity;
  message: string;
  code?: string;
  source: "parse" | "semantic";
};

type Diagnostic = DiagnosticInput;

type SourceSpan = {
  from: number;
  to: number;
};

type SourceSpanEntry = {
  sourceId: string;
  from: number;
  to: number;
  width: number;
};

type SourceSpanIndex = {
  bySourceId: ReadonlyMap<string, SourceSpan>;
  sortedByWidth: SourceSpanEntry[];
};

type ActiveColorPickerSession = {
  from: number;
  to: number;
  currentToken: string;
  anchorRect: DOMRectReadOnly;
  editable: boolean;
};

const EMPTY_SPAN_INDEX: SourceSpanIndex = {
  bySourceId: new Map(),
  sortedByWidth: []
};

const EMPTY_SYMBOLS: DocumentSymbols = {
  nodeNames: [],
  styleNames: [],
  coordinateNames: []
};

const MAX_DIAGNOSTICS = 300;
const MAX_DECORATED_SPAN = 160;
const DIAGNOSTIC_DEBOUNCE_MS = 120;
const MIN_FORMATTER_MAX_LINE_LENGTH = 40;
const MAX_FORMATTER_MAX_LINE_LENGTH = 240;

const COMMON_OPTION_KEYS = [
  "draw",
  "fill",
  "text",
  "line width",
  "opacity",
  "fill opacity",
  "text opacity",
  "rounded corners",
  "dash pattern",
  "dashed",
  "dotted",
  "thick",
  "thin",
  "very thick",
  "very thin",
  "ultra thick",
  "ultra thin",
  "line cap",
  "line join",
  "font",
  "xshift",
  "yshift",
  "shift",
  "rotate",
  "scale",
  "xscale",
  "yscale",
  "minimum width",
  "minimum height",
  "minimum size",
  "inner sep",
  "outer sep",
  "shape",
  "name",
  "alias",
  "at",
  "<-",
  "->",
  "<->"
] as const;

const COORDINATE_FORM_COMPLETIONS: Completion[] = [
  { label: "(0,0)", type: "snippet", detail: "cartesian coordinate" },
  { label: "(30:1cm)", type: "snippet", detail: "polar coordinate" },
  { label: "++(1,0)", type: "snippet", detail: "incremental coordinate" },
  { label: "+(1,0)", type: "snippet", detail: "relative coordinate" },
  { label: "($(A)+(1,0)$)", type: "snippet", detail: "calc coordinate" },
  { label: "(intersection of A--B and C--D)", type: "snippet", detail: "intersection coordinate" }
];

const OPTION_KEY_COMPLETIONS: Completion[] = uniqueStrings([
  ...COMMON_OPTION_KEYS,
  ...NON_STYLE_OPTION_KEYS,
  ...NON_STYLE_OPTION_FLAGS
]).map((key) => ({ label: key, type: "keyword", detail: "TikZ option" }));

const COLOR_COMPLETIONS: Completion[] = uniqueStrings([...NAMED_COLORS]).map((color) => ({
  label: color,
  type: "constant",
  detail: "color"
}));

const BASE_COMPLETIONS: Completion[] = dedupeCompletions([
  ...OPTION_KEY_COMPLETIONS,
  ...COLOR_COMPLETIONS,
  ...COORDINATE_FORM_COMPLETIONS
]);
const SOURCE_PICKER_COLORS = uniqueStrings(["none", ...NAMED_COLORS]);
const ENABLE_TIKZ_AUTOCOMPLETE = false;

// ── State fields ─────────────────────────────────────────────────────────────

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setHighlight)) continue;
      if (!effect.value) return Decoration.none;
      const [from, to] = effect.value;
      return Decoration.set([Decoration.mark({ class: "cm-highlight-range" }).range(from, to)]);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f)
});

const diagnosticsField = StateField.define<{ list: Diagnostic[]; decorations: DecorationSet }>({
  create: () => ({ list: [], decorations: Decoration.none }),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setDiagnostics)) continue;
      const list = normalizeDiagnostics(effect.value, tr.state.doc.length);
      return { list, decorations: buildDecorations(list) };
    }
    if (tr.docChanged) return { list: [], decorations: Decoration.none };
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations)
});

const figureOverlayField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFigureOverlay)) {
        return effect.value;
      }
    }
    if (tr.docChanged) {
      return value.map(tr.changes);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f)
});

const diagnosticTooltip = hoverTooltip((view, pos) => {
  const field = view.state.field(diagnosticsField, false);
  if (!field) return null;
  const d = bestDiagnosticAt(field.list, pos);
  if (!d) return null;
  return {
    pos: d.from,
    end: d.to,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = `cm-editor-diagnostic-tooltip cm-editor-diagnostic-tooltip-${d.severity}`;

      const header = document.createElement("div");
      header.className = "cm-editor-diagnostic-tooltip-header";
      const code = document.createElement("code");
      code.textContent = d.code ?? d.severity;
      const src = document.createElement("span");
      src.textContent = d.source.toUpperCase();
      header.append(code, src);

      const msg = document.createElement("div");
      msg.className = "cm-editor-diagnostic-tooltip-message";
      msg.textContent = d.message;

      dom.append(header, msg);
      return { dom };
    }
  };
});

const editorKeymap = Prec.highest(
  keymap.of([
    { key: "Mod-d", run: deleteLine, preventDefault: true },
    { key: "Mod-[", run: indentLess, preventDefault: true },
    { key: "Mod-]", run: indentMore, preventDefault: true },
    { key: "Tab", run: insertSoftIndent, preventDefault: true },
    { key: "Shift-Tab", run: indentLess, preventDefault: true }
  ])
);

// ── Component ─────────────────────────────────────────────────────────────────

export function SourcePanel() {
  const source = useEditorStore((s) => s.source);
  const lastEditPatches = useEditorStore((s) => s.lastEditPatches);
  const activeFigureId = useEditorStore((s) => s.activeFigureId);
  const snapshot = useEditorStore((s) => s.snapshot);
  const figures = snapshot.figures;
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const hoveredElementId = useEditorStore((s) => s.hoveredElementId);
  const assistantLockReason = useEditorStore((s) => s.documents[s.activeDocumentId]?.assistantLockReason ?? null);
  const dispatch = useEditorStore((s) => s.dispatch);
  const editorWordWrap = useSettingsStore((s) => s.settings.editor.wordWrap);
  const editorFontSize = useSettingsStore((s) => s.settings.editor.fontSize);
  const editorLineNumbers = useSettingsStore((s) => s.settings.editor.lineNumbers);
  const editorIndentSize = useSettingsStore((s) => s.settings.editor.indentSize);
  const [darkMode, setDarkMode] = useState(() => document.documentElement.dataset.colorScheme === "dark");
  const formatterReflowLongOptions = useSettingsStore((s) => s.settings.editor.formatterReflowLongOptions);
  const formatterMaxLineLength = useSettingsStore((s) => s.settings.editor.formatterMaxLineLength);

  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const colorPickerRef = useRef<HTMLDivElement | null>(null);
  const ignoreNextDocUpdateRef = useRef(false);
  const ignoreNextSelectionSyncRef = useRef(false);
  const suppressStoreSelectionSyncRef = useRef(false);
  const suppressElementScrollOnFigureSwitchRef = useRef(false);
  const colorPickerApplyingRef = useRef(false);
  const diagnosticTimerRef = useRef<number | null>(null);
  const spanIndexRef = useRef<SourceSpanIndex>(EMPTY_SPAN_INDEX);
  const symbolsRef = useRef<DocumentSymbols>(EMPTY_SYMBOLS);
  const selectedElementIdsRef = useRef(selectedElementIds);
  const figuresRef = useRef(figures);
  const activeFigureIdRef = useRef(activeFigureId);
  const [activeColorPicker, setActiveColorPicker] = useState<ActiveColorPickerSession | null>(null);
  const projectNamedColorSwatches = useProjectNamedColorSwatches(source);

  useEffect(() => {
    selectedElementIdsRef.current = selectedElementIds;
  }, [selectedElementIds]);

  useEffect(() => {
    figuresRef.current = figures;
    activeFigureIdRef.current = activeFigureId;
  }, [activeFigureId, figures]);

  useEffect(() => {
    spanIndexRef.current = buildSourceSpanIndex(snapshot.scene?.elements ?? [], snapshot.parseResult?.figure.body);
    symbolsRef.current = collectSymbols({ parseResult: snapshot.parseResult });
  }, [snapshot.scene, snapshot.parseResult]);

  // ── Initialize CodeMirror ───────────────────────────────────────────────────
  useEffect(() => {
    if (!editorRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const appliedByColorPicker = colorPickerApplyingRef.current;
        colorPickerApplyingRef.current = false;

        setActiveColorPicker((current) => {
          if (!current) {
            return null;
          }

          if (!appliedByColorPicker) {
            return null;
          }

          const mappedFrom = update.changes.mapPos(current.from, 1);
          const mappedTo = update.changes.mapPos(current.to, -1);
          if (mappedTo <= mappedFrom || mappedFrom < 0 || mappedTo > update.state.doc.length) {
            return null;
          }

          const nextToken = update.state.doc.sliceString(mappedFrom, mappedTo).trim();
          if (nextToken.length === 0) {
            return null;
          }

          return {
            ...current,
            from: mappedFrom,
            to: mappedTo,
            currentToken: nextToken
          };
        });

        if (ignoreNextDocUpdateRef.current) {
          ignoreNextDocUpdateRef.current = false;
        } else {
          const nextSource = update.state.doc.toString();
          dispatch({ type: "CODE_EDITED", source: nextSource });
        }
      }

      if (!update.selectionSet) {
        return;
      }

      if (ignoreNextSelectionSyncRef.current) {
        ignoreNextSelectionSyncRef.current = false;
        return;
      }

      // Drive active-figure switching from CodeMirror selection updates so
      // keyboard navigation and all cursor moves behave consistently.
      if (update.view.hasFocus) {
        const head = clamp(update.state.selection.main.head, 0, update.state.doc.length);
        const targetFigure = figuresRef.current.find((figure) => head >= figure.span.from && head <= figure.span.to) ?? null;
        if (targetFigure && targetFigure.id !== activeFigureIdRef.current) {
          dispatch({ type: "SET_ACTIVE_FIGURE", figureId: targetFigure.id });
        }
      }

      syncSelectionFromSourceCursor(
        update.state,
        spanIndexRef.current,
        selectedElementIdsRef.current,
        () => {
          suppressStoreSelectionSyncRef.current = true;
        },
        dispatch
      );

      const selection = update.state.selection.main;
      notifySourceSelectionChanged({
        from: selection.from,
        to: selection.to,
        anchor: selection.anchor,
        head: selection.head,
        sourceId: findSelectionSourceId(selection.anchor, selection.head, update.state.doc.length, spanIndexRef.current)
      });
    });

    const sourceHoverBridge = EditorView.domEventHandlers({
      mousemove(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        const sourceId = findSourceIdAtPosition(pos, view.state.doc.length, spanIndexRef.current);
        dispatch({ type: "SET_HOVERED_ELEMENT", id: sourceId });
        return false;
      },
      mouseleave() {
        dispatch({ type: "SET_HOVERED_ELEMENT", id: null });
        return false;
      }
    });

    const completionExtensions = ENABLE_TIKZ_AUTOCOMPLETE
      ? [
          autocompletion({
            override: [
              (context) => completeTikz(context, symbolsRef.current)
            ]
          })
        ]
      : [];

    const state = CMState.create({
      doc: source,
      extensions: [
        basicSetup,
        editorKeymap,
        ...completionExtensions,
        tikzLanguage(),
        wordWrapCompartment.of(editorWordWrap ? EditorView.lineWrapping : []),
        fontSizeCompartment.of(EditorView.theme({ "& .cm-scroller": { fontSize: `${editorFontSize}px` } })),
        tabSizeCompartment.of(CMState.tabSize.of(editorIndentSize)),
        editableCompartment.of(EditorView.editable.of(!assistantLockReason)),
        highlightCompartment.of(buildHighlightExtension(darkMode)),
        numberScrubber({
          onScrubStateChange: (scrub) => {
            if (!scrub.isActive || scrub.from == null) {
              dispatch({ type: "SET_ACTIVE_SOURCE_SCRUB", sourceId: null });
              return;
            }
            const sourceId = findSourceIdAtPosition(scrub.from, view.state.doc.length, spanIndexRef.current);
            dispatch({
              type: "SET_ACTIVE_SOURCE_SCRUB",
              sourceId
            });
          }
        }),
        colorSwatches({
          onPickRequest: ({ occurrence, anchorRect }) => {
            if (!occurrence.editable) {
              return;
            }
            setActiveColorPicker({
              from: occurrence.from,
              to: occurrence.to,
              currentToken: occurrence.token,
              anchorRect,
              editable: occurrence.editable
            });
          }
        }),
        highlightField,
        diagnosticsField,
        figureOverlayField,
        diagnosticTooltip,
        sourceHoverBridge,
        updateListener
      ]
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    return () => {
      dispatch({ type: "SET_ACTIVE_SOURCE_SCRUB", sourceId: null });
      if (diagnosticTimerRef.current != null) {
        clearTimeout(diagnosticTimerRef.current);
        diagnosticTimerRef.current = null;
      }
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once; source synced via separate effect below

  // ── Reactively apply editor settings ────────────────────────────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: wordWrapCompartment.reconfigure(editorWordWrap ? EditorView.lineWrapping : []) });
  }, [editorWordWrap]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: fontSizeCompartment.reconfigure(EditorView.theme({ "& .cm-scroller": { fontSize: `${editorFontSize}px` } })) });
  }, [editorFontSize]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: tabSizeCompartment.reconfigure(CMState.tabSize.of(editorIndentSize)) });
  }, [editorIndentSize]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(!assistantLockReason)) });
  }, [assistantLockReason]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDarkMode(document.documentElement.dataset.colorScheme === "dark");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-color-scheme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: highlightCompartment.reconfigure(buildHighlightExtension(darkMode)) });
  }, [darkMode]);


  // ── Canvas selection → source selection sync ────────────────────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    // Preserve active typing/caret behavior: when the source editor has focus,
    // store selection changes should update canvas state but must not replace
    // the user's current text selection/cursor in CodeMirror.
    if (view.hasFocus) {
      return;
    }

    if (suppressStoreSelectionSyncRef.current) {
      suppressStoreSelectionSyncRef.current = false;
      return;
    }

    // After a figure switch, suppress the scroll that would come from
    // selectedElementIds changing (the figure-scroll effect already positioned
    // the viewport at the figure header).
    const suppressScroll = suppressElementScrollOnFigureSwitchRef.current;
    if (suppressScroll) {
      suppressElementScrollOnFigureSwitchRef.current = false;
    }

    const selection = combineSelectedSourceSpan(selectedElementIds, spanIndexRef.current.bySourceId);
    if (!selection) {
      const currentSelection = view.state.selection.main;
      if (currentSelection.empty) {
        return;
      }
      ignoreNextSelectionSyncRef.current = true;
      dispatchSelectionWithStableHorizontalScroll(view, {
        selection: { anchor: currentSelection.head, head: currentSelection.head },
        annotations: [Transaction.addToHistory.of(false)],
        scrollIntoView: false
      });
      return;
    }

    const normalized = normalizeRange(selection.from, selection.to, view.state.doc.length);
    const currentSelection = view.state.selection.main;
    if (currentSelection.from === normalized.from && currentSelection.to === normalized.to) {
      return;
    }

    const autoRevealSelection = suppressScroll ? false : shouldAutoRevealSourceSelection();
    ignoreNextSelectionSyncRef.current = true;
    dispatchSelectionWithStableHorizontalScroll(view, {
      selection: { anchor: normalized.from, head: normalized.to },
      annotations: [Transaction.addToHistory.of(false)],
      scrollIntoView: autoRevealSelection
    });
  }, [selectedElementIds]);

  // ── Sync store source → CodeMirror (for WYSIWYG changes) ───────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === source) return;

    // When patches are available (from WYSIWYG edit actions), use them for
    // surgical CodeMirror updates instead of replacing the entire document.
    // This is much cheaper for large documents where only coordinates change.
    let changes: { from: number; to: number; insert: string } | Array<{ from: number; to: number; insert: string }>;
    // Guardrail: patch updates are only safe when all old spans target the
    // current pre-edit document and replay exactly to the desired next source.
    if (
      lastEditPatches &&
      lastEditPatches.length > 0 &&
      patchesMatchSourceTransition(current, source, lastEditPatches)
    ) {
      changes = lastEditPatches.map((p) => ({
        from: p.oldSpan.from,
        to: p.oldSpan.to,
        insert: p.replacement
      }));
    } else {
      changes = { from: 0, to: current.length, insert: source };
    }

    ignoreNextDocUpdateRef.current = true;
    dispatchSelectionWithStableHorizontalScroll(view, {
      changes,
      annotations: [
        Transaction.addToHistory.of(false),
        isolateHistory.of("before")
      ]
    });

    dispatchSelectionWithStableHorizontalScroll(view, {
      annotations: [isolateHistory.of("after")]
    });
  }, [source]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const decorations = buildFigureOverlayDecorations({
      docLength: view.state.doc.length,
      figures,
      activeFigureId
    });
    view.dispatch({ effects: setFigureOverlay.of(decorations) });
  }, [activeFigureId, figures, source]);

  const prevActiveFigureIdRef = useRef(activeFigureId);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const activeFigure = figures.find((figure) => figure.id === activeFigureId);
    if (!activeFigure) {
      return;
    }
    // Only scroll to figure top when the active figure actually changes,
    // not on every reparse (which updates the `figures` array reference).
    const figureChanged = prevActiveFigureIdRef.current !== activeFigureId;
    prevActiveFigureIdRef.current = activeFigureId;
    if (!figureChanged) {
      return;
    }
    // If the user changed figures by placing their caret in the source
    // editor, they are already looking at the right spot — don't scroll.
    if (view.hasFocus) {
      return;
    }
    const anchor = clamp(activeFigure.span.from, 0, view.state.doc.length);
    suppressElementScrollOnFigureSwitchRef.current = true;
    const selection = view.state.selection.main;
    if (selection.anchor !== anchor || selection.head !== anchor) {
      ignoreNextSelectionSyncRef.current = true;
      dispatchSelectionWithStableHorizontalScroll(view, {
        selection: { anchor, head: anchor },
        annotations: [Transaction.addToHistory.of(false)],
        effects: EditorView.scrollIntoView(anchor, { y: "start", yMargin: 8 })
      });
      return;
    }
    view.dispatch({
      effects: EditorView.scrollIntoView(anchor, { y: "start", yMargin: 8 })
    });
  }, [activeFigureId, figures]);

  useEffect(() => {
    if (!activeColorPicker) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (colorPickerRef.current?.contains(target)) {
        return;
      }
      setActiveColorPicker(null);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setActiveColorPicker(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeColorPicker]);

  // ── Canvas hover → source highlight sync ────────────────────────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const hoverSpan = hoveredElementId
      ? spanIndexRef.current.bySourceId.get(hoveredElementId) ?? null
      : null;

    if (!hoverSpan) {
      view.dispatch({ effects: setHighlight.of(null) });
      return;
    }

    const normalized = normalizeRange(hoverSpan.from, hoverSpan.to, view.state.doc.length);
    view.dispatch({ effects: setHighlight.of([normalized.from, normalized.to]) });
  }, [hoveredElementId, snapshot.scene]);

  // ── Update diagnostic decorations when snapshot changes ────────────────────
  useEffect(() => {
    if (diagnosticTimerRef.current != null) {
      clearTimeout(diagnosticTimerRef.current);
    }

    diagnosticTimerRef.current = window.setTimeout(() => {
      diagnosticTimerRef.current = null;
      const view = viewRef.current;
      if (!view) return;

      const docSource = view.state.doc.toString();
      const parse = snapshot.parseResult;
      const semantic = snapshot.semanticResult;

      if (!parse || parse.source !== docSource) {
        view.dispatch({ effects: setDiagnostics.of([]) });
        return;
      }

      const list: DiagnosticInput[] = [
        ...parse.diagnostics.map((d) => ({ ...d, from: d.span.from, to: d.span.to, source: "parse" as const })),
        ...(semantic?.diagnostics ?? []).map((d) => ({
          ...d,
          from: d.span.from,
          to: d.span.to,
          source: "semantic" as const
        }))
      ];
      view.dispatch({ effects: setDiagnostics.of(list) });
    }, DIAGNOSTIC_DEBOUNCE_MS);

    return () => {
      if (diagnosticTimerRef.current != null) {
        clearTimeout(diagnosticTimerRef.current);
        diagnosticTimerRef.current = null;
      }
    };
  }, [snapshot]);

  // ── Handle source selection/focus requests (canvas double-click) ───────────
  useEffect(() => {
    const handleRequest = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<SourceSelectionRequestDetail>;
      const detail = event.detail;
      const view = viewRef.current;
      if (!view || !detail) return;

      const sourceId = detail.sourceId?.trim();
      if (sourceId && shouldSuppressStoreSelectionSync(sourceId, selectedElementIdsRef.current)) {
        suppressStoreSelectionSyncRef.current = true;
      }

      const normalized = normalizeSelectionAnchorHead(
        detail.anchor ?? detail.from,
        detail.head ?? detail.to,
        view.state.doc.length
      );
      const autoRevealSelection = shouldAutoRevealSourceSelection();
      ignoreNextSelectionSyncRef.current = true;
      dispatchSelectionWithStableHorizontalScroll(view, {
        selection: { anchor: normalized.anchor, head: normalized.head },
        annotations: [Transaction.addToHistory.of(false)],
        scrollIntoView: autoRevealSelection
      });

      if (detail.focus && autoRevealSelection) {
        view.focus();
      }
    };

    window.addEventListener(SOURCE_SELECTION_REQUEST_EVENT, handleRequest as EventListener);
    return () => window.removeEventListener(SOURCE_SELECTION_REQUEST_EVENT, handleRequest as EventListener);
  }, []);

  useEffect(() => {
    const handleFormatRequest = (_rawEvent: Event): void => {
      const view = viewRef.current;
      if (!view) {
        return;
      }

      const currentSource = view.state.doc.toString();
      const formattedSource = formatTikzSource(currentSource, {
        indentUnit: " ".repeat(editorIndentSize),
        reflowLongOptionLists: formatterReflowLongOptions,
        maxLineLength: clampFormatterMaxLineLength(formatterMaxLineLength)
      });
      if (formattedSource === currentSource) {
        return;
      }

      const selection = view.state.selection.main;
      const nextAnchor = clamp(selection.anchor, 0, formattedSource.length);
      const nextHead = clamp(selection.head, 0, formattedSource.length);

      dispatchSelectionWithStableHorizontalScroll(view, {
        changes: { from: 0, to: currentSource.length, insert: formattedSource },
        selection: { anchor: nextAnchor, head: nextHead },
        userEvent: "input.format"
      });
    };

    window.addEventListener(SOURCE_FORMAT_REQUEST_EVENT, handleFormatRequest as EventListener);
    return () => window.removeEventListener(SOURCE_FORMAT_REQUEST_EVENT, handleFormatRequest as EventListener);
  }, [editorIndentSize, formatterMaxLineLength, formatterReflowLongOptions]);

  const handleInlineColorChange = (nextToken: string): void => {
    const session = activeColorPicker;
    const view = viewRef.current;
    if (!session || !view || !session.editable) {
      return;
    }

    colorPickerApplyingRef.current = true;
    dispatchSelectionWithStableHorizontalScroll(view, {
      changes: { from: session.from, to: session.to, insert: nextToken },
      selection: { anchor: session.from + nextToken.length },
      scrollIntoView: true,
      userEvent: "input"
    });

    setActiveColorPicker({
      ...session,
      to: session.from + nextToken.length,
      currentToken: nextToken
    });
  };

  const inlineColorPopoverStyle = activeColorPicker
    ? computeInlineColorPopoverStyle(activeColorPicker.anchorRect)
    : null;

  const diagnostics = useMemo(() => {
    const parse = snapshot.parseResult;
    const semantic = snapshot.semanticResult;
    const result: DiagnosticInput[] = [];
    if (parse) {
      for (const d of parse.diagnostics) {
        result.push({ ...d, from: d.span.from, to: d.span.to, source: "parse" });
      }
    }
    if (semantic) {
      for (const d of semantic.diagnostics) {
        result.push({ ...d, from: d.span.from, to: d.span.to, source: "semantic" });
      }
    }
    return result;
  }, [snapshot.parseResult, snapshot.semanticResult]);

  return (
    <div className={css.panel}>

      <div className={[css.editorWrap, editorLineNumbers ? "" : css.hideLineNumbers].filter(Boolean).join(" ")} ref={editorRef} />

      {diagnostics.length > 0 && (
        <div className={css.diagnostics}>
          {diagnostics.slice(0, 5).map((d, i) => {
            const line = snapshot.parseResult
              ? snapshot.parseResult.source.slice(0, d.from).split("\n").length
              : null;
            return (
              <div
                key={i}
                className={`${css.diagnostic} ${d.severity === "error" ? css.error : css.warning}`}
                onClick={() => {
                  const view = viewRef.current;
                  if (!view) return;
                  const pos = Math.min(d.from, view.state.doc.length);
                  dispatchSelectionWithStableHorizontalScroll(view, {
                    selection: { anchor: pos },
                    scrollIntoView: true,
                    annotations: [Transaction.addToHistory.of(false)]
                  });
                  view.focus();
                }}
              >
                <span className={css.diagnosticIcon}>{d.severity === "error" ? "\u2715" : "\u26A0"}</span>
                <span className={css.diagnosticMessage}>{d.message}</span>
                {line != null && <span className={css.diagnosticLocation}>Ln {line}</span>}
              </div>
            );
          })}
          {diagnostics.length > 5 && (
            <div className={`${css.diagnostic} ${css.diagnosticMore}`}>
              <span className={css.diagnosticIcon} />
              <span className={css.diagnosticMessage}>…{diagnostics.length - 5} more</span>
            </div>
          )}
        </div>
      )}

      {assistantLockReason ? <div className={css.lockBanner}>{assistantLockReason}</div> : null}
      {activeColorPicker && inlineColorPopoverStyle ? (
        <div className={css.inlineColorPickerPopover} ref={colorPickerRef} style={inlineColorPopoverStyle}>
          <ColorPicker
            ariaLabel="Source color"
            options={SOURCE_PICKER_COLORS}
            namedColorSwatches={projectNamedColorSwatches}
            value={activeColorPicker.currentToken}
            syntaxValue={activeColorPicker.currentToken}
            disabled={!activeColorPicker.editable}
            onChange={handleInlineColorChange}
          />
        </div>
      ) : null}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

type FigureOverlayFigure = {
  id: string;
  span: { from: number; to: number };
};

function buildFigureOverlayDecorations(params: {
  docLength: number;
  figures: readonly FigureOverlayFigure[];
  activeFigureId: string | null;
}): DecorationSet {
  const { docLength, figures, activeFigureId } = params;
  if (figures.length < 2) {
    return Decoration.none;
  }
  const normalizedFigures = figures
    .map((figure) => {
      const spanFrom = clamp(figure.span.from, 0, docLength);
      const spanTo = clamp(figure.span.to, spanFrom, docLength);
      if (spanTo <= spanFrom) {
        return null;
      }
      return {
        ...figure,
        span: { from: spanFrom, to: spanTo }
      };
    })
    .filter((figure): figure is FigureOverlayFigure => figure != null);
  if (normalizedFigures.length < 2) {
    return Decoration.none;
  }
  const decorations: any[] = [];
  const activeFigure = activeFigureId ? normalizedFigures.find((figure) => figure.id === activeFigureId) : null;
  if (activeFigure) {
    if (activeFigure.span.from > 0) {
      decorations.push(Decoration.mark({ class: "cm-figure-dimmed" }).range(0, activeFigure.span.from));
    }
    if (activeFigure.span.to < docLength) {
      decorations.push(Decoration.mark({ class: "cm-figure-dimmed" }).range(activeFigure.span.to, docLength));
    }
  } else {
    const sorted = [...normalizedFigures].sort((left, right) => left.span.from - right.span.from);
    let cursor = 0;
    for (const figure of sorted) {
      if (figure.span.from > cursor) {
        decorations.push(Decoration.mark({ class: "cm-figure-dimmed" }).range(cursor, figure.span.from));
      }
      cursor = Math.max(cursor, figure.span.to);
    }
    if (cursor < docLength) {
      decorations.push(Decoration.mark({ class: "cm-figure-dimmed" }).range(cursor, docLength));
    }
  }

  return Decoration.set(decorations, false);
}

function insertSoftIndent(view: EditorView): boolean {
  const indentSize = Math.max(1, view.state.facet(CMState.tabSize));
  const indentUnit = " ".repeat(indentSize);
  const transactionSpec = view.state.changeByRange((range) => ({
    changes: { from: range.from, to: range.to, insert: indentUnit },
    range: EditorSelection.cursor(range.from + indentUnit.length)
  }));
  view.dispatch(
    view.state.update(transactionSpec, {
      scrollIntoView: true,
      userEvent: "input"
    })
  );
  return true;
}

function clampFormatterMaxLineLength(value: number): number {
  if (!Number.isFinite(value)) {
    return 100;
  }
  const rounded = Math.round(value);
  return Math.max(MIN_FORMATTER_MAX_LINE_LENGTH, Math.min(MAX_FORMATTER_MAX_LINE_LENGTH, rounded));
}

function completeTikz(context: CompletionContext, symbols: DocumentSymbols) {
  const coordinatePrefix = context.matchBefore(/(?:\+\+|\+)?\([^)\]\}\s,]*$/);
  const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_./:-]*/);

  if (!context.explicit && !coordinatePrefix && (!word || word.from === word.to)) {
    return null;
  }

  const from = coordinatePrefix?.from ?? word?.from ?? context.pos;
  return {
    from,
    options: buildCompletionOptions(symbols),
    validFor: /[A-Za-z0-9_./:+\-()$ ]*/
  };
}

function buildCompletionOptions(symbols: DocumentSymbols): Completion[] {
  const dynamic: Completion[] = [];

  for (const nodeName of symbols.nodeNames) {
    dynamic.push({
      label: nodeName,
      type: "variable",
      detail: "node name"
    });
    dynamic.push({
      label: `(${nodeName})`,
      type: "snippet",
      detail: "node coordinate"
    });
  }

  for (const coordinateName of symbols.coordinateNames) {
    dynamic.push({
      label: coordinateName,
      type: "variable",
      detail: "coordinate name"
    });
    dynamic.push({
      label: `(${coordinateName})`,
      type: "snippet",
      detail: "named coordinate"
    });
  }

  for (const styleName of symbols.styleNames) {
    dynamic.push({
      label: styleName,
      type: "type",
      detail: "style name"
    });
  }

  return dedupeCompletions([...dynamic, ...BASE_COMPLETIONS]);
}

function buildSourceSpanIndex(elements: readonly SceneElement[], statements: readonly Statement[] | undefined): SourceSpanIndex {
  if (elements.length === 0 && (!statements || statements.length === 0)) {
    return EMPTY_SPAN_INDEX;
  }

  const sourceIds = new Set<string>();
  for (const element of elements) {
    const sourceId = element.sourceRef.sourceId.trim();
    if (!sourceId) {
      continue;
    }
    sourceIds.add(sourceId);
  }

  const sceneSpansBySourceId = new Map<string, SourceSpan>();
  for (const element of elements) {
    const sourceId = element.sourceRef.sourceId.trim();
    const sourceSpan = element.sourceRef.sourceSpan;
    if (!sourceId || !sourceSpan || sourceSpan.to <= sourceSpan.from) {
      continue;
    }
    const existing = sceneSpansBySourceId.get(sourceId);
    if (!existing) {
      sceneSpansBySourceId.set(sourceId, { from: sourceSpan.from, to: sourceSpan.to });
      continue;
    }
    sceneSpansBySourceId.set(sourceId, {
      from: Math.min(existing.from, sourceSpan.from),
      to: Math.max(existing.to, sourceSpan.to)
    });
  }

  const parseSpansById = collectParseSpansById(statements ?? []);
  const adornmentSpansByTargetId = collectAdornmentSpansByTargetId(elements);
  const bySourceId = new Map<string, SourceSpan>();
  for (const sourceId of sourceIds) {
    const parseSpan = parseSpansById.get(sourceId);
    const sceneSpan = sceneSpansBySourceId.get(sourceId);
    const chosen = parseSpan ?? sceneSpan;
    if (!chosen) {
      continue;
    }
    bySourceId.set(sourceId, chosen);
  }
  for (const [targetId, span] of adornmentSpansByTargetId) {
    bySourceId.set(targetId, span);
  }

  const sortedByWidth = [...bySourceId.entries()]
    .map(([sourceId, span]) => ({
      sourceId,
      from: span.from,
      to: span.to,
      width: Math.max(0, span.to - span.from)
    }))
    .sort((a, b) => {
      if (a.width !== b.width) return a.width - b.width;
      if (a.from !== b.from) return a.from - b.from;
      return a.sourceId.localeCompare(b.sourceId);
    });

  return { bySourceId, sortedByWidth };
}

function collectAdornmentSpansByTargetId(elements: readonly SceneElement[]): Map<string, SourceSpan> {
  const spans = new Map<string, SourceSpan>();
  for (const element of elements) {
    const adornment = element.adornment;
    if (!adornment || adornment.textSpan.to <= adornment.textSpan.from) {
      continue;
    }
    const existing = spans.get(adornment.targetId);
    if (!existing) {
      spans.set(adornment.targetId, {
        from: adornment.textSpan.from,
        to: adornment.textSpan.to
      });
      continue;
    }
    spans.set(adornment.targetId, {
      from: Math.min(existing.from, adornment.textSpan.from),
      to: Math.max(existing.to, adornment.textSpan.to)
    });
  }
  return spans;
}

function collectParseSpansById(statements: readonly Statement[]): Map<string, SourceSpan> {
  const spans = new Map<string, SourceSpan>();

  const addSpan = (id: string, span: Span | undefined) => {
    if (!span || span.to <= span.from) {
      return;
    }
    const existing = spans.get(id);
    if (!existing) {
      spans.set(id, { from: span.from, to: span.to });
      return;
    }
    spans.set(id, {
      from: Math.min(existing.from, span.from),
      to: Math.max(existing.to, span.to)
    });
  };

  const collectItems = (items: readonly PathItem[]) => {
    for (const item of items) {
      addSpan(item.id, item.span);
      if ((item.kind === "ToOperation" || item.kind === "EdgeOperation") && item.nodes) {
        for (const node of item.nodes) {
          addSpan(node.id, node.span);
        }
      }
    }
  };

  const collectStatements = (items: readonly Statement[]) => {
    for (const statement of items) {
      addSpan(statement.id, statement.span);
      if (statement.kind === "Path") {
        collectItems(statement.items);
      } else if (statement.kind === "Scope") {
        collectStatements(statement.body);
      }
    }
  };

  collectStatements(statements);
  return spans;
}

function combineSelectedSourceSpan(
  selectedElementIds: ReadonlySet<string>,
  spansBySourceId: ReadonlyMap<string, SourceSpan>
): SourceSpan | null {
  let combined: SourceSpan | null = null;
  for (const sourceId of selectedElementIds) {
    const span = spansBySourceId.get(sourceId);
    if (!span) continue;
    if (!combined) {
      combined = { ...span };
      continue;
    }
    combined = {
      from: Math.min(combined.from, span.from),
      to: Math.max(combined.to, span.to)
    };
  }
  return combined;
}

function syncSelectionFromSourceCursor(
  state: CMState,
  spanIndex: SourceSpanIndex,
  selectedElementIds: ReadonlySet<string>,
  onDispatchingStoreSelection: () => void,
  dispatch: (action: { type: "SELECT"; id: string; additive: boolean } | { type: "CLEAR_SELECTION" }) => void
): void {
  const sourceId = findSourceIdAtPosition(state.selection.main.head, state.doc.length, spanIndex);

  if (sourceId) {
    const alreadySelected = selectedElementIds.size === 1 && selectedElementIds.has(sourceId);
    if (alreadySelected) {
      return;
    }
    onDispatchingStoreSelection();
    dispatch({ type: "SELECT", id: sourceId, additive: false });
    return;
  }

  if (selectedElementIds.size === 0) {
    return;
  }

  onDispatchingStoreSelection();
  dispatch({ type: "CLEAR_SELECTION" });
}

function shouldSuppressStoreSelectionSync(sourceId: string, selectedElementIds: ReadonlySet<string>): boolean {
  return !(selectedElementIds.size === 1 && selectedElementIds.has(sourceId));
}

function findSelectionSourceId(
  anchor: number,
  head: number,
  docLength: number,
  spanIndex: SourceSpanIndex
): string | null {
  const headSourceId = findSourceIdAtPosition(head, docLength, spanIndex);
  const anchorSourceId = findSourceIdAtPosition(anchor, docLength, spanIndex);
  if (headSourceId && anchorSourceId && headSourceId === anchorSourceId) {
    return headSourceId;
  }
  if (headSourceId) {
    return headSourceId;
  }
  return anchorSourceId;
}

function findSourceIdAtPosition(
  position: number | null | undefined,
  docLength: number,
  spanIndex: SourceSpanIndex
): string | null {
  if (position == null || docLength <= 0) {
    return null;
  }

  const probe = clamp(position, 0, Math.max(0, docLength - 1));
  for (const span of spanIndex.sortedByWidth) {
    if (probe >= span.from && probe < span.to) {
      return span.sourceId;
    }
  }
  return null;
}

function normalizeDiagnostics(inputs: DiagnosticInput[], docLength: number): Diagnostic[] {
  return [...inputs]
    .sort((a, b) => {
      const sa = a.severity === "error" ? 1 : 0;
      const sb = b.severity === "error" ? 1 : 0;
      if (sa !== sb) return sb - sa;
      return Math.abs(a.to - a.from) - Math.abs(b.to - b.from);
    })
    .slice(0, MAX_DIAGNOSTICS)
    .map((d) => {
      let { from, to } = normalizeRange(d.from, d.to, docLength);
      if (to - from > MAX_DECORATED_SPAN) to = from + MAX_DECORATED_SPAN;
      return { ...d, from, to };
    })
    .filter((d) => d.to > d.from);
}

function normalizeRange(from: number, to: number, length: number): { from: number; to: number } {
  if (length <= 0) return { from: 0, to: 0 };
  const start = clamp(Math.min(from, to), 0, length);
  const end = clamp(Math.max(from, to), 0, length);
  if (start === end) {
    return start < length ? { from: start, to: start + 1 } : { from: Math.max(0, start - 1), to: start };
  }
  return { from: start, to: end };
}

function normalizeSelectionAnchorHead(anchor: number, head: number, length: number): { anchor: number; head: number } {
  if (length <= 0) {
    return { anchor: 0, head: 0 };
  }
  return {
    anchor: clamp(Math.floor(anchor), 0, length),
    head: clamp(Math.floor(head), 0, length)
  };
}

function dispatchSelectionWithStableHorizontalScroll(
  view: EditorView,
  spec: Parameters<EditorView["dispatch"]>[0]
): void {
  const previousScrollLeft = view.scrollDOM.scrollLeft;
  view.dispatch(spec);
  // When word-wrap is on there is no horizontal overflow, so nothing to
  // restore – skip the forced-reflow work entirely.
  if (view.scrollDOM.scrollWidth <= view.scrollDOM.clientWidth) {
    return;
  }
  restoreHorizontalScroll(view, previousScrollLeft);
  window.requestAnimationFrame(() => {
    restoreHorizontalScroll(view, previousScrollLeft);
  });
}

function restoreHorizontalScroll(view: EditorView, scrollLeft: number): void {
  if (!view.scrollDOM.isConnected) {
    return;
  }
  if (view.scrollDOM.scrollLeft === scrollLeft) {
    return;
  }
  view.scrollDOM.scrollLeft = scrollLeft;
}

function shouldAutoRevealSourceSelection(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  return !window.matchMedia("(max-width: 768px)").matches;
}

function buildDecorations(diagnostics: Diagnostic[]): DecorationSet {
  return Decoration.set(
    diagnostics.map((d) =>
      Decoration.mark({
        class: `cm-editor-diagnostic-range cm-editor-diagnostic-${d.severity}`
      }).range(d.from, d.to)
    ),
    true
  );
}

function bestDiagnosticAt(diagnostics: Diagnostic[], pos: number): Diagnostic | null {
  let best: Diagnostic | null = null;
  for (const d of diagnostics) {
    if (pos < d.from || pos > d.to) continue;
    if (!best) {
      best = d;
      continue;
    }
    const currentSeverity = d.severity === "error" ? 2 : 1;
    const bestSeverity = best.severity === "error" ? 2 : 1;
    if (currentSeverity > bestSeverity) {
      best = d;
      continue;
    }
    if (currentSeverity === bestSeverity && d.to - d.from < best.to - best.from) {
      best = d;
    }
  }
  return best;
}

function dedupeCompletions(completions: Completion[]): Completion[] {
  const byLabel = new Map<string, Completion>();
  for (const completion of completions) {
    if (byLabel.has(completion.label)) continue;
    byLabel.set(completion.label, completion);
  }
  return [...byLabel.values()];
}

function uniqueStrings(values: Iterable<string>): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    unique.add(trimmed);
  }
  return [...unique].sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function computeInlineColorPopoverStyle(anchorRect: DOMRectReadOnly): CSSProperties {
  const VIEWPORT_PADDING_PX = 8;
  const POPOVER_WIDTH_PX = 284;
  const POPOVER_HEIGHT_PX = 320;
  const POPOVER_GAP_PX = 6;

  const maxLeft = Math.max(VIEWPORT_PADDING_PX, window.innerWidth - POPOVER_WIDTH_PX - VIEWPORT_PADDING_PX);
  const left = clamp(anchorRect.left, VIEWPORT_PADDING_PX, maxLeft);

  const spaceBelow = window.innerHeight - anchorRect.bottom - POPOVER_GAP_PX - VIEWPORT_PADDING_PX;
  const spaceAbove = anchorRect.top - POPOVER_GAP_PX - VIEWPORT_PADDING_PX;
  const openUpward = POPOVER_HEIGHT_PX > spaceBelow && spaceAbove > 0;
  const top = openUpward
    ? Math.max(VIEWPORT_PADDING_PX, anchorRect.top - POPOVER_HEIGHT_PX - POPOVER_GAP_PX)
    : Math.min(
        anchorRect.bottom + POPOVER_GAP_PX,
        Math.max(VIEWPORT_PADDING_PX, window.innerHeight - POPOVER_HEIGHT_PX - VIEWPORT_PADDING_PX)
      );

  return {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`
  };
}
