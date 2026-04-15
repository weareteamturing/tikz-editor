import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { CursorOverlay } from "../cursor-overlay";
import { CURSOR_FOR_DRAG } from "../cursor-conventions";
import { createCursorScript, type CursorFrame } from "../cursor-script";
import { createCursorPathScript } from "../animation/cursor-path";
import { SnapGuidesOverlay, type SnapGuideLine } from "../animation/snap-guides";
import { mountRenderedScene, queryRenderedElement } from "../animation/rendered-scene";
import { setSvgAttrs } from "../animation/svg-actors";
import { snapGuidesCommonViewBox, snapGuidesFinal, snapGuidesInitial } from "../generated/feature-svgs";

type RectNode = {
  sourceId: string;
  bounds: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  labelPos: { x: number; y: number };
};

const SNAP_STROKE_WIDTH = 0.9;
const SNAP_CROSS_SIZE = 1.6;
const SNAP_APPROACH_DISTANCE = 2.8;

const SNAP_IDLE_START = {
  x: snapGuidesInitial.movingNode.center.x + 15.5,
  y: snapGuidesInitial.movingNode.center.y - 0.2
};

export function SnapGuidesCard() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SVGGElement | null>(null);
  const cursorStateRef = useRef<CursorFrame>({
    x: SNAP_IDLE_START.x,
    y: SNAP_IDLE_START.y,
    visible: true,
    pressed: false,
    cursor: CURSOR_FOR_DRAG.element
  });
  const [cursorFrame, setCursorFrame] = useState<CursorFrame>({ ...cursorStateRef.current });
  const [snapLines, setSnapLines] = useState<SnapGuideLine[]>([]);

  const commitCursor = (): void => setCursorFrame({ ...cursorStateRef.current });

  useLayoutEffect(() => {
    if (!rootRef.current || !sceneRef.current) {
      return;
    }

    mountRenderedScene(sceneRef.current, snapGuidesInitial.innerSvg);

    const movingNode = queryNode(sceneRef.current, snapGuidesInitial.movingNode);
    const movingLabel = queryLabel(sceneRef.current, snapGuidesInitial.movingNode);
    if (!movingNode || !movingLabel) {
      return;
    }

    const moveState: RectNode = cloneNode(snapGuidesInitial.movingNode);
    const finalCenter = { ...snapGuidesFinal.movingNode.center };
    const initialCenter = { ...snapGuidesInitial.movingNode.center };
    const peerX = snapGuidesFinal.peerX;
    const peerY = snapGuidesFinal.peerY;
    const travelVector = {
      x: finalCenter.x - initialCenter.x,
      y: finalCenter.y - initialCenter.y
    };
    const travelLength = Math.hypot(travelVector.x, travelVector.y) || 1;
    const preSnapCenter = {
      x: finalCenter.x - (travelVector.x / travelLength) * SNAP_APPROACH_DISTANCE,
      y: finalCenter.y - (travelVector.y / travelLength) * SNAP_APPROACH_DISTANCE
    };
    const preSnapBounds = {
      x: preSnapCenter.x - moveState.bounds.width / 2,
      y: preSnapCenter.y - moveState.bounds.height / 2,
      width: moveState.bounds.width,
      height: moveState.bounds.height
    };
    const cursorGrabOffsetX = snapGuidesInitial.movingNode.bounds.width * 0.22;
    const cursorGrabOffsetY = snapGuidesInitial.movingNode.bounds.height * 0.22;
    const preSnapGrab = {
      x: preSnapCenter.x + cursorGrabOffsetX,
      y: preSnapCenter.y + cursorGrabOffsetY
    };
    const finalGrab = {
      x: finalCenter.x + cursorGrabOffsetX,
      y: finalCenter.y + cursorGrabOffsetY
    };

    const updateMoving = (showSnapLines: boolean): void => {
      setSvgAttrs(movingNode, {
        d: rectPathD(moveState.bounds)
      });
      setSvgAttrs(movingLabel, {
        x: moveState.labelPos.x,
        y: moveState.labelPos.y
      });

      const nextLines: SnapGuideLine[] = [];
      if (showSnapLines) {
        nextLines.push({
          type: "points",
          axis: "x",
          points: [
            { x: peerX.center.x, y: peerX.center.y },
            { x: finalCenter.x, y: finalCenter.y }
          ]
        });
      }
      if (showSnapLines) {
        nextLines.push({
          type: "points",
          axis: "y",
          points: [
            { x: peerY.center.x, y: peerY.center.y },
            { x: finalCenter.x, y: finalCenter.y }
          ]
        });
      }
      setSnapLines(nextLines);
    };

    const ctx = gsap.context(() => {
      Object.assign(cursorStateRef.current, {
        x: SNAP_IDLE_START.x,
        y: SNAP_IDLE_START.y,
        visible: true,
        pressed: false,
        cursor: "pointer"
      });
      commitCursor();
      setSnapLines([]);

      const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.8 });
      const cursor = createCursorScript(tl, cursorStateRef.current, commitCursor);
      const hoverHold = 0.18;
      const cursorPath = createCursorPathScript(cursor, {
        idleAbove: SNAP_IDLE_START,
        hoverOnNode: { x: snapGuidesInitial.movingNode.center.x + cursorGrabOffsetX, y: snapGuidesInitial.movingNode.center.y + cursorGrabOffsetY },
        dragToTarget: finalGrab,
        releaseAbove: { x: finalGrab.x + 0.3, y: finalGrab.y - 1.2 }
      });

      cursor.setStyle("pointer", 0);
      tl.to({}, { duration: 0.28, ease: "none" }, 0);

      tl.add("hoverMove");
      cursorPath.moveTo("hoverOnNode", 0.34, "hoverMove", "power1.inOut");
      cursor.setStyle(CURSOR_FOR_DRAG.element, "hoverMove+=0.34");
      tl.to({}, { duration: hoverHold, ease: "none" }, "hoverMove+=0.34");

      tl.add("press", `hoverMove+=${0.34 + hoverHold}`);
      cursor.setPressed(true, "press");

      tl.add("drag", "press+=0.12");
      cursorPath.moveTo("dragToTarget", 0.84, "drag", "power1.inOut");
      tl.to(moveState.bounds, {
        x: preSnapBounds.x,
        y: preSnapBounds.y,
        duration: 0.84,
        ease: "power1.inOut",
        onUpdate: () => {
          moveState.center.x = moveState.bounds.x + moveState.bounds.width / 2;
          moveState.center.y = moveState.bounds.y + moveState.bounds.height / 2;
          moveState.labelPos.x = snapGuidesInitial.movingNode.labelPos.x + (moveState.bounds.x - snapGuidesInitial.movingNode.bounds.x);
          moveState.labelPos.y = snapGuidesInitial.movingNode.labelPos.y + (moveState.bounds.y - snapGuidesInitial.movingNode.bounds.y);
          updateMoving(false);
        }
      }, "drag");
      tl.call(() => {
        Object.assign(moveState.bounds, snapGuidesFinal.movingNode.bounds);
        Object.assign(moveState.center, snapGuidesFinal.movingNode.center);
        Object.assign(moveState.labelPos, snapGuidesFinal.movingNode.labelPos);
        updateMoving(true);
      }, undefined, "drag+=0.92");
      cursorPath.jumpTo("dragToTarget", "drag+=0.92");

      // Hold at snapped position so viewer can see the guides.
      tl.to({}, { duration: 0.6, ease: "none" }, "drag+=0.92");

      tl.add("release", "drag+=1.52");
      cursor.setPressed(false, "release");
      cursor.setStyle("pointer", "release");
      tl.call(() => {
        setSnapLines([]);
      }, undefined, "release+=0.05");

      tl.add("reset", "release+=0.4");
      cursorPath.moveTo("idleAbove", 0.4, "reset", "power1.inOut");
      tl.call(() => {
        Object.assign(moveState.bounds, snapGuidesInitial.movingNode.bounds);
        Object.assign(moveState.center, snapGuidesInitial.movingNode.center);
        Object.assign(moveState.labelPos, snapGuidesInitial.movingNode.labelPos);
        updateMoving(false);
      }, undefined, "reset");
      cursor.setStyle("pointer", "reset+=0.3");
    }, rootRef);

    updateMoving(false);
    return () => ctx.revert();
  }, []);

  return (
    <article className="featureCard" ref={rootRef}>
      <div className="featureCardTitle">Snap guides appear while moving a node</div>
      <svg className="featureScene" viewBox={snapGuidesCommonViewBox} role="img" aria-label="Snap guides demo">
        <g ref={sceneRef} />
        <SnapGuidesOverlay lines={snapLines} strokeWidth={SNAP_STROKE_WIDTH} crossSize={SNAP_CROSS_SIZE} />
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

function queryNode(root: ParentNode, node: RectNode): SVGPathElement | null {
  return queryRenderedElement<SVGPathElement>(root, `path[data-source-id="${node.sourceId}"]:not([fill="none"])`);
}

function queryLabel(root: ParentNode, node: RectNode): SVGSVGElement | null {
  return queryRenderedElement<SVGSVGElement>(root, `svg[data-source-id="${node.sourceId}"][data-text-renderer="mathjax"]`);
}

function cloneNode(node: RectNode): RectNode {
  return {
    sourceId: node.sourceId,
    bounds: { ...node.bounds },
    center: { ...node.center },
    labelPos: { ...node.labelPos }
  };
}

function rectPathD(bounds: { x: number; y: number; width: number; height: number }): string {
  const x0 = bounds.x;
  const y0 = bounds.y;
  const x1 = bounds.x + bounds.width;
  const y1 = bounds.y + bounds.height;
  return `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1} L ${x0} ${y1} Z`;
}
