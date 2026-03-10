import { describe, expect, it } from "vitest";
import type { ScenePath, SceneText } from "../../packages/core/src/semantic/types.js";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import { parseLength } from "../../packages/core/src/semantic/coords/parse-length.js";
import { buildHitRegions } from "../../packages/app/src/ui/canvas-panel/hit-regions.js";
import {
  collectSourceBounds,
  isPointInsideRectHitRegionContentBox,
  rectHitRegionsForTargetId,
  resolveGridResizeSnapForHandleDrag,
  resolveRectHitRegionContentBox
} from "../../packages/app/src/ui/canvas-panel/panel-helpers.js";
import type { HitRegion } from "../../packages/app/src/ui/canvas-panel/hit-regions.js";

describe("rectHitRegionsForTargetId", () => {
  it("matches rect regions by target id rather than statement source id", () => {
    const hitRegions: HitRegion[] = [
      {
        shape: "rect",
        key: "hit:text",
        sourceId: "path:0",
        targetId: "node-adornment:node:0:2:label:0",
        x: 0,
        y: 0,
        width: 10,
        height: 4,
        cx: 5,
        cy: 2,
        rotation: 0
      },
      {
        shape: "rect",
        key: "hit:node-text",
        sourceId: "path:0",
        targetId: "path:0",
        x: 0,
        y: 0,
        width: 12,
        height: 4,
        cx: 6,
        cy: 2,
        rotation: 0
      }
    ];

    const result = rectHitRegionsForTargetId(hitRegions, "node-adornment:node:0:2:label:0");

    expect(result).toHaveLength(1);
    expect(result[0]?.key).toBe("hit:text");
  });

  it("keeps a smaller text-edit box inside enlarged adornment hit regions", () => {
    const region: Extract<HitRegion, { shape: "rect" }> = {
      shape: "rect",
      key: "hit:adornment",
      sourceId: "path:0",
      targetId: "node-adornment:node:0:2:label:0",
      x: -10,
      y: -6,
      width: 20,
      height: 12,
      cx: 0,
      cy: 0,
      rotation: 0,
      contentWidth: 12,
      contentHeight: 4
    };

    expect(resolveRectHitRegionContentBox(region)).toEqual({
      x: -6,
      y: -2,
      width: 12,
      height: 4
    });
    expect(isPointInsideRectHitRegionContentBox({ x: 0, y: 0 }, region)).toBe(true);
    expect(isPointInsideRectHitRegionContentBox({ x: 8, y: 0 }, region)).toBe(false);
  });

  it("adds an invisible halo around adornment text hit regions", () => {
    const text: SceneText = {
      kind: "Text",
      id: "scene-text:adornment",
      runtimeId: "runtime:scene-text:adornment",
      sourceRef: {
        sourceId: "path:0",
        sourceSpan: { from: 0, to: 0 },
        sourceFingerprint: "test-fingerprint"
      },
      style: {
        fontSize: 10
      } as SceneText["style"],
      styleChain: [],
      position: { x: 20, y: 30 },
      text: "Pin",
      textBlockWidth: 12,
      textBlockHeight: 4,
      adornment: {
        targetId: "node-adornment:node:0:2:pin:0",
        kind: "pin",
        ownerSourceId: "node:0:2",
        ownerNodeId: "node:0:2",
        adornmentIndex: 0,
        optionSpan: { from: 0, to: 0 },
        valueSpan: { from: 0, to: 0 },
        textSpan: { from: 0, to: 0 },
        angleRaw: "above",
        distancePt: 0,
        defaultDistancePt: 0,
        distanceExplicit: false
      }
    };

    const regions = buildHitRegions([text], { x: 0, y: 0, width: 100, height: 100 }, 2);
    expect(regions).toHaveLength(2);
    const haloRegion = regions[0];
    const textRegion = regions[1];

    expect(haloRegion?.shape).toBe("rect");
    expect(textRegion?.shape).toBe("rect");
    if (!haloRegion || haloRegion.shape !== "rect" || !textRegion || textRegion.shape !== "rect") {
      return;
    }

    expect(haloRegion.interactionMode).toBe("move");
    expect(textRegion.interactionMode).toBe("text");
    expect(haloRegion.width).toBeGreaterThan(textRegion.width);
    expect(haloRegion.height).toBeGreaterThan(textRegion.height);
  });

  it("uses only pin label text bounds for pin adornment selection boxes", () => {
    const pinText: SceneText = {
      kind: "Text",
      id: "scene-text:pin",
      runtimeId: "runtime:scene-text:pin",
      sourceRef: {
        sourceId: "path:0",
        sourceSpan: { from: 0, to: 0 },
        sourceFingerprint: "test-fingerprint"
      },
      style: {
        fontSize: 10
      } as SceneText["style"],
      styleChain: [],
      position: { x: 40, y: 20 },
      text: "P",
      textBlockWidth: 12,
      textBlockHeight: 4,
      adornment: {
        targetId: "node-adornment:node:0:2:pin:0",
        kind: "pin",
        ownerSourceId: "node:0:2",
        ownerNodeId: "node:0:2",
        adornmentIndex: 0,
        optionSpan: { from: 0, to: 0 },
        valueSpan: { from: 0, to: 0 },
        textSpan: { from: 0, to: 0 },
        angleRaw: "above",
        distancePt: 0,
        defaultDistancePt: 0,
        distanceExplicit: false
      }
    };
    const pinEdge: ScenePath = {
      kind: "Path",
      id: "scene-path:pin-edge",
      runtimeId: "runtime:scene-path:pin-edge",
      sourceRef: {
        sourceId: "path:0",
        sourceSpan: { from: 0, to: 0 },
        sourceFingerprint: "test-fingerprint"
      },
      style: {} as ScenePath["style"],
      styleChain: [],
      commands: [
        { kind: "M", to: { x: 0, y: 0 } },
        { kind: "L", to: { x: 40, y: 20 } }
      ],
      adornment: pinText.adornment
    };

    const boundsBySource = collectSourceBounds(
      [pinText, pinEdge],
      { x: 0, y: 0, width: 100, height: 100 }
    );
    const bounds = boundsBySource.get("node-adornment:node:0:2:pin:0");

    expect(bounds).toBeDefined();
    expect(bounds?.minX).toBeCloseTo(34, 6);
    expect(bounds?.maxX).toBeCloseTo(46, 6);
  });
});

describe("resolveGridResizeSnapForHandleDrag", () => {
  it("returns axis-specific step snapping for grid handle drags", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) grid[xstep=0.5cm, ystep=2pt] (2,3);
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const pathHandles = semantic.editHandles.filter(
      (handle) => handle.kind === "path-point"
    );
    expect(pathHandles).toHaveLength(2);
    const dragHandle = pathHandles[1]!;

    const result = resolveGridResizeSnapForHandleDrag(dragHandle, semantic.editHandles, parsed.figure.body);
    expect(result).toBeDefined();
    if (!result) {
      return;
    }

    expect(result.stepX).toBeCloseTo(parseLength("0.5cm", "cm")!, 6);
    expect(result.stepY).toBeCloseTo(parseLength("2pt", "cm")!, 6);
    expect(result.anchorWorld).toEqual(pathHandles[0]!.world);
  });

  it("returns null for non-grid paths", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- (2,3);
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const handle = semantic.editHandles.find((candidate) => candidate.kind === "path-point");
    expect(handle).toBeDefined();
    if (!handle) {
      return;
    }

    const result = resolveGridResizeSnapForHandleDrag(handle, semantic.editHandles, parsed.figure.body);
    expect(result).toBeNull();
  });
});
