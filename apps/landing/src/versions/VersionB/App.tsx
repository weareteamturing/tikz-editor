import type { ReactNode } from "react";
import appScreenshotUrl from "../../../background-materials/app-screenshot.png";
import { AddArrowCard } from "../VersionA/cards/AddArrowCard";
import { AddRectCard } from "../VersionA/cards/AddRectCard";
import { NodeMoveCard } from "../VersionA/cards/NodeMoveCard";
import { SelectionAlignCard } from "../VersionA/cards/SelectionAlignCard";
import { SnapGuidesCard } from "../VersionA/cards/SnapGuidesCard";

type CodeLine = {
  id: string;
  number: string;
  content: ReactNode;
  active?: boolean;
  folded?: boolean;
  foldControl?: "open" | "closed";
};

const heroCodeLines: CodeLine[] = [
  line("1", "1", <>
    <Tok kind="keyword">\begin</Tok><Tok kind="punctuation">{"{tikzpicture}"}</Tok>
  </>, false, false, "open"),
  line("2", "2", <>
    {"  "}<Tok kind="keyword">\node</Tok><Tok kind="punctuation">[</Tok><Tok kind="type">decision</Tok><Tok kind="punctuation">]</Tok>{" (q1) at (0,.85) "}
    <Tok kind="string">{"{$x > 0$}"}</Tok><Tok kind="punctuation">;</Tok>
  </>),
  line("3", "3", <>
    {"  "}<Tok kind="keyword">\node</Tok><Tok kind="punctuation">[</Tok><Tok kind="type">decision</Tok><Tok kind="punctuation">]</Tok>{" (q2) at (-2.2,-2) "}
    <Tok kind="string">{"{$y > 0$}"}</Tok><Tok kind="punctuation">;</Tok>
  </>, true),
  line("4", "4", <>
    {"  "}<Tok kind="keyword">\draw</Tok>{"[->] (q1) -- node[above left] "}
    <Tok kind="string">{"{yes}"}</Tok>{" (q2);"}
  </>),
  line("5", "5", <>
    <Tok kind="keyword">\end</Tok><Tok kind="punctuation">{"{tikzpicture}"}</Tok>
  </>)
];

const foldingLines: CodeLine[] = [
  line("1", "1", <>
    <Tok kind="keyword">\begin</Tok><Tok kind="punctuation">{"{tikzpicture}"}</Tok>
  </>),
  line("2", "2", <>
    {"  "}<Tok kind="comment">% styles</Tok>
  </>),
  line("3", "3", <>
    {"  "}<Tok kind="keyword">\tikzset</Tok><Tok kind="punctuation">{"{"}</Tok><Tok kind="type">workflow/.style</Tok>{"={draw, rounded corners, fill=green!15}"}
  </>, false, false, "closed"),
  line("4", "4", <Tok kind="meta">{"  ..."}</Tok>, false, true),
  line("12", "12", <>
    {"  "}<Tok kind="keyword">\draw</Tok>{"[->] (draft) -- (review);"}
  </>),
  line("13", "13", <>
    <Tok kind="keyword">\end</Tok><Tok kind="punctuation">{"{tikzpicture}"}</Tok>
  </>)
];

const tooltipLines: CodeLine[] = [
  line("1", "7", <>
    {"  "}<Tok kind="keyword">\node</Tok>{"["}<Tok kind="type">draw</Tok>{", "}<span className="vBHoverToken">rounded corners</span>{", "}
  </>),
  line("2", "8", <>
    {"    "}<Tok kind="type">fill</Tok>{"="}<Tok kind="number">blue!12</Tok>{", "}
    <Tok kind="type">minimum width</Tok>{"="}<Tok kind="number">18mm</Tok>{"]"}
  </>, true),
  line("3", "9", <>
    {"    "}<Tok kind="punctuation">(start)</Tok>{" at (0,0) "}
    <Tok kind="string">{"{Draft}"}</Tok><Tok kind="punctuation">;</Tok>
  </>)
];

const exportLines: CodeLine[] = [
  line("1", "1", <>
    <Tok kind="keyword">\foreach</Tok>{" \\i/\\label in "}
    <Tok kind="punctuation">{"{1/A,2/B,3/C}"}</Tok>{" {"}
  </>),
  line("2", "2", <>
    {"  "}<Tok kind="keyword">\node</Tok>{"[circle, draw] (n\\i) at (\\i,0) "}
    <Tok kind="string">{"{\\label}"}</Tok><Tok kind="punctuation">;</Tok>
  </>),
  line("3", "3", <>
    <Tok kind="punctuation">{"}"}</Tok>
  </>)
];

export function App() {
  return (
    <main className="landingPage landingPageVersionB">
      <Hero />
      <EditorStory />
    </main>
  );
}

