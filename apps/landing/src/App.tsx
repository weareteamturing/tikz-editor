import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import gsap from "gsap";
import {
  BASIC_PICKER_COLORS,
  ColorPicker,
  GENERATED_OPEN_EXAMPLE_PREVIEWS,
  OPEN_EXAMPLE_CATALOG,
  cssColorForToken
} from "@tikz-editor/app/landing-assets";
import appScreenshotUrl from "../background-materials/app-screenshot.png";
import { NodeMoveCard } from "./cards/NodeMoveCard";
import { AddArrowCard } from "./cards/AddArrowCard";
import { AddRectCard } from "./cards/AddRectCard";
import { SnapGuidesCard } from "./cards/SnapGuidesCard";
import { SelectionAlignCard } from "./cards/SelectionAlignCard";
import { RotateNodeCard } from "./cards/RotateNodeCard";
import { applyCursorOverlayFrame, CursorOverlay, type CursorStyle } from "./cursor-overlay";
import { createCursorScript, type CursorFrame } from "./cursor-script";
import { mountRenderedScene, wrapRenderedElements } from "./animation/rendered-scene";
import { applyLinePathEndpoints, prepareTransformDrivenLinePath, setSvgAttrs } from "./animation/svg-actors";
import {
  formatTikzNumber,
  renderSourcePreview,
  SourcePreview,
  sourceKeyword,
  sourceLine,
  sourceNumber,
  sourcePunctuation,
  sourceString,
  sourceText,
  type SourceLine
} from "./source-preview";
import { useDemoTimelinePlayback } from "./use-demo-playback";
import { landingShowcaseSvgs, sourceEditStates, type ForeachRepeatShowcaseSvg, type SourceEditState } from "./generated/feature-svgs";

const EXAMPLE_IDS = [
  "axes",
  "flowchart",
  "graph",
  "tree",
  "automaton",
  "commutative-diagram",
  "venn",
  "geometry"
] as const;

const CAPABILITIES = [
  "Nodes",
  "Paths",
  "Arrows",
  "Anchors",
  "Styles",
  "Matrices",
  "Trees",
  "Foreach loops",
  "Plots",
  "Fills",
  "Opacity",
  "Transforms",
  "Math text",
  "SVG export",
  "PDF export",
  "PNG export"
];

export function App() {
  return (
    <main className="landingPage">
      <Hero />
      <SourceScrubSection />
      <CanvasEditSection />
      <ExamplesGallery />
      <LayoutToolsSection />
      <ShapeShowcase />
      <InspectorColorSection />
      <ForeachRepeatSection />
      <CapabilityClose />
    </main>
  );
}

function Hero() {
  return (
    <section className="heroSection">
      <div className="heroCopy">
        <p className="eyebrow">TikZ Editor</p>
        <h1>TikZ Editor</h1>
        <p className="heroLead">A visual editor for TikZ diagrams.</p>
        <p className="heroText">
          Move nodes, draw paths, adjust styles, and edit the TikZ source in the same workspace.
        </p>
        <div className="heroActions" aria-label="Landing page links">
          <a href="/" className="textLink">Open app</a>
          <a href="https://github.com/DominikPeters/tikz-editor" className="textLink">GitHub</a>
          <a href="#capabilities" className="textLink">Download</a>
        </div>
      </div>
      <figure className="heroScreenshotFrame">
        <img src={appScreenshotUrl} alt="TikZ Editor interface with source, canvas, and inspector" />
      </figure>
    </section>
  );
}

function SourceScrubSection() {
  return (
    <StoryStrip
      eyebrow="Source edit -> canvas update"
      title="Edit the source directly."
      body="Coordinates, lengths, angles, colors, and options update the diagram as you edit. Number scrubbing makes small geometric changes feel direct."
      visual={<SourceEditDemo />}
    />
  );
}

function CanvasEditSection() {
  return (
    <section className="storyBlock editStoryBlock">
      <div className="storyBlockHeader storyBlockHeaderRight">
        <p className="eyebrow">Canvas edit {"->"} source patch</p>
        <h2>Work on the drawing.</h2>
        <p>
          Drag a node, resize a shape, or rotate a label. The TikZ source changes with the edit.
        </p>
      </div>
      <div className="editStorySlices">
        <article className="storySlice storySliceNodeMove">
          <div className="storySliceText">
            <h3>Move a node.</h3>
            <p>The edge follows the node, and the coordinate in the source updates while it moves.</p>
          </div>
          <div className="storyAnimation storyAnimationLarge">
            <NodeMoveCard />
          </div>
        </article>
        <article className="storySlice storySliceRectangle">
          <div className="storySliceText">
            <h3>Draw and resize a shape.</h3>
            <p>Create the rectangle on the canvas, then pull a handle to adjust the TikZ dimensions.</p>
          </div>
          <div className="storyAnimation">
            <AddRectCard />
          </div>
        </article>
        <article className="storySlice storySliceRotate">
          <div className="storySliceText">
            <h3>Rotate a label.</h3>
            <p>The transform is represented as a normal TikZ option.</p>
          </div>
          <div className="storyAnimation">
            <RotateNodeCard />
          </div>
        </article>
      </div>
    </section>
  );
}

