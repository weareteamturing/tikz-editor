import { describe, expect, it } from "vitest";
import type { ScenePath, SceneText } from "../../packages/core/src/semantic/types.js";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import { parseLength } from "../../packages/core/src/semantic/coords/parse-length.js";
import { buildHitRegions } from "../../packages/app/src/ui/canvas-panel/hit-regions.js";
import {
  collectSelectionBounds,
  collectSourceBounds,
  isPointInsideRectHitRegionContentBox,
  rectHitRegionsForTargetId,
  resolveGridResizeSnapForHandleDrag,
  resolveRectHitRegionContentBox
} from "../../packages/app/src/ui/canvas-panel/panel-helpers.js";
import type { HitRegion } from "../../packages/app/src/ui/canvas-panel/hit-regions.js";
import { renderTikzToSvg } from "../../packages/core/src/render/index.js";

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

  it("adds a stroke hit region for selected scope bounds", () => {
    const text: SceneText = {
      kind: "Text",
      id: "scene-text:scope-member",
      runtimeId: "runtime:scene-text:scope-member",
      sourceRef: {
        sourceId: "path:1",
        sourceSpan: { from: 0, to: 0 },
        sourceFingerprint: "test-fingerprint"
      },
      style: {
        fontSize: 10
      } as SceneText["style"],
      styleChain: [],
      position: { x: 20, y: 20 },
      text: "A",
      textBlockWidth: 10,
      textBlockHeight: 6
    };

    const regions = buildHitRegions(
      [text],
      { x: 0, y: 0, width: 100, height: 100 },
      2,
      [{ scopeId: "scope:0", bounds: { minX: 10, minY: 15, maxX: 30, maxY: 25 } }]
    );
    const scopeRegion = regions.find(
      (region): region is Extract<HitRegion, { shape: "rect" }> => region.key === "scope-hit:scope:0"
    );

    expect(scopeRegion).toBeDefined();
    if (!scopeRegion) {
      return;
    }

    expect(scopeRegion.targetId).toBe("scope:0");
    expect(scopeRegion.sourceId).toBe("scope:0");
    expect(scopeRegion.interactionMode).toBe("move");
    expect(scopeRegion.pointerMode).toBe("stroke");
    expect(scopeRegion.strokeWidth).toBeCloseTo(9, 6);
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

describe("hit region and selection integrity", () => {
  it("builds non-empty source/target IDs for statements before/inside/after foreach", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[red] (1.68,0.2) rectangle (1,-0.32);
  \foreach \x in {0,1} { \draw (0,0) -- (1,1); }
  \draw[blue] (-0.6,1.4) rectangle (0.2,0.8);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const regions = buildHitRegions(rendered.semantic.scene.elements, rendered.svg.viewBox, 1);
    expect(regions.length).toBeGreaterThan(0);
    expect(regions.every((region) => region.sourceId.trim().length > 0)).toBe(true);
    expect(regions.every((region) => region.targetId.trim().length > 0)).toBe(true);
    expect(regions.some((region) => region.targetId === "path:2")).toBe(true);
  });

  it("collects selection bounds for post-foreach statements deterministically", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[red] (0,0) rectangle (1,1);
  \foreach \x in {0,1} { \draw (\x,0) -- (\x,1); }
  \draw[blue] (4,0) rectangle (5,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const selected = new Set<string>(["path:2"]);
    const selections = collectSelectionBounds(rendered.semantic.scene.elements, selected, rendered.svg.viewBox);
    expect(selections).toHaveLength(1);
    expect(selections[0]?.sourceId).toBe("path:2");
  });

  it("applies affine transforms to path hit regions", () => {
    const source = String.raw`\tikz \node[draw,xscale=0.6,minimum width=100pt] at (0.78,-2.26) {Hello};`;
    const rendered = renderTikzToSvg(source);
    const regions = buildHitRegions(rendered.semantic.scene.elements, rendered.svg.viewBox, 1);
    const pathRegion = regions.find((region): region is Extract<HitRegion, { shape: "path" }> => region.shape === "path");
    expect(pathRegion).toBeDefined();
    if (!pathRegion) {
      return;
    }
    expect(pathRegion.transform).toBeDefined();
    if (!pathRegion.transform) {
      return;
    }
    expect(pathRegion.transform.a).toBeCloseTo(0.6, 3);
    expect(pathRegion.transform.d).toBeCloseTo(1, 3);
  });

  it("applies node affine transforms when collecting selection bounds", () => {
    const baseSource = String.raw`\tikz \node[draw,minimum width=100pt] (C) at (0.78,-2.26) {Hello};`;
    const scaledSource = String.raw`\tikz \node[draw,xscale=0.6,minimum width=100pt] (C) at (0.78,-2.26) {Hello};`;

    const baseRendered = renderTikzToSvg(baseSource);
    const scaledRendered = renderTikzToSvg(scaledSource);

    const baseSourceId = baseRendered.semantic.scene.elements.find((element) => !element.adornment)?.sourceRef.sourceId;
    const scaledSourceId = scaledRendered.semantic.scene.elements.find((element) => !element.adornment)?.sourceRef.sourceId;
    expect(baseSourceId).toBeDefined();
    expect(scaledSourceId).toBeDefined();
    if (!baseSourceId || !scaledSourceId) {
      return;
    }

    const baseBounds = collectSelectionBounds(baseRendered.semantic.scene.elements, new Set([baseSourceId]), baseRendered.svg.viewBox)[0]
      ?.bounds;
    const scaledBounds = collectSelectionBounds(
      scaledRendered.semantic.scene.elements,
      new Set([scaledSourceId]),
      scaledRendered.svg.viewBox
    )[0]?.bounds;

    expect(baseBounds).toBeDefined();
    expect(scaledBounds).toBeDefined();
    if (!baseBounds || !scaledBounds) {
      return;
    }

    const baseWidth = baseBounds.maxX - baseBounds.minX;
    const scaledWidth = scaledBounds.maxX - scaledBounds.minX;
    expect(scaledWidth / baseWidth).toBeCloseTo(0.6, 1);
  });
});