function Hero() {
  return (
    <section className="vBHero" aria-labelledby="landing-title">
      <div className="vBHeroCopy">
        <p className="vBEyebrow">TikZ Editor</p>
        <h1 id="landing-title">TikZ Editor</h1>
        <p className="vBHeroLead">A visual workspace for precise TikZ diagrams.</p>
        <p className="vBHeroText">
          Edit the source, shape the drawing directly, and keep both views in sync.
        </p>
        <div className="vBHeroActions" aria-label="Landing page links">
          <a href="/" className="vBTextLink">Open app</a>
          <a href="https://github.com/DominikPeters/tikz-editor" className="vBTextLink">GitHub</a>
        </div>
      </div>
      <figure className="vBHeroScreenshot" aria-label="TikZ Editor interface screenshot">
        <img src={appScreenshotUrl} alt="TikZ Editor interface with source, canvas, and inspector" />
      </figure>
    </section>
  );
}

function EditorStory() {
  return (
    <section className="vBEditorStory" aria-label="TikZ Editor feature walkthrough">
      <EditorRow
        code={<EmptyRail />}
        eyebrow="Editor-shaped story"
        title="The page follows the app."
        body="The left side behaves like a source pane. The right side has the explanation, rendered graphics, and the editor interactions. When a feature has no meaningful code sample, the source pane simply stays quiet."
      >
        <div className="vBMirrorDiagram" aria-hidden="true">
          <span>Source</span>
          <span>Canvas</span>
          <span>Inspector</span>
        </div>
      </EditorRow>

      <EditorRow
        code={<CodePanel title="decision-tree.tex" lines={heroCodeLines} />}
        eyebrow="Source and canvas"
        title="Code remains a first-class view."
        body="The left rail can show the exact TikZ fragment being discussed while the right side explains what the editor makes visible: selected nodes, paths, anchors, and the rendered result."
      >
        <div className="vBResultPane">
          <DecisionTreeGraphic />
        </div>
      </EditorRow>

      <SyncedDemo
        eyebrow="Canvas edit -> source patch"
        title="Drag a node and the TikZ changes."
        body="These are the Version A animation components reused directly. Their source previews are still synchronized with the fake cursor timeline, but Version B lays that code in the left rail and the drawing on the right."
      >
        <NodeMoveCard />
      </SyncedDemo>

      <SyncedDemo
        eyebrow="Draw and resize"
        title="Shape tools write the corresponding TikZ."
        body="The rectangle tool demonstrates the main rhythm for the page: code appears on the left exactly when it matters, while the right side stays focused on the direct manipulation."
      >
        <AddRectCard />
      </SyncedDemo>

      <EditorRow
        code={<CodePanel title="workflow.tex" lines={foldingLines} variant="editor" />}
        eyebrow="Code folding"
        title="Large diagrams stay navigable."
        body="Folding can collapse styles, repeated graph sections, or local helper scopes, so the source pane stays useful even when the diagram grows."
      />

      <EditorRow
        code={<CodePanel title="tooltip-hover.tex" lines={tooltipLines} overlay={<DocsTooltipMock />} variant="editor" />}
        eyebrow="Inline help"
        title="Documentation can live next to the code."
        body="The hover target stays in the source editor, and the documentation popover uses the same structure and styling as the real CodeMirror docs tooltip."
      />

      <SyncedDemo
        eyebrow="Snap guides"
        title="Layout tools understand the drawing."
        body="The cursor motion, guides, and source update are still driven by the Version A GSAP timeline. Version B only changes where the source and scene sit on the page."
      >
        <SnapGuidesCard />
      </SyncedDemo>

      <SyncedDemo
        eyebrow="Anchors and arrows"
        title="Paths attach to semantic points."
        body="The same split can introduce arrows, anchors, alignment, and multi-selection tools without switching away from the code-and-canvas metaphor."
      >
        <AddArrowCard />
      </SyncedDemo>

      <SyncedDemo
        eyebrow="Selection tools"
        title="Repeated edits stay visual."
        body="Alignment and distribution make sense visually, while the source rail keeps the generated TikZ patch legible."
      >
        <SelectionAlignCard />
      </SyncedDemo>

      <EditorRow
        code={<CodePanel title="repeat.tex" lines={exportLines} />}
        eyebrow="TikZ vocabulary"
        title="The landing page can keep widening from here."
        body="Further sections can cover foreach loops, matrices, styles, exports, and examples using the same rule: code when it clarifies the feature, empty rail when the story is visual."
      >
        <div className="vBClosingGrid" aria-hidden="true">
          <span>Nodes</span>
          <span>Paths</span>
          <span>Styles</span>
          <span>Exports</span>
        </div>
      </EditorRow>
    </section>
  );
}