function ExamplesGallery() {
  const examples = EXAMPLE_IDS.map((id) => ({
    id,
    title: OPEN_EXAMPLE_CATALOG.find((example) => example.id === id)?.title ?? id,
    preview: GENERATED_OPEN_EXAMPLE_PREVIEWS[id]?.svg ?? null
  }));

  return (
    <section className="gallerySection" id="examples">
      <div className="galleryHeader">
        <p className="eyebrow">Open examples</p>
        <h2>Open real diagrams.</h2>
        <p>
          The built-in examples cover common TikZ work: graphs, trees, automata, commutative diagrams,
          geometry, plots, and flow diagrams.
        </p>
      </div>
      <div className="exampleGrid">
        {examples.map((example) => (
          <article className="exampleTile" key={example.id}>
            <div
              className="examplePreview"
              dangerouslySetInnerHTML={example.preview ? { __html: example.preview } : undefined}
            />
            <h3>{example.title}</h3>
          </article>
        ))}
      </div>
    </section>
  );
}

function LayoutToolsSection() {
  return (
    <section className="storyBlock layoutStoryBlock">
      <div className="storyBlockHeader">
        <p className="eyebrow">Anchors, snapping, alignment</p>
        <h2>Layout tools understand nodes.</h2>
        <p>
          Arrows attach to anchors. Dragging shows snap guides. Multi-selection alignment updates every
          selected node and the connected paths.
        </p>
      </div>
      <div className="layoutStorySlices">
        <article className="storySlice storySliceAnchors">
          <div className="storySliceText">
            <h3>Attach arrows to anchors.</h3>
            <p>Anchor dots appear on the node you are targeting, and the generated path uses those anchors.</p>
          </div>
          <div className="storyAnimation">
            <AddArrowCard />
          </div>
        </article>
        <article className="storySlice storySliceSnap">
          <div className="storySliceText">
            <h3>Snap into place.</h3>
            <p>Guides appear as objects line up, while the source keeps the final coordinate.</p>
          </div>
          <div className="storyAnimation">
            <SnapGuidesCard />
          </div>
        </article>
        <article className="storySlice storySliceAlign">
          <div className="storySliceText">
            <h3>Align a selection.</h3>
            <p>Select several nodes, use the alignment toolbar, and keep the connected paths intact.</p>
          </div>
          <div className="storyAnimation storyAnimationWide">
            <SelectionAlignCard />
          </div>
        </article>
      </div>
    </section>
  );
}

function ShapeShowcase() {
  return (
    <section className="showcaseSection">
      <div className="galleryHeader">
        <p className="eyebrow">Shapes and paths</p>
        <h2>Draw with TikZ vocabulary.</h2>
        <p>Shapes, paths, arrows, fills, labels, and math text render as TikZ objects.</p>
      </div>
      <div className="shapeShowcaseGrid">
        {["shapes", "paths", "styles", "matrix"].map((id) => (
          <RenderedShowcaseCard key={id} id={id} />
        ))}
      </div>
    </section>
  );
}

