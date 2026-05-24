import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import { RiAppleFill, RiExternalLinkLine, RiGithubFill, RiWindowsFill } from "@remixicon/react";
import { TOOL_BUTTONS } from "@tikz-editor/app/landing-assets";
import appScreenshotUrl from "../../../background-materials/app-screenshot.png";
import codexScreenshotUrl from "../../../background-materials/codex.png";
import multiFigureUrl from "../../../background-materials/multi-figure.png";
import { AddArrowCard } from "../../feature-demos/cards/AddArrowCard";
import { AddRectCard } from "../../feature-demos/cards/AddRectCard";
import { NodeMoveCard } from "../../feature-demos/cards/NodeMoveCard";
import { SelectionAlignCard } from "../../feature-demos/cards/SelectionAlignCard";
import { SnapGuidesCard } from "../../feature-demos/cards/SnapGuidesCard";
import { VERSION_B_TOOL_SVGS } from "./generated/tool-svgs";

type CodeLine = {
  id: string;
  number: string;
  content: ReactNode;
  active?: boolean;
  folded?: boolean;
  foldControl?: "open" | "closed";
};

type ToolPreviewMode = keyof typeof VERSION_B_TOOL_SVGS;
type MagnifyCenter = {
  x: number;
  y: number;
  frameWidth: number;
  frameHeight: number;
};

const MAGNIFY_REST_VIEW_BOX = {
  minX: -62.345,
  minY: -22.3934,
  width: 130.9992,
  height: 43.3935
};

const MAGNIFY_REST_POINT = {
  x: -31.8671,
  y: -6.2596
};

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

const TOOL_COPY: Record<ToolPreviewMode, { name?: string; description: string }> = {
  select: {
    description: "Move objects, resize bounds, rotate selections, and edit path handles."
  },
  magnify: {
    description: "Drag over the canvas to zoom into the part of a diagram you are working on."
  },
  addNode: {
    description: "Click to place text as a TikZ node at a precise point."
  },
  addShape: {
    description: "Drag preset node shapes, including TikZ shape-library forms."
  },
  addMatrix: {
    description: "Insert a matrix of nodes with the chosen row and column count."
  },
  addLine: {
    description: "Drag a straight TikZ draw segment between two points."
  },
  addArrow: {
    description: "Drag a directed path with the same arrow syntax the source uses."
  },
  addBezier: {
    description: "Place endpoints first, then bend the curve with control handles."
  },
  addPath: {
    description: "Build multi-segment paths with straight and curved parts."
  },
  addFreehand: {
    description: "Draw a smoothed freehand path from pointer movement."
  },
  addGrid: {
    description: "Drag out TikZ grid lines with the selected x and y step."
  },
  addRect: {
    name: "Rectangle",
    description: "Create a rectangular path by dragging corner to corner."
  },
  addEllipse: {
    description: "Create an ellipse with independent horizontal and vertical radii."
  },
  addCircle: {
    description: "Drag from the center to set a circle radius."
  },
  addBucket: {
    description: "Apply a fill color to an existing closed region."
  }
};

const TOOL_CATALOG = TOOL_BUTTONS.map((button) => {
  const mode = button.mode as ToolPreviewMode;
  return {
    ...button,
    name: TOOL_COPY[mode].name ?? button.label,
    description: TOOL_COPY[mode].description,
    preview: VERSION_B_TOOL_SVGS[mode]
  };
});

const VERSION_B_DEMO_VIEW_BOXES = {
  nodeMove: "-51.215 -34.1433 130.8827 56",
  addRect: "-62.5961 -34 147.9543 53",
  snapGuides: "-82 -39 164 78",
  addArrow: "-68.2866 -27 156.4902 53"
} as const;

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
          body="The source preview stays synchronized with the cursor timeline, so the code changes exactly where the visual edit happens."
        >
          <NodeMoveCard sceneViewBox={VERSION_B_DEMO_VIEW_BOXES.nodeMove} />
        </SyncedDemo>

        <SyncedDemo
          title="Shape tools write the corresponding TikZ."
          body="The rectangle tool demonstrates the main rhythm for the page: code appears on the left exactly when it matters, while the right side stays focused on the direct manipulation."
        >
          <AddRectCard sceneViewBox={VERSION_B_DEMO_VIEW_BOXES.addRect} />
        </SyncedDemo>

        <EditorRow
          code={<CodePanel title="tooltip-hover.tex" lines={tooltipLines} overlay={<DocsTooltipMock />} variant="editor" />}
          title="Documentation can live next to the code."
          body="The hover target stays in the source editor, and the documentation popover uses the same structure and styling as the real CodeMirror docs tooltip."
        />

        <SyncedDemo
          title="Layout tools understand the drawing."
          body="The cursor motion, guides, and source update stay connected while the layout tool snaps one object to another."
        >
          <SnapGuidesCard sceneViewBox={VERSION_B_DEMO_VIEW_BOXES.snapGuides} />
        </SyncedDemo>

        <SyncedDemo
          title="Paths attach to semantic points."
          body="The same split can introduce arrows, anchors, alignment, and multi-selection tools without switching away from the code-and-canvas metaphor."
        >
          <AddArrowCard sceneViewBox={VERSION_B_DEMO_VIEW_BOXES.addArrow} />
        </SyncedDemo>

        <SyncedDemo
          title="Repeated edits stay visual."
          body="Alignment and distribution make sense visually, while the source rail keeps the generated TikZ patch legible."
        >
          <SelectionAlignCard />
        </SyncedDemo>
      </section>
      <PaperFileSection />
      <AiAssistSection />
      <ToolCatalogSection />
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

