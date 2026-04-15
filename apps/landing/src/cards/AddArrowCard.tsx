import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { CursorOverlay } from "../cursor-overlay";
import { CURSOR_FOR_DRAG } from "../cursor-conventions";
import { createCursorScript, type CursorFrame } from "../cursor-script";
import { addArrowFinal, addArrowInitial, addArrowCommonViewBox } from "../generated/feature-svgs";
import { AnchorOverlay, buildRectAnchorDots } from "../animation/anchor-overlay";
import { createCursorPathScript } from "../animation/cursor-path";
import { point } from "../animation/points";
import { mountRenderedScene } from "../animation/rendered-scene";
import { toSvgAttrs } from "../animation/svg-actors";
import type { AnchorDot, RectBounds } from "../animation/anchor-overlay";

type SceneRefs = {
  contentGroup: SVGGElement | null;
  previewLine: SVGLineElement | null;
  tipPath: SVGPathElement | null;
};

const NODE_REVEAL_RADIUS = 10.5;
const ANCHOR_SNAP_RADIUS = 4.2;

export function AddArrowCard() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneRefs>({
    contentGroup: null,
    previewLine: null,
    tipPath: null
  });
  const cursorStateRef = useRef<CursorFrame>({
    x: addArrowInitial.s.center.x,
    y: addArrowInitial.s.bounds.y - 18,
    visible: true,
    pressed: false,
    cursor: CURSOR_FOR_DRAG.toolCreate
  });
  const [cursorFrame, setCursorFrame] = useState<CursorFrame>({ ...cursorStateRef.current });

  const commitCursor = (): void => setCursorFrame({ ...cursorStateRef.current });
  const cursorPoint = point(cursorFrame.x, cursorFrame.y);
  const toolActive = cursorFrame.cursor === CURSOR_FOR_DRAG.toolCreate;
  const hoveredNode = toolActive
    ? resolveHoveredRectNode(cursorPoint, addArrowInitial.s.bounds, addArrowInitial.t.bounds)
    : null;
  const sAnchors = buildAnchorDots(addArrowInitial.s.bounds, hoveredNode === "s" ? cursorPoint : null);
  const tAnchors = buildAnchorDots(addArrowInitial.t.bounds, hoveredNode === "t" ? cursorPoint : null);

  useLayoutEffect(() => {
    if (!rootRef.current) {
      return;
    }

    const { contentGroup, previewLine, tipPath } = sceneRef.current;
    if (!contentGroup || !previewLine || !tipPath) {
      return;
    }

    mountRenderedScene(contentGroup, addArrowInitial.innerSvg);

    const sEast = point(addArrowInitial.s.bounds.x + addArrowInitial.s.bounds.width, addArrowInitial.s.center.y);
    const tWest = point(addArrowInitial.t.bounds.x, addArrowInitial.t.center.y);
    const initialAbove = point(addArrowInitial.s.center.x, addArrowInitial.s.bounds.y - 18);

    const ctx = gsap.context(() => {
      gsap.set([previewLine, tipPath], { autoAlpha: 0 });
      gsap.set(previewLine, {
        attr: { x1: sEast.x, y1: sEast.y, x2: sEast.x, y2: sEast.y }
      });
      gsap.set(tipPath, { attr: { d: addArrowFinal.edge?.tipD ?? "" } });

      Object.assign(cursorStateRef.current, {
        x: initialAbove.x,
        y: initialAbove.y,
        visible: true,
        pressed: false,
        cursor: CURSOR_FOR_DRAG.toolCreate
      });
      commitCursor();

      const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.85 });
      const cursor = createCursorScript(tl, cursorStateRef.current, commitCursor);
      const cursorPath = createCursorPathScript(cursor, {
        initialAbove,
        sourceAnchor: sEast,
        targetAnchor: tWest
      });

      cursor.setStyle(CURSOR_FOR_DRAG.toolCreate, 0);
      tl.to({}, { duration: 0.42, ease: "none" }, 0);

      tl.add("sourceMove");
      cursorPath.moveTo("sourceAnchor", 1.12, "sourceMove");

      tl.add("sourceHover", "sourceMove+=1.12");
      tl.to({}, { duration: 0.16, ease: "none" }, "sourceHover");

      tl.add("sourceClick", "sourceHover+=0.02");
      cursor.setPressed(true, "sourceClick");
      cursor.setPressed(false, "sourceClick+=0.12");
      tl.to(previewLine, { autoAlpha: 1, duration: 0.05, ease: "none" }, "sourceClick+=0.02");

      tl.add("targetMove", "sourceClick+=0.18");
      cursorPath.moveTo("targetAnchor", 0.86, "targetMove", "power1.inOut");
      cursor.setStyle(CURSOR_FOR_DRAG.toolCreate, "targetMove");
      toSvgAttrs(tl, previewLine, { x2: tWest.x, y2: tWest.y }, 0.86, "targetMove", "power1.inOut");

      tl.add("targetClick", "targetMove+=0.86");
      cursor.setPressed(true, "targetClick");
      cursor.setPressed(false, "targetClick+=0.12");
      tl.to(tipPath, { autoAlpha: 1, duration: 0.08, ease: "none" }, "targetClick+=0.02");

      tl.add("deactivateTool", "targetClick+=0.22");
      cursor.setStyle("pointer", "deactivateTool");
      tl.to({}, { duration: 0.18, ease: "none" }, "deactivateTool");

      tl.add("reset", "deactivateTool+=0.26");
      cursorPath.moveTo("initialAbove", 0.44, "reset", "power1.inOut");
      cursor.setPressed(false, "reset");
    }, rootRef);

    return () => ctx.revert();
  }, []);

  return (
    <article className="featureCard" ref={rootRef}>
      <div className="featureCardTitle">Add arrow snaps to node anchors</div>
      <svg className="featureScene" viewBox={addArrowCommonViewBox} role="img" aria-label="Add arrow demo">
        <g
          ref={(el) => {
            sceneRef.current.contentGroup = el;
          }}
        />

        <g
          pointerEvents="none"
        >
          <AnchorOverlay anchors={sAnchors} visible={hoveredNode === "s"} />
        </g>

        <g
          pointerEvents="none"
        >
          <AnchorOverlay anchors={tAnchors} visible={hoveredNode === "t"} />
        </g>

        <line
          ref={(el) => {
            sceneRef.current.previewLine = el;
          }}
          x1={addArrowInitial.s.bounds.x + addArrowInitial.s.bounds.width}
          y1={addArrowInitial.s.center.y}
          x2={addArrowInitial.s.bounds.x + addArrowInitial.s.bounds.width}
          y2={addArrowInitial.s.center.y}
          stroke="black"
          strokeWidth={0.4}
          strokeLinecap="butt"
          vectorEffect="non-scaling-stroke"
        />

        <path
          ref={(el) => {
            sceneRef.current.tipPath = el;
          }}
          fill="none"
          stroke="black"
          strokeWidth={0.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          d={addArrowFinal.edge?.tipD ?? ""}
        />

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

function buildAnchorDots(bounds: RectBounds, cursor: { x: number; y: number } | null): AnchorDot[] {
  const anchors = buildRectAnchorDots(bounds);
  if (!cursor) {
    return anchors.map((anchor) => ({ ...anchor, active: false }));
  }
  const snappedKey = resolveSnappedRectAnchor(bounds, cursor);
  return anchors.map((anchor) => ({
    ...anchor,
    active: anchor.key === snappedKey
  }));
}

function resolveHoveredRectNode(cursor: { x: number; y: number }, sBounds: RectBounds, tBounds: RectBounds): "s" | "t" | null {
  const sDistanceSq = distanceSquaredToBounds(cursor, sBounds);
  const tDistanceSq = distanceSquaredToBounds(cursor, tBounds);
  const revealRadiusSq = NODE_REVEAL_RADIUS * NODE_REVEAL_RADIUS;
  const nearest = sDistanceSq <= tDistanceSq ? "s" : "t";
  const nearestDistanceSq = nearest === "s" ? sDistanceSq : tDistanceSq;
  return nearestDistanceSq <= revealRadiusSq ? nearest : null;
}

function resolveSnappedRectAnchor(bounds: RectBounds, cursor: { x: number; y: number }): string | null {
  const anchors = buildRectAnchorDots(bounds);
  let snappedKey: string | null = null;
  let snappedDistanceSq = Number.POSITIVE_INFINITY;
  const snapRadiusSq = ANCHOR_SNAP_RADIUS * ANCHOR_SNAP_RADIUS;
  for (const anchor of anchors) {
    const dx = cursor.x - anchor.x;
    const dy = cursor.y - anchor.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > snapRadiusSq || distanceSq >= snappedDistanceSq) {
      continue;
    }
    snappedKey = anchor.key;
    snappedDistanceSq = distanceSq;
  }
  return snappedKey;
}

function distanceSquaredToBounds(
  point: { x: number; y: number },
  bounds: RectBounds
): number {
  const maxX = bounds.x + bounds.width;
  const maxY = bounds.y + bounds.height;
  const clampedX = Math.min(maxX, Math.max(bounds.x, point.x));
  const clampedY = Math.min(maxY, Math.max(bounds.y, point.y));
  const dx = point.x - clampedX;
  const dy = point.y - clampedY;
  return dx * dx + dy * dy;
}