function InspectorColorSection() {
  const [fillColor, setFillColor] = useState("green!15");
  const [strokeColor, setStrokeColor] = useState("blue!30");
  const fillCss = cssColorForToken(fillColor) ?? "#d9f99d";
  const strokeCss = cssColorForToken(strokeColor) ?? "#93c5fd";

  return (
    <StoryStrip
      eyebrow="Inspector and color"
      title="Adjust styles from the inspector."
      body="Change fills, strokes, shapes, text layout, sizes, and transforms. The color picker works with xcolor expressions such as blue!30."
      visual={
        <div className="inspectorColorMock">
          <div className="inspectorCanvasPane">
            <svg viewBox="0 0 360 210" role="img" aria-label="Selected TikZ node styled by the inspector">
              <path d="M64 106 C108 40 222 40 292 102" fill="none" stroke="#111827" strokeWidth="1.2" />
              <path d="M292 102 L283 98 L286 104 Z" fill="#111827" />
              <rect x="86" y="70" width="118" height="52" rx="7" fill={fillCss} stroke={strokeCss} strokeWidth="2" />
              <text x="145" y="103" textAnchor="middle" fontFamily="serif" fontSize="22">Start</text>
              <rect className="selectionBox" x="82" y="66" width="126" height="60" rx="3" />
              {[
                [82, 66],
                [145, 66],
                [208, 66],
                [208, 96],
                [208, 126],
                [145, 126],
                [82, 126],
                [82, 96]
              ].map(([x, y]) => <rect className="selectionHandle" x={x - 4} y={y - 4} width="8" height="8" rx="1.5" key={`${x}-${y}`} />)}
              <rect x="242" y="82" width="72" height="40" rx="5" fill="#f8fafc" stroke="#111827" />
              <text x="278" y="108" textAnchor="middle" fontFamily="serif" fontSize="18">End</text>
            </svg>
          </div>
          <div className="inspectorPanelMock">
            <div className="panelTitle">Inspector</div>
            <div className="inspectorProperty inspectorPropertyActive">
              <span>Fill</span>
              <div className="inspectorValueTrigger">
                <span className="inspectorSwatch" style={{ background: fillCss }} aria-hidden="true" />
                <input value={fillColor} onChange={(event) => setFillColor(event.target.value)} />
              </div>
              <div className="inspectorPopover">
                <ColorPicker
                  ariaLabel="Landing page fill color"
                  options={BASIC_PICKER_COLORS}
                  value={fillColor}
                  syntaxValue={fillColor}
                  namedColorSwatches={[
                    { token: "brandgreen", cssColor: "#4ade80" },
                    { token: "paperblue", cssColor: "#93c5fd" }
                  ]}
                  onChange={setFillColor}
                />
              </div>
            </div>
            <label className="inspectorProperty">
              <span>Stroke</span>
              <div className="inspectorValueTrigger">
                <span className="inspectorSwatch" style={{ background: strokeCss }} aria-hidden="true" />
                <input value={strokeColor} onChange={(event) => setStrokeColor(event.target.value)} />
              </div>
            </label>
            <label className="inspectorProperty">
              <span>Shape</span>
              <select value="rounded rectangle" onChange={() => undefined}>
                <option>rounded rectangle</option>
              </select>
            </label>
            <label className="inspectorProperty">
              <span>Minimum width</span>
              <input value="2.8 cm" onChange={() => undefined} />
            </label>
          </div>
        </div>
      }
    />
  );
}

function ForeachRepeatSection() {
  return (
    <section className="wideSection foreachSection">
      <div className="sectionText">
        <p className="eyebrow">Foreach and repeat</p>
        <h2>Use foreach.</h2>
        <p>
          Foreach loops render as diagram items. The repeat dialog creates new repeated structures
          with a live preview.
        </p>
      </div>
      <ForeachRepeatDemo />
    </section>
  );
}

function CapabilityClose() {
  return (
    <section className="capabilitySection" id="capabilities">
      <div className="pipeline">
        <span>TikZ source</span>
        <span>parser</span>
        <span>semantic scene</span>
        <span>SVG renderer</span>
        <span>visual editing</span>
      </div>
      <div>
        <p className="eyebrow">Built for TikZ diagrams</p>
        <h2>Nodes, paths, arrows, anchors, styles, matrices, trees, foreach loops, plots, fills, opacity, transforms, math text, SVG export, PDF export, and PNG export.</h2>
        <div className="capabilityList">
          {CAPABILITIES.map((item) => <span key={item}>{item}</span>)}
        </div>
      </div>
    </section>
  );
}

type StoryStripProps = {
  eyebrow: string;
  title: string;
  body: string;
  visual: ReactNode;
};

function StoryStrip({ eyebrow, title, body, visual }: StoryStripProps) {
  return (
    <section className="wideSection">
      <div className="sectionText">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
      <div className="stripVisual">{visual}</div>
    </section>
  );
}

