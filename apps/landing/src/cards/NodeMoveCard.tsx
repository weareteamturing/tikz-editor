import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { CursorOverlay } from "../cursor-overlay";
import { createCursorScript, type CursorFrame } from "../cursor-script";
import { renderEditHandlesForBounds } from "../edit-handles";
import { nodeMoveCommonViewBox, nodeMoveInitial, nodeMoveMoved } from "../generated/feature-svgs";
import { createCursorPathScript } from "../animation/cursor-path";
import { offsetPoint, point } from "../animation/points";
import { setSvgAttrs, toSvgAttrs, toTranslate } from "../animation/svg-actors";

type SceneRefs = {
  contentGroup: SVGGElement | null;
  handlesGroup: SVGGElement | null;
};

type NodeSceneElements = {
  sCircle: SVGCircleElement;
  sLabel: SVGSVGElement;
  edgeLine: SVGPathElement;
  edgeTip: SVGPathElement;
};

function queryNodeSceneElements(contentGroup: SVGGElement): NodeSceneElements | null {
  const sCircle = contentGroup.querySelector('circle[data-source-id="path:1"]') as SVGCircleElement | null;
  const sLabel = contentGroup.querySelector('svg[data-source-id="path:1"][data-text-renderer="mathjax"]') as SVGSVGElement | null;
  const edgeLine = contentGroup.querySelector('path[data-source-id="path:3"]:not([data-arrow-tip-kind])') as SVGPathElement | null;
  const edgeTip = contentGroup.querySelector('path[data-source-id="path:3"][data-arrow-tip-kind]') as SVGPathElement | null;

  if (!sCircle || !sLabel || !edgeLine || !edgeTip) {
    return null;
  }

  return { sCircle, sLabel, edgeLine, edgeTip };
}

function setNodeFrame(elements: NodeSceneElements, frame: typeof nodeMoveInitial): void {
  setSvgAttrs(elements.sCircle, { cx: frame.sCenter.x, cy: frame.sCenter.y });
  setSvgAttrs(elements.sLabel, { x: frame.sLabelPos.x, y: frame.sLabelPos.y });
  setSvgAttrs(elements.edgeLine, { d: frame.edge.lineD });
  setSvgAttrs(elements.edgeTip, { d: frame.edge.tipD });
}

function tweenNodeFrame(
  tl: gsap.core.Timeline,
  elements: NodeSceneElements,
  frame: typeof nodeMoveInitial,
  duration: number,
  position: gsap.Position,
  ease = "power1.inOut"
): void {
  toSvgAttrs(tl, elements.sCircle, { cx: frame.sCenter.x, cy: frame.sCenter.y }, duration, position, ease);
  toSvgAttrs(tl, elements.sLabel, { x: frame.sLabelPos.x, y: frame.sLabelPos.y }, duration, position, ease);
  toSvgAttrs(tl, elements.edgeLine, { d: frame.edge.lineD }, duration, position, ease);
  toSvgAttrs(tl, elements.edgeTip, { d: frame.edge.tipD }, duration, position, ease);
}

