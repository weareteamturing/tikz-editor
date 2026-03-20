import { useEffect, useMemo, useState } from "react";
import {
  resolveTransformInspectorMutationContext,
  resolveTransformInspectorValues,
  TIKZPICTURE_GLOBAL_TARGET_ID,
  type InspectorDescriptor,
  type InspectorSection,
  type SetPropertyWriteTarget,
  type TransformInspectorKey,
  type TransformInspectorMutationContext,
  type InspectorSnapshot
} from "tikz-editor/edit/inspector";
import { resolvePropertyTarget } from "tikz-editor/edit/property-target";
import { buildStylesCascadeModel } from "tikz-editor/edit/styles-cascade";
import type { OptionListAst } from "tikz-editor/options/types";
import { parseTikz } from "tikz-editor/parser";
import { parseLength } from "tikz-editor/semantic/coords/parse-length";
import type { SceneElement } from "tikz-editor/semantic/types";
import { getSharedEditAnalysisView } from "../../edit-analysis-manager";
import { useProjectNamedColorSwatches } from "../../project-named-colors";
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

function buildScopeTransformWriteTarget(
  scopeId: string,
  writable: boolean,
  reason: string | undefined,
  key: TransformInspectorKey,
  context: TransformInspectorMutationContext
): SetPropertyWriteTarget {
  return {
    mode: "setProperty",
    elementId: scopeId,
    level: "command",
    key,
    transformContext: {
      key,
      values: { ...context.values },
      presence: context.presence ? { ...context.presence } : undefined
    },
    writable,
    reason
  };
}

function buildMatrixSetPropertyWriteTarget(
  matrixId: string,
  writable: boolean,
  reason: string | undefined,
  key: string
): SetPropertyWriteTarget {
  return {
    mode: "setProperty",
    elementId: matrixId,
    level: "command",
    key,
    writable,
    reason
  };
}

function isMatrixOptionList(options: OptionListAst | undefined): boolean {
  for (const entry of options?.entries ?? []) {
    if (entry.kind !== "flag" && entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "matrix" || entry.key === "matrix of nodes" || entry.key === "matrix of math nodes") {
      return true;
    }
  }
  return false;
}

function resolveMatrixSpacingPt(options: OptionListAst | undefined, key: "row sep" | "column sep"): number {
  const entry = options?.entries.find((candidate) => candidate.kind === "kv" && candidate.key === key);
  if (!entry || entry.kind !== "kv") {
    return 0;
  }
  const tokens = entry.valueRaw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  let sum = 0;
  for (const token of tokens) {
    const parsed = parseLength(token, "pt");
    if (parsed != null) {
      sum += parsed;
    }
  }
  return sum;
}

function resolveMatrixNodeOptionsFromSource(
  source: string,
  matrixId: string
): OptionListAst | undefined {
  const parsed = parseTikz(source, { recover: true });
  const stack = [...parsed.figure.body];
  while (stack.length > 0) {
    const statement = stack.shift();
    if (!statement) {
      continue;
    }
    if (statement.kind === "Scope") {
      stack.unshift(...statement.body);
      continue;
    }
    if (statement.kind !== "Path" || statement.id !== matrixId) {
      continue;
    }
    const matrixNode = statement.items.find((item) => item.kind === "Node");
    return matrixNode?.kind === "Node" ? matrixNode.options : undefined;
  }
  return undefined;
}

function resolveMatrixColorOption(options: OptionListAst | undefined, key: "draw" | "fill"): string | null {
  const entry = options?.entries.find((candidate) => candidate.kind === "kv" && candidate.key === key);
  if (!entry || entry.kind !== "kv") {
    return null;
  }
  const normalized = entry.valueRaw.trim();
  return normalized.length > 0 ? normalized : null;
}

