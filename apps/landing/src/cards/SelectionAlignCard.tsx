import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import gsap from "gsap";
import {
  RiAlignItemHorizontalCenterLine,
  RiAlignItemLeftLine,
  RiAlignItemRightLine
} from "@remixicon/react";
import { CursorOverlay } from "../cursor-overlay";
import { createCursorScript, type CursorFrame, type CursorScript } from "../cursor-script";
import { mountRenderedScene, queryRenderedElement } from "../animation/rendered-scene";
import { setSvgAttrs } from "../animation/svg-actors";
import { renderEditHandlesForBounds } from "../edit-handles";
import {
  selectionAlignCommonViewBox,
  selectionAlignInitial,
  type SelectionAlignCardState
} from "../generated/feature-svgs";

type NodeState = SelectionAlignCardState["leftNodes"][number];
type Rect = { x: number; y: number; width: number; height: number };

const BUTTON = {
  width: 14,
  height: 12
};

const TOOLBAR_GAP = 6;
const MARQUEE_PAD = 5.5;
const CURSOR_OVERSHOOT = 2.6;

function centerAlign(nodes: readonly NodeState[]): NodeState[] {
  const bounds = unionBounds(nodes);
  const targetCenterX = bounds.x + bounds.width / 2;
  return nodes.map((node) => {
    const nodeCenterX = node.bounds.x + node.bounds.width / 2;
    const dx = targetCenterX - nodeCenterX;
    return {
      sourceId: node.sourceId,
      bounds: { ...node.bounds, x: node.bounds.x + dx },
      center: { x: node.center.x + dx, y: node.center.y },
      labelPos: { x: node.labelPos.x + dx, y: node.labelPos.y }
    };
  });
}

function padBounds(bounds: Rect, pad: number): Rect {
  return {
    x: bounds.x - pad,
    y: bounds.y - pad,
    width: bounds.width + pad * 2,
    height: bounds.height + pad * 2
  };
}

