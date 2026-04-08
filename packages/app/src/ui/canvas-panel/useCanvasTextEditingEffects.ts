import { useEffect } from "react";
import { getActiveMathJaxOutputJax } from "tikz-editor/text/mathjax-engine";
import { getKnuthPlassPointFromOffset, getKnuthPlassSelectionRects } from "tikz-editor/text/knuth-plass";
import { clamp } from "./geometry";
import { createSourceRenderOffsetMap } from "./text-offset-map";

export type UseCanvasTextEditingEffectsArgs = {
  [key: string]: any;
};

const REGION_EPSILON = 1e-6;

function sameRectRegion(left: any, right: any): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    left.key === right.key &&
    left.sourceId === right.sourceId &&
    left.targetId === right.targetId &&
    left.interactionMode === right.interactionMode &&
    Math.abs(Number(left.x) - Number(right.x)) <= REGION_EPSILON &&
    Math.abs(Number(left.y) - Number(right.y)) <= REGION_EPSILON &&
    Math.abs(Number(left.width) - Number(right.width)) <= REGION_EPSILON &&
    Math.abs(Number(left.height) - Number(right.height)) <= REGION_EPSILON &&
    Math.abs(Number(left.cx) - Number(right.cx)) <= REGION_EPSILON &&
    Math.abs(Number(left.cy) - Number(right.cy)) <= REGION_EPSILON &&
    Math.abs(Number(left.rotation) - Number(right.rotation)) <= REGION_EPSILON &&
    Math.abs(Number(left.contentWidth ?? left.width) - Number(right.contentWidth ?? right.width)) <= REGION_EPSILON &&
    Math.abs(Number(left.contentHeight ?? left.height) - Number(right.contentHeight ?? right.height)) <= REGION_EPSILON
  );
}

type LogicalLineRange = {
  start: number;
  end: number;
};

function collectLogicalLineRanges(text: string): LogicalLineRange[] {
  if (text.length === 0) {
    return [{ start: 0, end: 0 }];
  }
  const ranges: LogicalLineRange[] = [];
  let start = 0;
  let cursor = 0;
  while (cursor < text.length) {
    if (text[cursor] === "\r") {
      const next = text[cursor + 1] === "\n" ? cursor + 2 : cursor + 1;
      ranges.push({ start, end: cursor });
      start = next;
      cursor = next;
      continue;
    }
    if (text[cursor] === "\n") {
      ranges.push({ start, end: cursor });
      start = cursor + 1;
      cursor += 1;
      continue;
    }
    if (text[cursor] === "\\" && text[cursor + 1] === "\\") {
      let next = cursor + 2;
      if (text[next] === "*") {
        next += 1;
      }
      while (next < text.length && /\s/.test(text[next] ?? "")) {
        next += 1;
      }
      if (text[next] === "[") {
        let bracketCursor = next + 1;
        while (bracketCursor < text.length && text[bracketCursor] !== "]") {
          bracketCursor += 1;
        }
        if (bracketCursor < text.length) {
          next = bracketCursor + 1;
        }
      }
      ranges.push({ start, end: cursor });
      start = next;
      cursor = next;
      continue;
    }
    cursor += 1;
  }
  ranges.push({ start, end: text.length });
  return ranges;
}

function resolveRegionSelectionOverlay(
  target: any,
  selectionStart: number,
  selectionEnd: number
): {
  caret: { left: number; top: number; height: number } | null;
  rects: Array<{ left: number; top: number; width: number; height: number; centerX?: number; centerY?: number; rotationDeg?: number }>;
} {
  const ranges = collectLogicalLineRanges(target.text);
  const lineHeight = target.region.height / Math.max(1, ranges.length);
  if (selectionStart === selectionEnd) {
    const pivot = target.text.length === 0 ? 0 : Math.min(Math.max(0, selectionStart), target.text.length - 1);
    let lineIndex = ranges.length - 1;
    for (let index = 0; index < ranges.length; index += 1) {
      const range = ranges[index]!;
      if (pivot >= range.start && pivot < range.end) {
        lineIndex = index;
        break;
      }
    }
    const range = ranges[lineIndex] ?? { start: 0, end: target.text.length };
    const denominator = Math.max(1, range.end - range.start);
    const ratio = (selectionStart - range.start) / denominator;
    return {
      caret: {
        left: target.region.x + clamp(ratio, 0, 1) * target.region.width,
        top: target.region.y + lineIndex * lineHeight,
        height: Math.max(1, lineHeight)
      },
      rects: []
    };
  }

  const rects: Array<{ left: number; top: number; width: number; height: number; centerX?: number; centerY?: number; rotationDeg?: number }> = [];
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index]!;
    const localStart = Math.max(start, range.start);
    const localEnd = Math.min(end, range.end);
    if (localEnd <= localStart) {
      continue;
    }
    const denominator = Math.max(1, range.end - range.start);
    const leftRatio = (localStart - range.start) / denominator;
    const rightRatio = (localEnd - range.start) / denominator;
    const left = target.region.x + clamp(leftRatio, 0, 1) * target.region.width;
    const right = target.region.x + clamp(rightRatio, 0, 1) * target.region.width;
    rects.push({
      left,
      top: target.region.y + index * lineHeight,
      width: Math.max(1, right - left),
      height: Math.max(1, lineHeight),
      centerX: left + Math.max(1, right - left) / 2,
      centerY: target.region.y + index * lineHeight + Math.max(1, lineHeight) / 2,
      rotationDeg: Number.isFinite(target.region.rotation) ? Number(target.region.rotation) : undefined
    });
  }
  return { caret: null, rects };
}