function SourceEditDemo() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  useDemoTimelinePlayback(rootRef, timelineRef);
  const contentGroupRef = useRef<SVGGElement | null>(null);
  const sceneElementsRef = useRef<SourceEditSceneElements | null>(null);
  const cursorOverlayRef = useRef<SVGGElement | null>(null);
  const sourceWrapRef = useRef<HTMLDivElement | null>(null);
  const sourcePreviewRef = useRef<HTMLElement | null>(null);
  const sourceStateRef = useRef({ x: sourceEditStates.initial.sourceX, label: sourceEditStates.initial.label });
  const lastSourceKeyRef = useRef<string | null>(null);
  const cursorStateRef = useRef<CursorFrame>({
    x: 98,
    y: 52,
    visible: true,
    pressed: false,
    cursor: "pointer"
  });
  const [cursorFrame, setCursorFrame] = useState<CursorFrame>({ ...cursorStateRef.current });
  const [numberChanging, setNumberChanging] = useState(false);
  const [sourceLayerSize, setSourceLayerSize] = useState({ width: 360, height: 96 });
  const [caretFrame, setCaretFrame] = useState<SourceEditCaretFrame | null>(null);

  const commitCursorPosition = (): void => {
    if (cursorOverlayRef.current) {
      applyCursorOverlayFrame(cursorOverlayRef.current, cursorStateRef.current, 0.78);
    }
  };
  const commitCursorFrame = (): void => {
    commitCursorPosition();
    setCursorFrame({ ...cursorStateRef.current });
  };
  const commitSource = (): void => {
    const sourceKey = `${formatTikzNumber(sourceStateRef.current.x)}|${sourceStateRef.current.label}`;
    if (lastSourceKeyRef.current === sourceKey) {
      return;
    }
    lastSourceKeyRef.current = sourceKey;
    if (sourcePreviewRef.current) {
      renderSourcePreview(sourcePreviewRef.current, buildSourceEditLines(sourceStateRef.current));
    }
  };

  useLayoutEffect(() => {
    const root = rootRef.current;
    const contentGroup = contentGroupRef.current;
    if (!root || !contentGroup) {
      return;
    }

    mountRenderedScene(contentGroup, sourceEditStates.initial.innerSvg);
    sourceStateRef.current = { x: sourceEditStates.initial.sourceX, label: sourceEditStates.initial.label };
    commitSource();

    sceneElementsRef.current = querySourceEditSceneElements(contentGroup);
    if (!sceneElementsRef.current) {
      return;
    }
    prepareSourceEditLine(sceneElementsRef.current.edgeLine, sourceEditStates.initial);

    const setRenderedState = (state: SourceEditState): void => {
      mountRenderedScene(contentGroup, state.innerSvg);
      sceneElementsRef.current = querySourceEditSceneElements(contentGroup);
      if (sceneElementsRef.current) {
        prepareSourceEditLine(sceneElementsRef.current.edgeLine, state);
      }
      sourceStateRef.current.x = state.sourceX;
      sourceStateRef.current.label = state.label;
      commitSource();
    };

    const measureSourceMetrics = (): SourceEditMetrics | null => {
      const wrap = sourceWrapRef.current;
      const coordinateToken = sourcePreviewRef.current?.querySelector<HTMLElement>(".sourceEditCoordinateToken");
      const labelToken = sourcePreviewRef.current?.querySelector<HTMLElement>(".sourceEditLabelToken");
      if (!wrap || !coordinateToken || !labelToken) {
        return null;
      }
      const wrapRect = wrap.getBoundingClientRect();
      const coordinateRect = coordinateToken.getBoundingClientRect();
      const labelRect = labelToken.getBoundingClientRect();
      const nextSize = {
        width: Math.max(1, wrapRect.width),
        height: Math.max(1, wrapRect.height)
      };
      setSourceLayerSize((previous) => (
        Math.abs(previous.width - nextSize.width) < 0.5 && Math.abs(previous.height - nextSize.height) < 0.5
          ? previous
          : nextSize
      ));
      return {
        numberHover: {
          x: coordinateRect.left - wrapRect.left + coordinateRect.width / 2,
          y: coordinateRect.top - wrapRect.top + coordinateRect.height / 2
        },
        numberDragEnd: {
          x: coordinateRect.left - wrapRect.left + coordinateRect.width / 2 + 42,
          y: coordinateRect.top - wrapRect.top + coordinateRect.height / 2
        },
        labelLeft: {
          x: labelRect.left - wrapRect.left - 2,
          y: labelRect.top - wrapRect.top + labelRect.height / 2
        },
        labelRight: {
          x: labelRect.right - wrapRect.left + 1,
          y: labelRect.top - wrapRect.top + labelRect.height / 2
        },
        labelHeight: labelRect.height
      };
    };

    const updateCaretAfterLabel = (): void => {
      const metrics = measureSourceMetrics();
      if (!metrics) {
        return;
      }
      setCaretFrame({
        x: metrics.labelRight.x,
        y: metrics.labelRight.y - metrics.labelHeight / 2 + 1,
        height: Math.max(16, metrics.labelHeight - 2),
        visible: true
      });
    };

    const initialMetrics = measureSourceMetrics();
    const numberHover = initialMetrics?.numberHover ?? { x: 148, y: 52 };
    const numberDragEnd = initialMetrics?.numberDragEnd ?? { x: 190, y: 52 };
    const labelRight = initialMetrics?.labelRight ?? { x: 226, y: 52 };
    const cursorStart = {
      x: numberHover.x - 54,
      y: numberHover.y - 7
    };

    Object.assign(cursorStateRef.current, {
      x: cursorStart.x,
      y: cursorStart.y,
      visible: true,
      pressed: false,
      cursor: "pointer" as CursorStyle
    });
    commitCursorFrame();
    setCaretFrame(null);

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 0.85 });
      timelineRef.current = tl;
      const cursor = createCursorScript(tl, cursorStateRef.current, {
        onPositionChange: commitCursorPosition,
        onFrameChange: commitCursorFrame
      });
      const moveCursorThrough = (
        points: SourceEditPoint[],
        duration: number,
        position: gsap.Position,
        ease = "power1.inOut"
      ): void => {
        const pathState = { progress: 0 };
        const segments = buildSourceEditCursorSegments(points);
        tl.to(pathState, {
          progress: 1,
          duration,
          ease,
          onUpdate: () => {
            const pointOnPath = interpolateSourceEditCursorPath(segments, pathState.progress);
            cursorStateRef.current.x = pointOnPath.x;
            cursorStateRef.current.y = pointOnPath.y;
            commitCursorPosition();
          }
        }, position);
      };

      tl.call(() => {
        setNumberChanging(false);
        setCaretFrame(null);
        setRenderedState(sourceEditStates.initial);
      }, undefined, 0);

      tl.add("scrubApproach", 0.35);
      cursor.setStyle("pointer", "scrubApproach");
      moveCursorThrough([
        cursorStart,
        { x: numberHover.x - 22, y: numberHover.y - 5 },
        numberHover
      ], 0.56, "scrubApproach", "power1.inOut");
      cursor.setStyle("ew-resize", "scrubApproach+=0.28");

      tl.add("scrubHover", "scrubApproach+=0.58");
      tl.to({}, { duration: 0.28, ease: "none" }, "scrubHover");

      tl.add("scrubStart", "scrubHover+=0.28");
      cursor.setPressed(true, "scrubStart");
      tl.call(() => setNumberChanging(true), undefined, "scrubStart");
      moveCursorThrough([
        numberHover,
        { x: numberDragEnd.x - 14, y: numberDragEnd.y + 1 },
        { x: numberDragEnd.x, y: numberDragEnd.y + 1 }
      ], 1.05, "scrubStart", "power1.inOut");
      tweenSourceEditState(tl, sceneElementsRef, sourceEditStates.initial, sourceEditStates.moved, 1.05, "scrubStart", () => {
        sourceStateRef.current.x = sourceEditStates.initial.sourceX + (
          (sourceEditStates.moved.sourceX - sourceEditStates.initial.sourceX) * scrubProgress.progress
        );
        commitSource();
      });

      tl.add("scrubRelease", "scrubStart+=1.05");
      cursor.setPressed(false, "scrubRelease");
      cursor.setStyle("pointer", "scrubRelease");
      tl.call(() => {
        setNumberChanging(false);
        sourceStateRef.current.x = sourceEditStates.moved.sourceX;
        sourceStateRef.current.label = "A";
        commitSource();
      }, undefined, "scrubRelease+=0.04");
      tl.to({}, { duration: 0.32, ease: "none" }, "scrubRelease+=0.06");

      tl.add("textApproach", "scrubRelease+=0.42");
      moveCursorThrough([
        { x: numberDragEnd.x, y: numberDragEnd.y + 1 },
        { x: (numberDragEnd.x + labelRight.x) / 2, y: labelRight.y - 7 },
        labelRight
      ], 0.82, "textApproach", "power1.inOut");
      cursor.setStyle("text", "textApproach+=0.7");
      tl.to({}, { duration: 0.24, ease: "none" }, "textApproach+=0.82");
      tl.call(updateCaretAfterLabel, undefined, "textApproach+=1.06");

      sourceEditStates.typed.forEach((state, index) => {
        if (index === 0) {
          return;
        }
        const position = `textApproach+=${1.28 + (index - 1) * 0.24}`;
        tl.call(() => {
          setRenderedState(state);
          updateCaretAfterLabel();
        }, undefined, position);
      });

      tl.add("holdTyped", `textApproach+=${1.28 + (sourceEditStates.typed.length - 1) * 0.24}`);
      tl.to({}, { duration: 0.7, ease: "none" }, "holdTyped");

      tl.add("reset", "holdTyped+=0.72");
      moveCursorThrough([
        labelRight,
        { x: (labelRight.x + cursorStart.x) / 2, y: cursorStart.y + 8 },
        cursorStart
      ], 0.75, "reset", "power1.inOut");
      cursor.setStyle("pointer", "reset+=0.1");
      tl.call(() => {
        setNumberChanging(false);
        setCaretFrame(null);
        setRenderedState(sourceEditStates.initial);
      }, undefined, "reset+=0.18");
    }, root);

    return () => {
      timelineRef.current = null;
      ctx.revert();
    };
  // GSAP owns this mount-time script; callback identities are intentionally excluded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="sourceEditDemo" ref={rootRef}>
      <svg className="sourceEditCanvas" viewBox={sourceEditStates.commonViewBox} role="img" aria-label="Source edit demo canvas">
        <g ref={contentGroupRef} />
      </svg>
      <div
        ref={sourceWrapRef}
        className={["sourceEditSourceWrap", numberChanging ? "sourceEditChangingNumber" : ""].filter(Boolean).join(" ")}
      >
        <SourcePreview
          ref={sourcePreviewRef}
          lines={buildSourceEditLines(sourceStateRef.current)}
          managedImperatively
        />
        {caretFrame ? (
          <span
            className="sourceEditCaret"
            aria-hidden="true"
            style={{
              height: caretFrame.height,
              left: caretFrame.x,
              opacity: caretFrame.visible ? 1 : 0,
              top: caretFrame.y
            }}
          />
        ) : null}
        <svg className="sourceEditCursorLayer" viewBox={`0 0 ${sourceLayerSize.width} ${sourceLayerSize.height}`} aria-hidden="true">
          <CursorOverlay
            ref={cursorOverlayRef}
            x={cursorFrame.x}
            y={cursorFrame.y}
            visible={cursorFrame.visible}
            pressed={cursorFrame.pressed}
            cursor={cursorFrame.cursor}
            scale={0.78}
          />
        </svg>
      </div>
    </div>
  );
}

