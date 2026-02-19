import { useEffect, useRef } from "react";
import {
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
import { basicSetup } from "codemirror";
import { tikzLanguage } from "../codemirror-tikz";
import { numberScrubber } from "../number-scrubber";
import { useEditorStore } from "../store/store";
import css from "./SourcePanel.module.css";

// ── CodeMirror state effects ────────────────────────────────────────────────

const setHighlight = StateEffect.define<[number, number] | null>();
const setDiagnostics = StateEffect.define<DiagnosticInput[]>();

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

const MAX_DIAGNOSTICS = 300;
const MAX_DECORATED_SPAN = 160;
const DIAGNOSTIC_DEBOUNCE_MS = 120;

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
    { key: "Mod-]", run: indentMore, preventDefault: true }
  ])
);

// ── Component ─────────────────────────────────────────────────────────────────

export function SourcePanel() {
  const source = useEditorStore((s) => s.source);
  const snapshot = useEditorStore((s) => s.snapshot);
  const dispatch = useEditorStore((s) => s.dispatch);

  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Track whether a CM update was triggered by us (WYSIWYG → CM), not the user
  const ignoreNextUpdateRef = useRef(false);
  const diagnosticTimerRef = useRef<number | null>(null);

  // ── Initialize CodeMirror ───────────────────────────────────────────────────
  useEffect(() => {
    if (!editorRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      if (ignoreNextUpdateRef.current) {
        ignoreNextUpdateRef.current = false;
        return;
      }
      const nextSource = update.state.doc.toString();
      dispatch({ type: "CODE_EDITED", source: nextSource });
    });

    const state = CMState.create({
      doc: source,
      extensions: [
        basicSetup,
        editorKeymap,
        tikzLanguage(),
        numberScrubber(),
        highlightField,
        diagnosticsField,
        diagnosticTooltip,
        updateListener
      ]
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    return () => {
      if (diagnosticTimerRef.current != null) {
        clearTimeout(diagnosticTimerRef.current);
        diagnosticTimerRef.current = null;
      }
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // intentionally run once; source synced via separate effect below

  // ── Sync store source → CodeMirror (for WYSIWYG changes) ───────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === source) return;

    // Push WYSIWYG change into CM without creating a CM undo entry.
    // We isolate history around this transaction so user typing starts
    // a fresh undo group after canvas-originated edits.
    ignoreNextUpdateRef.current = true;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: source },
      annotations: [
        Transaction.addToHistory.of(false),
        isolateHistory.of("before")
      ]
    });

    view.dispatch({
      annotations: [isolateHistory.of("after")]
    });
  }, [source]);

  // ── Update diagnostic decorations when snapshot changes ───────────────────
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

  return (
    <div className={css.panel}>
      <div className={css.header}>Source</div>
      <div className={css.editorWrap} ref={editorRef} />
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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
    if (!best) { best = d; continue; }
    const cs = d.severity === "error" ? 2 : 1;
    const bs = best.severity === "error" ? 2 : 1;
    if (cs > bs) { best = d; continue; }
    if (cs === bs && d.to - d.from < best.to - best.from) best = d;
  }
  return best;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