export function SelectionAlignCard() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SVGGElement | null>(null);
  const marqueeRef = useRef<SVGRectElement | null>(null);
  const leftOverlayRefs = useRef<Array<SVGGElement | null>>([]);
  const rightOverlayRefs = useRef<Array<SVGGElement | null>>([]);
  const leftSelectedRef = useRef(false);
  const rightSelectedRef = useRef(false);
  const marqueeVisibleRef = useRef(false);
  const toolbarVisibleRef = useRef(false);
  const alignPressedRef = useRef(false);
  const cursorStateRef = useRef<CursorFrame>({
    x: 0,
    y: 0,
    visible: true,
    pressed: false,
    cursor: "pointer"
  });
  const [cursorFrame, setCursorFrame] = useState<CursorFrame>({ ...cursorStateRef.current });
  const [leftSelected, setLeftSelected] = useState(false);
  const [rightSelected, setRightSelected] = useState(false);
  const [marqueeVisible, setMarqueeVisible] = useState(false);
  const [alignPressed, setAlignPressed] = useState(false);
  const [toolbarVisible, setToolbarVisible] = useState(false);

  const commitCursor = (): void => setCursorFrame({ ...cursorStateRef.current });

  const leftInitial = selectionAlignInitial.leftNodes;
  const rightInitial = selectionAlignInitial.rightNodes;

  const leftFinal = useMemo(() => centerAlign(leftInitial), [leftInitial]);
  const rightFinal = useMemo(() => centerAlign(rightInitial), [rightInitial]);

  const leftBounds = useMemo(() => unionBounds(leftInitial), [leftInitial]);
  const rightBounds = useMemo(() => unionBounds(rightInitial), [rightInitial]);

  const allBounds = useMemo(() => unionBounds([...leftInitial, ...rightInitial]), [leftInitial, rightInitial]);

  const toolbar = useMemo(() => {
    const [vbX, , vbW] = selectionAlignCommonViewBox.split(/\s+/).map(Number);
    const imageCenterX = vbX! + vbW! / 2;
    const totalWidth = BUTTON.width * 3;
    return {
      x: imageCenterX - totalWidth / 2,
      y: allBounds.y - MARQUEE_PAD - TOOLBAR_GAP - BUTTON.height
    };
  }, [allBounds]);

  useLayoutEffect(() => {
    if (!rootRef.current || !sceneRef.current) {
      return;
    }

    mountRenderedScene(sceneRef.current, selectionAlignInitial.innerSvg);

    const leftNodePaths = leftInitial.map((node) => queryNodePath(sceneRef.current!, node));
    const leftLabels = leftInitial.map((node) => queryNodeLabel(sceneRef.current!, node));
    const rightNodePaths = rightInitial.map((node) => queryNodePath(sceneRef.current!, node));
    const rightLabels = rightInitial.map((node) => queryNodeLabel(sceneRef.current!, node));
    const edgePaths = Array.from(
      sceneRef.current.querySelectorAll('path[data-source-id][fill="none"][stroke="black"]:not([data-arrow-tip-kind])')
    ) as SVGPathElement[];

    if (
      leftNodePaths.some((el) => !el) ||
      leftLabels.some((el) => !el) ||
      rightNodePaths.some((el) => !el) ||
      rightLabels.some((el) => !el) ||
      edgePaths.length < leftInitial.length * rightInitial.length
    ) {
      return;
    }

    const leftStates: NodeState[] = leftInitial.map((node) => cloneNode(node));
    const rightStates: NodeState[] = rightInitial.map((node) => cloneNode(node));

    const updateEdges = (): void => {
      let edgeIndex = 0;
      for (const left of leftStates) {
        for (const right of rightStates) {
          const from = { x: left.bounds.x + left.bounds.width, y: left.center.y };
          const to = { x: right.bounds.x, y: right.center.y };
          setSvgAttrs(edgePaths[edgeIndex]!, { d: `M ${from.x} ${from.y} L ${to.x} ${to.y}` });
          edgeIndex += 1;
        }
      }
    };

    const updateGroup = (
      states: NodeState[],
      initials: readonly NodeState[],
      paths: (SVGPathElement | null)[],
      labels: (SVGSVGElement | null)[],
      overlays: Array<SVGGElement | null>,
      visible: boolean
    ): void => {
      states.forEach((state, index) => {
        const path = paths[index];
        const label = labels[index];
        if (path) setSvgAttrs(path, { d: rectPathD(state.bounds) });
        if (label) setSvgAttrs(label, { x: state.labelPos.x, y: state.labelPos.y });
        const group = overlays[index];
        const initial = initials[index];
        if (group && initial) {
          group.style.display = visible ? "inline" : "none";
          setSvgAttrs(group, {
            transform: `translate(${state.bounds.x - initial.bounds.x} ${state.bounds.y - initial.bounds.y})`
          });
        }
      });
    };

    const updateMarquee = (): void => {
      const rect = marqueeRef.current;
      if (!rect) return;
      setSvgAttrs(rect, {
        x: marqueeState.x,
        y: marqueeState.y,
        width: marqueeState.width,
        height: marqueeState.height
      });
      rect.style.display = marqueeVisibleRef.current ? "inline" : "none";
    };

    const updateAll = (): void => {
      updateGroup(leftStates, leftInitial, leftNodePaths, leftLabels, leftOverlayRefs.current, leftSelectedRef.current);
      updateGroup(rightStates, rightInitial, rightNodePaths, rightLabels, rightOverlayRefs.current, rightSelectedRef.current);
      updateEdges();
      updateMarquee();
    };

    const marqueeState: Rect = { x: 0, y: 0, width: 0.001, height: 0.001 };

    const resetAll = (): void => {
      leftSelectedRef.current = false;
      rightSelectedRef.current = false;
      marqueeVisibleRef.current = false;
      toolbarVisibleRef.current = false;
      alignPressedRef.current = false;
      setLeftSelected(false);
      setRightSelected(false);
      setToolbarVisible(false);
      setAlignPressed(false);
      setMarqueeVisible(false);
      marqueeState.x = 0;
      marqueeState.y = 0;
      marqueeState.width = 0.001;
      marqueeState.height = 0.001;
      leftStates.forEach((state, index) => {
        Object.assign(state.bounds, leftInitial[index]!.bounds);
        Object.assign(state.center, leftInitial[index]!.center);
        Object.assign(state.labelPos, leftInitial[index]!.labelPos);
      });
      rightStates.forEach((state, index) => {
        Object.assign(state.bounds, rightInitial[index]!.bounds);
        Object.assign(state.center, rightInitial[index]!.center);
        Object.assign(state.labelPos, rightInitial[index]!.labelPos);
      });
      updateAll();
    };

    const toolbarCenter = {
      x: toolbar.x + BUTTON.width + BUTTON.width / 2,
      y: toolbar.y + BUTTON.height / 2
    };

    const runPhase = (
      tl: gsap.core.Timeline,
      cursor: CursorScript,
      label: string,
      options: {
        selectionBounds: Rect;
        states: NodeState[];
        finals: NodeState[];
        selectedRef: { current: boolean };
        setSelected: (v: boolean) => void;
        showLeftAfter: boolean;
        showRightAfter: boolean;
      }
    ): string => {
      const marqueeTarget = padBounds(options.selectionBounds, MARQUEE_PAD);
      const anchor = {
        x: marqueeTarget.x - CURSOR_OVERSHOOT,
        y: marqueeTarget.y - CURSOR_OVERSHOOT
      };
      const dragTip = {
        x: marqueeTarget.x + marqueeTarget.width + CURSOR_OVERSHOOT,
        y: marqueeTarget.y + marqueeTarget.height + CURSOR_OVERSHOOT
      };

      const move = `${label}-move`;
      const press = `${label}-press`;
      const release = `${label}-release`;
      const btnMove = `${label}-btnMove`;
      const btnHover = `${label}-btnHover`;
      const btnPress = `${label}-btnPress`;
      const end = `${label}-end`;

      tl.add(move);
      cursor.setStyle("pointer", move);
      cursor.moveTo(anchor.x, anchor.y, 0.36, move, "power1.inOut");
      tl.to({}, { duration: 0.18, ease: "none" }, `${move}+=0.36`);

      tl.add(press, `${move}+=0.54`);
      cursor.setPressed(true, press);
      cursor.setStyle("crosshair", press);

      tl.call(() => {
        marqueeState.x = marqueeTarget.x;
        marqueeState.y = marqueeTarget.y;
        marqueeState.width = 0.001;
        marqueeState.height = 0.001;
        marqueeVisibleRef.current = true;
        setMarqueeVisible(true);
        updateMarquee();
      }, undefined, press);

      tl.to(
        marqueeState,
        {
          width: marqueeTarget.width,
          height: marqueeTarget.height,
          duration: 0.7,
          ease: "power1.inOut",
          onUpdate: updateMarquee
        },
        `${press}+=0.06`
      );
      cursor.moveTo(dragTip.x, dragTip.y, 0.7, `${press}+=0.06`, "power1.inOut");

      tl.add(release, `${press}+=0.82`);
      cursor.setPressed(false, release);

      tl.call(() => {
        options.selectedRef.current = true;
        options.setSelected(true);
        toolbarVisibleRef.current = true;
        setToolbarVisible(true);
        marqueeVisibleRef.current = false;
        setMarqueeVisible(false);
        updateAll();
      }, undefined, `${release}+=0.04`);

      tl.add(btnMove, `${release}+=0.3`);
      cursor.setStyle("pointer", btnMove);
      cursor.moveTo(toolbarCenter.x, toolbarCenter.y, 0.46, btnMove, "power1.inOut");

      tl.add(btnHover, `${btnMove}+=0.48`);
      tl.to({}, { duration: 0.36, ease: "none" }, btnHover);

      tl.add(btnPress, `${btnHover}+=0.36`);
      cursor.setPressed(true, btnPress);
      tl.call(() => {
        alignPressedRef.current = true;
        setAlignPressed(true);
      }, undefined, btnPress);

      tl.call(() => {
        options.states.forEach((state, index) => {
          const final = options.finals[index]!;
          Object.assign(state.bounds, final.bounds);
          Object.assign(state.center, final.center);
          Object.assign(state.labelPos, final.labelPos);
        });
        updateAll();
      }, undefined, `${btnPress}+=0.08`);

      tl.to({}, { duration: 0.14, ease: "none" }, `${btnPress}+=0.24`);
      cursor.setPressed(false, `${btnPress}+=0.18`);
      tl.call(() => {
        alignPressedRef.current = false;
        setAlignPressed(false);
      }, undefined, `${btnPress}+=0.24`);

      tl.add(end, `${btnPress}+=0.7`);
      // Optionally clear selection for hand-off to next phase.
      tl.call(() => {
        if (!options.showLeftAfter) {
          leftSelectedRef.current = false;
          setLeftSelected(false);
        }
        if (!options.showRightAfter) {
          rightSelectedRef.current = false;
          setRightSelected(false);
        }
        toolbarVisibleRef.current = false;
        setToolbarVisible(false);
        updateAll();
      }, undefined, end);

      return end;
    };

    const ctx = gsap.context(() => {
      const startPos = {
        x: padBounds(leftBounds, MARQUEE_PAD).x - CURSOR_OVERSHOOT - 4,
        y: padBounds(leftBounds, MARQUEE_PAD).y - CURSOR_OVERSHOOT - 3
      };
      Object.assign(cursorStateRef.current, {
        x: startPos.x,
        y: startPos.y,
        visible: true,
        pressed: false,
        cursor: "pointer"
      });
      commitCursor();
      resetAll();

      const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.9 });
      const cursor = createCursorScript(tl, cursorStateRef.current, commitCursor);

      tl.to({}, { duration: 0.22, ease: "none" }, 0);

      const afterLeft = runPhase(tl, cursor, "left", {
        selectionBounds: leftBounds,
        states: leftStates,
        finals: leftFinal,
        selectedRef: leftSelectedRef,
        setSelected: setLeftSelected,
        showLeftAfter: false,
        showRightAfter: false
      });

      const afterRight = runPhase(tl, cursor, "right", {
        selectionBounds: rightBounds,
        states: rightStates,
        finals: rightFinal,
        selectedRef: rightSelectedRef,
        setSelected: setRightSelected,
        showLeftAfter: true,
        showRightAfter: false
      });
      // Position the right phase after the left phase finishes.
      // (runPhase already appends sequentially via bare labels.)
      void afterLeft;
      void afterRight;

      tl.add("reset", `${afterRight}+=0.2`);
      cursor.moveTo(startPos.x, startPos.y, 0.4, "reset", "power1.inOut");
      tl.call(resetAll, undefined, "reset+=0.05");
      cursor.setStyle("pointer", "reset+=0.26");
    }, rootRef);

    return () => ctx.revert();
  }, [leftBounds, rightBounds, leftInitial, rightInitial, leftFinal, rightFinal, toolbar]);

  return (
    <article className="featureCard" ref={rootRef}>
      <div className="featureCardTitle">Marquee select and align center</div>
      <svg className="featureScene" viewBox={selectionAlignCommonViewBox} role="img" aria-label="Align selection demo">
        <g ref={(el) => { sceneRef.current = el; }} />

        <rect
          ref={marqueeRef}
          x={0}
          y={0}
          width={0.001}
          height={0.001}
          className="marqueeRect"
          style={{ display: marqueeVisible ? "inline" : "none" }}
        />

        {leftInitial.map((node, index) => (
          <g
            key={node.sourceId}
            ref={(el) => { leftOverlayRefs.current[index] = el; }}
            style={{ display: leftSelected ? "inline" : "none" }}
          >
            {renderEditHandlesForBounds({
              bounds: node.bounds,
              showRotateHandle: false,
              handleHalfSize: 1.05,
              handleStrokeWidth: 0.26,
              selectionStrokeWidth: 0.24,
              rotateHandleGap: 5.2
            })}
          </g>
        ))}

        {rightInitial.map((node, index) => (
          <g
            key={node.sourceId}
            ref={(el) => { rightOverlayRefs.current[index] = el; }}
            style={{ display: rightSelected ? "inline" : "none" }}
          >
            {renderEditHandlesForBounds({
              bounds: node.bounds,
              showRotateHandle: false,
              handleHalfSize: 1.05,
              handleStrokeWidth: 0.26,
              selectionStrokeWidth: 0.24,
              rotateHandleGap: 5.2
            })}
          </g>
        ))}

        <g style={{ opacity: toolbarVisible ? 1 : 0, transition: "opacity 120ms linear" }}>
          <ToolbarButton x={toolbar.x} y={toolbar.y} active={false} label="Align left">
            <RiAlignItemLeftLine size={14} />
          </ToolbarButton>
          <ToolbarButton x={toolbar.x + BUTTON.width} y={toolbar.y} active={alignPressed} label="Align center">
            <RiAlignItemHorizontalCenterLine size={14} />
          </ToolbarButton>
          <ToolbarButton x={toolbar.x + BUTTON.width * 2} y={toolbar.y} active={false} label="Align right">
            <RiAlignItemRightLine size={14} />
          </ToolbarButton>
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

function ToolbarButton({
  x,
  y,
  active,
  label,
  children
}: {
  x: number;
  y: number;
  active: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <g aria-label={label} transform={`translate(${x} ${y})`}>
      <rect
        width={BUTTON.width}
        height={BUTTON.height}
        rx={0.4}
        ry={0.4}
        fill={active ? "color-mix(in srgb, var(--text) 18%, transparent)" : "var(--btn-disabled-bg)"}
        stroke="var(--border-light)"
        strokeWidth={0.3}
      />
      <g transform={`translate(${BUTTON.width / 2} ${BUTTON.height / 2}) scale(${BUTTON.height * 0.75 / 14})`} style={{ color: active ? "var(--text)" : "var(--text-faint)" }}>
        <g transform="translate(-7 -7)">{children}</g>
      </g>
    </g>
  );
}

function queryNodePath(root: ParentNode, node: NodeState): SVGPathElement | null {
  return queryRenderedElement<SVGPathElement>(root, `path[data-source-id="${node.sourceId}"]:not([fill="none"])`);
}

function queryNodeLabel(root: ParentNode, node: NodeState): SVGSVGElement | null {
  return queryRenderedElement<SVGSVGElement>(root, `svg[data-source-id="${node.sourceId}"][data-text-renderer="mathjax"]`);
}

function cloneNode(node: NodeState): NodeState {
  return {
    sourceId: node.sourceId,
    bounds: { ...node.bounds },
    center: { ...node.center },
    labelPos: { ...node.labelPos }
  };
}

function rectPathD(bounds: Rect): string {
  const x0 = bounds.x;
  const y0 = bounds.y;
  const x1 = bounds.x + bounds.width;
  const y1 = bounds.y + bounds.height;
  return `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1} L ${x0} ${y1} Z`;
}

function unionBounds(nodes: readonly NodeState[]): Rect {
  const xs = nodes.flatMap((node) => [node.bounds.x, node.bounds.x + node.bounds.width]);
  const ys = nodes.flatMap((node) => [node.bounds.y, node.bounds.y + node.bounds.height]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  };
}