type SourceEditSceneElements = {
  aNodeGroup: SVGGElement;
  edgeLine: SVGPathElement;
  edgeTip: SVGPathElement;
};

type SourceEditPoint = {
  x: number;
  y: number;
};

type SourceEditMetrics = {
  numberHover: SourceEditPoint;
  numberDragEnd: SourceEditPoint;
  labelLeft: SourceEditPoint;
  labelRight: SourceEditPoint;
  labelHeight: number;
};

type SourceEditCaretFrame = {
  x: number;
  y: number;
  height: number;
  visible: boolean;
};

type SourceEditCursorSegment = {
  from: SourceEditPoint;
  to: SourceEditPoint;
  start: number;
  end: number;
};

function buildSourceEditCursorSegments(points: SourceEditPoint[]): SourceEditCursorSegment[] {
  const segments = points.slice(0, -1).map((from, index) => {
    const to = points[index + 1]!;
    return {
      from,
      to,
      length: Math.hypot(to.x - from.x, to.y - from.y)
    };
  });
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0) || 1;
  let cursor = 0;
  return segments.map((segment) => {
    const start = cursor / totalLength;
    cursor += segment.length;
    return {
      from: segment.from,
      to: segment.to,
      start,
      end: cursor / totalLength
    };
  });
}

function interpolateSourceEditCursorPath(
  segments: SourceEditCursorSegment[],
  progress: number
): SourceEditPoint {
  const clamped = Math.max(0, Math.min(1, progress));
  const segment = segments.find((candidate) => clamped <= candidate.end) ?? segments[segments.length - 1];
  if (!segment) {
    return { x: 0, y: 0 };
  }
  const localProgress = segment.end === segment.start
    ? 1
    : (clamped - segment.start) / (segment.end - segment.start);
  return {
    x: segment.from.x + (segment.to.x - segment.from.x) * localProgress,
    y: segment.from.y + (segment.to.y - segment.from.y) * localProgress
  };
}