export function buildMatrixInspectorDescriptor(
  source: string,
  matrixId: string,
  parseOptions: InspectorSnapshot["parseOptions"]
): InspectorDescriptor | null {
  const resolved = resolvePropertyTarget(source, matrixId, parseOptions ?? {});
  if (resolved.kind === "not-found") {
    return null;
  }
  if (resolved.target.kind !== "path-statement") {
    return null;
  }
  const matrixNodeOptions = resolveMatrixNodeOptionsFromSource(source, matrixId);
  if (!isMatrixOptionList(matrixNodeOptions)) {
    return null;
  }

  const writable = true;
  const readOnlyReason = undefined;
  const transformContext = resolveTransformInspectorMutationContext(source, matrixId, parseOptions);
  const transformValues = transformContext.values;
  const rowSepPt = resolveMatrixSpacingPt(matrixNodeOptions, "row sep");
  const columnSepPt = resolveMatrixSpacingPt(matrixNodeOptions, "column sep");
  const drawColor = resolveMatrixColorOption(matrixNodeOptions, "draw");
  const fillColor = resolveMatrixColorOption(matrixNodeOptions, "fill");

  const sections: InspectorSection[] = [
    {
      id: "transform",
      title: "Transform",
      sourceLevel: "command",
      properties: [
        {
          kind: "number",
          id: "xshift",
          label: "X shift",
          value: transformValues.xshift,
          step: 0.1,
          unit: "pt",
          write: buildScopeTransformWriteTarget(matrixId, writable, readOnlyReason, "xshift", transformContext)
        },
        {
          kind: "number",
          id: "yshift",
          label: "Y shift",
          value: transformValues.yshift,
          step: 0.1,
          unit: "pt",
          write: buildScopeTransformWriteTarget(matrixId, writable, readOnlyReason, "yshift", transformContext)
        },
        {
          kind: "number",
          id: "xscale",
          label: "X scale",
          value: transformValues.xscale,
          step: 0.1,
          write: buildScopeTransformWriteTarget(matrixId, writable, readOnlyReason, "xscale", transformContext)
        },
        {
          kind: "number",
          id: "yscale",
          label: "Y scale",
          value: transformValues.yscale,
          step: 0.1,
          write: buildScopeTransformWriteTarget(matrixId, writable, readOnlyReason, "yscale", transformContext)
        },
        {
          kind: "number",
          id: "rotate",
          label: "Rotate",
          value: transformValues.rotate,
          step: 1,
          unit: "deg",
          write: buildScopeTransformWriteTarget(matrixId, writable, readOnlyReason, "rotate", transformContext)
        }
      ]
    },
    {
      id: "matrix",
      title: "Matrix",
      sourceLevel: "command",
      properties: [
        {
          kind: "length",
          id: "matrix-row-sep",
          label: "Row sep",
          value: rowSepPt,
          step: 0.1,
          unit: "pt",
          write: buildMatrixSetPropertyWriteTarget(matrixId, writable, readOnlyReason, "row sep")
        },
        {
          kind: "length",
          id: "matrix-column-sep",
          label: "Column sep",
          value: columnSepPt,
          step: 0.1,
          unit: "pt",
          write: buildMatrixSetPropertyWriteTarget(matrixId, writable, readOnlyReason, "column sep")
        },
        {
          kind: "color",
          id: "matrix-draw",
          label: "Draw",
          value: drawColor,
          syntaxValue: drawColor,
          options: [],
          write: buildMatrixSetPropertyWriteTarget(matrixId, writable, readOnlyReason, "draw")
        },
        {
          kind: "color",
          id: "matrix-fill",
          label: "Fill",
          value: fillColor,
          syntaxValue: fillColor,
          options: [],
          write: buildMatrixSetPropertyWriteTarget(matrixId, writable, readOnlyReason, "fill")
        }
      ]
    }
  ];

  return {
    elementKind: "path",
    elementId: matrixId,
    writeTargetId: matrixId,
    readOnlyReason,
    sections
  };
}

