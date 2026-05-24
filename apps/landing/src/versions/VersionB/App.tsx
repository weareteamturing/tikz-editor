import type { ReactNode } from "react";
import { RiAppleFill, RiExternalLinkLine, RiGithubFill, RiWindowsFill } from "@remixicon/react";
import appScreenshotUrl from "../../../background-materials/app-screenshot.png";
import multiFigureUrl from "../../../background-materials/multi-figure.png";
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

export function App() {
  return (
    <div className="vBTikzDevPage">
      <TikzDevHeader />
      <main className="landingPage landingPageVersionB">
        <Hero />
        <EditorStory />
      </main>
      <TikzDevFooter />
    </div>
  );
}

function TikzDevHeader() {
  return (
    <header className="vBTikzDevHeader">
      <div className="vBTikzDevHamburger" aria-hidden="true">☰</div>
      <strong className="vBTikzDevTitle">
        <a href="https://tikz.dev" className="vBTikzDevParentLink">tikz.dev / </a>
        <a href="/editor">TikZ Editor</a>
      </strong>
      <nav className="vBTikzDevLinks" aria-label="TikZ Editor links">
        <a className="vBTikzDevGithubLink" href="https://github.com/DominikPeters/tikz-editor">
          <RiGithubFill aria-hidden="true" size={18} />
          <span>GitHub</span>
        </a>
      </nav>
    </header>
  );
}

function TikzDevFooter() {
  return (
    <footer className="vBTikzDevFooter">
      <div className="vBFooterLinks">
        <a href="https://tikz.dev/license">License</a>
        <span aria-hidden="true">·</span>
        <a href="https://github.com/DominikPeters/tikz-editor">GitHub</a>
        <span aria-hidden="true">·</span>
        <a href="https://github.com/DominikPeters/tikz-editor/issues">Feedback and issues</a>
        <span aria-hidden="true">·</span>
        <a href="https://tikz.dev">PGF/<span className="vBTikzName">TikZ</span> Manual</a>
      </div>
      <div className="vBFooterMeta"><em>TikZ Editor for tikz.dev/editor</em></div>
    </footer>
  );
}

function Hero() {
  const desktopPlatform = getDesktopPlatform();
  const DesktopDownloadIcon = desktopPlatform === "windows" ? RiWindowsFill : RiAppleFill;
  const desktopDownloadLabel = desktopPlatform === "windows" ? "Download for Windows" : "Download for Mac";

  return (
    <section className="vBHero" aria-labelledby="landing-title">
      <div className="vBHeroCopy">
        <h1 id="landing-title">TikZ Editor</h1>
        <p className="vBHeroLead">A visual workspace for precise TikZ diagrams.</p>
        <p className="vBHeroText">
          Edit the source, shape the drawing directly, and keep both views in sync.
        </p>
        <div className="vBHeroActions" aria-label="Landing page links">
          <a href="https://tikz.dev/editor/web" className="vBPrimaryLink">
            <RiExternalLinkLine className="vBCtaIcon" aria-hidden="true" size={17} />
            <span className="vBCtaLabel">Open TikZ Editor Web</span>
          </a>
          <a href="https://github.com/DominikPeters/tikz-editor/releases" className="vBDownloadLink">
            <span className="vBDownloadIcons" aria-hidden="true">
              <DesktopDownloadIcon className="vBCtaIcon" size={17} />
            </span>
            <span className="vBCtaLabel">{desktopDownloadLabel}</span>
            <span className="vBDownloadSize">8.8 MB</span>
          </a>
        </div>
      </div>
      <figure className="vBHeroScreenshot" aria-label="TikZ Editor interface screenshot">
        <img src={appScreenshotUrl} alt="TikZ Editor interface with source, canvas, and inspector" />
      </figure>
    </section>
  );
}

function getDesktopPlatform(): "mac" | "windows" {
  if (typeof navigator === "undefined") {
    return "mac";
  }

  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    "";
  const userAgent = navigator.userAgent ?? "";
  const platformText = `${platform} ${userAgent}`;

  return /win/i.test(platformText) ? "windows" : "mac";
}

