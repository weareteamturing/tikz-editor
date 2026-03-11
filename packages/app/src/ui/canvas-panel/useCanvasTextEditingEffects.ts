import { useEffect, useRef } from "react";
import { SOURCE_SELECTION_CHANGED_EVENT, type SourceSelectionChangeDetail } from "../source-sync";
import { clamp } from "./geometry";
import { resolveEditableTextTargetForSelectionOffsets } from "./panel-helpers";

export type UseCanvasTextEditingEffectsArgs = {
  [key: string]: any;
};

export function useCanvasTextEditingEffects(args: UseCanvasTextEditingEffectsArgs) {
  const {
    toolMode,
    textEditingSession,
    setTextEditingSession,
    selectedElementIds,
    hitRegions,
    resolveEditableTextTarget,
    resolveEditableTextTargetById,
    resolvePrefixTableForTarget,
    setTextSelectionOverlay,
    pendingAdornmentTextEditTargetId,
    snapshot,
    source,
    applyCanvasTextSelection,
    setPendingAdornmentTextEditTargetId
  } = args;

  useEffect(() => {
    if (!textEditingSession) {
      return;
    }
    if (!selectedElementIds.has(textEditingSession.sourceId)) {
      setTextEditingSession(null);
    }
  }, [selectedElementIds, setTextEditingSession, textEditingSession]);

  const textEditingSessionRef = useRef(textEditingSession);
  textEditingSessionRef.current = textEditingSession;

  useEffect(() => {
    const handleSelectionChanged = (rawEvent: Event) => {
      if (toolMode !== "select") {
        return;
      }
      const event = rawEvent as CustomEvent<SourceSelectionChangeDetail>;
      const detail = event.detail;
      const sourceId = detail?.sourceId?.trim() ?? "";
      if (!sourceId) {
        setTextEditingSession(null);
        return;
      }

      const anchorOffset = Math.floor(detail.anchor);
      const headOffset = Math.floor(detail.head);
      const currentSession = textEditingSessionRef.current;

      if (currentSession && currentSession.sourceId === sourceId) {
        const target = resolveEditableTextTargetForSelectionOffsets(
          sourceId,
          anchorOffset,
          headOffset,
          hitRegions,
          resolveEditableTextTarget
        );
        if (target) {
          const offsetsInRange =
            anchorOffset >= target.sourceSpan.from &&
            anchorOffset <= target.sourceSpan.to &&
            headOffset >= target.sourceSpan.from &&
            headOffset <= target.sourceSpan.to;
          if (offsetsInRange) {
            setTextEditingSession({
              sourceId,
              anchorIndex: clamp(anchorOffset - target.sourceSpan.from, 0, target.text.length),
              headIndex: clamp(headOffset - target.sourceSpan.from, 0, target.text.length),
              anchorOffset,
              headOffset
            });
            return;
          }
        }
        setTextEditingSession((prev: any) =>
          prev && prev.sourceId === sourceId
            ? { ...prev, anchorOffset: anchorOffset, headOffset: headOffset }
            : prev
        );
        return;
      }

      const target = resolveEditableTextTargetForSelectionOffsets(
        sourceId,
        anchorOffset,
        headOffset,
        hitRegions,
        resolveEditableTextTarget
      );
      if (!target) {
        return;
      }
      const offsetsInRange =
        anchorOffset >= target.sourceSpan.from &&
        anchorOffset <= target.sourceSpan.to &&
        headOffset >= target.sourceSpan.from &&
        headOffset <= target.sourceSpan.to;
      if (!offsetsInRange) {
        return;
      }

      setTextEditingSession({
        sourceId,
        anchorIndex: clamp(anchorOffset - target.sourceSpan.from, 0, target.text.length),
        headIndex: clamp(headOffset - target.sourceSpan.from, 0, target.text.length),
        anchorOffset,
        headOffset
      });
    };

    window.addEventListener(SOURCE_SELECTION_CHANGED_EVENT, handleSelectionChanged as EventListener);
    return () => window.removeEventListener(SOURCE_SELECTION_CHANGED_EVENT, handleSelectionChanged as EventListener);
  }, [hitRegions, resolveEditableTextTarget, setTextEditingSession, toolMode]);

  useEffect(() => {
    if (!textEditingSession) {
      setTextSelectionOverlay(null);
      return;
    }
    const target = resolveEditableTextTargetById(textEditingSession.sourceId);
    if (!target) {
      return;
    }
    let anchorIndex = textEditingSession.anchorIndex;
    let headIndex = textEditingSession.headIndex;
    if (textEditingSession.anchorOffset != null && textEditingSession.headOffset != null) {
      const ao = textEditingSession.anchorOffset;
      const ho = textEditingSession.headOffset;
      if (
        ao >= target.sourceSpan.from && ao <= target.sourceSpan.to &&
        ho >= target.sourceSpan.from && ho <= target.sourceSpan.to
      ) {
        anchorIndex = clamp(ao - target.sourceSpan.from, 0, target.text.length);
        headIndex = clamp(ho - target.sourceSpan.from, 0, target.text.length);
      }
    }

    const prefixTable = resolvePrefixTableForTarget(target);
    setTextSelectionOverlay({
      sourceId: textEditingSession.sourceId,
      textLength: target.text.length,
      totalWidth: target.totalWidth,
      fontSizePt: target.style.fontSize,
      startIndex: clamp(anchorIndex, 0, target.text.length),
      endIndex: clamp(headIndex, 0, target.text.length),
      rotation: target.region.rotation,
      cx: target.region.cx,
      cy: target.region.cy,
      width: target.region.width,
      height: target.region.height,
      prefixTable
    });
  }, [resolveEditableTextTargetById, resolvePrefixTableForTarget, setTextSelectionOverlay, textEditingSession]);

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
    applyCanvasTextSelection(target, 0, target.text.length);
    setPendingAdornmentTextEditTargetId(null);
  }, [
    applyCanvasTextSelection,
    pendingAdornmentTextEditTargetId,
    resolveEditableTextTargetById,
    selectedElementIds,
    setPendingAdornmentTextEditTargetId,
    snapshot.source,
    source
  ]);
}
