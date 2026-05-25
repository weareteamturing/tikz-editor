import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import {
  RiAppleFill,
  RiCheckLine,
  RiCodeLine,
  RiEdit2Line,
  RiExternalLinkLine,
  RiFileListLine,
  RiGithubFill,
  RiNodeTree,
  RiRobot2Line,
  RiSideBarLine,
  RiSlideshowLine,
  RiWindowsFill
} from "@remixicon/react";
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
    description: "Move, resize, and rotate objects, edit paths, and multi-select to edit multiple elements at once."
  },
  magnify: {
    description: <>A virtual magnifying glass to look at details in the figure, similar to <a href='https://www.texstudio.org/'>TeXstudio</a>.</>
  },
  addNode: {
    description: <>Add text to the figure using a TikZ <code>\node</code>.</>
  },
  addShape: {
    description: "Add a node using the shape library. Can add text. Examples: diamonds, polygons, stars, clouds, arrows."
  },
  addMatrix: {
    description: "Insert a matrix of nodes with a chosen number of rows and columns."
  },
  addLine: {
    description: <>Draw a straight TikZ <code>\draw</code> path.</>
  },
  addArrow: {
    description: <>Draw a straight TikZ <code>\draw[-&gt;]</code> arrow.</>
  },
  addBezier: {
    description: "Draw a curved path between two points."
  },
  addPath: {
    description: "Build multi-segment paths with straight and curved parts."
  },
  addFreehand: {
    description: "Draw a freehand path with smoothing."
  },
  addGrid: {
    description: "Draw a grid path."
  },
  addRect: {
    name: "Rectangle",
    description: "Draw a rectangle path."
  },
  addEllipse: {
    description: "Draw an ellipse path."
  },
  addCircle: {
    description: "Draw a circle path."
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

const FEATURE_GROUPS = [
  {
    title: "Files and export",
    icon: RiFileListLine,
    items: [
      <>Open and edit <code>.tex</code> and <code>.tikz</code> files.</>,
      <>Import figures from SVG, Ipe <code>.ipe</code>, and PowerPoint <code>.pptx</code>.</>,
      <>Export to SVG, PNG, PDF, or standalone LaTeX.</>,
      "Work across multiple open documents with tabs."
    ]
  },
  {
    title: "Papers and figures",
    icon: RiSlideshowLine,
    items: [
      "Open a full paper with multiple figures, and navigate between figures using thumbnail previews.",
      "Draw nodes, shapes, matrices, arrows, paths, curves, grids, rectangles, ellipses, and circles.",
      "Edit text and equations directly in the figure."
    ]
  },
  {
    title: "Direct editing",
    icon: RiEdit2Line,
    items: [
      "Move, resize, rotate, duplicate, group, align, distribute, flip, and reorder objects.",
      "Edit paths with point handles, split/join, reverse, open/close, corner, and smooth point commands.",
      "Use snapping to grids, guides, object points, and object gaps."
    ]
  },
  {
    title: "Loops and structures",
    icon: RiNodeTree,
    items: [
      <>Use the Repeat dialog to add a <code>\foreach</code> loop, copying the selection into multiple rows and columns.</>,
      <>Open and edit figures that already use <code>\foreach</code>, including nested loops.</>,
      "Add labels and pins to nodes.",
      "Edit tree diagrams by adding children and edit matrices with row/column and transpose commands."
    ]
  },
  {
    title: "Panels",
    icon: RiSideBarLine,
    items: [
      "Inspect and edit stroke, fill, arrows, text, transforms, shapes, and styling in the Inspector.",
      "Manage object visibility, grouping, renaming, and layer order in the Objects panel.",
      "Edit TikZ styles in the Styles panel, similar to CSS editing in browser devtools."
    ]
  },
  {
    title: "Source and assistant",
    icon: RiCodeLine,
    items: [
      "Use the source editor with syntax highlighting, autocomplete, folding, search, diagnostics, inline color swatches.",
      "Auto-format your code (fixing indentation).",
      "On desktop, ask the Codex assistant to help edit figures, including with image attachments."
    ],
    secondaryIcon: RiRobot2Line
  }
] as const;

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
        <p className="vBHeroLead">WYSIWYG editor for TikZ diagrams in LaTeX</p>
        <p className="vBHeroText">
          You can start from scratch or edit an existing TikZ figure, or even directly open your paper tex file to edit its images. The TikZ code gets instantly updated as you move around elements, without disturbing existing formatting such as line breaks and spaces.
        </p>
        <p className="vBHeroText">
          The app makes fine-tuning the positions of elements easy and instant, without needing to recompile. It supports all common TikZ features including \foreach loops.
        </p>
        <p className="vBHeroText">
          The app is free and open source (MIT licensed, code on <a href="https://github.com/DominikPeters/tikz-editor">GitHub</a>). It works on the web or as a lightweight desktop app (&lt; 10MB) with some extra features.
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
          title="Drag elements to update or finetune locations"
          body="Instead of manually changing code coordinates, you can now just drag paths or nodes to where you want them, and the code updates instantly."
        >
          <NodeMoveCard sceneViewBox={VERSION_B_DEMO_VIEW_BOXES.nodeMove} />
        </SyncedDemo>

        <SyncedDemo
          title="Add new elements to figures"
          body="Tools are provided to add new paths (lines, arrows, multi-segment paths) as well as nodes, rectangles, and circles. New elements get inserted at the end of your code. And of course you can immediately move or resize those elements."
        >
          <AddRectCard sceneViewBox={VERSION_B_DEMO_VIEW_BOXES.addRect} />
        </SyncedDemo>

        <EditorRow
          code={<CodePanel title="tooltip-hover.tex" lines={tooltipLines} overlay={<DocsTooltipMock />} variant="editor" />}
          title="Full-features source editor tailored to TikZ"
          body=<>The source panel always shows the current source. It has syntax highlighting for TikZ, allows code folding to hide the details of a scope, and shows snippets from the TikZ manual on hover. 
          <br/><br/> 
          It highlights errors with clear explanations of what's wrong (which is possible because the app does not use a tex compiler to understand your code). 
          <br/><br/>
          You can also edit colors and numbers directly in the source view without typing, using a color picker and number scrubbing.</>
        />

        <SyncedDemo
          title="Many convenience features are provided"
          body="The app supports snapping which easily allows you to align elements vertically or horizontally, and make sure they are spaced at equal distances. It also features rulers and customizable guide lines, as well as zoom and a magnifying glass tool."
        >
          <SnapGuidesCard sceneViewBox={VERSION_B_DEMO_VIEW_BOXES.snapGuides} />
        </SyncedDemo>

        <SyncedDemo
          title="Native support for common TikZ features"
          body="The app allows you to produce idiomatic TikZ figures. For example, paths can easily be drawn so they attach to node anchors. The app also has support for editing node labels and pins, as well as edge labels."
        >
          <AddArrowCard sceneViewBox={VERSION_B_DEMO_VIEW_BOXES.addArrow} />
        </SyncedDemo>

        <SyncedDemo
          title="Multi-selection for grouping and aligning"
          body="You can select multiple objects and group them (implement using TikZ scopes) as well as use layout features including align and distribute."
        >
          <SelectionAlignCard />
        </SyncedDemo>
      </section>
      <PaperFileSection />
      <AiAssistSection />
      <ToolCatalogSection />
      <FeatureChecklistSection />
    </>
  );
}

