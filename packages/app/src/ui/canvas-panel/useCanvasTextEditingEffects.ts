import { useEffect } from "react";
import { getActiveMathJaxOutputJax } from "tikz-editor/text/mathjax-engine";
import { getKnuthPlassPointFromOffset, getKnuthPlassSelectionRects } from "tikz-editor/text/knuth-plass";
import { clamp } from "./geometry";

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
      textEditingSession.text !== target.text ||
      textEditingSession.selectionStart !== boundedStart ||
      textEditingSession.selectionEnd !== boundedEnd
    ) {
      setTextEditingSession((current: any) =>
        current && current.sourceId === target.sourceId
          ? {
              ...current,
              sceneTextId: target.sceneTextId,
              sourceSpan: target.sourceSpan,
              text: target.text,
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
    if (!outputJax || !containerElement || !viewport) {
      setTextSelectionOverlay(null);
      return;
    }

    const requestRef = { cancelled: false };
    const viewportRect = viewport.getBoundingClientRect();
    const renderAnchor = clamp(boundedStart, 0, target.renderSourceText.length);
    const renderFocus = clamp(boundedEnd, 0, target.renderSourceText.length);
    const renderStart = Math.min(renderAnchor, renderFocus);
    const renderEnd = Math.max(renderAnchor, renderFocus);

    void (async () => {
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
            height
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
      if (requestRef.cancelled || !rects.ok) {
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
          height: rect.height
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
