import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import gsap from "gsap";
import {
  BASIC_PICKER_COLORS,
  ColorPicker,
  GENERATED_OPEN_EXAMPLE_PREVIEWS,
  OPEN_EXAMPLE_CATALOG,
  cssColorForToken
} from "@tikz-editor/app/landing-assets";
import { NodeMoveCard } from "./cards/NodeMoveCard";
import { AddArrowCard } from "./cards/AddArrowCard";
import { AddRectCard } from "./cards/AddRectCard";
import { SnapGuidesCard } from "./cards/SnapGuidesCard";
import { SelectionAlignCard } from "./cards/SelectionAlignCard";
import { RotateNodeCard } from "./cards/RotateNodeCard";
import { LandingLayoutEditor } from "./LandingLayoutEditor";
import { applyCursorOverlayFrame, CursorOverlay } from "./cursor-overlay";
import { createCursorScript, type CursorFrame } from "./cursor-script";
import { renderEditHandlesForBounds, type RectBounds } from "./edit-handles";
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

type ParsedSvgMarkup = {
  viewBox: string;
  innerSvg: string;
};

const GENERATED_OPEN_EXAMPLE_PREVIEWS_BY_ID = GENERATED_OPEN_EXAMPLE_PREVIEWS as Record<string, { svg: string | null } | undefined>;
const FOREACH_NODE_FILL = cssColorForToken("blue!10") ?? "#e6e6ff";

const VENN_SELECTED_SET_BOUNDS: RectBounds = {
  x: -39.8339,
  y: -56.39,
  width: 79.6678,
  height: 79.6678
};

function parseSvgMarkup(svg: string | null | undefined): ParsedSvgMarkup | null {
  if (!svg) {
    return null;
  }
  const viewBox = svg.match(/\bviewBox="([^"]+)"/)?.[1];
  const openTagEnd = svg.indexOf(">");
  const closeTagStart = svg.lastIndexOf("</svg>");
  if (!viewBox || openTagEnd < 0 || closeTagStart < openTagEnd) {
    return null;
  }
  return {
    viewBox,
    innerSvg: svg.slice(openTagEnd + 1, closeTagStart)
  };
}

function getVennInspectorSvg(fillCss: string, strokeCss: string): ParsedSvgMarkup | null {
  const parsed = parseSvgMarkup(GENERATED_OPEN_EXAMPLE_PREVIEWS_BY_ID.venn?.svg);
  if (!parsed) {
    return null;
  }
  return {
    viewBox: parsed.viewBox,
    innerSvg: parsed.innerSvg
      .replace('fill="#ccccff"', `fill="${fillCss}"`)
      .replace(/(<path data-source-id="path:0"[^>]*\bstroke=")[^"]+/, `$1${strokeCss}`)
  };
}

function ignoreChange(): void {}

function parseCircleBounds(circleSvg: string): RectBounds | null {
  const cx = Number.parseFloat(circleSvg.match(/\bcx="([^"]+)"/)?.[1] ?? "");
  const cy = Number.parseFloat(circleSvg.match(/\bcy="([^"]+)"/)?.[1] ?? "");
  const r = Number.parseFloat(circleSvg.match(/\br="([^"]+)"/)?.[1] ?? "");
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r)) {
    return null;
  }
  return {
    x: cx - r,
    y: cy - r,
    width: r * 2,
    height: r * 2
  };
}

function applyForeachNodeStyle(circleSvg: string): string {
  return circleSvg.replace('fill="none"', `fill="${FOREACH_NODE_FILL}"`);
}