async function estimateCaretHeight(
  outputJax: unknown,
  paragraphId: string,
  sourceText: string,
  containerElement: SVGSVGElement,
  offset: number
): Promise<number | null> {
  const nextOffset = Math.min(sourceText.length, offset + 1);
  const prevOffset = Math.max(0, offset - 1);
  const probes: Array<[number, number]> = [];
  if (nextOffset > offset) {
    probes.push([offset, nextOffset]);
  }
  if (prevOffset < offset) {
    probes.push([prevOffset, offset]);
  }
  for (const [startOffset, endOffset] of probes) {
    const rects = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId,
      sourceText,
      containerElement,
      startOffset,
      endOffset
    });
    if (rects.ok && rects.rects.length > 0) {
      return Math.max(1, rects.rects[0]!.height);
    }
  }
  return null;
}

export function useCanvasTextEditingEffects(args: UseCanvasTextEditingEffectsArgs) {
  const {
    toolMode,
    textEditingSession,
    setTextEditingSession,
    selectedElementIds,
    resolveEditableTextTargetById,
    resolveRenderedMathTextElement,
    viewportRef,
    setTextSelectionOverlay,
    pendingAdornmentTextEditTargetId,
    snapshot,
    source,
    startTextEditingSession,
    setPendingAdornmentTextEditTargetId,
    canvasTransform
  } = args;

  useEffect(() => {
    if (toolMode === "select" || !textEditingSession) {
      return;
    }
    setTextEditingSession(null);
  }, [setTextEditingSession, textEditingSession, toolMode]);

  useEffect(() => {
    if (!textEditingSession) {
      return;
    }
    if (selectedElementIds.size > 0 && !selectedElementIds.has(textEditingSession.sourceId)) {
      setTextEditingSession(null);
    }
  }, [selectedElementIds, setTextEditingSession, textEditingSession]);

  useEffect(() => {
    if (!textEditingSession) {
      setTextSelectionOverlay(null);
      return;
    }

    const target = resolveEditableTextTargetById(textEditingSession.sourceId);
    if (!target) {
      setTextSelectionOverlay(null);
      return;
    }
    if (snapshot.source !== source) {
      return;
    }

    const boundedStart = clamp(textEditingSession.selectionStart, 0, target.text.length);
    const boundedEnd = clamp(textEditingSession.selectionEnd, 0, target.text.length);
    if (
      textEditingSession.sourceSpan.from !== target.sourceSpan.from ||
      textEditingSession.sourceSpan.to !== target.sourceSpan.to ||
      textEditingSession.paragraphId !== target.paragraphId ||
      textEditingSession.renderSourceText !== target.renderSourceText ||
      textEditingSession.layoutKind !== target.layoutKind ||
      textEditingSession.sceneTextId !== target.sceneTextId ||
      !sameRectRegion(textEditingSession.region, target.region) ||
      textEditingSession.selectionStart !== boundedStart ||
      textEditingSession.selectionEnd !== boundedEnd
    ) {
      setTextEditingSession((current: any) =>
        current && current.sourceId === target.sourceId
          ? {
              ...current,
              sceneTextId: target.sceneTextId,
              sourceSpan: target.sourceSpan,
              selectionStart: boundedStart,
              selectionEnd: boundedEnd,
              paragraphId: target.paragraphId,
              renderSourceText: target.renderSourceText,
              layoutKind: target.layoutKind,
              region: target.region
            }
          : current
      );
    }

    const outputJax = getActiveMathJaxOutputJax();
    const containerElement = resolveRenderedMathTextElement(target);
    const viewport = viewportRef.current;
    if (!viewport) {
      setTextSelectionOverlay(null);
      return;
    }

    const requestRef = { cancelled: false };
    const viewportRect = viewport.getBoundingClientRect();
    const offsetMap = createSourceRenderOffsetMap(target.text, target.renderSourceText);
    const renderAnchor = clamp(offsetMap.sourceToRender(boundedStart), 0, target.renderSourceText.length);
    const renderFocus = clamp(offsetMap.sourceToRender(boundedEnd), 0, target.renderSourceText.length);
    const renderStart = Math.min(renderAnchor, renderFocus);
    const renderEnd = Math.max(renderAnchor, renderFocus);

    void (async () => {
      if (!target.paragraphId || !outputJax || !containerElement) {
        const overlay = resolveRegionSelectionOverlay(target, boundedStart, boundedEnd);
        setTextSelectionOverlay({
          sourceId: target.sourceId,
          selectionStart: boundedStart,
          selectionEnd: boundedEnd,
          caret: overlay.caret
            ? {
                left: overlay.caret.left - viewportRect.left,
                top: overlay.caret.top - viewportRect.top,
                height: overlay.caret.height
              }
            : null,
          rects: overlay.rects.map((rect) => ({
            left: rect.left - viewportRect.left,
            top: rect.top - viewportRect.top,
            width: rect.width,
            height: rect.height,
            centerX: rect.centerX != null ? rect.centerX - viewportRect.left : undefined,
            centerY: rect.centerY != null ? rect.centerY - viewportRect.top : undefined,
            rotationDeg: rect.rotationDeg
          }))
        });
        return;
      }

      if (renderStart === renderEnd) {
        const point = await getKnuthPlassPointFromOffset(outputJax, {
          paragraphId: target.paragraphId,
          sourceText: target.renderSourceText,
          containerElement,
          offset: renderStart
        });
        if (requestRef.cancelled || !point.ok || point.clientX == null || point.clientY == null) {
          return;
        }
        const height =
          (await estimateCaretHeight(
            outputJax,
            target.paragraphId,
            target.renderSourceText,
            containerElement,
            point.offset ?? renderStart
          )) ?? Math.max(1, target.region.height);
        if (requestRef.cancelled) {
          return;
        }
        setTextSelectionOverlay({
          sourceId: target.sourceId,
          selectionStart: boundedStart,
          selectionEnd: boundedEnd,
          caret: {
            left: point.clientX - viewportRect.left,
            top: point.clientY - viewportRect.top - height / 2,
            height,
            centerX: point.clientX - viewportRect.left,
            centerY: point.clientY - viewportRect.top,
            rotationDeg: Number.isFinite(point.rotationDeg) ? point.rotationDeg : undefined
          },
          rects: []
        });
        return;
      }

      const rects = await getKnuthPlassSelectionRects(outputJax, {
        paragraphId: target.paragraphId,
        sourceText: target.renderSourceText,
        containerElement,
        startOffset: renderStart,
        endOffset: renderEnd
      });
      if (requestRef.cancelled) {
        return;
      }
      if (!rects.ok || rects.rects.length === 0) {
        setTextSelectionOverlay(null);
        return;
      }
      setTextSelectionOverlay({
        sourceId: target.sourceId,
        selectionStart: boundedStart,
        selectionEnd: boundedEnd,
        caret: null,
        rects: rects.rects.map((rect) => ({
          left: rect.left - viewportRect.left,
          top: rect.top - viewportRect.top,
          width: rect.width,
          height: rect.height,
          centerX: rect.centerX - viewportRect.left,
          centerY: rect.centerY - viewportRect.top,
          rotationDeg: rect.rotationDeg
        }))
      });
    })();

    return () => {
      requestRef.cancelled = true;
    };
  }, [
    resolveEditableTextTargetById,
    resolveRenderedMathTextElement,
    setTextEditingSession,
    setTextSelectionOverlay,
    snapshot.source,
    source,
    textEditingSession,
    viewportRef,
    canvasTransform.scale,
    canvasTransform.translateX,
    canvasTransform.translateY
  ]);

  useEffect(() => {
    if (!pendingAdornmentTextEditTargetId) {
      return;
    }
    if (snapshot.source !== source || !selectedElementIds.has(pendingAdornmentTextEditTargetId)) {
      return;
    }
    const target = resolveEditableTextTargetById(pendingAdornmentTextEditTargetId);
    if (!target) {
      return;
    }
    startTextEditingSession(target, 0, target.text.length);
    setPendingAdornmentTextEditTargetId(null);
  }, [
    pendingAdornmentTextEditTargetId,
    resolveEditableTextTargetById,
    selectedElementIds,
    setPendingAdornmentTextEditTargetId,
    snapshot.source,
    source,
    startTextEditingSession
  ]);
}
