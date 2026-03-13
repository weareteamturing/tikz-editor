import { useEffect, useMemo, useState } from "react";
import {
  resolveTransformInspectorValues,
  TIKZPICTURE_GLOBAL_TARGET_ID,
  type InspectorDescriptor,
  type InspectorSnapshot
} from "tikz-editor/edit/inspector";
import { buildStylesCascadeModel } from "tikz-editor/edit/styles-cascade";
import type { SceneElement } from "tikz-editor/semantic/types";
import { getSharedEditAnalysisView } from "../../edit-analysis-manager";
import { collectProjectNamedColorSwatches } from "../../project-named-colors";
import { useEditorStore } from "../../store/store";
import { actionAvailability } from "../editor-commands";
import {
  buildInspectorPropertyProvenanceMap,
  buildMultiInspectorModel,
  buildMultiInspectorPropertyProvenanceMap,
  sameOrderedStringArrays,
  type InspectorPropertyProvenanceMap,
  type MultiInspectorModel
} from "./panel-helpers";

export type FrozenInspectorView = {
  selectedSourceIds: string[];
  descriptor: InspectorDescriptor | null;
  multiModel: MultiInspectorModel | null;
  singlePropertyProvenance: InspectorPropertyProvenanceMap;
  multiPropertyProvenance: InspectorPropertyProvenanceMap;
};