function EditorStory() {
  return (
    <>
      <section className="vBEditorStory" aria-label="TikZ Editor feature walkthrough">
        <SyncedDemo
          title="Drag a node and the TikZ changes."
          body="These are the Version A animation components reused directly. Their source previews are still synchronized with the fake cursor timeline, but Version B lays that code in the left rail and the drawing on the right."
        >
          <NodeMoveCard />
        </SyncedDemo>

        <SyncedDemo
          title="Shape tools write the corresponding TikZ."
          body="The rectangle tool demonstrates the main rhythm for the page: code appears on the left exactly when it matters, while the right side stays focused on the direct manipulation."
        >
          <AddRectCard />
        </SyncedDemo>

        <EditorRow
          code={<CodePanel title="workflow.tex" lines={foldingLines} variant="editor" />}
          title="Large diagrams stay navigable."
          body="Folding can collapse styles, repeated graph sections, or local helper scopes, so the source pane stays useful even when the diagram grows."
        />

        <EditorRow
          code={<CodePanel title="tooltip-hover.tex" lines={tooltipLines} overlay={<DocsTooltipMock />} variant="editor" />}
          title="Documentation can live next to the code."
          body="The hover target stays in the source editor, and the documentation popover uses the same structure and styling as the real CodeMirror docs tooltip."
        />

        <SyncedDemo
          title="Layout tools understand the drawing."
          body="The cursor motion, guides, and source update are still driven by the Version A GSAP timeline. Version B only changes where the source and scene sit on the page."
        >
          <SnapGuidesCard />
        </SyncedDemo>

        <SyncedDemo
          title="Paths attach to semantic points."
          body="The same split can introduce arrows, anchors, alignment, and multi-selection tools without switching away from the code-and-canvas metaphor."
        >
          <AddArrowCard />
        </SyncedDemo>

        <SyncedDemo
          title="Repeated edits stay visual."
          body="Alignment and distribution make sense visually, while the source rail keeps the generated TikZ patch legible."
        >
          <SelectionAlignCard />
        </SyncedDemo>
      </section>
      <PaperFileSection />
    </>
  );
}

function PaperFileSection() {
  return (
    <section className="vBPaperSection" aria-labelledby="paper-workflow-title">
      <div className="vBPaperSectionInner">
        <div className="vBPaperCopy">
          <h2 id="paper-workflow-title">Edit every figure in a paper.</h2>
          <p>
            Open a full <code>.tex</code> paper file and directly edit each figure in context. Figure previews
            at the bottom of the app make it easy to switch between the different <code>tikzpicture</code>
            environments in your paper.
          </p>
        </div>
        <figure className="vBPaperScreenshot">
          <img src={multiFigureUrl} alt="TikZ Editor showing a multi-figure TeX paper with figure previews" />
        </figure>
      </div>
    </section>
  );
}

function EditorRow({
  code,
  title,
  body,
  children
}: {
  code: ReactNode;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <article className="vBEditorRow">
      <div className="vBCodeRail">{code}</div>
      <div className="vBFeatureColumn">
        <div className="vBFeatureCopy">
          <h2>{title}</h2>
          <p>{body}</p>
        </div>
        {children ? <div className="vBFeatureVisual">{children}</div> : null}
      </div>
    </article>
  );
}

function SyncedDemo({
  title,
  body,
  children
}: {
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <article className="vBEditorRow vBSyncedRow">
      <div className="vBCodeRail vBCodeRailEmpty" aria-hidden="true" />
      <div className="vBFeatureColumn vBDemoCopy">
        <div className="vBFeatureCopy">
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

function Tok({ kind, children }: { kind: "keyword" | "type" | "string" | "number" | "punctuation" | "comment" | "meta"; children: ReactNode }) {
  return <span className={`vBTok vBTok-${kind}`}>{children}</span>;
}

function line(id: string, number: string, content: ReactNode, active = false, folded = false, foldControl?: "open" | "closed"): CodeLine {
  return { id, number, content, active, folded, foldControl };
}
