import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { deleteLine, indentLess, indentMore } from "@codemirror/commands";
import { EditorView, Decoration, DecorationSet, hoverTooltip, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import type { ParseTikzResult } from "tikz-editor/parser/index";
import type { EvaluateTikzResult } from "tikz-editor/semantic/index";
import type { EmitSvgResult } from "tikz-editor/svg/index";
import type { RenderDiagnostic } from "tikz-editor/render/index";
import { renderTikzToSvgAsync } from "tikz-editor/render/index";
import { applyEditIntent } from "tikz-editor/edit/apply";
import { tikzLanguage } from "./codemirror-tikz";
import { numberScrubber } from "./number-scrubber";
import { TreeView } from "./TreeView";

type PaneId = "editor" | "tree" | "ir" | "svg";
type SourceSpan = { from: number; to: number };
type EditHandle = EvaluateTikzResult["editHandles"][number];
type Point2D = { x: number; y: number };
type DraggableNodeHandle = EditHandle & {
  kind: "node-position";
  rewriteMode: "direct";
  coordinateForm: "cartesian";
};
type NodeDragTarget = {
  handle: DraggableNodeHandle;
  sourceIds: string[];
};
type DragState = {
  pointerId: number;
  handleId: string;
  editHandlesSnapshot: EditHandle[];
  sourceIds: string[];
  capturedElement: SVGElement | null;
  baseSource: string;
  startWorld: Point2D;
  pointerStartWorld: Point2D;
  currentWorld: Point2D;
};

const PANE_ORDER: PaneId[] = ["editor", "tree", "ir", "svg"];
const PANE_LABELS: Record<PaneId, string> = {
  editor: "Editor",
  tree: "CST",
  ir: "IR",
  svg: "SVG"
};

// const defaultSource = String.raw`\begin{tikzpicture}[line width=0.8pt]
//   \begin{scope}[xshift=1cm, yshift=0.5cm, rotate=4]
//     \draw[->, blue] (0,0) -- (3,1) node {Flow};
//     \draw[red, fill=yellow] (0,0) rectangle (1.4,0.8);
//     \draw[green] (2,0.4) circle [radius=0.45cm];
//     \draw (2,1.4) ellipse [x radius=0.8cm, y radius=0.35cm];
//     \draw (0,1.2) arc [start angle=0, end angle=120, radius=0.7cm];
//   \end{scope}
//   \path coordinate (A) at (0,0) coordinate (B) at (2,1);
//   \draw[gray] (A) grid [step=1cm] (4,2);
//   \draw[thick] (A) to (B) -- +(1,0);
//   \node at (3.5,1.7) {Semantic IR + SVG};
// \end{tikzpicture}`;

const defaultSource = String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
  \draw (-3,-3) rectangle (3,3);

  \node[draw] (A) at (-1, -1) {A};
  \node[draw] (B) at (1.5, -0.5) {B};
  \node[draw] (C) at (0, 1.5) {C};
  \draw (A) edge (B)
        (B) edge (C)
        (C) edge (A);
\end{tikzpicture}`

const setHighlight = StateEffect.define<[number, number] | null>();
const setEditorDiagnostics = StateEffect.define<EditorDiagnosticInput[]>();

type SourceDiagnostic = {
  severity: "error" | "warning";
  message: string;
  span: { from: number; to: number };
  code?: string;
};

type EditorDiagnosticInput = SourceDiagnostic & {
  source: "parse" | "semantic";
};

type EditorDiagnostic = {
  from: number;
  to: number;
  severity: "error" | "warning";
  message: string;
  code?: string;
  source: "parse" | "semantic";
};

const MAX_EDITOR_DIAGNOSTICS = 300;
const MAX_DECORATED_SPAN = 160;
const DIAGNOSTIC_DECORATION_DEBOUNCE_MS = 120;
const LIVE_PARSE_INTERVAL_MS = 8;
const LIVE_SOURCE_UPDATE_INTERVAL_MS = 8;
const INITIAL_PANE_VISIBILITY: Record<PaneId, boolean> = {
  editor: true,
  tree: false,
  ir: false,
  svg: true
};
const BASE_PANE_SIZES: Record<PaneId, number> = {
  editor: 30,
  tree: 22,
  ir: 24,
  svg: 24
};

const playgroundKeymap = Prec.highest(
  keymap.of([
    {
      key: "Mod-d",
      run: deleteLine,
      preventDefault: true
    },
    {
      key: "Mod-[",
      run: indentLess,
      preventDefault: true
    },
    {
      key: "Mod-]",
      run: indentMore,
      preventDefault: true
    }
  ])
);

const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setHighlight)) {
        continue;
      }

      if (!effect.value) {
        return Decoration.none;
      }
      const [from, to] = effect.value;
      return Decoration.set([Decoration.mark({ class: "cm-highlight-range" }).range(from, to)]);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field)
});

const editorDiagnosticsField = StateField.define<{
  diagnostics: EditorDiagnostic[];
  decorations: DecorationSet;
}>({
  create() {
    return {
      diagnostics: [],
      decorations: Decoration.none
    };
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setEditorDiagnostics)) {
        continue;
      }
      const diagnostics = normalizeEditorDiagnostics(effect.value, tr.state.doc.length);
      return {
        diagnostics,
        decorations: buildDiagnosticDecorations(diagnostics)
      };
    }

    if (tr.docChanged) {
      return {
        diagnostics: [],
        decorations: Decoration.none
      };
    }

    return value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
});

const editorDiagnosticTooltip = hoverTooltip((view, position) => {
  const field = view.state.field(editorDiagnosticsField, false);
  if (!field) {
    return null;
  }

  const diagnostic = findDiagnosticAtPosition(field.diagnostics, position);
  if (!diagnostic) {
    return null;
  }

  return {
    pos: diagnostic.from,
    end: diagnostic.to,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = `cm-editor-diagnostic-tooltip cm-editor-diagnostic-tooltip-${diagnostic.severity}`;

      const header = document.createElement("div");
      header.className = "cm-editor-diagnostic-tooltip-header";

      const code = document.createElement("code");
      code.textContent = diagnostic.code ?? diagnostic.severity;

      const source = document.createElement("span");
      source.textContent = diagnostic.source.toUpperCase();

      header.append(code, source);

      const message = document.createElement("div");
      message.className = "cm-editor-diagnostic-tooltip-message";
      message.textContent = diagnostic.message;

      dom.append(header, message);
      return { dom };
    }
  };
});

export function App() {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const appBodyRef = useRef<HTMLDivElement>(null);
  const renderRequestRef = useRef(0);
  const parseDebounceTimerRef = useRef<number | null>(null);
  const diagnosticDebounceTimerRef = useRef<number | null>(null);
  const scrubAnimationFrameRef = useRef<number | null>(null);
  const scrubPendingSourceRef = useRef<string | null>(null);
  const isScrubbingRef = useRef(false);
  const isLiveDraggingRef = useRef(false);
  const liveDragParseTimerRef = useRef<number | null>(null);
  const liveDragPendingSourceRef = useRef<string | null>(null);
  const dragRef = useRef<{
    left: PaneId;
    right: PaneId;
    startX: number;
    startLeft: number;
    startRight: number;
  } | null>(null);

  const [parseResult, setParseResult] = useState<ParseTikzResult | null>(null);
  const [semanticResult, setSemanticResult] = useState<EvaluateTikzResult | null>(null);
  const [svgResult, setSvgResult] = useState<EmitSvgResult | null>(null);
  const [renderDiagnostics, setRenderDiagnostics] = useState<RenderDiagnostic[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [source, setSource] = useState(defaultSource);
  const [showGhostDragPreview, setShowGhostDragPreview] = useState(false);
  const [paneVisibility, setPaneVisibility] = useState<Record<PaneId, boolean>>(INITIAL_PANE_VISIBILITY);
  const [paneSizes, setPaneSizes] = useState<Record<PaneId, number>>(() =>
    normalizePaneSizes(BASE_PANE_SIZES, INITIAL_PANE_VISIBILITY)
  );

  const visiblePaneIds = PANE_ORDER.filter((paneId) => paneVisibility[paneId]);

  const runParse = useCallback((src: string) => {
    const requestId = renderRequestRef.current + 1;
    renderRequestRef.current = requestId;
    void (async () => {
      try {
        const rendered = await renderTikzToSvgAsync(src, {
          validateNodeText: false,
          parse: { recover: true },
          svg: { padding: 18 }
        });
        if (renderRequestRef.current !== requestId) {
          return;
        }
        setParseResult(rendered.parse);
        setSemanticResult(rendered.semantic);
        setSvgResult(rendered.svg);
        setRenderDiagnostics(rendered.renderDiagnostics);
        setParseError(null);
      } catch (error) {
        if (renderRequestRef.current !== requestId) {
          return;
        }
        setParseResult(null);
        setSemanticResult(null);
        setSvgResult(null);
        setRenderDiagnostics([]);
        setParseError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, []);

  const queueParse = useCallback(
    (src: string) => {
      if (parseDebounceTimerRef.current != null) {
        window.clearTimeout(parseDebounceTimerRef.current);
      }
      parseDebounceTimerRef.current = window.setTimeout(() => {
        parseDebounceTimerRef.current = null;
        runParse(src);
      }, 35);
    },
    [runParse]
  );

  const queueScrubParse = useCallback(
    (src: string) => {
      scrubPendingSourceRef.current = src;
      if (scrubAnimationFrameRef.current != null) {
        return;
      }
      scrubAnimationFrameRef.current = window.requestAnimationFrame(() => {
        scrubAnimationFrameRef.current = null;
        const pending = scrubPendingSourceRef.current;
        scrubPendingSourceRef.current = null;
        if (pending != null) {
          runParse(pending);
        }
      });
    },
    [runParse]
  );

  const queueLiveDragParse = useCallback(
    (src: string) => {
      liveDragPendingSourceRef.current = src;
      if (liveDragParseTimerRef.current != null) {
        return;
      }
      liveDragParseTimerRef.current = window.setTimeout(() => {
        liveDragParseTimerRef.current = null;
        const pending = liveDragPendingSourceRef.current;
        liveDragPendingSourceRef.current = null;
        if (pending != null) {
          runParse(pending);
        }
      }, LIVE_PARSE_INTERVAL_MS);
    },
    [runParse]
  );

  const handleScrubStateChange = useCallback(
    (active: boolean) => {
      isScrubbingRef.current = active;

      if (active && parseDebounceTimerRef.current != null) {
        window.clearTimeout(parseDebounceTimerRef.current);
        parseDebounceTimerRef.current = null;
      }

      if (!active) {
        if (scrubAnimationFrameRef.current != null) {
          window.cancelAnimationFrame(scrubAnimationFrameRef.current);
          scrubAnimationFrameRef.current = null;
        }
        const pending = scrubPendingSourceRef.current;
        scrubPendingSourceRef.current = null;
        if (pending != null) {
          runParse(pending);
        }
      }
    },
    [runParse]
  );

  const handleLiveDragStateChange = useCallback(
    (active: boolean) => {
      if (isLiveDraggingRef.current === active) {
        return;
      }
      isLiveDraggingRef.current = active;

      if (active) {
        if (parseDebounceTimerRef.current != null) {
          window.clearTimeout(parseDebounceTimerRef.current);
          parseDebounceTimerRef.current = null;
        }
        return;
      }

      if (liveDragParseTimerRef.current != null) {
        window.clearTimeout(liveDragParseTimerRef.current);
        liveDragParseTimerRef.current = null;
      }
      const pending = liveDragPendingSourceRef.current;
      liveDragPendingSourceRef.current = null;
      if (pending != null) {
        runParse(pending);
      }
    },
    [runParse]
  );

  useEffect(() => {
    if (!editorRef.current) {
      return;
    }

    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged) {
        return;
      }
      const nextSource = update.state.doc.toString();
      setSource(nextSource);
      if (isLiveDraggingRef.current) {
        queueLiveDragParse(nextSource);
      } else if (isScrubbingRef.current) {
        queueScrubParse(nextSource);
      } else {
        queueParse(nextSource);
      }
    });

    const state = EditorState.create({
      doc: defaultSource,
      extensions: [
        basicSetup,
        playgroundKeymap,
        tikzLanguage(),
        numberScrubber({ onScrubStateChange: handleScrubStateChange }),
        highlightField,
        editorDiagnosticsField,
        editorDiagnosticTooltip,
        updateListener
      ]
    });

    const view = new EditorView({
      state,
      parent: editorRef.current
    });
    viewRef.current = view;
    runParse(defaultSource);

    return () => {
      if (parseDebounceTimerRef.current != null) {
        window.clearTimeout(parseDebounceTimerRef.current);
        parseDebounceTimerRef.current = null;
      }
      if (diagnosticDebounceTimerRef.current != null) {
        window.clearTimeout(diagnosticDebounceTimerRef.current);
        diagnosticDebounceTimerRef.current = null;
      }
      if (scrubAnimationFrameRef.current != null) {
        window.cancelAnimationFrame(scrubAnimationFrameRef.current);
        scrubAnimationFrameRef.current = null;
      }
      if (liveDragParseTimerRef.current != null) {
        window.clearTimeout(liveDragParseTimerRef.current);
        liveDragParseTimerRef.current = null;
      }
      scrubPendingSourceRef.current = null;
      liveDragPendingSourceRef.current = null;
      isScrubbingRef.current = false;
      isLiveDraggingRef.current = false;
      document.body.classList.remove("is-scrubbing");
      view.destroy();
    };
  }, [handleScrubStateChange, queueLiveDragParse, queueParse, queueScrubParse, runParse]);

  useEffect(() => {
    function onMouseMove(event: MouseEvent): void {
      const drag = dragRef.current;
      const container = appBodyRef.current;
      if (!drag || !container) {
        return;
      }

      const containerWidth = Math.max(1, container.clientWidth);
      const deltaPercent = ((event.clientX - drag.startX) / containerWidth) * 100;
      const minWidth = 10;
      const pairTotal = drag.startLeft + drag.startRight;

      const nextLeft = Math.min(pairTotal - minWidth, Math.max(minWidth, drag.startLeft + deltaPercent));
      const nextRight = pairTotal - nextLeft;

      setPaneSizes((previous) => ({
        ...previous,
        [drag.left]: nextLeft,
        [drag.right]: nextRight
      }));
    }

    function onMouseUp(): void {
      if (dragRef.current) {
        dragRef.current = null;
        document.body.classList.remove("is-resizing");
      }
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const handleHover = useCallback((range: [number, number] | null) => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({ effects: setHighlight.of(range) });
  }, []);

  useEffect(() => {
    if (diagnosticDebounceTimerRef.current != null) {
      window.clearTimeout(diagnosticDebounceTimerRef.current);
      diagnosticDebounceTimerRef.current = null;
    }

    const view = viewRef.current;
    if (!view) {
      return;
    }

    diagnosticDebounceTimerRef.current = window.setTimeout(() => {
      diagnosticDebounceTimerRef.current = null;
      const currentView = viewRef.current;
      if (!currentView) {
        return;
      }

      const currentSource = currentView.state.doc.toString();
      if (!parseResult || parseResult.source !== currentSource) {
        currentView.dispatch({ effects: setEditorDiagnostics.of([]) });
        return;
      }

      const diagnostics = toEditorDiagnostics(parseResult, semanticResult);
      currentView.dispatch({ effects: setEditorDiagnostics.of(diagnostics) });
    }, DIAGNOSTIC_DECORATION_DEBOUNCE_MS);

    return () => {
      if (diagnosticDebounceTimerRef.current != null) {
        window.clearTimeout(diagnosticDebounceTimerRef.current);
        diagnosticDebounceTimerRef.current = null;
      }
    };
  }, [parseResult, semanticResult]);

  const handleTogglePane = useCallback((paneId: PaneId) => {
    setPaneVisibility((previous) => {
      const visibleCount = Object.values(previous).filter(Boolean).length;
      if (visibleCount === 1 && previous[paneId]) {
        return previous;
      }

      const next = { ...previous, [paneId]: !previous[paneId] };
      setPaneSizes((sizes) => normalizePaneSizes(sizes, next));
      return next;
    });
  }, []);

  const startResize = useCallback(
    (left: PaneId, right: PaneId, event: ReactMouseEvent) => {
      dragRef.current = {
        left,
        right,
        startX: event.clientX,
        startLeft: paneSizes[left],
        startRight: paneSizes[right]
      };
      document.body.classList.add("is-resizing");
      event.preventDefault();
    },
    [paneSizes]
  );

  const replaceSourceText = useCallback((nextSource: string) => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    if (view.state.doc.toString() === nextSource) {
      return;
    }

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextSource }
    });
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-main">
          <h1>TikZ Parser Playground</h1>
          <span className="header-subtitle">Parser → Semantic IR → SVG</span>
        </div>
        <div className="pane-toggles">
          {PANE_ORDER.map((paneId) => (
            <label key={paneId} className="pane-toggle">
              <input type="checkbox" checked={paneVisibility[paneId]} onChange={() => handleTogglePane(paneId)} />
              <span>{PANE_LABELS[paneId]}</span>
            </label>
          ))}
          <label className="pane-toggle">
            <input
              type="checkbox"
              checked={showGhostDragPreview}
              onChange={(event) => setShowGhostDragPreview(event.target.checked)}
            />
            <span>Ghost</span>
          </label>
        </div>
      </header>

      <div className="app-body" ref={appBodyRef}>
        {visiblePaneIds.map((paneId, index) => (
          <Fragment key={paneId}>
            <section className={`pane ${paneId}-pane`} style={paneStyle(paneId, paneSizes, visiblePaneIds.length)}>
              <div className="pane-title">{paneTitleFor(paneId)}</div>
              {paneId === "editor" && <div className="editor-container" ref={editorRef} />}
              {paneId === "tree" && <TreeView tree={parseResult?.tree ?? null} source={source} onHover={handleHover} />}
              {paneId === "ir" && (
                <IrView parseResult={parseResult} semanticResult={semanticResult} parseError={parseError} onHover={handleHover} />
              )}
              {paneId === "svg" && (
                <SvgView
                  parseError={parseError}
                  svgResult={svgResult}
                  semanticResult={semanticResult}
                  source={source}
                  renderDiagnostics={renderDiagnostics}
                  showGhost={showGhostDragPreview}
                  onLiveEditStateChange={handleLiveDragStateChange}
                  onReplaceSource={replaceSourceText}
                />
              )}
            </section>
            {index < visiblePaneIds.length - 1 && (
              <div
                className="pane-splitter"
                onMouseDown={(event) => startResize(visiblePaneIds[index], visiblePaneIds[index + 1], event)}
              />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function paneStyle(paneId: PaneId, paneSizes: Record<PaneId, number>, visibleCount: number): CSSProperties {
  const gutter = 8;
  const totalGutter = Math.max(0, (visibleCount - 1) * gutter);
  const ratio = paneSizes[paneId] / 100;
  return {
    flex: `0 0 calc((100% - ${totalGutter}px) * ${ratio})`
  };
}

function paneTitleFor(paneId: PaneId): string {
  if (paneId === "tree") {
    return "Syntax Tree (CST)";
  }
  if (paneId === "ir") {
    return "Internal Representation (IR)";
  }
  if (paneId === "svg") {
    return "SVG Preview";
  }
  return "Editor";
}

function normalizePaneSizes(
  currentSizes: Record<PaneId, number>,
  visibility: Record<PaneId, boolean>
): Record<PaneId, number> {
  const visible = PANE_ORDER.filter((paneId) => visibility[paneId]);
  if (visible.length === 0) {
    return currentSizes;
  }

  const total = visible.reduce((sum, paneId) => sum + currentSizes[paneId], 0);
  if (total <= 0) {
    const equal = 100 / visible.length;
    return {
      ...currentSizes,
      ...Object.fromEntries(visible.map((paneId) => [paneId, equal]))
    };
  }

  return {
    ...currentSizes,
    ...Object.fromEntries(visible.map((paneId) => [paneId, (currentSizes[paneId] / total) * 100]))
  };
}

function IrView({
  parseResult,
  semanticResult,
  parseError,
  onHover
}: {
  parseResult: ParseTikzResult | null;
  semanticResult: EvaluateTikzResult | null;
  parseError: string | null;
  onHover: (range: [number, number] | null) => void;
}) {
  if (parseError) {
    return <div className="ir-view ir-error">{parseError}</div>;
  }

  if (!parseResult) {
    return <div className="ir-view">No parse result</div>;
  }

  const parseDiagnostics = parseResult.diagnostics;
  const semanticDiagnostics = semanticResult?.diagnostics ?? [];
  const diagnostics = [...parseDiagnostics, ...semanticDiagnostics];
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;

  return (
    <div className="ir-view">
      <div className="ir-summary">
        <span>Statements: {parseResult.figure.body.length}</span>
        <span>Scene Elements: {semanticResult?.scene.elements.length ?? 0}</span>
        <span>Errors: {errorCount}</span>
        <span>Warnings: {warningCount}</span>
      </div>
      {diagnostics.length > 0 && (
        <div className="ir-diagnostics">
          {diagnostics.map((diagnostic, index) => (
            <div
              key={index}
              className={`ir-diagnostic ${diagnostic.severity}`}
              onMouseEnter={() => onHover([diagnostic.span.from, diagnostic.span.to])}
              onMouseLeave={() => onHover(null)}
            >
              <code>{diagnostic.code ?? diagnostic.severity}</code>
              <span>{diagnostic.message}</span>
              <span>
                [{diagnostic.span.from}–{diagnostic.span.to}]
              </span>
            </div>
          ))}
        </div>
      )}
      <pre className="ir-json">{JSON.stringify({ figure: parseResult.figure, semantic: semanticResult?.scene }, null, 2)}</pre>
    </div>
  );
}

function toEditorDiagnostics(
  parseResult: ParseTikzResult | null,
  semanticResult: EvaluateTikzResult | null
): EditorDiagnosticInput[] {
  const diagnostics: EditorDiagnosticInput[] = [];

  if (parseResult) {
    diagnostics.push(...parseResult.diagnostics.map((diagnostic) => ({ ...diagnostic, source: "parse" as const })));
  }
  if (semanticResult) {
    diagnostics.push(...semanticResult.diagnostics.map((diagnostic) => ({ ...diagnostic, source: "semantic" as const })));
  }

  return diagnostics;
}

function normalizeEditorDiagnostics(diagnostics: EditorDiagnosticInput[], docLength: number): EditorDiagnostic[] {
  return [...diagnostics]
    .sort((left, right) => {
      const leftSeverity = left.severity === "error" ? 1 : 0;
      const rightSeverity = right.severity === "error" ? 1 : 0;
      if (leftSeverity !== rightSeverity) {
        return rightSeverity - leftSeverity;
      }
      const leftSpan = Math.abs(left.span.to - left.span.from);
      const rightSpan = Math.abs(right.span.to - right.span.from);
      return leftSpan - rightSpan;
    })
    .slice(0, MAX_EDITOR_DIAGNOSTICS)
    .map((diagnostic) => {
      let [from, to] = normalizeDiagnosticRange(diagnostic.span.from, diagnostic.span.to, docLength);
      if (to - from > MAX_DECORATED_SPAN) {
        to = Math.min(docLength, from + MAX_DECORATED_SPAN);
      }
      return {
        from,
        to,
        severity: diagnostic.severity,
        message: diagnostic.message,
        code: diagnostic.code,
        source: diagnostic.source
      };
    })
    .filter((diagnostic) => diagnostic.to > diagnostic.from);
}

function normalizeDiagnosticRange(from: number, to: number, docLength: number): [number, number] {
  if (docLength <= 0) {
    return [0, 0];
  }

  const start = clamp(Math.min(from, to), 0, docLength);
  const end = clamp(Math.max(from, to), 0, docLength);

  if (start === end) {
    if (start < docLength) {
      return [start, start + 1];
    }
    return [Math.max(0, start - 1), start];
  }

  return [start, end];
}

function buildDiagnosticDecorations(diagnostics: EditorDiagnostic[]): DecorationSet {
  return Decoration.set(
    diagnostics.map((diagnostic) =>
      Decoration.mark({
        class: `cm-editor-diagnostic-range cm-editor-diagnostic-${diagnostic.severity}`
      }).range(diagnostic.from, diagnostic.to)
    ),
    true
  );
}

function findDiagnosticAtPosition(diagnostics: EditorDiagnostic[], position: number): EditorDiagnostic | null {
  let best: EditorDiagnostic | null = null;
  for (const diagnostic of diagnostics) {
    if (position < diagnostic.from || position > diagnostic.to) {
      continue;
    }
    if (!best || isHigherPriorityDiagnostic(diagnostic, best)) {
      best = diagnostic;
    }
  }
  return best;
}

function isHigherPriorityDiagnostic(candidate: EditorDiagnostic, current: EditorDiagnostic): boolean {
  const candidateSeverity = candidate.severity === "error" ? 2 : 1;
  const currentSeverity = current.severity === "error" ? 2 : 1;
  if (candidateSeverity !== currentSeverity) {
    return candidateSeverity > currentSeverity;
  }

  const candidateSpan = candidate.to - candidate.from;
  const currentSpan = current.to - current.from;
  return candidateSpan < currentSpan;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function SvgView({
  parseError,
  svgResult,
  semanticResult,
  source,
  renderDiagnostics,
  showGhost,
  onLiveEditStateChange,
  onReplaceSource
}: {
  parseError: string | null;
  svgResult: EmitSvgResult | null;
  semanticResult: EvaluateTikzResult | null;
  source: string;
  renderDiagnostics: RenderDiagnostic[];
  showGhost: boolean;
  onLiveEditStateChange: (active: boolean) => void;
  onReplaceSource: (nextSource: string) => void;
}) {
  const overlaySvgRef = useRef<SVGSVGElement>(null);
  const svgContentRef = useRef<HTMLDivElement>(null);
  const ghostLayerRef = useRef<SVGGElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const pendingLiveSourceRef = useRef<string | null>(null);
  const liveUpdateTimerRef = useRef<number | null>(null);

  const setNodeDragCursorActive = useCallback((active: boolean) => {
    document.body.classList.toggle("is-node-dragging", active);
  }, []);

  const draggableHandles = useMemo(() => {
    const handles = semanticResult?.editHandles ?? [];
    return handles.filter((handle): handle is DraggableNodeHandle => {
      if (handle.kind !== "node-position") {
        return false;
      }
      if (handle.rewriteMode !== "direct" || handle.coordinateForm !== "cartesian") {
        return false;
      }
      return isSimpleCoordinateSpan(source, handle.sourceSpan);
    });
  }, [semanticResult, source]);

  const nodeDragTargets = useMemo<NodeDragTarget[]>(() => {
    const sceneElements = semanticResult?.scene.elements ?? [];
    return draggableHandles
      .map((handle) => {
        const sourceIds = Array.from(
          new Set(
            sceneElements
              .filter((element) => spanContains(element.sourceSpan, handle.sourceSpan))
              .map((element) => element.sourceId)
          )
        );
        return {
          handle,
          sourceIds
        };
      })
      .filter((target) => target.sourceIds.length > 0);
  }, [draggableHandles, semanticResult?.scene.elements]);

  const targetsBySourceId = useMemo(() => {
    const map = new Map<string, NodeDragTarget[]>();
    for (const target of nodeDragTargets) {
      for (const sourceId of target.sourceIds) {
        const bucket = map.get(sourceId);
        if (bucket) {
          bucket.push(target);
        } else {
          map.set(sourceId, [target]);
        }
      }
    }
    return map;
  }, [nodeDragTargets]);

  const flushPendingLiveSource = useCallback(() => {
    if (liveUpdateTimerRef.current != null) {
      window.clearTimeout(liveUpdateTimerRef.current);
      liveUpdateTimerRef.current = null;
    }
    const pending = pendingLiveSourceRef.current;
    pendingLiveSourceRef.current = null;
    if (pending != null) {
      onReplaceSource(pending);
    }
  }, [onReplaceSource]);

  const clearGhostClone = useCallback(() => {
    const layer = ghostLayerRef.current;
    if (!layer) {
      return;
    }
    layer.replaceChildren();
    layer.removeAttribute("transform");
  }, []);

  const setGhostTranslation = useCallback(
    (deltaWorld: Point2D) => {
      const layer = ghostLayerRef.current;
      if (!layer || !svgResult || !showGhost) {
        return;
      }
      const dx = deltaWorld.x;
      const dy = -deltaWorld.y;
      layer.setAttribute("transform", `translate(${formatSvgNumber(dx)} ${formatSvgNumber(dy)})`);
    },
    [showGhost, svgResult]
  );

  const queueLiveSourceUpdate = useCallback(
    (nextSource: string) => {
      pendingLiveSourceRef.current = nextSource;
      if (liveUpdateTimerRef.current != null) {
        return;
      }
      liveUpdateTimerRef.current = window.setTimeout(() => {
        liveUpdateTimerRef.current = null;
        const pending = pendingLiveSourceRef.current;
        pendingLiveSourceRef.current = null;
        if (pending != null) {
          onReplaceSource(pending);
        }
      }, LIVE_SOURCE_UPDATE_INTERVAL_MS);
    },
    [onReplaceSource]
  );

  const applyMoveIntentToSource = useCallback(
    (baseSource: string, handles: EditHandle[], handleId: string, world: Point2D): string | null => {
      const result = applyEditIntent(baseSource, handles, {
        kind: "move",
        handleId,
        newWorld: world
      });
      if (result.kind !== "success") {
        return null;
      }
      return result.newSource;
    },
    []
  );

  useEffect(() => {
    return () => {
      if (liveUpdateTimerRef.current != null) {
        window.clearTimeout(liveUpdateTimerRef.current);
        liveUpdateTimerRef.current = null;
      }
      pendingLiveSourceRef.current = null;
      if (dragStateRef.current) {
        onLiveEditStateChange(false);
      }
      setNodeDragCursorActive(false);
      clearGhostClone();
      dragStateRef.current = null;
    };
  }, [clearGhostClone, onLiveEditStateChange, setNodeDragCursorActive]);

  useEffect(() => {
    if (!showGhost) {
      clearGhostClone();
    }
  }, [clearGhostClone, showGhost]);

  const handleNodePointerDown = useCallback(
    (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || dragStateRef.current) {
        return;
      }
      if (!svgResult || !(event.currentTarget instanceof SVGElement)) {
        return;
      }

      const sourceId = event.currentTarget.getAttribute("data-source-id");
      if (!sourceId) {
        return;
      }

      const pointerWorld = pointerEventToWorldOnSvg(event, overlaySvgRef.current, svgResult.viewBox);
      if (!pointerWorld) {
        return;
      }

      const candidates = targetsBySourceId.get(sourceId);
      if (!candidates || candidates.length === 0) {
        return;
      }

      let chosen = candidates[0];
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const candidate of candidates) {
        const distance = Math.hypot(candidate.handle.world.x - pointerWorld.x, candidate.handle.world.y - pointerWorld.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          chosen = candidate;
        }
      }

      const nextState: DragState = {
        pointerId: event.pointerId,
        handleId: chosen.handle.id,
        editHandlesSnapshot: semanticResult?.editHandles ?? [],
        sourceIds: chosen.sourceIds,
        capturedElement: event.currentTarget,
        baseSource: source,
        startWorld: { ...chosen.handle.world },
        pointerStartWorld: pointerWorld,
        currentWorld: { ...chosen.handle.world }
      };
      dragStateRef.current = nextState;
      setNodeDragCursorActive(true);
      onLiveEditStateChange(true);

      const rootSvg = svgContentRef.current?.querySelector("svg");
      const layer = ghostLayerRef.current;
      if (showGhost && rootSvg && layer) {
        layer.replaceChildren();
        for (const ghostSourceId of nextState.sourceIds) {
          const selector = `[data-source-id="${escapeCssAttributeValue(ghostSourceId)}"]`;
          const sourceElements = rootSvg.querySelectorAll<SVGGraphicsElement>(selector);
          for (const sourceElement of sourceElements) {
            const clone = sourceElement.cloneNode(true);
            if (!(clone instanceof SVGElement)) {
              continue;
            }
            clone.classList.add("svg-ghost-element");
            clone.removeAttribute("data-source-id");
            layer.appendChild(clone);
          }
        }
      } else {
        clearGhostClone();
      }
      setGhostTranslation({ x: 0, y: 0 });
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Ignore capture failures (e.g. unsupported environment).
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [
      clearGhostClone,
      onLiveEditStateChange,
      semanticResult?.editHandles,
      setGhostTranslation,
      setNodeDragCursorActive,
      showGhost,
      source,
      svgResult,
      targetsBySourceId
    ]
  );

  useEffect(() => {
    const rootSvg = svgContentRef.current?.querySelector("svg");
    if (!rootSvg || targetsBySourceId.size === 0) {
      return;
    }

    const cleanup: Array<() => void> = [];
    for (const sourceId of targetsBySourceId.keys()) {
      const selector = `[data-source-id="${escapeCssAttributeValue(sourceId)}"]`;
      const elements = rootSvg.querySelectorAll<SVGGraphicsElement>(selector);
      for (const element of elements) {
        element.classList.add("svg-node-target");
        element.addEventListener("pointerdown", handleNodePointerDown);
        cleanup.push(() => {
          element.classList.remove("svg-node-target");
          element.removeEventListener("pointerdown", handleNodePointerDown);
        });
      }
    }

    return () => {
      for (const dispose of cleanup) {
        dispose();
      }
    };
  }, [handleNodePointerDown, svgResult?.svg, targetsBySourceId]);

  const handleWindowPointerMove = useCallback(
    (event: PointerEvent) => {
      if (!svgResult) {
        return;
      }
      const previous = dragStateRef.current;
      if (!previous || previous.pointerId !== event.pointerId) {
        return;
      }

      const pointerWorld = pointerEventToWorldOnSvg(event, overlaySvgRef.current, svgResult.viewBox);
      if (!pointerWorld) {
        return;
      }

      const delta = {
        x: pointerWorld.x - previous.pointerStartWorld.x,
        y: pointerWorld.y - previous.pointerStartWorld.y
      };
      const currentWorld = {
        x: previous.startWorld.x + delta.x,
        y: previous.startWorld.y + delta.y
      };
      dragStateRef.current = {
        ...previous,
        currentWorld
      };
      setGhostTranslation({
        x: currentWorld.x - previous.startWorld.x,
        y: currentWorld.y - previous.startWorld.y
      });
      const nextSource = applyMoveIntentToSource(
        previous.baseSource,
        previous.editHandlesSnapshot,
        previous.handleId,
        currentWorld
      );
      if (nextSource != null) {
        queueLiveSourceUpdate(nextSource);
      }
    },
    [applyMoveIntentToSource, queueLiveSourceUpdate, setGhostTranslation, svgResult]
  );

  const handleWindowPointerUp = useCallback(
    (event: PointerEvent) => {
      const previous = dragStateRef.current;
      if (!previous || previous.pointerId !== event.pointerId) {
        return;
      }

      flushPendingLiveSource();
      const committed = applyMoveIntentToSource(
        previous.baseSource,
        previous.editHandlesSnapshot,
        previous.handleId,
        previous.currentWorld
      );
      if (committed != null) {
        onReplaceSource(committed);
      }
      releaseCapturedPointer(previous.capturedElement, previous.pointerId);
      dragStateRef.current = null;
      setNodeDragCursorActive(false);
      clearGhostClone();
      onLiveEditStateChange(false);
    },
    [
      applyMoveIntentToSource,
      clearGhostClone,
      flushPendingLiveSource,
      onLiveEditStateChange,
      onReplaceSource,
      setNodeDragCursorActive
    ]
  );

  const handleWindowPointerCancel = useCallback(
    (event: PointerEvent) => {
      const previous = dragStateRef.current;
      if (!previous || previous.pointerId !== event.pointerId) {
        return;
      }
      flushPendingLiveSource();
      releaseCapturedPointer(previous.capturedElement, previous.pointerId);
      dragStateRef.current = null;
      setNodeDragCursorActive(false);
      clearGhostClone();
      onLiveEditStateChange(false);
    },
    [clearGhostClone, flushPendingLiveSource, onLiveEditStateChange, setNodeDragCursorActive]
  );

  useEffect(() => {
    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerCancel);
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerCancel);
    };
  }, [handleWindowPointerCancel, handleWindowPointerMove, handleWindowPointerUp]);

  if (parseError) {
    return <div className="ir-view ir-error">{parseError}</div>;
  }

  if (!svgResult) {
    return <div className="ir-view">No SVG available</div>;
  }

  return (
    <div className="svg-view">
      <div className="svg-meta">
        <span>
          viewBox: {svgResult.viewBox.x.toFixed(1)} {svgResult.viewBox.y.toFixed(1)} {svgResult.viewBox.width.toFixed(1)}{" "}
          {svgResult.viewBox.height.toFixed(1)}
        </span>
        <span>Draggable nodes: {draggableHandles.length}</span>
        <span>Ghost: {showGhost ? "on" : "off"}</span>
        <span>Emitter diagnostics: {svgResult.diagnostics.length}</span>
      </div>
      {renderDiagnostics.length > 0 && (
        <div className="svg-diagnostics">
          {renderDiagnostics.map((diagnostic, index) => (
            <div key={index} className={`svg-diagnostic ${diagnostic.severity}`}>
              <code>{diagnostic.code}</code>
              <span>{diagnostic.message}</span>
            </div>
          ))}
        </div>
      )}
      <div className="svg-canvas">
        <div className="svg-stage">
          <div className="svg-content" ref={svgContentRef} dangerouslySetInnerHTML={{ __html: svgResult.svg }} />
          <svg
            ref={overlaySvgRef}
            className="svg-overlay-svg"
            viewBox={`${svgResult.viewBox.x} ${svgResult.viewBox.y} ${svgResult.viewBox.width} ${svgResult.viewBox.height}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden
          >
            <g ref={ghostLayerRef} className="svg-ghost-layer" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function isSimpleCoordinateSpan(source: string, span: SourceSpan): boolean {
  if (span.from < 0 || span.to > source.length || span.from >= span.to) {
    return false;
  }
  const raw = source.slice(span.from, span.to).trim();
  return /^\(\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*,\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*\)$/.test(raw);
}

function spanContains(outer: SourceSpan, inner: SourceSpan): boolean {
  return outer.from <= inner.from && outer.to >= inner.to;
}

function pointerEventToWorldOnSvg(
  event: Pick<PointerEvent, "clientX" | "clientY">,
  svg: SVGSVGElement | null,
  viewBox: EmitSvgResult["viewBox"]
): Point2D | null {
  if (!svg) {
    return null;
  }
  const screenCtm = svg.getScreenCTM();
  if (!screenCtm) {
    return null;
  }
  const inverse = screenCtm.inverse();
  if (!inverse) {
    return null;
  }
  const projected = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
  return {
    x: projected.x,
    y: svgYToWorldY(projected.y, viewBox)
  };
}

function svgYToWorldY(svgY: number, viewBox: EmitSvgResult["viewBox"]): number {
  return viewBox.y + viewBox.height - (svgY - viewBox.y);
}

function escapeCssAttributeValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function releaseCapturedPointer(element: SVGElement | null, pointerId: number): void {
  if (!element) {
    return;
  }
  try {
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  } catch {
    // Ignore if capture was already released or unsupported.
  }
}

function formatSvgNumber(value: number): string {
  return Number(value.toFixed(4)).toString();
}
