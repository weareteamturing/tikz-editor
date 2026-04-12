import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { addGuide, moveGuide, removeGuide } from "./panel-helpers";
import type { GuideDragState, GuideOrientation, GuidePreview, GuidesState } from "./types";

export type UseCanvasGuideEffectsArgs = {
  guideDragRef: MutableRefObject<GuideDragState | null>;
  setGuidePreview: Dispatch<SetStateAction<GuidePreview | null>>;
  resolveGuideFromClient: (
    orientation: GuideOrientation,
    clientX: number,
    clientY: number
  ) => { value: number; overViewport: boolean } | null;
  isPointerOverGuideDeleteZone: (
    orientation: GuideOrientation,
    clientX: number,
    clientY: number
  ) => boolean;
  setGuides: Dispatch<SetStateAction<GuidesState>>;
  showGuides: boolean;
};

export function useCanvasGuideEffects(args: UseCanvasGuideEffectsArgs) {
  const {
    guideDragRef,
    setGuidePreview,
    resolveGuideFromClient,
    isPointerOverGuideDeleteZone,
    setGuides,
    showGuides
  } = args;

  useEffect(() => {
    function clearGuideDragState() {
      if (!guideDragRef.current) {
        return;
      }
      guideDragRef.current = null;
      setGuidePreview(null);
      document.body.classList.remove("is-dragging-guide-horizontal");
      document.body.classList.remove("is-dragging-guide-vertical");
    }

    function onPointerMove(event: PointerEvent) {
      const drag = guideDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }

      const guide = resolveGuideFromClient(drag.orientation, event.clientX, event.clientY);
      if (!guide) {
        drag.overViewport = false;
        drag.overDeleteZone = isPointerOverGuideDeleteZone(drag.orientation, event.clientX, event.clientY);
        setGuidePreview(
          drag.source === "guide"
            ? {
                orientation: drag.orientation,
                value: drag.value,
                hideValue: drag.sourceValue,
                visible: false
              }
            : null
        );
        return;
      }
      drag.value = guide.value;
      drag.overViewport = guide.overViewport;
      drag.overDeleteZone = isPointerOverGuideDeleteZone(drag.orientation, event.clientX, event.clientY);
      setGuidePreview(
        drag.source === "guide"
          ? {
              orientation: drag.orientation,
              value: guide.value,
              hideValue: drag.sourceValue,
              visible: guide.overViewport && !drag.overDeleteZone
            }
          : guide.overViewport
            ? {
                orientation: drag.orientation,
                value: guide.value
              }
            : null
      );
    }

    function onPointerUp(event: PointerEvent) {
      const drag = guideDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }

      const guide = resolveGuideFromClient(drag.orientation, event.clientX, event.clientY);
      if (guide) {
        drag.value = guide.value;
        drag.overViewport = guide.overViewport;
      } else {
        drag.overViewport = false;
      }
      drag.overDeleteZone = isPointerOverGuideDeleteZone(drag.orientation, event.clientX, event.clientY);

      if (drag.source === "ruler") {
        if (drag.overViewport) {
          setGuides((current) => addGuide(current, drag.orientation, drag.value));
        }
      } else if (drag.source === "guide" && drag.sourceValue != null) {
        const sourceValue = drag.sourceValue;
        if (drag.overDeleteZone) {
          setGuides((current) => removeGuide(current, drag.orientation, sourceValue));
        } else if (drag.overViewport) {
          setGuides((current) =>
            moveGuide(current, drag.orientation, sourceValue, drag.value)
          );
        }
      }
      clearGuideDragState();
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      clearGuideDragState();
    };
  }, [guideDragRef, isPointerOverGuideDeleteZone, resolveGuideFromClient, setGuidePreview, setGuides]);

  useEffect(() => {
    if (showGuides) {
      return;
    }
    guideDragRef.current = null;
    setGuidePreview(null);
    document.body.classList.remove("is-dragging-guide-horizontal");
    document.body.classList.remove("is-dragging-guide-vertical");
  }, [guideDragRef, setGuidePreview, showGuides]);
}
