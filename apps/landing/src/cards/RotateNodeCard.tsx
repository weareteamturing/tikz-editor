import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { CursorOverlay } from "../cursor-overlay";
import { CURSOR_FOR_ROTATE_HANDLE } from "../cursor-conventions";
import { createCursorScript, type CursorFrame } from "../cursor-script";
import { renderEditHandlesForBounds } from "../edit-handles";
import { rotateNodeInitial } from "../generated/feature-svgs";
import { createCursorPathScript } from "../animation/cursor-path";
import { offsetPoint, point, rotatePointAround } from "../animation/points";
import { mountRenderedScene, queryRenderedElement } from "../animation/rendered-scene";
import { toSvgRotation } from "../animation/svg-actors";

type SceneRefs = {
  contentGroup: SVGGElement | null;
  handlesGroup: SVGGElement | null;
};

export function RotateNodeCard() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneRefs>({
    contentGroup: null,
    handlesGroup: null
  });
  const cursorStateRef = useRef<CursorFrame>({
    x: rotateNodeInitial.center.x - rotateNodeInitial.bounds.width / 2 - 28,
    y: rotateNodeInitial.center.y + rotateNodeInitial.bounds.height / 2 + 2,
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

    const { contentGroup, handlesGroup } = sceneRef.current;
    if (!contentGroup || !handlesGroup) {
      return;
    }

    mountRenderedScene(contentGroup, rotateNodeInitial.innerSvg);

    const bodyPath = queryRenderedElement<SVGPathElement>(contentGroup, 'path[data-source-id="path:1"]:not([data-arrow-tip-kind])');
    const labelSvg = queryRenderedElement<SVGSVGElement>(
      contentGroup,
      'svg[data-source-id="path:1"][data-text-renderer="mathjax"]'
    );
    if (!bodyPath || !labelSvg) {
      return;
    }

    const center = point(rotateNodeInitial.center.x, rotateNodeInitial.center.y);
    const bounds = rotateNodeInitial.bounds;
    const handleGap = 6.6;
    const handleStart = point(center.x, bounds.y - handleGap);
    const handleDragEnd = rotatePointAround(handleStart, center, 28);
    const initialBeside = offsetPoint(handleStart, -30, 2);

    const svgOrigin = `${center.x} ${center.y}`;

    const ctx = gsap.context(() => {
      gsap.set([bodyPath, labelSvg, handlesGroup], {
        rotation: 0,
        svgOrigin
      });

      Object.assign(cursorStateRef.current, {
        x: initialBeside.x,
        y: initialBeside.y,
        visible: true,
        pressed: false,
        cursor: "pointer"
      });
      commitCursor();

      const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.85 });
      const cursor = createCursorScript(tl, cursorStateRef.current, commitCursor);
      const cursorPath = createCursorPathScript(cursor, {
        initialBeside,
        handleStart,
        handleDragEnd
      });

      tl.add("approachHandle");
      cursorPath.moveTo("handleStart", 0.36, "approachHandle");
      cursor.setStyle(CURSOR_FOR_ROTATE_HANDLE, "approachHandle+=0.36");

      tl.add("grabHandle", "approachHandle+=0.36");
      cursor.setPressed(true, "grabHandle");
      cursor.setPressed(false, "grabHandle+=0.12");

      tl.add("rotateForward", "grabHandle+=0.16");
      cursorPath.moveTo("handleDragEnd", 0.84, "rotateForward", "power2.inOut");
      toSvgRotation(tl, bodyPath, 28, svgOrigin, 0.84, "rotateForward", "power2.inOut");
      toSvgRotation(tl, labelSvg, 28, svgOrigin, 0.84, "rotateForward", "power2.inOut");
      toSvgRotation(tl, handlesGroup, 28, svgOrigin, 0.84, "rotateForward", "power2.inOut");

      tl.add("release", "rotateForward+=0.84");
      cursor.setPressed(false, "release");

      tl.add("rotateBack", "release+=0.34");
      cursorPath.moveTo("handleStart", 0.72, "rotateBack", "power2.inOut");
      toSvgRotation(tl, bodyPath, 0, svgOrigin, 0.72, "rotateBack", "power2.inOut");
      toSvgRotation(tl, labelSvg, 0, svgOrigin, 0.72, "rotateBack", "power2.inOut");
      toSvgRotation(tl, handlesGroup, 0, svgOrigin, 0.72, "rotateBack", "power2.inOut");

      tl.add("returnStart", "rotateBack+=0.72");
      cursorPath.moveTo("initialBeside", 0.42, "returnStart", "power1.inOut");
      cursor.setStyle("pointer", "returnStart");
      cursor.setPressed(false, "returnStart");
    }, rootRef);

    return () => ctx.revert();
  }, []);

  const initialBounds = {
    x: rotateNodeInitial.bounds.x,
    y: rotateNodeInitial.bounds.y,
    width: rotateNodeInitial.bounds.width,
    height: rotateNodeInitial.bounds.height
  };

  return (
    <article className="featureCard" ref={rootRef}>
      <div className="featureCardTitle">Rotate handle spins the node</div>
      <svg className="featureScene" viewBox={rotateNodeInitial.viewBox} role="img" aria-label="Rotate node demo">
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
            handleHalfSize: 1.15,
            handleStrokeWidth: 0.26,
            selectionStrokeWidth: 0.24,
            rotateHandleGap: 6.6
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