export function NodeMoveCard() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneRefs>({ contentGroup: null, handlesGroup: null });
  const cursorStateRef = useRef<CursorFrame>({
    x: nodeMoveInitial.sCenter.x,
    y: nodeMoveInitial.sCenter.y,
    visible: true,
    pressed: false,
    cursor: "pointer"
  });
  const [cursorFrame, setCursorFrame] = useState<CursorFrame>({ ...cursorStateRef.current });

  const commitCursor = (): void => setCursorFrame({ ...cursorStateRef.current });

  useLayoutEffect(() => {
    if (!rootRef.current) {
      return;
    }

    const contentGroup = sceneRef.current.contentGroup;
    const handlesGroup = sceneRef.current.handlesGroup;
    if (!contentGroup || !handlesGroup) {
      return;
    }

    // Mount once so React re-renders (from cursor state updates) do not
    // overwrite animated SVG attributes.
    contentGroup.innerHTML = nodeMoveInitial.innerSvg;

    const elements = queryNodeSceneElements(contentGroup);
    if (!elements) {
      return;
    }

    const dx = nodeMoveMoved.sCenter.x - nodeMoveInitial.sCenter.x;
    const dy = nodeMoveMoved.sCenter.y - nodeMoveInitial.sCenter.y;

    const initialCenter = point(nodeMoveInitial.sCenter.x, nodeMoveInitial.sCenter.y);
    const movedCenter = point(nodeMoveMoved.sCenter.x, nodeMoveMoved.sCenter.y);

    const waypoints = {
      initialHover: offsetPoint(initialCenter, -nodeMoveInitial.sRadius * 0.5, 0),
      movedHover: offsetPoint(movedCenter, -nodeMoveMoved.sRadius * 0.5, 0),
      initialBeside: offsetPoint(initialCenter, -nodeMoveInitial.sRadius - 12, 4),
      deselectOutside: offsetPoint(initialCenter, -nodeMoveInitial.sRadius - 24, -6)
    };

    const ctx = gsap.context(() => {
      setNodeFrame(elements, nodeMoveInitial);
      gsap.set(handlesGroup, { x: 0, y: 0, autoAlpha: 0 });

      Object.assign(cursorStateRef.current, {
        x: waypoints.initialBeside.x,
        y: waypoints.initialBeside.y,
        visible: true,
        pressed: false,
        cursor: "pointer"
      });
      commitCursor();

      const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.9 });
      const cursor = createCursorScript(tl, cursorStateRef.current, commitCursor);
      const cursorPath = createCursorPathScript(cursor, waypoints);

      tl.add("hoverStart");
      cursorPath.moveTo("initialHover", 0.34, "hoverStart");
      cursor.setStyle("move", "hoverStart+=0.14");

      tl.add("selectClick", "hoverStart+=0.36");
      cursor.setPressed(true, "selectClick");
      cursor.setPressed(false, "selectClick+=0.12");
      tl.to(handlesGroup, { autoAlpha: 1, duration: 0.08, ease: "none" }, "selectClick+=0.02");

      tl.add("dragForwardStart", "selectClick+=0.28");
      cursor.setPressed(true, "dragForwardStart");
      cursorPath.moveTo("movedHover", 1, "dragForwardStart", "power1.inOut");

      tweenNodeFrame(tl, elements, nodeMoveMoved, 1, "dragForwardStart", "power1.inOut");
      toTranslate(tl, handlesGroup, dx, dy, 1, "dragForwardStart", "power1.inOut");

      tl.add("dragForwardEnd", "dragForwardStart+=1");
      cursor.setPressed(false, "dragForwardEnd-=0.14");

      tl.add("prepBack", "dragForwardEnd+=0.45");
      cursorPath.moveTo("movedHover", 0.16, "prepBack");
      cursor.setStyle("move", "prepBack");
      cursor.setPressed(true, "prepBack");

      tl.add("dragBackStart", "prepBack+=0.16");
      cursorPath.moveTo("initialHover", 0.75, "dragBackStart", "power1.inOut");
      tweenNodeFrame(tl, elements, nodeMoveInitial, 0.75, "dragBackStart", "power1.inOut");
      toTranslate(tl, handlesGroup, 0, 0, 0.75, "dragBackStart", "power1.inOut");

      tl.add("dragBackEnd", "dragBackStart+=0.75");
      cursor.setPressed(false, "dragBackEnd-=0.14");
      cursor.setStyle("pointer", "dragBackEnd");
      tl.to({}, { duration: 0.26, ease: "none" }, "dragBackEnd");
      cursorPath.moveTo("deselectOutside", 0.4, "dragBackEnd");

      // Rest briefly at the outside point before clicking to deselect.
      tl.add("deselectClick", "dragBackEnd+=0.84");
      cursor.setPressed(true, "deselectClick");
      cursor.setPressed(false, "deselectClick+=0.1");
      tl.to(handlesGroup, { autoAlpha: 0, duration: 0.08, ease: "none" }, "deselectClick+=0.03");

      // Return to the exact initial position to keep a seamless loop.
      cursorPath.moveTo("initialBeside", 0.4, "deselectClick+=0.32");
      cursor.setStyle("pointer", "deselectClick+=0.3");
      cursor.setFrame({ pressed: false }, "deselectClick+=0.3");
    }, rootRef);

    return () => ctx.revert();
  }, []);

  const initialBounds = {
    x: nodeMoveInitial.sCenter.x - nodeMoveInitial.sRadius,
    y: nodeMoveInitial.sCenter.y - nodeMoveInitial.sRadius,
    width: nodeMoveInitial.sRadius * 2,
    height: nodeMoveInitial.sRadius * 2
  };

  return (
    <article className="featureCard" ref={rootRef}>
      <div className="featureCardTitle">Node drag keeps edge attached</div>
      <svg className="featureScene" viewBox={nodeMoveCommonViewBox} role="img" aria-label="Node drag demo">
        <g
          ref={(el) => {
            sceneRef.current.contentGroup = el;
          }}
        />

        <g
          ref={(el) => {
            sceneRef.current.handlesGroup = el;
          }}
        >
          {renderEditHandlesForBounds({
            bounds: initialBounds,
            handleHalfSize: 1.1,
            handleStrokeWidth: 0.26,
            selectionStrokeWidth: 0.24,
            rotateHandleGap: 5.2
          })}
        </g>

        <CursorOverlay
          x={cursorFrame.x}
          y={cursorFrame.y}
          visible={cursorFrame.visible}
          pressed={cursorFrame.pressed}
          cursor={cursorFrame.cursor}
          scale={0.35}
        />
      </svg>
    </article>
  );
}