function PaperFileSection() {
  return (
    <section className="vBPaperSection" aria-labelledby="paper-workflow-title">
      <div className="vBPaperSectionInner">
        <div className="vBPaperCopy">
          <h2 id="paper-workflow-title">Multi-figure support so you can open the full paper</h2>
          <p>
            Open a full <code>.tex</code> paper file and directly edit its figures. Figure previews
            at the bottom of the app make it easy to switch between the different <code>tikzpicture</code>
            environments in your paper. The app understands many of your custom macros.
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
          <h2 id="ai-workflow-title">Ask AI for help editing your figures</h2>
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
          <h2 id="tool-catalog-title">Available tools</h2>
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

function FeatureChecklistSection() {
  return (
    <section className="vBFeatureChecklist" aria-labelledby="feature-checklist-title">
      <div className="vBFeatureChecklistInner">
        <div className="vBFeatureChecklistIntro">
          <h2 id="feature-checklist-title">List of editor features</h2>
        </div>
        <div className="vBFeatureGroups">
          {FEATURE_GROUPS.map((group) => {
            const GroupIcon = group.icon;
            const SecondaryIcon = "secondaryIcon" in group ? group.secondaryIcon : null;
            return (
              <article className="vBFeatureGroup" key={group.title}>
                <h3>
                  <span className="vBFeatureGroupIcon" aria-hidden="true">
                    <GroupIcon size={17} />
                    {SecondaryIcon ? <SecondaryIcon className="vBFeatureGroupSecondaryIcon" size={13} /> : null}
                  </span>
                  <span>{group.title}</span>
                </h3>
                <ul>
                  {group.items.map((item, index) => (
                    <li key={index}>
                      <RiCheckLine aria-hidden="true" size={14} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
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
