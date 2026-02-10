import { useEffect, useRef, useState, useCallback } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, Decoration, DecorationSet } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { StateField, StateEffect } from "@codemirror/state";
import { parseTikz } from "tikz-editor/parser/index";
import type { ParseTikzResult } from "tikz-editor/parser/index";
import { tikzLanguage } from "./codemirror-tikz";
import { TreeView } from "./TreeView";

const defaultSource = `\\begin{tikzpicture}
  \\draw[thick, ->] (0,0) -- (2,1);
  \\fill[red] (1,1) circle;
  \\node[above] at (2,1) {Hello};
  % A comment
  \\draw (0,0) -- (1,0) -- (1,1) -- cycle;
\\end{tikzpicture}`;

// Highlight effect and field for hover ranges
const setHighlight = StateEffect.define<[number, number] | null>();

const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setHighlight)) {
        if (e.value) {
          const [from, to] = e.value;
          return Decoration.set([
            Decoration.mark({ class: "cm-highlight-range" }).range(from, to),
          ]);
        }
        return Decoration.none;
      }
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function App() {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [parseResult, setParseResult] = useState<ParseTikzResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [source, setSource] = useState(defaultSource);

  const runParse = useCallback((src: string) => {
    try {
      const result = parseTikz(src, { recover: true });
      setParseResult(result);
      setParseError(null);
    } catch (error) {
      setParseResult(null);
      setParseError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    if (!editorRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const src = update.state.doc.toString();
        setSource(src);
        runParse(src);
      }
    });

    const state = EditorState.create({
      doc: defaultSource,
      extensions: [basicSetup, tikzLanguage(), highlightField, updateListener],
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;
    runParse(defaultSource);

    return () => view.destroy();
  }, [runParse]);

  const handleHover = useCallback((range: [number, number] | null) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setHighlight.of(range) });
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>TikZ Parser Playground</h1>
      </header>
      <div className="app-body">
        <div className="editor-pane">
          <div className="pane-title">Editor</div>
          <div className="editor-container" ref={editorRef} />
        </div>
        <div className="tree-pane">
          <div className="pane-title">Syntax Tree (CST)</div>
          <TreeView tree={parseResult?.tree ?? null} source={source} onHover={handleHover} />
        </div>
        <div className="ir-pane">
          <div className="pane-title">Internal Representation (IR)</div>
          <IrView parseResult={parseResult} parseError={parseError} />
        </div>
      </div>
    </div>
  );
}

function IrView({
  parseResult,
  parseError,
}: {
  parseResult: ParseTikzResult | null;
  parseError: string | null;
}) {
  if (parseError) {
    return <div className="ir-view ir-error">{parseError}</div>;
  }

  if (!parseResult) {
    return <div className="ir-view">No parse result</div>;
  }

  const diagnostics = parseResult.diagnostics;
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;

  return (
    <div className="ir-view">
      <div className="ir-summary">
        <span>Statements: {parseResult.figure.body.length}</span>
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
      <pre className="ir-json">{JSON.stringify(parseResult.figure, null, 2)}</pre>
    </div>
  );
}