function buildScopeInspectorDescriptor(
  source: string,
  scopeId: string,
  parseOptions: InspectorSnapshot["parseOptions"]
): InspectorDescriptor {
  const resolved = resolvePropertyTarget(source, scopeId, parseOptions ?? {});
  const writable = resolved.kind === "found";
  const readOnlyReason = resolved.kind === "not-found" ? resolved.reason : undefined;
  const transformContext = resolveTransformInspectorMutationContext(source, scopeId, parseOptions);
  const transformValues = transformContext.values;
  const sections: InspectorSection[] = [
    {
      id: "transform",
      title: "Transform",
      sourceLevel: "command",
      properties: [
        {
          kind: "number",
          id: "xshift",
          label: "X shift",
          value: transformValues.xshift,
          step: 0.1,
          unit: "pt",
          write: buildScopeTransformWriteTarget(scopeId, writable, readOnlyReason, "xshift", transformContext)
        },
        {
          kind: "number",
          id: "yshift",
          label: "Y shift",
          value: transformValues.yshift,
          step: 0.1,
          unit: "pt",
          write: buildScopeTransformWriteTarget(scopeId, writable, readOnlyReason, "yshift", transformContext)
        },
        {
          kind: "number",
          id: "xscale",
          label: "X scale",
          value: transformValues.xscale,
          step: 0.1,
          write: buildScopeTransformWriteTarget(scopeId, writable, readOnlyReason, "xscale", transformContext)
        },
        {
          kind: "number",
          id: "yscale",
          label: "Y scale",
          value: transformValues.yscale,
          step: 0.1,
          write: buildScopeTransformWriteTarget(scopeId, writable, readOnlyReason, "yscale", transformContext)
        },
        {
          kind: "number",
          id: "rotate",
          label: "Rotate",
          value: transformValues.rotate,
          step: 1,
          unit: "deg",
          write: buildScopeTransformWriteTarget(scopeId, writable, readOnlyReason, "rotate", transformContext)
        }
      ]
    }
  ];

  return {
    elementKind: "scope",
    elementId: scopeId,
    writeTargetId: writable ? scopeId : null,
    readOnlyReason,
    sections
  };
}

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

  const rawSelectedSourceIds = useMemo(() => [...selectedIds], [selectedIds]);
  const selectedSourceIds = rawSelectedSourceIds;
  const selectedSourceIdSet = useMemo(() => new Set(selectedSourceIds), [selectedSourceIds]);
  const projectNamedColorSwatches = useProjectNamedColorSwatches();
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

  const selectedElementBySourceId = useMemo(() => {
    const bySource = new Map<string, SceneElement>();
    for (const element of snapshot.scene?.elements ?? []) {
      const targetId = element.adornment?.targetId ?? element.sourceRef.sourceId;
      if (!selectedSourceIdSet.has(targetId) || bySource.has(targetId)) {
        continue;
      }
      bySource.set(targetId, element);
    }

    return bySource;
  }, [selectedSourceIdSet, snapshot.scene]);

  const selectedElements = useMemo(() => {
    return selectedSourceIds
      .map((sourceId) => selectedElementBySourceId.get(sourceId))
      .filter((element): element is SceneElement => element != null);
  }, [selectedElementBySourceId, selectedSourceIds]);

  const descriptorEntries = useMemo(() => {
    return selectedSourceIds.map((sourceId) => {
      const matrixDescriptor = buildMatrixInspectorDescriptor(snapshot.source, sourceId, parseOptions);
      if (matrixDescriptor) {
        return matrixDescriptor;
      }

      if (sourceId.startsWith("scope:")) {
        return buildScopeInspectorDescriptor(snapshot.source, sourceId, parseOptions);
      }

      const element = selectedElementBySourceId.get(sourceId);
      if (!element) {
        return null;
      }

      return getInspectorDescriptor(element, {
        source: snapshot.source,
        editHandles: snapshot.editHandles,
        parseOptions
      });
    });
  }, [getInspectorDescriptor, parseOptions, selectedElementBySourceId, selectedSourceIds, snapshot.editHandles, snapshot.source]);

  const descriptors = useMemo(() => {
    return descriptorEntries.filter((entry): entry is InspectorDescriptor => entry != null);
  }, [descriptorEntries]);

  const descriptor = selectedSourceIds.length === 1 ? descriptorEntries[0] ?? null : null;

  const multiModel = useMemo(() => {
    if (selectedSourceIds.length <= 1) {
      return null;
    }
    return buildMultiInspectorModel(descriptors, selectedSourceIds.length);
  }, [descriptors, selectedSourceIds.length]);

  const perElementPropertyProvenance = useMemo<InspectorPropertyProvenanceMap[]>(() => {
    return selectedSourceIds.map((sourceId, index) => {
      const element = selectedElementBySourceId.get(sourceId);
      const elementDescriptor = descriptorEntries[index];
      if (!element || !elementDescriptor) {
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
  }, [descriptorEntries, parseOptions, selectedElementBySourceId, selectedSourceIds, snapshot.editHandles, snapshot.source]);

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
      selectedElementIds: selectedSourceIdSet,
      dispatch
    }),
    [activeFigureId, dispatch, parseOptions, selectedSourceIdSet, snapshot.editHandles, snapshot.scene, snapshot.source, source]
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