function AiAssistSection() {
  return (
    <section className="vBPaperSection vBAiSection" aria-labelledby="ai-workflow-title">
      <div className="vBPaperSectionInner">
        <div className="vBPaperCopy">
          <h2 id="ai-workflow-title">Ask AI for help editing your figures.</h2>
          <p>
            On the desktop version, if OpenAI Codex is installed, you can ask GPT to edit your figure directly
            in the app. The assistant has access to several TikZ-specific tools. Usage draws from your ChatGPT
            account.
          </p>
        </div>
        <figure className="vBPaperScreenshot">
          <img src={codexScreenshotUrl} alt="TikZ Editor desktop assistant editing a figure with Codex" />
        </figure>
      </div>
    </section>
  );
}

function ToolCatalogSection() {
  return (
    <section className="vBToolCatalog" aria-labelledby="tool-catalog-title">
      <div className="vBToolCatalogInner">
        <div className="vBToolCatalogIntro">
          <h2 id="tool-catalog-title">Available tools.</h2>
          <p>
            The toolbar covers direct manipulation and drawing tools, with previews generated from the same TikZ
            renderer used by the editor canvas.
          </p>
        </div>
        <div className="vBToolRows">
          {TOOL_CATALOG.map((tool) => {
            const ToolIcon = tool.icon;
            return (
              <article className="vBToolRow" key={tool.mode}>
                <div className="vBToolIcon" aria-hidden="true">
                  <ToolIcon size={22} />
                </div>
                <div className="vBToolDescription">
                  <h3>{tool.name}</h3>
                  <p>{tool.description}</p>
                </div>
                {tool.mode === "magnify" ? (
                  <MagnifyToolPreview svg={tool.preview.svg} label={`${tool.name} example`} />
                ) : (
                  <div className="vBToolExample" data-tool-mode={tool.mode} aria-label={`${tool.name} example`}>
                    <div className="vBToolPreviewSvg" dangerouslySetInnerHTML={{ __html: tool.preview.svg }} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function MagnifyToolPreview({ svg, label }: { svg: string; label: string }) {
  const lensRadiusPx = 46;
  const magnifyScale = 2.25;
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [center, setCenter] = useState<MagnifyCenter>({
    x: 0,
    y: 0,
    frameWidth: 0,
    frameHeight: 0
  });
  const style = {
    "--vBMagnifyX": `${center.x}px`,
    "--vBMagnifyY": `${center.y}px`,
    "--vBMagnifyFrameWidth": `${center.frameWidth}px`,
    "--vBMagnifyFrameHeight": `${center.frameHeight}px`,
    "--vBMagnifyContentX": `${lensRadiusPx - center.x * magnifyScale}px`,
    "--vBMagnifyContentY": `${lensRadiusPx - center.y * magnifyScale}px`,
    "--vBMagnifyScale": magnifyScale
  } as CSSProperties;

  const setCenterFromFrame = useCallback((xPx: number, yPx: number, frameWidth: number, frameHeight: number): void => {
    setCenter({
      x: xPx,
      y: yPx,
      frameWidth,
      frameHeight
    });
  }, []);

  const resetCenter = useCallback((): void => {
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const viewBoxAspect = MAGNIFY_REST_VIEW_BOX.width / MAGNIFY_REST_VIEW_BOX.height;
    const frameAspect = rect.width / rect.height;
    const fittedWidth = frameAspect > viewBoxAspect ? rect.height * viewBoxAspect : rect.width;
    const fittedHeight = frameAspect > viewBoxAspect ? rect.height : rect.width / viewBoxAspect;
    const fittedLeft = (rect.width - fittedWidth) / 2;
    const fittedTop = (rect.height - fittedHeight) / 2;
    const xRatio = (MAGNIFY_REST_POINT.x - MAGNIFY_REST_VIEW_BOX.minX) / MAGNIFY_REST_VIEW_BOX.width;
    const yRatio = (MAGNIFY_REST_POINT.y - MAGNIFY_REST_VIEW_BOX.minY) / MAGNIFY_REST_VIEW_BOX.height;
    setCenterFromFrame(fittedLeft + xRatio * fittedWidth, fittedTop + yRatio * fittedHeight, rect.width, rect.height);
  }, [setCenterFromFrame]);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) {
      return;
    }
    resetCenter();

    const observer = new ResizeObserver(resetCenter);
    observer.observe(preview);
    return () => {
      observer.disconnect();
    };
  }, [resetCenter]);

  const updateCenter = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const xPx = event.clientX - rect.left;
    const yPx = event.clientY - rect.top;
    if (xPx < 0 || xPx > rect.width || yPx < 0 || yPx > rect.height) {
      setIsActive(false);
      resetCenter();
      return;
    }
    setIsActive(true);
    setCenterFromFrame(xPx, yPx, rect.width, rect.height);
  };

  return (
    <div
      className="vBToolExample vBMagnifyToolExample"
      data-tool-mode="magnify"
      data-magnify-active={isActive ? "true" : "false"}
      aria-label={label}
      style={style}
      onPointerMove={updateCenter}
    >
      <div
        ref={previewRef}
        className="vBToolPreviewSvg"
        dangerouslySetInnerHTML={{ __html: svg }}
        onPointerEnter={updateCenter}
        onPointerMove={updateCenter}
        onPointerLeave={() => {
          setIsActive(false);
          resetCenter();
        }}
      />
      <div className="vBMagnifyOverlayFrame" aria-hidden="true">
        <div className="vBMagnifyLensLayer">
          <div className="vBMagnifyLensSvg" dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
        <div className="vBMagnifyLensRing" />
      </div>
    </div>
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
