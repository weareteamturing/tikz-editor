import { useEffect } from "react";
import { addGuide, moveGuide, removeGuide } from "./panel-helpers";

export type UseCanvasGuideEffectsArgs = {
  [key: string]: any;
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
          setGuides((current: any) => addGuide(current, drag.orientation, drag.value));
        }
      } else if (drag.source === "guide" && drag.sourceValue != null) {
        if (drag.overDeleteZone) {
          setGuides((current: any) => removeGuide(current, drag.orientation, drag.sourceValue!));
        } else if (drag.overViewport) {
          setGuides((current: any) =>
            moveGuide(current, drag.orientation, drag.sourceValue!, drag.value)
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