function EditorRow({
  code,
  eyebrow,
  title,
  body,
  children
}: {
  code: ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <article className="vBEditorRow">
      <div className="vBCodeRail">{code}</div>
      <div className="vBFeatureColumn">
        <div className="vBFeatureCopy">
          <p className="vBEyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p>{body}</p>
        </div>
        {children ? <div className="vBFeatureVisual">{children}</div> : null}
      </div>
    </article>
  );
}

function SyncedDemo({
  eyebrow,
  title,
  body,
  children
}: {
  eyebrow: string;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <article className="vBEditorRow vBSyncedRow">
      <div className="vBCodeRail vBCodeRailEmpty" aria-hidden="true" />
      <div className="vBFeatureColumn vBDemoCopy">
        <div className="vBFeatureCopy">
          <p className="vBEyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p>{body}</p>
        </div>
      </div>
      <div className="vBSyncedDemo">
        {children}
      </div>
    </article>
  );
}

function CodePanel({
  title,
  lines,
  overlay,
  variant
}: {
  title: string;
  lines: CodeLine[];
  overlay?: ReactNode;
  variant?: "editor";
}) {
  return (
    <div className={["vBCodePanel", overlay ? "vBCodePanelWithOverlay" : "", variant === "editor" ? "vBCodePanelEditor" : ""].filter(Boolean).join(" ")}>
      <div className="vBCodeTitle">{title}</div>
      <pre className="vBCodePreview" aria-label={title}>
        <code>
          {lines.map((codeLine) => (
            <span
              className={[
                "vBCodeLine",
                codeLine.active ? "isActive" : "",
                codeLine.folded ? "isFolded" : ""
              ].filter(Boolean).join(" ")}
              key={codeLine.id}
            >
              <span className="vBFoldGutter">
                {codeLine.foldControl ? (
                  <span title={codeLine.foldControl === "closed" ? "Unfold line" : "Fold line"}>
                    {codeLine.foldControl === "closed" ? "›" : "⌄"}
                  </span>
                ) : null}
              </span>
              <span className="vBLineNumber">{codeLine.number}</span>
              <span className="vBLineContent">{codeLine.content}</span>
            </span>
          ))}
        </code>
      </pre>
      {overlay}
    </div>
  );
}

function DocsTooltipMock() {
  return (
    <div className="cm-editor-docs-tooltip vBDocsTooltipMock" role="note">
      <div className="cm-editor-docs-tooltip-meta">
        <div className="cm-editor-docs-tooltip-signature">
          <code>rounded corners</code>
        </div>
        <div className="cm-editor-docs-tooltip-default">default <code>4pt</code></div>
      </div>
      <div className="cm-editor-docs-tooltip-snippet">
        <p>Rounds corners on rectangle and path joins.</p>
        <p>Can be combined with <code>rounded corners=2pt</code>.</p>
      </div>
      <div className="cm-editor-docs-tooltip-link-row">
        <a className="cm-editor-docs-tooltip-link" href="https://tikz.dev/tikz-actions" target="_blank" rel="noreferrer">Open docs</a>
      </div>
    </div>
  );
}

function EmptyRail() {
  return <div className="vBEmptyRail" aria-hidden="true" />;
}

function DecisionTreeGraphic() {
  return (
    <svg viewBox="0 0 520 340" role="img" aria-label="Rendered decision tree diagram">
      <defs>
        <marker id="vBArrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0 0 8 4 0 8z" />
        </marker>
      </defs>
      <g className="vBGridLines">
        {Array.from({ length: 11 }, (_, index) => (
          <path d={`M${index * 52} 0V340`} key={`v-${index}`} />
        ))}
        {Array.from({ length: 8 }, (_, index) => (
          <path d={`M0 ${index * 48}H520`} key={`h-${index}`} />
        ))}
      </g>
      <g className="vBDecisionTree">
        <path d="M260 82 166 182" />
        <path d="M260 82 382 182" />
        <path d="M166 222 108 298" />
        <path d="M166 222 236 298" />
        <polygon points="260,28 345,76 260,124 175,76" />
        <polygon points="166,152 250,200 166,248 82,200" />
        <rect x="344" y="172" width="104" height="48" rx="6" />
        <rect x="62" y="276" width="104" height="48" rx="6" />
        <rect x="204" y="276" width="104" height="48" rx="6" />
        <text x="260" y="85">x &gt; 0?</text>
        <text x="166" y="209">y &gt; 0?</text>
        <text x="396" y="203">No action</text>
        <text x="114" y="307">Accept</text>
        <text x="256" y="307">Review</text>
      </g>
    </svg>
  );
}

function Tok({ kind, children }: { kind: "keyword" | "type" | "string" | "number" | "punctuation" | "comment" | "meta"; children: ReactNode }) {
  return <span className={`vBTok vBTok-${kind}`}>{children}</span>;
}

function line(id: string, number: string, content: ReactNode, active = false, folded = false, foldControl?: "open" | "closed"): CodeLine {
  return { id, number, content, active, folded, foldControl };
}
