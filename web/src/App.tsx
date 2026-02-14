import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { deleteLine, indentLess, indentMore } from "@codemirror/commands";
import { EditorView, Decoration, DecorationSet, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import type { ParseTikzResult } from "tikz-editor/parser/index";
import type { EvaluateTikzResult } from "tikz-editor/semantic/index";
import type { EmitSvgResult } from "tikz-editor/svg/index";
import type { RenderDiagnostic } from "tikz-editor/render/index";
import { renderTikzToSvgAsync } from "tikz-editor/render/index";
import { tikzLanguage } from "./codemirror-tikz";
import { TreeView } from "./TreeView";

type PaneId = "editor" | "tree" | "ir" | "svg";

const PANE_ORDER: PaneId[] = ["editor", "tree", "ir", "svg"];
const PANE_LABELS: Record<PaneId, string> = {
  editor: "Editor",
  tree: "CST",
  ir: "IR",
  svg: "SVG"
};

const defaultSource = String.raw`\begin{tikzpicture}[line width=0.8pt]
  \begin{scope}[xshift=1cm, yshift=0.5cm, rotate=4]
    \draw[->, blue] (0,0) -- (3,1) node {Flow};
    \draw[red, fill=yellow] (0,0) rectangle (1.4,0.8);
    \draw[green] (2,0.4) circle [radius=0.45cm];
    \draw (2,1.4) ellipse [x radius=0.8cm, y radius=0.35cm];
    \draw (0,1.2) arc [start angle=0, end angle=120, radius=0.7cm];
  \end{scope}
  \path coordinate (A) at (0,0) coordinate (B) at (2,1);
  \draw[gray] (A) grid [step=1cm] (4,2);
  \draw[thick] (A) to (B) -- +(1,0);
  \node at (3.5,1.7) {Semantic IR + SVG};
\end{tikzpicture}`;

const setHighlight = StateEffect.define<[number, number] | null>();

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

export function App() {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const appBodyRef = useRef<HTMLDivElement>(null);
  const renderRequestRef = useRef(0);
  const parseDebounceTimerRef = useRef<number | null>(null);
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
  const [paneVisibility, setPaneVisibility] = useState<Record<PaneId, boolean>>({
    editor: true,
    tree: true,
    ir: true,
    svg: true
  });
  const [paneSizes, setPaneSizes] = useState<Record<PaneId, number>>({
    editor: 30,
    tree: 22,
    ir: 24,
    svg: 24
  });

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
      queueParse(nextSource);
    });

    const state = EditorState.create({
      doc: defaultSource,
      extensions: [basicSetup, playgroundKeymap, tikzLanguage(), highlightField, updateListener]
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
      view.destroy();
    };
  }, [queueParse, runParse]);

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
                <IrView parseResult={parseResult} semanticResult={semanticResult} parseError={parseError} />
              )}
              {paneId === "svg" && (
                <SvgView parseError={parseError} svgResult={svgResult} renderDiagnostics={renderDiagnostics} />
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
  parseError
}: {
  parseResult: ParseTikzResult | null;
  semanticResult: EvaluateTikzResult | null;
  parseError: string | null;
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
            <div key={index} className={`ir-diagnostic ${diagnostic.severity}`}>
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

function SvgView({
  parseError,
  svgResult,
  renderDiagnostics
}: {
  parseError: string | null;
  svgResult: EmitSvgResult | null;
  renderDiagnostics: RenderDiagnostic[];
}) {
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
      <div className="svg-canvas" dangerouslySetInnerHTML={{ __html: svgResult.svg }} />
    </div>
  );
}