export function useInspectorModel(args: {
  selectedIds: ReadonlySet<string>;
  dispatch: (action: any) => void;
  getInspectorDescriptor: (element: SceneElement, context: InspectorSnapshot) => InspectorDescriptor;
}) {
  const { selectedIds, dispatch, getInspectorDescriptor } = args;
  const activeDocumentId = useEditorStore((s) => s.activeDocumentId);
  const activeFigureId = useEditorStore((s) => s.activeFigureId);
  const sourceRevision = useEditorStore((s) => s.sourceRevision);

  const [{ source, snapshot }, setSourceSnapshot] = useState(() => {
    const s = useEditorStore.getState();
    return { source: s.source, snapshot: s.snapshot };
  });

  useEffect(() => {
    return useEditorStore.subscribe((s, prev) => {
      const k = s.activeCanvasDragKind;
      if (k === "element" || k === "resize" || k === "rotate" || k === "handle") return;
      if (s.source !== prev.source || s.snapshot !== prev.snapshot) {
        setSourceSnapshot({ source: s.source, snapshot: s.snapshot });
      }
    });
  }, []);

  const selectedSourceIds = useMemo(() => [...selectedIds], [selectedIds]);
  const projectNamedColorSwatches = useMemo(
    () => collectProjectNamedColorSwatches(source),
    [source]
  );
  const editAnalysisView = useMemo(
    () =>
      getSharedEditAnalysisView({
        documentId: activeDocumentId,
        sourceRevision,
        source,
        activeFigureId,
        snapshot
      }),
    [activeDocumentId, activeFigureId, snapshot, source, sourceRevision]
  );
  const parseOptions = useMemo(
    () => ({
      activeFigureId,
      analysisView: editAnalysisView
    }),
    [activeFigureId, editAnalysisView]
  );
  const globalTransformValues = useMemo(
    () => resolveTransformInspectorValues(source, TIKZPICTURE_GLOBAL_TARGET_ID, parseOptions),
    [parseOptions, source]
  );

  const selectedElements = useMemo(() => {
    const bySource = new Map<string, SceneElement>();
    for (const element of snapshot.scene?.elements ?? []) {
      const targetId = element.adornment?.targetId ?? element.sourceRef.sourceId;
      if (!selectedIds.has(targetId) || bySource.has(targetId)) {
        continue;
      }
      bySource.set(targetId, element);
    }

    return selectedSourceIds
      .map((sourceId) => bySource.get(sourceId))
      .filter((element): element is SceneElement => element != null);
  }, [selectedIds, selectedSourceIds, snapshot.scene]);

  const descriptors = useMemo(() => {
    return selectedElements.map((element) =>
      getInspectorDescriptor(element, {
        source: snapshot.source,
        editHandles: snapshot.editHandles,
        parseOptions
      })
    );
  }, [getInspectorDescriptor, parseOptions, selectedElements, snapshot.source, snapshot.editHandles]);

  const descriptor = selectedSourceIds.length === 1 ? descriptors[0] ?? null : null;

  const multiModel = useMemo(() => {
    if (selectedSourceIds.length <= 1) {
      return null;
    }
    return buildMultiInspectorModel(descriptors, selectedSourceIds.length);
  }, [descriptors, selectedSourceIds.length]);

  const perElementPropertyProvenance = useMemo<InspectorPropertyProvenanceMap[]>(() => {
    return selectedElements.map((element, index) => {
      const elementDescriptor = descriptors[index];
      if (!elementDescriptor) {
        return {};
      }
      const cascadeModel = buildStylesCascadeModel(
        element,
        {
          source: snapshot.source,
          editHandles: snapshot.editHandles,
          parseOptions
        },
        elementDescriptor
      );
      return buildInspectorPropertyProvenanceMap(cascadeModel);
    });
  }, [descriptors, parseOptions, selectedElements, snapshot.editHandles, snapshot.source]);

  const singlePropertyProvenance = useMemo<InspectorPropertyProvenanceMap>(() => {
    if (selectedSourceIds.length !== 1) {
      return {};
    }
    return perElementPropertyProvenance[0] ?? {};
  }, [perElementPropertyProvenance, selectedSourceIds.length]);

  const multiPropertyProvenance = useMemo<InspectorPropertyProvenanceMap>(() => {
    return buildMultiInspectorPropertyProvenanceMap(
      multiModel,
      perElementPropertyProvenance,
      selectedSourceIds.length
    );
  }, [multiModel, perElementPropertyProvenance, selectedSourceIds.length]);

  const [frozenInspectorView, setFrozenInspectorView] = useState<FrozenInspectorView | null>(null);

  const usingFrozenInspectorView =
    frozenInspectorView != null &&
    sameOrderedStringArrays(frozenInspectorView.selectedSourceIds, selectedSourceIds);
  const renderedDescriptor = usingFrozenInspectorView
    ? frozenInspectorView.descriptor
    : descriptor;
  const renderedMultiModel = usingFrozenInspectorView
    ? frozenInspectorView.multiModel
    : multiModel;
  const renderedSinglePropertyProvenance = usingFrozenInspectorView
    ? frozenInspectorView.singlePropertyProvenance
    : singlePropertyProvenance;
  const renderedMultiPropertyProvenance = usingFrozenInspectorView
    ? frozenInspectorView.multiPropertyProvenance
    : multiPropertyProvenance;

  const commandContext = useMemo(
    () => ({
      source,
      activeFigureId,
      parseOptions,
      snapshotSource: snapshot.source,
      scene: snapshot.scene,
      editHandles: snapshot.editHandles,
      selectedElementIds: selectedIds,
      dispatch
    }),
    [activeFigureId, dispatch, parseOptions, selectedIds, snapshot.editHandles, snapshot.scene, snapshot.source, source]
  );
  const arrangeAvailability = useMemo(
    () => actionAvailability(commandContext),
    [commandContext]
  );

  return {
    source,
    snapshot,
    selectedSourceIds,
    projectNamedColorSwatches,
    globalTransformValues,
    selectedElements,
    descriptors,
    descriptor,
    multiModel,
    singlePropertyProvenance,
    multiPropertyProvenance,
    renderedDescriptor,
    renderedMultiModel,
    renderedSinglePropertyProvenance,
    renderedMultiPropertyProvenance,
    commandContext,
    arrangeAvailability,
    frozenInspectorView,
    setFrozenInspectorView
  };
}