export function DeferredSections() {
  return (
    <>
      <SourceScrubSection />
      <CanvasEditSection />
      <ExamplesGallery />
      <LayoutToolsSection />
      <ShapeShowcase />
      <InspectorColorSection />
      <ForeachRepeatSection />
      <CapabilityClose />
      <LandingLayoutEditor />
    </>
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
          <div className="storySliceText" data-layout-item="canvas.move.text" data-layout-text>
            <p>
              Nodes can be dragged to a desired location, rescaled, or rotated. Paths can be edited
              using line, arrow, Bezier, and freehand tools. All edits are immediately reflected in
              the TikZ code.
            </p>
          </div>
          <div className="storyAnimation storyAnimationLarge">
            <NodeMoveCard />
          </div>
        </article>
        <article className="storySlice storySliceRectangle">
          <div className="storySliceText" data-layout-item="canvas.rectangle.text" data-layout-text>
            <p>
              New shapes can be added using the grid, rectangle, circle, and ellipse tools. They can
              be styled with the inspector, then flexibly moved and resized.
            </p>
          </div>
          <div className="storyAnimation">
            <AddRectCard />
          </div>
        </article>
        <article className="storySlice storySliceRotate">
          <div className="storySliceText" data-layout-item="canvas.rotate.text" data-layout-text>
            <p>
              Tools for adding other shapes and matrices are included, along with helpers like a
              magnifying glass and paint bucket.
            </p>
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
          <div className="storySliceText" data-layout-item="layout.anchors.text" data-layout-text>
            <p>
              Paths can be attached to node anchors, which makes it straightforward to build graphs
              and flow charts.
            </p>
          </div>
          <div className="storyAnimation">
            <AddArrowCard />
          </div>
        </article>
        <article className="storySlice storySliceSnap">
          <div className="storySliceText" data-layout-item="layout.snap.text" data-layout-text>
            <p>
              During drag, snap guides allow exact positioning of elements in alignment with others.
              Rulers and guide lines are also available.
            </p>
          </div>
          <div className="storyAnimation">
            <SnapGuidesCard />
          </div>
        </article>
        <article className="storySlice storySliceAlign">
          <div className="storySliceText" data-layout-item="layout.align.text" data-layout-text>
            <p>
              When selecting several nodes, the editor allows grouping them, or aligning and
              distributing them.
            </p>
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
  const [fillColor, setFillColor] = useState("blue!20");
  const [strokeColor, setStrokeColor] = useState("black");
  const fillCss = cssColorForToken(fillColor) ?? "#ccccff";
  const strokeCss = cssColorForToken(strokeColor) ?? "#111827";
  const vennSvg = getVennInspectorSvg(fillCss, strokeCss);

  return (
    <StoryStrip
      eyebrow="Inspector and color"
      title="Adjust styles from the inspector."
      body="Change fills, strokes, shapes, text layout, sizes, and transforms. The color picker works with xcolor expressions such as blue!30."
      visual={
        <div className="inspectorColorMock">
          <div className="inspectorCanvasPane">
            {vennSvg ? (
              <svg viewBox={vennSvg.viewBox} role="img" aria-label="Selected Venn diagram set styled by the inspector">
                <g
                  className="inspectorRenderedVenn"
                  dangerouslySetInnerHTML={{ __html: vennSvg.innerSvg }}
                />
                <g className="inspectorSelectionOverlay">
                  {renderEditHandlesForBounds({
                    bounds: VENN_SELECTED_SET_BOUNDS,
                    handleHalfSize: 2.2,
                    handleStrokeWidth: 0.45,
                    selectionStrokeWidth: 0.38,
                    rotateHandleGap: 11
                  })}
                </g>
              </svg>
            ) : null}
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
              <span>Draw</span>
              <div className="inspectorValueTrigger">
                <span className="inspectorSwatch" style={{ background: strokeCss }} aria-hidden="true" />
                <input value={strokeColor} onChange={(event) => setStrokeColor(event.target.value)} />
              </div>
            </label>
            <label className="inspectorProperty">
              <span>Shape</span>
              <select value="circle" onChange={ignoreChange}>
                <option>circle</option>
              </select>
            </label>
            <label className="inspectorProperty">
              <span>Opacity</span>
              <input value="0.5" readOnly />
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
          x: labelRect.right - wrapRect.left - 1.5,
          y: labelRect.top - wrapRect.top + labelRect.height / 2
        },
        labelHeight: labelRect.height
      };
    };

    const setTypedLabelState = (state: SourceEditState): void => {
      const elements = sceneElementsRef.current;
      if (!elements) {
        return;
      }
      applySourceEditNodeFrame(elements, getSourceEditLabelFrame(state));
      sourceStateRef.current.x = state.sourceX;
      sourceStateRef.current.label = state.label;
      commitSource();
    };

    const getSourceEditLabelFrame = (() => {
      const frames = new WeakMap<SourceEditState, SourceEditLabelFrame>();
      return (state: SourceEditState): SourceEditLabelFrame => {
        const cached = frames.get(state);
        if (cached) {
          return cached;
        }
        const scratch = document.createElementNS("http://www.w3.org/2000/svg", "g");
        mountRenderedScene(scratch, state.innerSvg);
        const label = scratch.querySelector<SVGImageElement>('[data-source-id="path:1"][data-text-renderer="mathjax"]');
        const circle = scratch.querySelector<SVGCircleElement>('circle[data-source-id="path:1"]');
        if (!label || !circle) {
          return { attrs: {}, circleAttrs: {} };
        }
        const attrs = Object.fromEntries(Array.from(label.attributes).map((attribute) => [attribute.name, attribute.value]));
        const circleAttrs = Object.fromEntries(Array.from(circle.attributes).map((attribute) => [attribute.name, attribute.value]));
        const dx = state.aCenter.x - sourceEditStates.initial.aCenter.x;
        const dy = state.aCenter.y - sourceEditStates.initial.aCenter.y;
        if (attrs.x !== undefined) {
          attrs.x = formatPathNumber(Number(attrs.x) - dx);
        }
        if (attrs.y !== undefined) {
          attrs.y = formatPathNumber(Number(attrs.y) - dy);
        }
        if (circleAttrs.cx !== undefined) {
          circleAttrs.cx = formatPathNumber(Number(circleAttrs.cx) - dx);
        }
        if (circleAttrs.cy !== undefined) {
          circleAttrs.cy = formatPathNumber(Number(circleAttrs.cy) - dy);
        }
        const frame = {
          circleAttrs,
          attrs
        };
        frames.set(state, frame);
        return frame;
      };
    })();

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
      cursor: "pointer"
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
        tl.to(pathState, {
          progress: 1,
          duration,
          ease,
          onStart: () => {
            pathState.progress = 0;
            const pointOnPath = interpolateSourceEditCursorPath(points, 0);
            cursorStateRef.current.x = pointOnPath.x;
            cursorStateRef.current.y = pointOnPath.y;
            commitCursorPosition();
          },
          onUpdate: () => {
            const pointOnPath = interpolateSourceEditCursorPath(points, pathState.progress);
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
          setTypedLabelState(state);
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
  aCircle: SVGCircleElement;
  aLabel: SVGImageElement;
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

type SourceEditLabelFrame = {
  circleAttrs: Record<string, string>;
  attrs: Record<string, string>;
};

type SourceEditCaretFrame = {
  x: number;
  y: number;
  height: number;
  visible: boolean;
};

function interpolateSourceEditCursorPath(
  points: SourceEditPoint[],
  progress: number
): SourceEditPoint {
  const clamped = Math.max(0, Math.min(1, progress));
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) {
    return { x: 0, y: 0 };
  }
  if (points.length === 1) {
    return first;
  }
  if (points.length === 2) {
    return interpolatePoint(first, last, clamped);
  }
  const control = points[1];
  const a = interpolatePoint(first, control, clamped);
  const b = interpolatePoint(control, last, clamped);
  return interpolatePoint(a, b, clamped);
}

function querySourceEditSceneElements(contentGroup: SVGGElement): SourceEditSceneElements | null {
  const aCircle = contentGroup.querySelector<SVGCircleElement>('circle[data-source-id="path:1"]');
  const aLabel = contentGroup.querySelector<SVGImageElement>('[data-source-id="path:1"][data-text-renderer="mathjax"]');
  const edgeLine = contentGroup.querySelector<SVGPathElement>('path[data-source-id="path:3"]:not([data-arrow-tip-kind])');
  const edgeTip = contentGroup.querySelector<SVGPathElement>('path[data-source-id="path:3"][data-arrow-tip-kind]');
  if (!aCircle || !aLabel || !edgeLine || !edgeTip) {
    return null;
  }
  const aNodeGroup = wrapRenderedElements([aCircle, aLabel], "animatedNodeGroup");
  if (!aNodeGroup) {
    return null;
  }
  return { aNodeGroup, aCircle, aLabel, edgeLine, edgeTip };
}

function applySourceEditNodeFrame(elements: SourceEditSceneElements, frame: SourceEditLabelFrame): void {
  applySourceEditElementFrame(elements.aCircle, frame.circleAttrs);
  applySourceEditElementFrame(elements.aLabel, frame.attrs);
}

function applySourceEditElementFrame(target: Element, attrs: Record<string, string>): void {
  Array.from(target.attributes).forEach((attribute) => {
    if (attribute.name.startsWith("data-")) {
      return;
    }
    if (!(attribute.name in attrs)) {
      target.removeAttribute(attribute.name);
    }
  });
  Object.entries(attrs).forEach(([name, value]) => {
    if (target.getAttribute(name) !== value) {
      target.setAttribute(name, value);
    }
  });
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
    const value = fromNumbers[index] + (toNumbers[index] - fromNumbers[index]) * progress;
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
    ),
    sourceLine(
      sourceKeyword("\\draw"),
      sourceText("[->] "),
      sourcePunctuation("(a)"),
      sourceText(" -- "),
      sourcePunctuation("(b)"),
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
  const visibleCells = foreach.cells.filter((cell) => cell.x <= columns && cell.y <= rows);
  const initialNodeBounds = parseCircleBounds(foreach.cells.find((cell) => cell.x === 1 && cell.y === 1)?.circleSvg ?? "");

  return (
    <div className="foreachDemo">
      <ForeachSource columns={columns} rows={rows} />
      <div className="foreachCanvas">
        <svg
          className="foreachRenderedSvg"
          viewBox={foreach.viewBox}
          role="img"
          aria-label="Foreach output with repeat preview"
        >
          <g
            dangerouslySetInnerHTML={{
              __html: visibleCells
                .map((cell) => applyForeachNodeStyle(cell.circleSvg))
                .join("")
            }}
          />
          {initialNodeBounds ? (
            <g className="foreachInitialHandles">
              {renderEditHandlesForBounds({
                bounds: initialNodeBounds,
                handleHalfSize: 1.3,
                handleStrokeWidth: 0.32,
                selectionStrokeWidth: 0.28,
                rotateHandleGap: 6
              })}
            </g>
          ) : null}
        </svg>
      </div>
      <div className="repeatPanel">
        <div className="repeatHeader">
          <div className="panelTitle">Repeat</div>
          <button className="repeatCloseButton" type="button" aria-label="Close repeat dialog">&times;</button>
        </div>
        <div className="repeatBody">
          <div className="repeatGrid">
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
              <input type="number" step="0.1" value="1" readOnly />
            </label>
            <label>
              <span>V Step (cm)</span>
              <input type="number" step="0.1" value="1" readOnly />
            </label>
          </div>
          <div className="repeatMetrics">
            <div>
              <span>Selection</span>
              <strong>0.87 cm &times; 0.87 cm</strong>
            </div>
            <div>
              <span>Gap</span>
              <strong>0.13 cm &times; 0.13 cm</strong>
            </div>
          </div>
        </div>
        <div className="repeatFooter">
          <button className="repeatSecondaryButton" type="button">Cancel</button>
          <button className="repeatPrimaryButton" type="button">Apply</button>
        </div>
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
          <span>{"[circle, draw, fill=blue!10, minimum size=8mm] at ("}</span>
          <span className="sourceToken sourceToken--meta">{"\\x"}</span>
          <span>{",-"}</span>
          <span className="sourceToken sourceToken--meta">{"\\y"}</span>
          <span>{") {};"}</span>
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