function querySourceEditSceneElements(contentGroup: SVGGElement): SourceEditSceneElements | null {
  const aCircle = contentGroup.querySelector('circle[data-source-id="path:1"]');
  const aLabel = contentGroup.querySelector('svg[data-source-id="path:1"][data-text-renderer="mathjax"]');
  const edgeLine = contentGroup.querySelector<SVGPathElement>('path[data-source-id="path:3"]:not([data-arrow-tip-kind])');
  const edgeTip = contentGroup.querySelector<SVGPathElement>('path[data-source-id="path:3"][data-arrow-tip-kind]');
  if (!aCircle || !aLabel || !edgeLine || !edgeTip) {
    return null;
  }
  const aNodeGroup = wrapRenderedElements([aCircle, aLabel], "animatedNodeGroup");
  if (!aNodeGroup) {
    return null;
  }
  return { aNodeGroup, edgeLine, edgeTip };
}

function tweenSourceEditState(
  tl: gsap.core.Timeline,
  elementsRef: RefObject<SourceEditSceneElements | null>,
  from: SourceEditState,
  to: SourceEditState,
  duration: number,
  position: gsap.Position,
  onUpdate: () => void
): void {
  scrubProgress.progress = 0;
  const fromEndpoints = parseLineEndpoints(from.edge.lineD);
  const toEndpoints = parseLineEndpoints(to.edge.lineD);
  tl.to(scrubProgress, {
    progress: 1,
    duration,
    ease: "power1.inOut",
    onUpdate: () => {
      const elements = elementsRef.current;
      if (!elements) {
        return;
      }
      const dx = (to.aCenter.x - from.aCenter.x) * scrubProgress.progress;
      const dy = (to.aCenter.y - from.aCenter.y) * scrubProgress.progress;
      elements.aNodeGroup.setAttribute("transform", `translate(${dx} ${dy})`);
      applyLinePathEndpoints(
        elements.edgeLine,
        interpolatePoint(fromEndpoints.from, toEndpoints.from, scrubProgress.progress),
        interpolatePoint(fromEndpoints.to, toEndpoints.to, scrubProgress.progress)
      );
      setSvgAttrs(elements.edgeTip, { d: interpolatePathD(from.edge.tipD, to.edge.tipD, scrubProgress.progress) });
      if (scrubProgress.progress > 0.995) {
        prepareSourceEditLine(elements.edgeLine, to);
        setSvgAttrs(elements.edgeTip, { d: to.edge.tipD });
      }
      onUpdate();
    }
  }, position);
}

