import { useEffect, useRef } from "react";
import { diffSvgModels, type SvgDiffHints, type SvgPatchOp, type SvgRenderModel } from "tikz-editor/svg/index";

import { SvgDomPatcher } from "./svg-dom-patcher";
import css from "../CanvasPanel.module.css";

export function CanvasSVGLayer(params: {
  model: SvgRenderModel | null;
  diffHints?: SvgDiffHints;
  forceReplaceAll: boolean;
  onFallback: (reason: "replaceDefs" | "replaceAll" | "patch-failure") => void;
}) {
  const { model, diffHints, forceReplaceAll, onFallback } = params;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const patcherRef = useRef<SvgDomPatcher | null>(null);
  const previousModelRef = useRef<SvgRenderModel | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const patcher = new SvgDomPatcher(host);
    patcherRef.current = patcher;
    return () => {
      patcher.dispose();
      patcherRef.current = null;
      previousModelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!model || !patcherRef.current) {
      return;
    }

    const patcher = patcherRef.current;
    try {
      let operations: SvgPatchOp[];
      if (forceReplaceAll) {
        operations = [{ kind: "replaceAll", model }];
      } else {
        operations = diffSvgModels(previousModelRef.current, model, diffHints);
      }
      if (operations.some((operation) => operation.kind === "replaceDefs")) {
        onFallback("replaceDefs");
      }
      if (operations.some((operation) => operation.kind === "replaceAll") && !forceReplaceAll) {
        onFallback("replaceAll");
      }
      patcher.applyOperations(operations);
      previousModelRef.current = model;
    } catch (error) {
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("[tikz-editor] SVG patch operation failed; falling back to replaceAll for this frame.", error);
      }
      onFallback("patch-failure");
      patcher.applyOperations([{ kind: "replaceAll", model }]);
      previousModelRef.current = model;
    }
  }, [diffHints, forceReplaceAll, model, onFallback]);

  return <div className={css.svgLayer} ref={hostRef} />;
}