const scrubProgress = { progress: 0 };

function prepareSourceEditLine(target: Element, state: SourceEditState): void {
  const endpoints = parseLineEndpoints(state.edge.lineD);
  prepareTransformDrivenLinePath(target);
  applyLinePathEndpoints(target, endpoints.from, endpoints.to);
}

function parseLineEndpoints(d: string): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const numbers = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  return {
    from: { x: numbers[0] ?? 0, y: numbers[1] ?? 0 },
    to: { x: numbers[2] ?? 0, y: numbers[3] ?? 0 }
  };
}

function interpolatePoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
  progress: number
): { x: number; y: number } {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress
  };
}

function interpolatePathD(fromD: string, toD: string, progress: number): string {
  const numberRe = /-?\d+(?:\.\d+)?/g;
  const fromNumbers = [...fromD.matchAll(numberRe)].map((match) => Number(match[0]));
  const toNumbers = [...toD.matchAll(numberRe)].map((match) => Number(match[0]));
  if (fromNumbers.length !== toNumbers.length) {
    return progress >= 1 ? toD : fromD;
  }
  let index = 0;
  return fromD.replace(numberRe, () => {
    const value = fromNumbers[index]! + (toNumbers[index]! - fromNumbers[index]!) * progress;
    index += 1;
    return formatPathNumber(value);
  });
}

function formatPathNumber(value: number): string {
  return Number.parseFloat(value.toFixed(4)).toString();
}

function buildSourceEditLines(state: { x: number; label: string }): SourceLine[] {
  return [
    sourceLine(
      sourceKeyword("\\draw"),
      sourceText("[->] "),
      sourcePunctuation("(a)"),
      sourceText(" -- "),
      sourcePunctuation("(b)"),
      sourceText(";")
    ),
    sourceLine(
      sourceKeyword("\\node"),
      sourceText("[draw, fill=blue!10] "),
      sourcePunctuation("(a)"),
      sourceText(" at ("),
      { ...sourceNumber(formatTikzNumber(state.x)), className: "sourceEditCoordinateToken" },
      sourceText(", 0.8) "),
      sourceString("{"),
      { ...sourceString(state.label), className: "sourceEditLabelToken" },
      sourceString("}"),
      sourceText(";")
    ),
    sourceLine(
      sourceKeyword("\\node"),
      sourceText("[draw, fill=green!12] "),
      sourcePunctuation("(b)"),
      sourceText(" at (3.2, 0) "),
      sourceString("{B}"),
      sourceText(";")
    )
  ];
}

function RenderedShowcaseCard({ id }: { id: string }) {
  const item = landingShowcaseSvgs[id];
  return (
    <ShowcaseCard label={item.title}>
      <div
        className="renderedShowcaseSvg"
        dangerouslySetInnerHTML={{ __html: item.svg }}
      />
    </ShowcaseCard>
  );
}

function ShowcaseCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <article className="showcaseCard">
      {children}
      <h3>{label}</h3>
    </article>
  );
}

function ForeachRepeatDemo() {
  const [columns, setColumns] = useState(5);
  const [rows, setRows] = useState(3);
  const foreach = landingShowcaseSvgs.foreachRepeat as ForeachRepeatShowcaseSvg;

  return (
    <div className="foreachDemo">
      <ForeachSource columns={columns} rows={rows} />
      <div className="foreachCanvas">
        <svg
          className="foreachRenderedSvg"
          viewBox={foreach.viewBox}
          role="img"
          aria-label="Foreach output with repeat preview"
          dangerouslySetInnerHTML={{
            __html: foreach.cells
              .filter((cell) => cell.x <= columns && cell.y <= rows)
              .map((cell) => `${cell.circleSvg}${cell.labelSvg}`)
              .join("")
          }}
        />
      </div>
      <div className="repeatPanel">
        <div className="panelTitle">Repeat</div>
        <label>
          <span>Columns</span>
          <input type="number" min="1" max="6" value={columns} onChange={(event) => setColumns(clampRepeatValue(event.target.value))} />
        </label>
        <label>
          <span>Rows</span>
          <input type="number" min="1" max="4" value={rows} onChange={(event) => setRows(clampRepeatValue(event.target.value, 4))} />
        </label>
        <label>
          <span>H Step (cm)</span>
          <input value="1.4" onChange={() => undefined} />
        </label>
        <label>
          <span>V Step (cm)</span>
          <input value="1.1" onChange={() => undefined} />
        </label>
        <div className="repeatMetrics">
          <span>Selection</span>
          <strong>0.7 cm x 0.7 cm</strong>
        </div>
        <button type="button">Apply</button>
      </div>
    </div>
  );
}

function ForeachSource({ columns, rows }: { columns: number; rows: number }) {
  return (
    <pre className="foreachSource" aria-label="Foreach TikZ source preview">
      <code className="sourcePreviewCode">
        <span className="sourceLine">
          <span className="sourceToken sourceToken--keyword">{"\\foreach"}</span>
          <span>{" "}</span>
          <span className="sourceToken sourceToken--meta">{"\\x"}</span>
          <span>{" in "}</span>
          <span className="sourceToken sourceToken--punctuation">{"{1,...,"}</span>
          <span className="sourceToken sourceToken--number">{columns}</span>
          <span className="sourceToken sourceToken--punctuation">{"} {"}</span>
        </span>
        <span className="sourceLine">
          <span>{"  "}</span>
          <span className="sourceToken sourceToken--keyword">{"\\foreach"}</span>
          <span>{" "}</span>
          <span className="sourceToken sourceToken--meta">{"\\y"}</span>
          <span>{" in "}</span>
          <span className="sourceToken sourceToken--punctuation">{"{1,...,"}</span>
          <span className="sourceToken sourceToken--number">{rows}</span>
          <span className="sourceToken sourceToken--punctuation">{"} {"}</span>
        </span>
        <span className="sourceLine">
          <span>{"    "}</span>
          <span className="sourceToken sourceToken--keyword">{"\\node"}</span>
          <span>{"[circle,draw,minimum size=8mm] at ("}</span>
          <span className="sourceToken sourceToken--meta">{"\\x"}</span>
          <span>{",-"}</span>
          <span className="sourceToken sourceToken--meta">{"\\y"}</span>
          <span>{") {"}</span>
          <span className="sourceToken sourceToken--meta">{"\\x"}</span>
          <span>{","}</span>
          <span className="sourceToken sourceToken--meta">{"\\y"}</span>
          <span>{"};"}</span>
        </span>
        <span className="sourceLine">{"  }"}</span>
        <span className="sourceLine">{"}"}</span>
      </code>
    </pre>
  );
}

function clampRepeatValue(value: string, max = 6): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, Math.min(max, parsed));
}
