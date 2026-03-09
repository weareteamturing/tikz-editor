import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from "react";
import {
  RiAlignItemBottomLine,
  RiAlignItemHorizontalCenterLine,
  RiAlignItemLeftLine,
  RiAlignItemRightLine,
  RiAlignItemTopLine,
  RiAlignItemVerticalCenterLine,
  RiBold,
  RiFontMono,
  RiFontSansSerif,
  RiFontSerif,
  RiItalic,
  RiSplitCellsHorizontal,
  RiSplitCellsVertical
} from "@remixicon/react";
import type { RemixiconComponentType } from "@remixicon/react";
import { formatNumber } from "tikz-editor/edit/format";
import {
  buildArrowTipSetPropertyMutation,
  buildDashStyleSetPropertyMutation,
  buildFillModeSetPropertyMutations,
  buildNodeFontSetPropertyMutation,
  buildNodeInnerSepSetPropertyMutation,
  buildNodeShapeSetPropertyMutation,
  NODE_INNER_SEP_DEFAULT,
  buildFillPatternOptionSetPropertyMutation,
  buildFillPatternSetPropertyMutation,
  buildFillShadingSetPropertyMutations,
  buildLineCapSetPropertyMutation,
  buildLineJoinSetPropertyMutation,
  buildPathMorphingDecorationSetPropertyMutations,
  buildRoundedCornersSetPropertyMutation,
  buildTransformSetPropertyMutations,
  getInspectorDescriptor,
  resolveTransformInspectorValues,
  TIKZPICTURE_GLOBAL_TARGET_ID,
  type ArrowTipPresetId,
  type ArrowTipSide,
  type ArrowTipWriteTarget,
  type DashStylePresetId,
  type FillModePresetId,
  type FillPatternPresetId,
  type FillPatternMetaOptionKey,
  type FillPatternOptionMutationContext,
  type FillShadingPresetId,
  type InspectorDescriptor,
  type InspectorProperty,
  type LineCapPresetId,
  type LineJoinPresetId,
  type NodeFontFamilyId,
  type NodeFontMutationContext,
  type NodeFontSizePresetId,
  type NodeShapePresetId,
  type PathMorphingDecorationPresetId,
  type SetPropertyWriteTarget
} from "tikz-editor/edit/inspector";
import { buildStylesCascadeModel } from "tikz-editor/edit/styles-cascade";
import type { SceneElement } from "tikz-editor/semantic/types";
import { collectProjectNamedColorSwatches } from "../project-named-colors";
import { useEditorStore } from "../store/store";
import { getInspectorPropertyCapabilityStatus } from "./capabilities";
import { ColorPickerField } from "./ColorPicker";
import { CustomDropdown } from "./CustomDropdown";
import { actionAvailability, alignSelection, distributeSelection } from "./editor-commands";
import { RenderedTooltip } from "./RenderedTooltip";
import {
  ARROW_TIP_MIXED_OPTION_VALUE,
  DASH_STYLE_MIXED_OPTION_VALUE,
  FILL_MODE_MIXED_OPTION_VALUE,
  FILL_PATTERN_MIXED_OPTION_VALUE,
  FILL_SHADING_MIXED_OPTION_VALUE,
  LINE_CAP_MIXED_OPTION_VALUE,
  LINE_JOIN_MIXED_OPTION_VALUE,
  LINE_WIDTH_ALL_OPTION_KEYS,
  LINE_WIDTH_CUSTOM_OPTION_VALUE,
  LINE_WIDTH_DROPDOWN_OPTIONS,
  LINE_WIDTH_MIXED_OPTION_VALUE,
  LINE_WIDTH_NUMERIC_KEY,
  LINE_WIDTH_PRESET_BY_LABEL,
  LINE_WIDTH_PRESET_KEYS,
  NODE_FONT_SIZE_MIXED_OPTION_VALUE,
  NODE_SHAPE_MIXED_OPTION_VALUE,
  PATH_MORPHING_DECORATION_MIXED_OPTION_VALUE,
  ArrowTipPreview,
  DashStylePreview,
  FillPatternPreview,
  LineCapPreview,
  LineJoinPreview,
  LineWidthPreview,
  PathMorphingDecorationPreview,
  arrowTipPreviewPreset,
  arrowTipValueLabel,
  buildMultiInspectorModel,
  buildInspectorPropertyProvenanceMap,
  buildMultiInspectorPropertyProvenanceMap,
  clampNumber,
  dashStylePreviewPreset,
  dashStyleValueLabel,
  fillModeValueLabel,
  fillPatternPreviewPreset,
  fillPatternValueLabel,
  fillShadingValueLabel,
  isFillAdvancedPropertyId,
  isPathMorphingSuboptionPropertyId,
  isSelectableArrowTipValue,
  isSelectableDashStyleValue,
  isSelectableFillModeValue,
  isSelectableFillPatternValue,
  isSelectableFillShadingValue,
  isSelectableLineCapValue,
  isSelectableLineJoinValue,
  isSelectableNodeFontSizeValue,
  isSelectableNodeShapeValue,
  isSelectablePathMorphingDecorationValue,
  isStrokeMoreOptionsPropertyId,
  lineCapPreviewPreset,
  lineCapValueLabel,
  lineJoinPreviewPreset,
  lineJoinValueLabel,
  lineWidthPresetLabelFromValue,
  lineWidthPreviewLineWidth,
  lineWidthValueLabel,
  nodeFontButtonClass,
  nodeFontSizePresetPtLabel,
  nodeFontSizeValueLabel,
  nodeShapeValueLabel,
  pathMorphingDecorationPreviewPreset,
  pathMorphingDecorationValueLabel,
  sameOrderedStringArrays,
  shouldAutoShowFillAdvancedOptions,
  shouldAutoShowStrokeMoreOptions,
  shouldRenderCompactNumberPair,
  toArrowTipDropdownOptions,
  toDashStyleDropdownOptions,
  toFillModeDropdownOptions,
  toFillPatternDropdownOptions,
  toFillShadingDropdownOptions,
  toLineCapDropdownOptions,
  toLineJoinDropdownOptions,
  toNodeFontSizeDropdownOptions,
  toNodeShapeDropdownOptions,
  toPathMorphingDecorationDropdownOptions,
  type ArrowTipDropdownValue,
  type DashStyleDropdownValue,
  type FillModeDropdownValue,
  type FillPatternDropdownValue,
  type FillShadingDropdownValue,
  type LineCapDropdownValue,
  type LineJoinDropdownValue,
  type LineWidthDropdownValue,
  type MultiInspectorModel,
  type InspectorPropertyProvenance,
  type InspectorPropertyProvenanceMap,
  type MultiInspectorProperty,
  type MultiInspectorSection,
  type NodeFontSizeDropdownValue,
  type NodeShapeDropdownValue,
  type PathMorphingDecorationDropdownValue
} from "./inspector-panel/panel-helpers";
import {
  createNumberScrubState,
  updateNumberScrubState
} from "./inspector-panel/number-scrub";
import css from "./InspectorPanel.module.css";


type ApplySetPropertyOptions = {
  key?: string;
  clearKeys?: string[];
  recordInHistory?: boolean;
};

type NumberChangeOptions = {
  recordInHistory?: boolean;
};

type NumberLabelScrubBinding = {
  writable: boolean;
  value: number;
  step: number;
  min?: number;
  max?: number;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
};

type HoverPreviewSession = {
  ownerKey: string;
  baseSource: string;
};

type FrozenInspectorView = {
  selectedSourceIds: string[];
  descriptor: InspectorDescriptor | null;
  multiModel: MultiInspectorModel | null;
  singlePropertyProvenance: InspectorPropertyProvenanceMap;
  multiPropertyProvenance: InspectorPropertyProvenanceMap;
};

type NumberLabelScrubSession = {
  pointerId: number;
  baseSource: string;
  state: ReturnType<typeof createNumberScrubState>;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
};

type ArrangeCommandContext = Parameters<typeof alignSelection>[0];

type MultiArrangeAction = {
  id:
    | "align-left"
    | "align-center"
    | "align-right"
    | "align-top"
    | "align-middle"
    | "align-bottom"
    | "distribute-horizontal"
    | "distribute-vertical";
  group: "align" | "distribute";
  label: string;
  icon: RemixiconComponentType;
  run: (context: ArrangeCommandContext) => void;
};

const MULTI_ARRANGE_ACTIONS: readonly MultiArrangeAction[] = [
  {
    id: "align-left",
    group: "align",
    label: "Align left",
    icon: RiAlignItemLeftLine,
    run: (context) => {
      alignSelection(context, "left");
    }
  },
  {
    id: "align-center",
    group: "align",
    label: "Align center",
    icon: RiAlignItemHorizontalCenterLine,
    run: (context) => {
      alignSelection(context, "center");
    }
  },
  {
    id: "align-right",
    group: "align",
    label: "Align right",
    icon: RiAlignItemRightLine,
    run: (context) => {
      alignSelection(context, "right");
    }
  },
  {
    id: "align-top",
    group: "align",
    label: "Align top",
    icon: RiAlignItemTopLine,
    run: (context) => {
      alignSelection(context, "top");
    }
  },
  {
    id: "align-middle",
    group: "align",
    label: "Align middle",
    icon: RiAlignItemVerticalCenterLine,
    run: (context) => {
      alignSelection(context, "middle");
    }
  },
  {
    id: "align-bottom",
    group: "align",
    label: "Align bottom",
    icon: RiAlignItemBottomLine,
    run: (context) => {
      alignSelection(context, "bottom");
    }
  },
  {
    id: "distribute-horizontal",
    group: "distribute",
    label: "Distribute horizontally",
    icon: RiSplitCellsHorizontal,
    run: (context) => {
      distributeSelection(context, "horizontal");
    }
  },
  {
    id: "distribute-vertical",
    group: "distribute",
    label: "Distribute vertically",
    icon: RiSplitCellsVertical,
    run: (context) => {
      distributeSelection(context, "vertical");
    }
  }
];

export function InspectorPanel() {
  const selectedIds = useEditorStore((s) => s.selectedElementIds);
  const dispatch = useEditorStore((s) => s.dispatch);

  // Freeze source/snapshot during element drags to avoid per-frame re-renders.
  // We use a manual subscription so we can skip updates while a drag is active,
  // then flush once when the drag ends.
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
  const [manualLineWidthCustomKeys, setManualLineWidthCustomKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [strokeMoreOptionsOpen, setStrokeMoreOptionsOpen] = useState(false);
  const [fillAdvancedOptionsOpen, setFillAdvancedOptionsOpen] = useState(false);
  const [frozenInspectorView, setFrozenInspectorView] = useState<FrozenInspectorView | null>(null);
  const hoverPreviewSessionRef = useRef<HoverPreviewSession | null>(null);
  const numberLabelScrubSessionRef = useRef<NumberLabelScrubSession | null>(null);
  const numberLabelScrubListenersAttachedRef = useRef(false);

  const selectedSourceIds = useMemo(() => [...selectedIds], [selectedIds]);
  const projectNamedColorSwatches = useMemo(
    () => collectProjectNamedColorSwatches(source),
    [source]
  );
  const globalTransformValues = useMemo(
    () => resolveTransformInspectorValues(source, TIKZPICTURE_GLOBAL_TARGET_ID),
    [source]
  );

  const selectedElements = useMemo(() => {
    const bySource = new Map<string, SceneElement>();
    for (const element of snapshot.scene?.elements ?? []) {
      const targetId = element.adornment?.targetId ?? element.sourceId;
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
        editHandles: snapshot.editHandles
      })
    );
  }, [selectedElements, snapshot.source, snapshot.editHandles]);

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
          editHandles: snapshot.editHandles
        },
        elementDescriptor
      );
      return buildInspectorPropertyProvenanceMap(cascadeModel);
    });
  }, [descriptors, selectedElements, snapshot.editHandles, snapshot.source]);

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
      snapshotSource: snapshot.source,
      scene: snapshot.scene,
      editHandles: snapshot.editHandles,
      selectedElementIds: selectedIds,
      dispatch
    }),
    [dispatch, selectedIds, snapshot.editHandles, snapshot.scene, snapshot.source, source]
  );
  const arrangeAvailability = useMemo(
    () => actionAvailability(commandContext),
    [commandContext]
  );

  const clearHoverPreviewSession = useCallback((ownerKey?: string) => {
    const current = hoverPreviewSessionRef.current;
    if (!current) {
      return;
    }
    if (ownerKey && current.ownerKey !== ownerKey) {
      return;
    }
    const currentSource = useEditorStore.getState().source;
    if (currentSource !== current.baseSource) {
      dispatch({
        type: "SET_SOURCE_TRANSIENT",
        source: current.baseSource
      });
    }
    hoverPreviewSessionRef.current = null;
    setFrozenInspectorView(null);
  }, [dispatch]);

  const ensureHoverPreviewSession = useCallback((ownerKey: string) => {
    const current = hoverPreviewSessionRef.current;
    if (!current) {
      hoverPreviewSessionRef.current = {
        ownerKey,
        baseSource: useEditorStore.getState().source
      };
      setFrozenInspectorView({
        selectedSourceIds: [...selectedSourceIds],
        descriptor,
        multiModel,
        singlePropertyProvenance,
        multiPropertyProvenance
      });
      return;
    }
    if (current.ownerKey === ownerKey) {
      return;
    }
    const currentSource = useEditorStore.getState().source;
    if (currentSource !== current.baseSource) {
      dispatch({
        type: "SET_SOURCE_TRANSIENT",
        source: current.baseSource
      });
    }
    hoverPreviewSessionRef.current = {
      ownerKey,
      baseSource: current.baseSource
    };
  }, [descriptor, dispatch, multiModel, multiPropertyProvenance, selectedSourceIds, singlePropertyProvenance]);

  const applyHoverPreview = useCallback((ownerKey: string, applyPreview: () => void) => {
    ensureHoverPreviewSession(ownerKey);
    applyPreview();
  }, [ensureHoverPreviewSession]);

  const commitAfterHoverPreview = useCallback((ownerKey: string, commit: () => void) => {
    const current = hoverPreviewSessionRef.current;
    if (current?.ownerKey === ownerKey) {
      const currentSource = useEditorStore.getState().source;
      if (currentSource !== current.baseSource) {
        dispatch({
          type: "SET_SOURCE_TRANSIENT",
          source: current.baseSource
        });
      }
      hoverPreviewSessionRef.current = null;
      setFrozenInspectorView(null);
    }
    commit();
  }, [dispatch]);

  const stopNumberLabelScrubRef = useRef<(commit: boolean, pointerId?: number) => void>(() => {});

  const handleNumberLabelScrubPointerMove = useCallback((event: PointerEvent) => {
    const session = numberLabelScrubSessionRef.current;
    if (!session || event.pointerId !== session.pointerId) {
      return;
    }

    const result = updateNumberScrubState(session.state, {
      currentX: event.clientX,
      modifiers: {
        shiftKey: event.shiftKey,
        altKey: event.altKey
      }
    });
    session.state = result.nextState;
    if (result.didActivate) {
      document.body.classList.add("is-scrubbing");
    }
    if (result.nextValue == null) {
      return;
    }
    session.onPreview(result.nextValue);
  }, []);

  const handleNumberLabelScrubPointerUp = useCallback((event: PointerEvent) => {
    stopNumberLabelScrubRef.current(true, event.pointerId);
  }, []);

  const handleNumberLabelScrubPointerCancel = useCallback((event: PointerEvent) => {
    stopNumberLabelScrubRef.current(false, event.pointerId);
  }, []);

  const handleNumberLabelScrubWindowBlur = useCallback(() => {
    stopNumberLabelScrubRef.current(false);
  }, []);

  const removeNumberLabelScrubListeners = useCallback(() => {
    if (!numberLabelScrubListenersAttachedRef.current) {
      return;
    }
    window.removeEventListener("pointermove", handleNumberLabelScrubPointerMove);
    window.removeEventListener("pointerup", handleNumberLabelScrubPointerUp);
    window.removeEventListener("pointercancel", handleNumberLabelScrubPointerCancel);
    window.removeEventListener("blur", handleNumberLabelScrubWindowBlur);
    numberLabelScrubListenersAttachedRef.current = false;
  }, [
    handleNumberLabelScrubPointerCancel,
    handleNumberLabelScrubPointerMove,
    handleNumberLabelScrubPointerUp,
    handleNumberLabelScrubWindowBlur
  ]);

  const stopNumberLabelScrub = useCallback((commit: boolean, pointerId?: number) => {
    const session = numberLabelScrubSessionRef.current;
    if (!session || (pointerId != null && pointerId !== session.pointerId)) {
      return;
    }
    numberLabelScrubSessionRef.current = null;
    removeNumberLabelScrubListeners();

    if (session.state.hasActivated) {
      const currentSource = useEditorStore.getState().source;
      if (currentSource !== session.baseSource) {
        dispatch({
          type: "SET_SOURCE_TRANSIENT",
          source: session.baseSource
        });
      }
      if (commit) {
        session.onCommit(session.state.lastValue);
      }
    }

    document.body.classList.remove("is-scrubbing");
  }, [dispatch, removeNumberLabelScrubListeners]);

  useEffect(() => {
    stopNumberLabelScrubRef.current = stopNumberLabelScrub;
  }, [stopNumberLabelScrub]);

  const ensureNumberLabelScrubListeners = useCallback(() => {
    if (numberLabelScrubListenersAttachedRef.current) {
      return;
    }
    window.addEventListener("pointermove", handleNumberLabelScrubPointerMove);
    window.addEventListener("pointerup", handleNumberLabelScrubPointerUp);
    window.addEventListener("pointercancel", handleNumberLabelScrubPointerCancel);
    window.addEventListener("blur", handleNumberLabelScrubWindowBlur);
    numberLabelScrubListenersAttachedRef.current = true;
  }, [
    handleNumberLabelScrubPointerCancel,
    handleNumberLabelScrubPointerMove,
    handleNumberLabelScrubPointerUp,
    handleNumberLabelScrubWindowBlur
  ]);

  const beginNumberLabelScrub = useCallback((event: ReactPointerEvent<HTMLElement>, binding: NumberLabelScrubBinding) => {
    if (!binding.writable || event.button !== 0 || event.ctrlKey || event.metaKey) {
      return;
    }
    event.preventDefault();
    clearHoverPreviewSession();
    stopNumberLabelScrub(false);

    numberLabelScrubSessionRef.current = {
      pointerId: event.pointerId,
      baseSource: useEditorStore.getState().source,
      state: createNumberScrubState({
        startX: event.clientX,
        startValue: binding.value,
        step: binding.step,
        min: binding.min,
        max: binding.max
      }),
      onPreview: binding.onPreview,
      onCommit: binding.onCommit
    };
    ensureNumberLabelScrubListeners();
  }, [clearHoverPreviewSession, ensureNumberLabelScrubListeners, stopNumberLabelScrub]);

  useEffect(() => {
    clearHoverPreviewSession();
    stopNumberLabelScrub(false);
  }, [selectedSourceIds, clearHoverPreviewSession, stopNumberLabelScrub]);

  useEffect(() => {
    return () => {
      clearHoverPreviewSession();
      stopNumberLabelScrub(false);
    };
  }, [clearHoverPreviewSession, stopNumberLabelScrub]);

  useEffect(() => {
    setStrokeMoreOptionsOpen(false);
    setFillAdvancedOptionsOpen(false);
  }, [selectedIds]);

  function applySetProperty(
    write: SetPropertyWriteTarget,
    value: string,
    options: ApplySetPropertyOptions = {}
  ): void {
    if (!write.writable || write.elementId.length === 0) return;
    dispatch({
      type: "APPLY_EDIT_ACTION",
      recordInHistory: options.recordInHistory,
      action: {
        kind: "setProperty",
        elementId: write.elementId,
        level: write.level,
        key: options.key ?? write.key,
        value,
        clearKeys: options.clearKeys
      }
    });
  }

  function applySetPropertyMany(
    writes: readonly SetPropertyWriteTarget[],
    value: string,
    options: ApplySetPropertyOptions = {}
  ): void {
    const writable = writes.filter((write) => write.writable && write.elementId.length > 0);
    if (writable.length === 0) {
      return;
    }

    const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
    for (const write of writable) {
      dispatch({
        type: "APPLY_EDIT_ACTION",
        historyMergeKey: mergeKey,
        recordInHistory: options.recordInHistory,
        action: {
          kind: "setProperty",
          elementId: write.elementId,
          level: write.level,
          key: options.key ?? write.key,
          value,
          clearKeys: options.clearKeys
        }
      });
    }
  }

  function colorSyntaxClearKeys(syntaxValue: string | null): string[] | undefined {
    const normalized = syntaxValue?.trim() ?? "";
    return normalized.length > 0 ? [normalized] : undefined;
  }

  function normalizeColorSetPropertyChange(
    write: SetPropertyWriteTarget,
    nextValue: string,
    syntaxValue: string | null
  ): { value: string; clearKeys?: string[] } {
    if (write.key === "text" && nextValue === "none") {
      const clearKeySet = new Set<string>(["text", "text color"]);
      for (const key of colorSyntaxClearKeys(syntaxValue) ?? []) {
        clearKeySet.add(key);
      }
      return {
        value: "",
        clearKeys: [...clearKeySet]
      };
    }

    return {
      value: nextValue,
      clearKeys: colorSyntaxClearKeys(syntaxValue)
    };
  }

  function applyArrowTipValue(
    write: ArrowTipWriteTarget,
    side: ArrowTipSide,
    value: Exclude<ArrowTipPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void {
    const mutation = buildArrowTipSetPropertyMutation(write.arrowContext, side, value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applyArrowTipValueMany(
    writes: readonly ArrowTipWriteTarget[],
    side: ArrowTipSide,
    value: Exclude<ArrowTipPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void {
    const writable = writes.filter((write) => write.writable && write.elementId.length > 0);
    if (writable.length === 0) {
      return;
    }

    const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
    for (const write of writable) {
      const mutation = buildArrowTipSetPropertyMutation(write.arrowContext, side, value);
      dispatch({
        type: "APPLY_EDIT_ACTION",
        historyMergeKey: mergeKey,
        recordInHistory: options.recordInHistory,
        action: {
          kind: "setProperty",
          elementId: write.elementId,
          level: write.level,
          key: mutation.key,
          value: mutation.value,
          clearKeys: mutation.clearKeys
        }
      });
    }
  }

  function applyDashStyleValue(
    write: SetPropertyWriteTarget,
    value: Exclude<DashStylePresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void {
    const mutation = buildDashStyleSetPropertyMutation(value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applyDashStyleValueMany(
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<DashStylePresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void {
    const mutation = buildDashStyleSetPropertyMutation(value);
    applySetPropertyMany(writes, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applyLineCapValue(
    write: SetPropertyWriteTarget,
    value: Exclude<LineCapPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void {
    const mutation = buildLineCapSetPropertyMutation(value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applyLineCapValueMany(
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<LineCapPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void {
    const mutation = buildLineCapSetPropertyMutation(value);
    applySetPropertyMany(writes, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applyLineJoinValue(
    write: SetPropertyWriteTarget,
    value: Exclude<LineJoinPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void {
    const mutation = buildLineJoinSetPropertyMutation(value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applyLineJoinValueMany(
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<LineJoinPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void {
    const mutation = buildLineJoinSetPropertyMutation(value);
    applySetPropertyMany(writes, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applyFillModeValue(
    write: SetPropertyWriteTarget,
    value: Exclude<FillModePresetId, "custom">,
    context: {
      fillColor: string | null;
      patternColor: string | null;
      shading: FillShadingPresetId;
      pattern: FillPatternPresetId;
    },
    options: ApplySetPropertyOptions = {}
  ): void {
    if (!write.writable || write.elementId.length === 0) {
      return;
    }

    const mutations = buildFillModeSetPropertyMutations(value, context);
    if (mutations.length === 0) {
      return;
    }

    const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
    for (const mutation of mutations) {
      dispatch({
        type: "APPLY_EDIT_ACTION",
        historyMergeKey: mergeKey,
        recordInHistory: options.recordInHistory,
        action: {
          kind: "setProperty",
          elementId: write.elementId,
          level: write.level,
          key: mutation.key,
          value: mutation.value,
          clearKeys: mutation.clearKeys
        }
      });
    }
  }

  function applyFillModeValueMany(
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<FillModePresetId, "custom">,
    contexts: ReadonlyArray<{
      fillColor: string | null;
      patternColor: string | null;
      shading: FillShadingPresetId;
      pattern: FillPatternPresetId;
    }>,
    options: ApplySetPropertyOptions = {}
  ): void {
    const writableWrites = writes
      .map((write, index) => ({
        write,
        context: contexts[index]
      }))
      .filter(
        (entry): entry is { write: SetPropertyWriteTarget; context: NonNullable<(typeof contexts)[number]> } =>
          entry.write.writable && entry.write.elementId.length > 0 && entry.context != null
      );

    if (writableWrites.length === 0) {
      return;
    }

    const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
    for (const { write, context } of writableWrites) {
      const mutations = buildFillModeSetPropertyMutations(value, context);
      for (const mutation of mutations) {
        dispatch({
          type: "APPLY_EDIT_ACTION",
          historyMergeKey: mergeKey,
          recordInHistory: options.recordInHistory,
          action: {
            kind: "setProperty",
            elementId: write.elementId,
            level: write.level,
            key: mutation.key,
            value: mutation.value,
            clearKeys: mutation.clearKeys
          }
        });
      }
    }
  }

  function applyFillShadingValue(
    write: SetPropertyWriteTarget,
    value: Exclude<FillShadingPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void {
    if (!write.writable || write.elementId.length === 0) {
      return;
    }
    const mutations = buildFillShadingSetPropertyMutations(value);
    if (mutations.length === 0) {
      return;
    }
    const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
    for (const mutation of mutations) {
      dispatch({
        type: "APPLY_EDIT_ACTION",
        historyMergeKey: mergeKey,
        recordInHistory: options.recordInHistory,
        action: {
          kind: "setProperty",
          elementId: write.elementId,
          level: write.level,
          key: mutation.key,
          value: mutation.value,
          clearKeys: mutation.clearKeys
        }
      });
    }
  }

  function applyFillShadingValueMany(
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<FillShadingPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void {
    const writable = writes.filter((write) => write.writable && write.elementId.length > 0);
    if (writable.length === 0) {
      return;
    }
    const mutations = buildFillShadingSetPropertyMutations(value);
    if (mutations.length === 0) {
      return;
    }

    const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
    for (const write of writable) {
      for (const mutation of mutations) {
        dispatch({
          type: "APPLY_EDIT_ACTION",
          historyMergeKey: mergeKey,
          recordInHistory: options.recordInHistory,
          action: {
            kind: "setProperty",
            elementId: write.elementId,
            level: write.level,
            key: mutation.key,
            value: mutation.value,
            clearKeys: mutation.clearKeys
          }
        });
      }
    }
  }

  function applyFillPatternValue(
    write: SetPropertyWriteTarget,
    value: Exclude<FillPatternPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void {
    const mutation = buildFillPatternSetPropertyMutation(value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applyFillPatternValueMany(
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<FillPatternPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void {
    const mutation = buildFillPatternSetPropertyMutation(value);
    applySetPropertyMany(writes, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applyFillPatternOptionValue(
    write: SetPropertyWriteTarget,
    option: FillPatternMetaOptionKey,
    value: number,
    context: FillPatternOptionMutationContext,
    options: ApplySetPropertyOptions = {}
  ): void {
    const mutation = buildFillPatternOptionSetPropertyMutation(context, option, value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applyFillPatternOptionValueMany(
    writes: readonly SetPropertyWriteTarget[],
    option: FillPatternMetaOptionKey,
    value: number,
    contexts: readonly FillPatternOptionMutationContext[],
    options: ApplySetPropertyOptions = {}
  ): void {
    const writableEntries = writes
      .map((write, index) => {
        const context = contexts[index];
        return context ? { write, context } : null;
      })
      .filter(
        (entry): entry is { write: SetPropertyWriteTarget; context: FillPatternOptionMutationContext } =>
          entry != null && entry.write.writable && entry.write.elementId.length > 0
      );
    if (writableEntries.length === 0) {
      return;
    }

    const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
    for (const entry of writableEntries) {
      const mutation = buildFillPatternOptionSetPropertyMutation(entry.context, option, value);
      dispatch({
        type: "APPLY_EDIT_ACTION",
        historyMergeKey: mergeKey,
        recordInHistory: options.recordInHistory,
        action: {
          kind: "setProperty",
          elementId: entry.write.elementId,
          level: entry.write.level,
          key: mutation.key,
          value: mutation.value,
          clearKeys: mutation.clearKeys
        }
      });
    }
  }

  function applyPathMorphingDecorationValue(
    write: SetPropertyWriteTarget,
    value: Exclude<PathMorphingDecorationPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void {
    if (!write.writable || write.elementId.length === 0) {
      return;
    }
    const mutations = buildPathMorphingDecorationSetPropertyMutations(value);
    if (mutations.length === 0) {
      return;
    }

    const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
    for (const mutation of mutations) {
      dispatch({
        type: "APPLY_EDIT_ACTION",
        historyMergeKey: mergeKey,
        recordInHistory: options.recordInHistory,
        action: {
          kind: "setProperty",
          elementId: write.elementId,
          level: write.level,
          key: mutation.key,
          value: mutation.value,
          clearKeys: mutation.clearKeys
        }
      });
    }
  }

  function applyPathMorphingDecorationValueMany(
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<PathMorphingDecorationPresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void {
    const writable = writes.filter((write) => write.writable && write.elementId.length > 0);
    if (writable.length === 0) {
      return;
    }

    const mutations = buildPathMorphingDecorationSetPropertyMutations(value);
    if (mutations.length === 0) {
      return;
    }

    const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
    for (const write of writable) {
      for (const mutation of mutations) {
        dispatch({
          type: "APPLY_EDIT_ACTION",
          historyMergeKey: mergeKey,
          recordInHistory: options.recordInHistory,
          action: {
            kind: "setProperty",
            elementId: write.elementId,
            level: write.level,
            key: mutation.key,
            value: mutation.value,
            clearKeys: mutation.clearKeys
          }
        });
      }
    }
  }

  function applyRoundedCornersValue(
    write: SetPropertyWriteTarget,
    enabled: boolean,
    radius: number,
    options: ApplySetPropertyOptions = {}
  ): void {
    const mutation = buildRoundedCornersSetPropertyMutation(enabled, radius);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applyRoundedCornersValueMany(
    writes: readonly SetPropertyWriteTarget[],
    enabled: boolean,
    radius: number,
    options: ApplySetPropertyOptions = {}
  ): void {
    const mutation = buildRoundedCornersSetPropertyMutation(enabled, radius);
    applySetPropertyMany(writes, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applyNodeShapeValue(
    write: SetPropertyWriteTarget,
    value: Exclude<NodeShapePresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void {
    const mutation = buildNodeShapeSetPropertyMutation(value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applyNodeShapeValueMany(
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<NodeShapePresetId, "custom">,
    options: ApplySetPropertyOptions = {}
  ): void {
    const mutation = buildNodeShapeSetPropertyMutation(value);
    applySetPropertyMany(writes, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applyNodeInnerSepValue(
    write: SetPropertyWriteTarget,
    value: number,
    options: ApplySetPropertyOptions = {}
  ): void {
    const mutation = buildNodeInnerSepSetPropertyMutation(value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applyNodeInnerSepValueMany(
    writes: readonly SetPropertyWriteTarget[],
    value: number,
    options: ApplySetPropertyOptions = {}
  ): void {
    const mutation = buildNodeInnerSepSetPropertyMutation(value);
    applySetPropertyMany(writes, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applyNodeFontValue(
    write: SetPropertyWriteTarget,
    context: NodeFontMutationContext,
    values: {
      family: NodeFontFamilyId;
      weight: "normal" | "bold";
      style: "normal" | "italic";
      sizePreset: NodeFontSizePresetId;
      customSizePt: number | null;
    },
    options: ApplySetPropertyOptions = {}
  ): void {
    const mutation = buildNodeFontSetPropertyMutation(context, values);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applyNodeFontValueMany(
    writes: readonly SetPropertyWriteTarget[],
    contexts: ReadonlyArray<{
      context: NodeFontMutationContext;
      values: {
        family: NodeFontFamilyId;
        weight: "normal" | "bold";
        style: "normal" | "italic";
        sizePreset: NodeFontSizePresetId;
        customSizePt: number | null;
      };
    }>,
    nextValues: Partial<{
      family: NodeFontFamilyId;
      weight: "normal" | "bold";
      style: "normal" | "italic";
      sizePreset: NodeFontSizePresetId;
      customSizePt: number | null;
    }>,
    options: ApplySetPropertyOptions = {}
  ): void {
    const writableEntries = writes
      .map((write, index) => {
        const context = contexts[index];
        return context ? { write, context } : null;
      })
      .filter(
        (
          entry
        ): entry is {
          write: SetPropertyWriteTarget;
          context: {
            context: NodeFontMutationContext;
            values: {
              family: NodeFontFamilyId;
              weight: "normal" | "bold";
              style: "normal" | "italic";
              sizePreset: NodeFontSizePresetId;
              customSizePt: number | null;
            };
          };
        } => entry != null && entry.write.writable && entry.write.elementId.length > 0
      );

    if (writableEntries.length === 0) {
      return;
    }

    const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
    for (const entry of writableEntries) {
      const mutation = buildNodeFontSetPropertyMutation(entry.context.context, {
        ...entry.context.values,
        ...nextValues
      });
      dispatch({
        type: "APPLY_EDIT_ACTION",
        historyMergeKey: mergeKey,
        recordInHistory: options.recordInHistory,
        action: {
          kind: "setProperty",
          elementId: entry.write.elementId,
          level: entry.write.level,
          key: mutation.key,
          value: mutation.value,
          clearKeys: mutation.clearKeys
        }
      });
    }
  }

  function handleNumberChange(
    property: Extract<InspectorProperty, { kind: "number" }>,
    raw: string,
    options: NumberChangeOptions = {}
  ): void {
    const write = property.write;
    if (!write || write.mode !== "setProperty" || !write.writable || write.elementId.length === 0) return;
    const next = Number(raw);
    if (!Number.isFinite(next)) return;
    if (!write.transformContext) {
      applySetProperty(write, formatNumberWriteValue(property, next), {
        clearKeys: property.clearKeys,
        recordInHistory: options.recordInHistory
      });
      return;
    }

    const mutations = buildTransformSetPropertyMutations(
      write.transformContext.values,
      write.transformContext.key,
      next
    );
    if (mutations.length === 0) {
      return;
    }

    const mergeKey = `single-set:${Date.now().toString(36)}`;
    for (const mutation of mutations) {
      dispatch({
        type: "APPLY_EDIT_ACTION",
        historyMergeKey: mergeKey,
        recordInHistory: options.recordInHistory,
        action: {
          kind: "setProperty",
          elementId: write.elementId,
          level: write.level,
          key: mutation.key,
          value: mutation.value,
          clearKeys: mutation.clearKeys
        }
      });
    }
  }

  function renderSingleTextField(
    property: Extract<InspectorProperty, { kind: "text" }>,
    provenance: InspectorPropertyProvenance | null
  ): JSX.Element {
    const writable = property.write.writable && property.write.elementId.length > 0;
    const readOnlyReason = property.readOnlyReason ?? property.write.reason ?? null;
    const textInput = (
      <input
        className={withValueProvenanceClass(css.textInput, provenance)}
        type="text"
        value={property.value}
        disabled={!writable}
        onChange={(event) => applySetProperty(property.write, event.currentTarget.value)}
      />
    );
    return (
      <div>
        <div className={css.propertyLabel}>{property.label}</div>
        <div className={css.controlRow}>
          {maybeWrapWithProvenanceTooltip(provenance, textInput, true)}
        </div>
        {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
      </div>
    );
  }

  function handleMultiNumberChange(
    property: Extract<MultiInspectorProperty, { kind: "number" }>,
    raw: string,
    options: NumberChangeOptions = {}
  ): void {
    const next = Number(raw);
    if (!Number.isFinite(next)) return;

    const writableWrites = property.writes.filter((write) => write.writable && write.elementId.length > 0);
    if (writableWrites.length === 0) {
      return;
    }

    const mergeKey = `multi-set:${Date.now().toString(36)}`;
    for (const write of writableWrites) {
      if (!write.transformContext) {
        dispatch({
          type: "APPLY_EDIT_ACTION",
          historyMergeKey: mergeKey,
          recordInHistory: options.recordInHistory,
          action: {
            kind: "setProperty",
            elementId: write.elementId,
            level: write.level,
            key: write.key,
            value: formatNumberWriteValue(property, next),
            clearKeys: property.clearKeys
          }
        });
        continue;
      }
      const mutations = buildTransformSetPropertyMutations(
        write.transformContext.values,
        write.transformContext.key,
        next
      );
      for (const mutation of mutations) {
        dispatch({
          type: "APPLY_EDIT_ACTION",
          historyMergeKey: mergeKey,
          recordInHistory: options.recordInHistory,
          action: {
            kind: "setProperty",
            elementId: write.elementId,
            level: write.level,
            key: mutation.key,
            value: mutation.value,
            clearKeys: mutation.clearKeys
          }
        });
      }
    }
  }

  function formatNumberWriteValue(
    property: Pick<Extract<InspectorProperty, { kind: "number" }> | Extract<MultiInspectorProperty, { kind: "number" }>, "unit">,
    value: number
  ): string {
    const formatted = formatNumber(value);
    if (property.unit) {
      return `${formatted}${property.unit}`;
    }
    return formatted;
  }

  function withValueProvenanceClass(
    className: string | undefined,
    provenance: InspectorPropertyProvenance | null
  ): string | undefined {
    if (!provenance) {
      return className;
    }
    return [className ?? "", css.provenanceValue].filter(Boolean).join(" ");
  }

  function implicitDefaultProvenance(
    property: InspectorProperty | MultiInspectorProperty
  ): InspectorPropertyProvenance | null {
    if (
      property.kind === "length"
      && property.id === "node-inner-sep"
      && Math.abs(property.value - NODE_INNER_SEP_DEFAULT) <= 1e-6
      && !("mixed" in property && property.mixed)
    ) {
      return { kind: "default", tooltip: "TikZ default" };
    }
    return null;
  }

  function provenanceTooltipContent(provenance: InspectorPropertyProvenance | null): JSX.Element | string | null {
    if (!provenance) {
      return null;
    }
    if (provenance.kind === "default") {
      return "TikZ default";
    }
    return <>set by <code>{provenance.sourceLabel}</code></>;
  }

  function maybeWrapWithProvenanceTooltip(
    provenance: InspectorPropertyProvenance | null,
    child: JSX.Element,
    block = false
  ): JSX.Element {
    const content = provenanceTooltipContent(provenance);
    if (!content) {
      return child;
    }
    return (
      <RenderedTooltip content={content} block={block}>
        {child}
      </RenderedTooltip>
    );
  }

  function applySingleLengthValue(
    property: Extract<InspectorProperty, { kind: "length" }>,
    value: number,
    options: NumberChangeOptions = {}
  ): void {
    applySetProperty(property.write, `${formatNumber(value)}pt`, {
      recordInHistory: options.recordInHistory
    });
  }

  function applyMultiLengthValue(
    property: Extract<MultiInspectorProperty, { kind: "length" }>,
    value: number,
    options: NumberChangeOptions = {}
  ): void {
    applySetPropertyMany(property.writes, `${formatNumber(value)}pt`, {
      recordInHistory: options.recordInHistory
    });
  }

  function applySingleFillPatternOptionValue(
    property: Extract<InspectorProperty, { kind: "fillPatternOption" }>,
    value: number,
    options: NumberChangeOptions = {}
  ): void {
    applyFillPatternOptionValue(property.write, property.option, value, property.context, {
      recordInHistory: options.recordInHistory
    });
  }

  function applyMultiFillPatternOptionValue(
    property: Extract<MultiInspectorProperty, { kind: "fillPatternOption" }>,
    value: number,
    options: NumberChangeOptions = {}
  ): void {
    applyFillPatternOptionValueMany(property.writes, property.option, value, property.contexts, {
      recordInHistory: options.recordInHistory
    });
  }

  function renderScrubbableNumberLabel(
    label: string,
    binding: NumberLabelScrubBinding
  ): JSX.Element {
    const className = binding.writable
      ? `${css.propertyLabel} ${css.propertyLabelScrubbable}`
      : `${css.propertyLabel} ${css.propertyLabelScrubbableDisabled}`;
    return (
      <div
        className={className}
        onPointerDown={(event) => beginNumberLabelScrub(event, binding)}
      >
        {label}
      </div>
    );
  }

  function getSingleNumberPropertyState(property: Extract<InspectorProperty, { kind: "number" }>): {
    writable: boolean;
    readOnlyReason: string | null;
  } {
    const capability = getInspectorPropertyCapabilityStatus(property);
    const capabilityReadOnlyReason =
      capability.status === "unsupported" ? capability.reason : null;
    const readOnlyReason = property.readOnlyReason ?? property.write?.reason ?? capabilityReadOnlyReason;
    const writable = (property.write?.writable ?? false) && capability.status !== "unsupported";
    return { writable, readOnlyReason };
  }

  function renderSingleNumberField(
    property: Extract<InspectorProperty, { kind: "number" }>,
    compact = false,
    provenance: InspectorPropertyProvenance | null = null
  ): JSX.Element {
    const { writable, readOnlyReason } = getSingleNumberPropertyState(property);
    const input = (
      <input
        className={withValueProvenanceClass(css.numberInput, provenance)}
        type="number"
        step={property.step}
        value={formatNumber(property.value)}
        disabled={!writable}
        onChange={(event) => handleNumberChange(property, event.currentTarget.value)}
      />
    );
    return (
      <div className={compact ? css.compactNumberField : undefined}>
        {renderScrubbableNumberLabel(property.label, {
          writable,
          value: property.value,
          step: property.step,
          onPreview: (next) => handleNumberChange(property, String(next), { recordInHistory: false }),
          onCommit: (next) => handleNumberChange(property, String(next))
        })}
        <div className={css.controlRow}>
          {maybeWrapWithProvenanceTooltip(provenance, input, true)}
          {property.unit ? <span className={css.unitLabel}>{property.unit}</span> : null}
        </div>
        {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
      </div>
    );
  }

  function renderMultiNumberField(
    property: Extract<MultiInspectorProperty, { kind: "number" }>,
    compact = false,
    provenance: InspectorPropertyProvenance | null = null
  ): JSX.Element {
    const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
    const input = (
      <input
        className={withValueProvenanceClass(css.numberInput, provenance)}
        type="number"
        step={property.step}
        value={property.mixed ? "" : formatNumber(property.value)}
        disabled={!writable}
        onChange={(event) => handleMultiNumberChange(property, event.currentTarget.value)}
      />
    );
    return (
      <div className={compact ? css.compactNumberField : undefined}>
        {renderScrubbableNumberLabel(property.label, {
          writable,
          value: property.value,
          step: property.step,
          onPreview: (next) => handleMultiNumberChange(property, String(next), { recordInHistory: false }),
          onCommit: (next) => handleMultiNumberChange(property, String(next))
        })}
        <div className={css.controlRow}>
          {maybeWrapWithProvenanceTooltip(provenance, input, true)}
          {property.unit ? <span className={css.unitLabel}>{property.unit}</span> : null}
        </div>
        {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
      </div>
    );
  }

  function renderSingleNumberPair(
    left: Extract<InspectorProperty, { kind: "number" }>,
    right: Extract<InspectorProperty, { kind: "number" }>,
    leftProvenance: InspectorPropertyProvenance | null,
    rightProvenance: InspectorPropertyProvenance | null
  ): JSX.Element {
    return (
      <div key={`${left.id}:${right.id}`} className={css.compactNumberPair}>
        {renderSingleNumberField(left, true, leftProvenance)}
        {renderSingleNumberField(right, true, rightProvenance)}
      </div>
    );
  }

  function renderMultiNumberPair(
    left: Extract<MultiInspectorProperty, { kind: "number" }>,
    right: Extract<MultiInspectorProperty, { kind: "number" }>,
    leftProvenance: InspectorPropertyProvenance | null,
    rightProvenance: InspectorPropertyProvenance | null
  ): JSX.Element {
    return (
      <div key={`${left.id}:${right.id}`} className={css.compactNumberPair}>
        {renderMultiNumberField(left, true, leftProvenance)}
        {renderMultiNumberField(right, true, rightProvenance)}
      </div>
    );
  }

  function enableManualCustomLineWidth(key: string): void {
    setManualLineWidthCustomKeys((current) => {
      if (current.has(key)) {
        return current;
      }
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }

  function disableManualCustomLineWidth(key: string): void {
    setManualLineWidthCustomKeys((current) => {
      if (!current.has(key)) {
        return current;
      }
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  function renderArrowTipDropdown(
    property: {
      id: string;
      label: string;
      side: ArrowTipSide;
      value: ArrowTipPresetId;
      options: Array<{ value: Exclude<ArrowTipPresetId, "custom">; label: string }>;
      previewLineWidth: number;
    },
    writable: boolean,
    onApply: (value: Exclude<ArrowTipPresetId, "custom">) => void,
    valueOverride?: ArrowTipDropdownValue,
    valueClassName?: string,
    onHoverPreview?: (value: Exclude<ArrowTipPresetId, "custom">) => void,
    onHoverPreviewEnd?: () => void
  ) {
    const dropdownValue: ArrowTipDropdownValue = valueOverride ?? property.value;
    const dropdownOptions = toArrowTipDropdownOptions(property.options);
    const displayLabel = arrowTipValueLabel(dropdownValue, property.options);
    const previewPreset = arrowTipPreviewPreset(dropdownValue);

    return (
      <CustomDropdown
        ariaLabel={property.label}
        value={dropdownValue}
        options={dropdownOptions}
        disabled={!writable}
        onChange={(nextValue) => {
          if (!writable || !isSelectableArrowTipValue(nextValue)) {
            return;
          }
          onApply(nextValue);
        }}
        onOptionHover={(nextValue) => {
          if (!writable || !isSelectableArrowTipValue(nextValue) || !onHoverPreview) {
            return;
          }
          onHoverPreview(nextValue);
        }}
        onOptionHoverEnd={onHoverPreviewEnd}
        renderValue={() => (
          <span className={css.arrowTipValue}>
            <span className={css.arrowTipValuePreview}>
              <ArrowTipPreview side={property.side} preset={previewPreset} lineWidth={property.previewLineWidth} />
            </span>
            <span className={[css.arrowTipValueLabel, valueClassName ?? ""].filter(Boolean).join(" ")}>{displayLabel}</span>
          </span>
        )}
        renderOption={(option, state) => {
          const optionPreset = option.value as Exclude<ArrowTipPresetId, "custom">;
          return (
            <span className={css.arrowTipOption}>
              <span className={css.arrowTipOptionPreview}>
                <ArrowTipPreview side={property.side} preset={optionPreset} lineWidth={property.previewLineWidth} />
              </span>
              <span className={css.arrowTipOptionLabel}>{option.label}</span>
              <span className={css.arrowTipOptionCheck} aria-hidden="true">
                {state.selected ? "✓" : ""}
              </span>
            </span>
          );
        }}
      />
    );
  }

  function renderDashStyleDropdown(
    property: {
      label: string;
      value: DashStylePresetId;
      previewLineWidth: number;
      options: Array<{ value: Exclude<DashStylePresetId, "custom">; label: string }>;
    },
    writable: boolean,
    onApply: (value: Exclude<DashStylePresetId, "custom">) => void,
    valueOverride?: DashStyleDropdownValue,
    valueClassName?: string,
    onHoverPreview?: (value: Exclude<DashStylePresetId, "custom">) => void,
    onHoverPreviewEnd?: () => void
  ) {
    const dropdownValue: DashStyleDropdownValue = valueOverride ?? property.value;
    const dropdownOptions = toDashStyleDropdownOptions(property.options);
    const displayLabel = dashStyleValueLabel(dropdownValue, property.options);
    const previewPreset = dashStylePreviewPreset(dropdownValue);

    return (
      <CustomDropdown
        ariaLabel={property.label}
        value={dropdownValue}
        options={dropdownOptions}
        disabled={!writable}
        onChange={(nextValue) => {
          if (!writable || !isSelectableDashStyleValue(nextValue)) {
            return;
          }
          onApply(nextValue);
        }}
        onOptionHover={(nextValue) => {
          if (!writable || !isSelectableDashStyleValue(nextValue) || !onHoverPreview) {
            return;
          }
          onHoverPreview(nextValue);
        }}
        onOptionHoverEnd={onHoverPreviewEnd}
        renderValue={() => (
          <span className={css.dashStyleValue}>
            <span className={css.dashStyleValuePreview}>
              <DashStylePreview preset={previewPreset} lineWidth={property.previewLineWidth} />
            </span>
            <span className={[css.dashStyleValueLabel, valueClassName ?? ""].filter(Boolean).join(" ")}>{displayLabel}</span>
          </span>
        )}
        renderOption={(option, state) => {
          const optionPreset = option.value as Exclude<DashStylePresetId, "custom">;
          return (
            <span className={css.dashStyleOption}>
              <span className={css.dashStyleOptionPreview}>
                <DashStylePreview preset={optionPreset} lineWidth={property.previewLineWidth} />
              </span>
              <span className={css.dashStyleOptionLabel}>{option.label}</span>
              <span className={css.dashStyleOptionCheck} aria-hidden="true">
                {state.selected ? "✓" : ""}
              </span>
            </span>
          );
        }}
      />
    );
  }

  function renderLineCapDropdown(
    property: {
      label: string;
      value: LineCapPresetId;
      previewLineWidth: number;
      options: Array<{ value: Exclude<LineCapPresetId, "custom">; label: string }>;
    },
    writable: boolean,
    onApply: (value: Exclude<LineCapPresetId, "custom">) => void,
    valueOverride?: LineCapDropdownValue,
    valueClassName?: string,
    onHoverPreview?: (value: Exclude<LineCapPresetId, "custom">) => void,
    onHoverPreviewEnd?: () => void
  ) {
    const dropdownValue: LineCapDropdownValue = valueOverride ?? property.value;
    const dropdownOptions = toLineCapDropdownOptions(property.options);
    const displayLabel = lineCapValueLabel(dropdownValue, property.options);
    const previewPreset = lineCapPreviewPreset(dropdownValue);

    return (
      <CustomDropdown
        ariaLabel={property.label}
        value={dropdownValue}
        options={dropdownOptions}
        disabled={!writable}
        onChange={(nextValue) => {
          if (!writable || !isSelectableLineCapValue(nextValue)) {
            return;
          }
          onApply(nextValue);
        }}
        onOptionHover={(nextValue) => {
          if (!writable || !isSelectableLineCapValue(nextValue) || !onHoverPreview) {
            return;
          }
          onHoverPreview(nextValue);
        }}
        onOptionHoverEnd={onHoverPreviewEnd}
        renderValue={() => (
          <span className={css.lineCapValue}>
            <span className={css.lineCapValuePreview}>
              <LineCapPreview preset={previewPreset} lineWidth={property.previewLineWidth} />
            </span>
            <span className={[css.lineCapValueLabel, valueClassName ?? ""].filter(Boolean).join(" ")}>{displayLabel}</span>
          </span>
        )}
        renderOption={(option, state) => {
          const optionPreset = option.value as Exclude<LineCapPresetId, "custom">;
          return (
            <span className={css.lineCapOption}>
              <span className={css.lineCapOptionPreview}>
                <LineCapPreview preset={optionPreset} lineWidth={property.previewLineWidth} />
              </span>
              <span className={css.lineCapOptionLabel}>{option.label}</span>
              <span className={css.lineCapOptionCheck} aria-hidden="true">
                {state.selected ? "✓" : ""}
              </span>
            </span>
          );
        }}
      />
    );
  }

  function renderLineJoinDropdown(
    property: {
      label: string;
      value: LineJoinPresetId;
      previewLineWidth: number;
      options: Array<{ value: Exclude<LineJoinPresetId, "custom">; label: string }>;
    },
    writable: boolean,
    onApply: (value: Exclude<LineJoinPresetId, "custom">) => void,
    valueOverride?: LineJoinDropdownValue,
    valueClassName?: string,
    onHoverPreview?: (value: Exclude<LineJoinPresetId, "custom">) => void,
    onHoverPreviewEnd?: () => void
  ) {
    const dropdownValue: LineJoinDropdownValue = valueOverride ?? property.value;
    const dropdownOptions = toLineJoinDropdownOptions(property.options);
    const displayLabel = lineJoinValueLabel(dropdownValue, property.options);
    const previewPreset = lineJoinPreviewPreset(dropdownValue);

    return (
      <CustomDropdown
        ariaLabel={property.label}
        value={dropdownValue}
        options={dropdownOptions}
        disabled={!writable}
        onChange={(nextValue) => {
          if (!writable || !isSelectableLineJoinValue(nextValue)) {
            return;
          }
          onApply(nextValue);
        }}
        onOptionHover={(nextValue) => {
          if (!writable || !isSelectableLineJoinValue(nextValue) || !onHoverPreview) {
            return;
          }
          onHoverPreview(nextValue);
        }}
        onOptionHoverEnd={onHoverPreviewEnd}
        renderValue={() => (
          <span className={css.lineJoinValue}>
            <span className={css.lineJoinValuePreview}>
              <LineJoinPreview preset={previewPreset} lineWidth={property.previewLineWidth} />
            </span>
            <span className={[css.lineJoinValueLabel, valueClassName ?? ""].filter(Boolean).join(" ")}>{displayLabel}</span>
          </span>
        )}
        renderOption={(option, state) => {
          const optionPreset = option.value as Exclude<LineJoinPresetId, "custom">;
          return (
            <span className={css.lineJoinOption}>
              <span className={css.lineJoinOptionPreview}>
                <LineJoinPreview preset={optionPreset} lineWidth={property.previewLineWidth} />
              </span>
              <span className={css.lineJoinOptionLabel}>{option.label}</span>
              <span className={css.lineJoinOptionCheck} aria-hidden="true">
                {state.selected ? "✓" : ""}
              </span>
            </span>
          );
        }}
      />
    );
  }

  function renderPathMorphingDecorationDropdown(
    property: {
      label: string;
      value: PathMorphingDecorationPresetId;
      previewLineWidth: number;
      options: Array<{ value: Exclude<PathMorphingDecorationPresetId, "custom">; label: string }>;
    },
    writable: boolean,
    onApply: (value: Exclude<PathMorphingDecorationPresetId, "custom">) => void,
    valueOverride?: PathMorphingDecorationDropdownValue,
    valueClassName?: string,
    onHoverPreview?: (value: Exclude<PathMorphingDecorationPresetId, "custom">) => void,
    onHoverPreviewEnd?: () => void
  ) {
    const dropdownValue: PathMorphingDecorationDropdownValue = valueOverride ?? property.value;
    const dropdownOptions = toPathMorphingDecorationDropdownOptions(property.options);
    const displayLabel = pathMorphingDecorationValueLabel(dropdownValue, property.options);
    const previewPreset = pathMorphingDecorationPreviewPreset(dropdownValue);

    return (
      <CustomDropdown
        ariaLabel={property.label}
        value={dropdownValue}
        options={dropdownOptions}
        disabled={!writable}
        onChange={(nextValue) => {
          if (!writable || !isSelectablePathMorphingDecorationValue(nextValue)) {
            return;
          }
          onApply(nextValue);
        }}
        onOptionHover={(nextValue) => {
          if (!writable || !isSelectablePathMorphingDecorationValue(nextValue) || !onHoverPreview) {
            return;
          }
          onHoverPreview(nextValue);
        }}
        onOptionHoverEnd={onHoverPreviewEnd}
        renderValue={() => (
          <span className={css.pathMorphingDecorationValue}>
            <span className={css.pathMorphingDecorationValuePreview}>
              <PathMorphingDecorationPreview preset={previewPreset} lineWidth={property.previewLineWidth} />
            </span>
            <span className={[css.pathMorphingDecorationValueLabel, valueClassName ?? ""].filter(Boolean).join(" ")}>{displayLabel}</span>
          </span>
        )}
        renderOption={(option, state) => {
          const optionPreset = option.value as Exclude<PathMorphingDecorationPresetId, "custom">;
          return (
            <span className={css.pathMorphingDecorationOption}>
              <span className={css.pathMorphingDecorationOptionPreview}>
                <PathMorphingDecorationPreview preset={optionPreset} lineWidth={property.previewLineWidth} />
              </span>
              <span className={css.pathMorphingDecorationOptionLabel}>{option.label}</span>
              <span className={css.pathMorphingDecorationOptionCheck} aria-hidden="true">
                {state.selected ? "✓" : ""}
              </span>
            </span>
          );
        }}
      />
    );
  }

  function renderFillModeDropdown(
    property: {
      label: string;
      value: FillModePresetId;
      options: Array<{ value: Exclude<FillModePresetId, "custom">; label: string }>;
    },
    writable: boolean,
    onApply: (value: Exclude<FillModePresetId, "custom">) => void,
    valueOverride?: FillModeDropdownValue,
    valueClassName?: string
  ) {
    const dropdownValue: FillModeDropdownValue = valueOverride ?? property.value;
    const dropdownOptions = toFillModeDropdownOptions(property.options);
    const displayLabel = fillModeValueLabel(dropdownValue, property.options);
    return (
      <CustomDropdown
        ariaLabel={property.label}
        value={dropdownValue}
        options={dropdownOptions}
        disabled={!writable}
        onChange={(nextValue) => {
          if (!writable || !isSelectableFillModeValue(nextValue)) {
            return;
          }
          onApply(nextValue);
        }}
        renderValue={() => <span className={valueClassName}>{displayLabel}</span>}
      />
    );
  }

  function renderFillShadingDropdown(
    property: {
      label: string;
      value: FillShadingPresetId;
      options: Array<{ value: Exclude<FillShadingPresetId, "custom">; label: string }>;
    },
    writable: boolean,
    onApply: (value: Exclude<FillShadingPresetId, "custom">) => void,
    valueOverride?: FillShadingDropdownValue,
    valueClassName?: string
  ) {
    const dropdownValue: FillShadingDropdownValue = valueOverride ?? property.value;
    const dropdownOptions = toFillShadingDropdownOptions(property.options);
    const displayLabel = fillShadingValueLabel(dropdownValue, property.options);
    return (
      <CustomDropdown
        ariaLabel={property.label}
        value={dropdownValue}
        options={dropdownOptions}
        disabled={!writable}
        onChange={(nextValue) => {
          if (!writable || !isSelectableFillShadingValue(nextValue)) {
            return;
          }
          onApply(nextValue);
        }}
        renderValue={() => <span className={valueClassName}>{displayLabel}</span>}
      />
    );
  }

  function renderFillPatternDropdown(
    property: {
      label: string;
      value: FillPatternPresetId;
      options: Array<{ value: Exclude<FillPatternPresetId, "custom">; label: string }>;
    },
    writable: boolean,
    onApply: (value: Exclude<FillPatternPresetId, "custom">) => void,
    valueOverride?: FillPatternDropdownValue,
    valueClassName?: string
  ) {
    const dropdownValue: FillPatternDropdownValue = valueOverride ?? property.value;
    const dropdownOptions = toFillPatternDropdownOptions(property.options);
    const displayLabel = fillPatternValueLabel(dropdownValue, property.options);
    const previewPreset = fillPatternPreviewPreset(dropdownValue);
    return (
      <CustomDropdown
        ariaLabel={property.label}
        value={dropdownValue}
        options={dropdownOptions}
        disabled={!writable}
        onChange={(nextValue) => {
          if (!writable || !isSelectableFillPatternValue(nextValue)) {
            return;
          }
          onApply(nextValue);
        }}
        renderValue={() => (
          <span className={css.fillPatternValue}>
            <span className={css.fillPatternValuePreview}>
              <FillPatternPreview preset={previewPreset} />
            </span>
            <span className={[css.fillPatternValueLabel, valueClassName ?? ""].filter(Boolean).join(" ")}>{displayLabel}</span>
          </span>
        )}
        renderOption={(option, state) => {
          const optionPreset = option.value as Exclude<FillPatternPresetId, "custom">;
          return (
            <span className={css.fillPatternOption}>
              <span className={css.fillPatternOptionPreview}>
                <FillPatternPreview preset={optionPreset} />
              </span>
              <span className={css.fillPatternOptionLabel}>{option.label}</span>
              <span className={css.fillPatternOptionCheck} aria-hidden="true">
                {state.selected ? "✓" : ""}
              </span>
            </span>
          );
        }}
      />
    );
  }

  function renderNodeShapeDropdown(
    property: {
      label: string;
      value: NodeShapePresetId;
      options: Array<{ value: Exclude<NodeShapePresetId, "custom">; label: string }>;
    },
    writable: boolean,
    onApply: (value: Exclude<NodeShapePresetId, "custom">) => void,
    valueOverride?: NodeShapeDropdownValue,
    valueClassName?: string,
    onHoverPreview?: (value: Exclude<NodeShapePresetId, "custom">) => void,
    onHoverPreviewEnd?: () => void
  ) {
    const dropdownValue: NodeShapeDropdownValue = valueOverride ?? property.value;
    const dropdownOptions = toNodeShapeDropdownOptions(property.options);
    const displayLabel = nodeShapeValueLabel(dropdownValue, property.options);
    return (
      <CustomDropdown
        ariaLabel={property.label}
        value={dropdownValue}
        options={dropdownOptions}
        disabled={!writable}
        onChange={(nextValue) => {
          if (!writable || !isSelectableNodeShapeValue(nextValue)) {
            return;
          }
          onApply(nextValue);
        }}
        onOptionHover={(nextValue) => {
          if (!writable || !isSelectableNodeShapeValue(nextValue) || !onHoverPreview) {
            onHoverPreviewEnd?.();
            return;
          }
          onHoverPreview(nextValue);
        }}
        onOptionHoverEnd={onHoverPreviewEnd}
        renderValue={() => <span className={valueClassName}>{displayLabel}</span>}
      />
    );
  }

  function renderNodeFontSizeDropdown(
    property: {
      label: string;
      value: NodeFontSizePresetId;
      options: Array<{ value: Exclude<NodeFontSizePresetId, "custom">; label: string }>;
      customSizePt: number | null;
    },
    writable: boolean,
    onApply: (value: Exclude<NodeFontSizePresetId, "custom">) => void,
    valueOverride?: NodeFontSizeDropdownValue,
    valueClassName?: string,
    onHoverPreview?: (value: Exclude<NodeFontSizePresetId, "custom">) => void,
    onHoverPreviewEnd?: () => void
  ) {
    const dropdownValue: NodeFontSizeDropdownValue = valueOverride ?? property.value;
    const dropdownOptions = toNodeFontSizeDropdownOptions(property.options);
    const displayLabel = nodeFontSizeValueLabel(dropdownValue, property.options, property.customSizePt);
    return (
      <CustomDropdown
        ariaLabel={property.label}
        value={dropdownValue}
        options={dropdownOptions}
        disabled={!writable}
        onChange={(nextValue) => {
          if (!writable || !isSelectableNodeFontSizeValue(nextValue)) {
            return;
          }
          onApply(nextValue);
        }}
        onOptionHover={(nextValue) => {
          if (!writable || !isSelectableNodeFontSizeValue(nextValue) || !onHoverPreview) {
            onHoverPreviewEnd?.();
            return;
          }
          onHoverPreview(nextValue);
        }}
        onOptionHoverEnd={onHoverPreviewEnd}
        renderValue={() => <span className={valueClassName}>{displayLabel}</span>}
        renderOption={(option) => {
          const ptLabel = nodeFontSizePresetPtLabel(option.value as Exclude<NodeFontSizePresetId, "custom">);
          return (
            <span className={css.nodeFontSizeOption}>
              <span className={css.nodeFontSizeOptionLabel}>{option.label}</span>
              <span className={css.nodeFontSizeOptionPt}>{ptLabel}</span>
            </span>
          );
        }}
      />
    );
  }

  function renderNodeFontToolbar(
    property: {
      family: NodeFontFamilyId;
      familyMixed: boolean;
      weight: "normal" | "bold";
      weightMixed: boolean;
      style: "normal" | "italic";
      styleMixed: boolean;
      sizePreset: NodeFontSizePresetId;
      sizePresetMixed: boolean;
      customSizePt: number | null;
      sizeOptions: Array<{ value: Exclude<NodeFontSizePresetId, "custom">; label: string }>;
      label: string;
    },
    writable: boolean,
    onFamilyChange: (family: NodeFontFamilyId) => void,
    onWeightToggle: () => void,
    onStyleToggle: () => void,
    onSizePresetChange: (sizePreset: Exclude<NodeFontSizePresetId, "custom">) => void,
    sizeValueClassName?: string,
    onSizePresetHoverPreview?: (sizePreset: Exclude<NodeFontSizePresetId, "custom">) => void,
    onSizePresetHoverPreviewEnd?: () => void
  ) {
    const boldActive = !property.weightMixed && property.weight === "bold";
    const italicActive = !property.styleMixed && property.style === "italic";
    const sizeValue: NodeFontSizeDropdownValue = property.sizePresetMixed
      ? NODE_FONT_SIZE_MIXED_OPTION_VALUE
      : property.sizePreset;
    return (
      <div className={css.nodeFontControls}>
        <div className={css.nodeFontToolbar}>
          <div className={css.nodeFontButtonGroup} role="group" aria-label="Font family">
            <button
              type="button"
              className={nodeFontButtonClass(property.family === "serif" && !property.familyMixed, property.familyMixed)}
              disabled={!writable}
              aria-label="Serif family"
              aria-pressed={!property.familyMixed && property.family === "serif"}
              onClick={() => onFamilyChange("serif")}
            >
              <RiFontSerif size={13} />
            </button>
            <button
              type="button"
              className={nodeFontButtonClass(property.family === "sans" && !property.familyMixed, property.familyMixed)}
              disabled={!writable}
              aria-label="Sans family"
              aria-pressed={!property.familyMixed && property.family === "sans"}
              onClick={() => onFamilyChange("sans")}
            >
              <RiFontSansSerif size={13} />
            </button>
            <button
              type="button"
              className={nodeFontButtonClass(property.family === "monospace" && !property.familyMixed, property.familyMixed)}
              disabled={!writable}
              aria-label="Monospace family"
              aria-pressed={!property.familyMixed && property.family === "monospace"}
              onClick={() => onFamilyChange("monospace")}
            >
              <RiFontMono size={13} />
            </button>
          </div>
          <div className={css.nodeFontButtonGroup} role="group" aria-label="Font style">
            <button
              type="button"
              className={nodeFontButtonClass(boldActive, property.weightMixed)}
              disabled={!writable}
              aria-label="Bold"
              aria-pressed={boldActive}
              onClick={onWeightToggle}
            >
              <RiBold size={13} />
            </button>
            <button
              type="button"
              className={nodeFontButtonClass(italicActive, property.styleMixed)}
              disabled={!writable}
              aria-label="Italic"
              aria-pressed={italicActive}
              onClick={onStyleToggle}
            >
              <RiItalic size={13} />
            </button>
          </div>
          <div className={css.nodeFontSizeRow}>
            {renderNodeFontSizeDropdown(
              {
                label: `${property.label} size`,
                value: property.sizePreset,
                options: property.sizeOptions,
                customSizePt: property.customSizePt
              },
              writable,
              onSizePresetChange,
              sizeValue,
              sizeValueClassName,
              onSizePresetHoverPreview,
              onSizePresetHoverPreviewEnd
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderProperty(property: InspectorProperty) {
    const provenance = renderedSinglePropertyProvenance[property.id] ?? implicitDefaultProvenance(property);
    const valueClassName = withValueProvenanceClass(undefined, provenance);
    const propertyClassName = isPathMorphingSuboptionPropertyId(property.id)
      ? `${css.property} ${css.subProperty}`
      : css.property;
    const capability = getInspectorPropertyCapabilityStatus(property);
    const capabilityReadOnlyReason =
      capability.status === "unsupported" ? capability.reason : null;
    const readOnlyReason = (() => {
      if (property.kind === "text") {
        return property.readOnlyReason ?? property.write.reason ?? capabilityReadOnlyReason;
      }
      if (property.kind === "number") {
        return property.readOnlyReason ?? property.write?.reason ?? capabilityReadOnlyReason;
      }
      if (property.kind === "length") {
        return property.readOnlyReason ?? property.write.reason ?? capabilityReadOnlyReason;
      }
      if (property.kind === "nodeFont") {
        return property.write.reason ?? capabilityReadOnlyReason;
      }
      return property.write.reason ?? capabilityReadOnlyReason;
    })();

    if (property.kind === "text") {
      return (
        <div key={property.id} className={propertyClassName}>
          {renderSingleTextField(property, provenance)}
        </div>
      );
    }

    if (property.kind === "number") {
      return (
        <div key={property.id} className={propertyClassName}>
          {renderSingleNumberField(property, false, provenance)}
        </div>
      );
    }

    if (property.kind === "length") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={propertyClassName}>
          {renderScrubbableNumberLabel(property.label, {
            writable,
            value: property.value,
            step: property.step,
            onPreview: (next) => applySingleLengthValue(property, next, { recordInHistory: false }),
            onCommit: (next) => applySingleLengthValue(property, next)
          })}
          <div className={css.controlRow}>
            {maybeWrapWithProvenanceTooltip(
              provenance,
              <input
                className={withValueProvenanceClass(css.numberInput, provenance)}
                type="number"
                step={property.step}
                value={formatNumber(property.value)}
                disabled={!writable}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (!Number.isFinite(next)) {
                    return;
                  }
                  applySingleLengthValue(property, next);
                }}
              />,
              true
            )}
            <span className={css.unitLabel}>{property.unit}</span>
          </div>
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "nodeShape") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const previewOwnerKey = `node-shape:${property.write.elementId}:${property.id}`;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderNodeShapeDropdown(
              {
                label: property.label,
                value: property.value,
                options: property.options
              },
              writable,
              (nextValue) =>
                commitAfterHoverPreview(previewOwnerKey, () =>
                  applyNodeShapeValue(property.write, nextValue)
                ),
              undefined,
              valueClassName,
              (nextValue) =>
                applyHoverPreview(previewOwnerKey, () =>
                  applyNodeShapeValue(property.write, nextValue, { recordInHistory: false })
                ),
              () => clearHoverPreviewSession(previewOwnerKey)
            ),
            true
          )}
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "nodeFont") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const previewOwnerKey = `node-font-size:${property.write.elementId}:${property.id}`;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderNodeFontToolbar(
              {
                family: property.family,
                familyMixed: false,
                weight: property.weight,
                weightMixed: false,
                style: property.style,
                styleMixed: false,
                sizePreset: property.sizePreset,
                sizePresetMixed: false,
                customSizePt: property.customSizePt,
                sizeOptions: property.sizeOptions,
                label: property.label
              },
              writable,
              (nextFamily) =>
                applyNodeFontValue(property.write, property.context, {
                  family: nextFamily,
                  weight: property.weight,
                  style: property.style,
                  sizePreset: property.sizePreset,
                  customSizePt: property.customSizePt
                }),
              () =>
                applyNodeFontValue(property.write, property.context, {
                  family: property.family,
                  weight: property.weight === "bold" ? "normal" : "bold",
                  style: property.style,
                  sizePreset: property.sizePreset,
                  customSizePt: property.customSizePt
                }),
              () =>
                applyNodeFontValue(property.write, property.context, {
                  family: property.family,
                  weight: property.weight,
                  style: property.style === "italic" ? "normal" : "italic",
                  sizePreset: property.sizePreset,
                  customSizePt: property.customSizePt
                }),
              (nextSizePreset) =>
                commitAfterHoverPreview(previewOwnerKey, () =>
                  applyNodeFontValue(property.write, property.context, {
                    family: property.family,
                    weight: property.weight,
                    style: property.style,
                    sizePreset: nextSizePreset,
                    customSizePt: property.customSizePt
                  })
                ),
              valueClassName,
              (nextSizePreset) =>
                applyHoverPreview(previewOwnerKey, () =>
                  applyNodeFontValue(
                    property.write,
                    property.context,
                    {
                      family: property.family,
                      weight: property.weight,
                      style: property.style,
                      sizePreset: nextSizePreset,
                      customSizePt: property.customSizePt
                    },
                    { recordInHistory: false }
                  )
                ),
              () => clearHoverPreviewSession(previewOwnerKey)
            ),
            true
          )}
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "color") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            <ColorPickerField
              ariaLabel={property.label}
              value={property.value ?? "none"}
              syntaxValue={property.syntaxValue}
              options={property.options}
              namedColorSwatches={projectNamedColorSwatches}
              disabled={!writable}
              triggerLabelClassName={valueClassName}
              onChange={(nextValue) => {
                const change = normalizeColorSetPropertyChange(property.write, nextValue, property.syntaxValue);
                applySetProperty(property.write, change.value, {
                  clearKeys: change.clearKeys
                });
              }}
            />,
            true
          )}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "fillMode") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderFillModeDropdown(
              {
                label: property.label,
                value: property.value,
                options: property.options
              },
              writable,
              (nextValue) => {
                applyFillModeValue(property.write, nextValue, property.context);
                setFillAdvancedOptionsOpen(nextValue !== "solid");
              },
              undefined,
              valueClassName
            ),
            true
          )}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "fillShading") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderFillShadingDropdown(
              {
                label: property.label,
                value: property.value,
                options: property.options
              },
              writable,
              (nextValue) => applyFillShadingValue(property.write, nextValue),
              undefined,
              valueClassName
            ),
            true
          )}
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "fillPattern") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderFillPatternDropdown(
              {
                label: property.label,
                value: property.value,
                options: property.options
              },
              writable,
              (nextValue) => applyFillPatternValue(property.write, nextValue),
              undefined,
              valueClassName
            ),
            true
          )}
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "fillPatternOption") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={propertyClassName}>
          {renderScrubbableNumberLabel(property.label, {
            writable,
            value: property.value,
            step: property.step,
            onPreview: (next) => applySingleFillPatternOptionValue(property, next, { recordInHistory: false }),
            onCommit: (next) => applySingleFillPatternOptionValue(property, next)
          })}
          <div className={css.controlRow}>
            {maybeWrapWithProvenanceTooltip(
              provenance,
              <input
                className={withValueProvenanceClass(css.numberInput, provenance)}
                type="number"
                step={property.step}
                value={formatNumber(property.value)}
                disabled={!writable}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (!Number.isFinite(next)) {
                    return;
                  }
                  applySingleFillPatternOptionValue(property, next);
                }}
              />,
              true
            )}
            {property.unit ? <span className={css.unitLabel}>{property.unit}</span> : null}
          </div>
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "lineWidth") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const lineWidthKey = `${property.write.elementId}:${property.id}`;
      const previewOwnerKey = `line-width:${lineWidthKey}`;
      const showCustomRange = property.presetLabel == null || manualLineWidthCustomKeys.has(lineWidthKey);
      const dropdownValue: LineWidthDropdownValue = showCustomRange
        ? LINE_WIDTH_CUSTOM_OPTION_VALUE
        : (property.presetLabel ?? LINE_WIDTH_CUSTOM_OPTION_VALUE);
      const dropdownDisplayLabel = lineWidthValueLabel(dropdownValue);
      const dropdownPreviewLineWidth = lineWidthPreviewLineWidth(dropdownValue, property.value);
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            <CustomDropdown
              ariaLabel={`${property.label} preset`}
              value={dropdownValue}
              options={LINE_WIDTH_DROPDOWN_OPTIONS}
              disabled={!writable}
              onChange={(nextValue) => {
                commitAfterHoverPreview(previewOwnerKey, () => {
                  if (!writable) {
                    return;
                  }
                  if (nextValue === LINE_WIDTH_CUSTOM_OPTION_VALUE) {
                    enableManualCustomLineWidth(lineWidthKey);
                    return;
                  }
                  const presetValue = LINE_WIDTH_PRESET_BY_LABEL.get(nextValue);
                  if (presetValue == null) {
                    return;
                  }
                  disableManualCustomLineWidth(lineWidthKey);
                  applySetProperty(property.write, "true", {
                    key: nextValue,
                    clearKeys: LINE_WIDTH_ALL_OPTION_KEYS.filter((key) => key !== nextValue)
                  });
                });
              }}
              onOptionHover={(nextValue) => {
                if (!writable) {
                  return;
                }
                const presetValue = LINE_WIDTH_PRESET_BY_LABEL.get(nextValue);
                if (presetValue == null) {
                  clearHoverPreviewSession(previewOwnerKey);
                  return;
                }
                applyHoverPreview(previewOwnerKey, () => {
                  applySetProperty(property.write, "true", {
                    key: nextValue,
                    clearKeys: LINE_WIDTH_ALL_OPTION_KEYS.filter((key) => key !== nextValue),
                    recordInHistory: false
                  });
                });
              }}
              onOptionHoverEnd={() => clearHoverPreviewSession(previewOwnerKey)}
              renderValue={() => (
                <span className={css.lineWidthValue}>
                  <span className={css.lineWidthValuePreview}>
                    <LineWidthPreview lineWidth={dropdownPreviewLineWidth} />
                  </span>
                  <span className={[css.lineWidthValueLabel, valueClassName ?? ""].filter(Boolean).join(" ")}>{dropdownDisplayLabel}</span>
                </span>
              )}
              renderOption={(option, state) => {
                const previewValue = lineWidthPreviewLineWidth(option.value, property.value);
                return (
                  <span className={css.lineWidthOption}>
                    <span className={css.lineWidthOptionPreview}>
                      <LineWidthPreview lineWidth={previewValue} />
                    </span>
                    <span className={css.lineWidthOptionLabel}>{option.label}</span>
                    <span className={css.lineWidthOptionCheck} aria-hidden="true">
                      {state.selected ? "✓" : ""}
                    </span>
                  </span>
                );
              }}
            />,
            true
          )}
          {showCustomRange ? (
            <input
              className={css.rangeInput}
              type="range"
              min={property.min}
              max={property.max}
              step={property.step}
              value={property.value}
              disabled={!writable}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                if (!Number.isFinite(next)) return;
                applySetProperty(property.write, `${formatNumber(next)}pt`, {
                  key: LINE_WIDTH_NUMERIC_KEY,
                  clearKeys: LINE_WIDTH_PRESET_KEYS
                });
              }}
            />
          ) : null}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "dashStyle") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const previewOwnerKey = `dash-style:${property.write.elementId}:${property.id}`;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderDashStyleDropdown(
              {
                label: property.label,
                value: property.value,
                previewLineWidth: property.previewLineWidth,
                options: property.options
              },
              writable,
              (nextValue) =>
                commitAfterHoverPreview(previewOwnerKey, () =>
                  applyDashStyleValue(property.write, nextValue)
                ),
              undefined,
              valueClassName,
              (nextValue) =>
                applyHoverPreview(previewOwnerKey, () =>
                  applyDashStyleValue(property.write, nextValue, { recordInHistory: false })
                ),
              () => clearHoverPreviewSession(previewOwnerKey)
            ),
            true
          )}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "lineCap") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const previewOwnerKey = `line-cap:${property.write.elementId}:${property.id}`;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderLineCapDropdown(
              {
                label: property.label,
                value: property.value,
                previewLineWidth: property.previewLineWidth,
                options: property.options
              },
              writable,
              (nextValue) =>
                commitAfterHoverPreview(previewOwnerKey, () =>
                  applyLineCapValue(property.write, nextValue)
                ),
              undefined,
              valueClassName,
              (nextValue) =>
                applyHoverPreview(previewOwnerKey, () =>
                  applyLineCapValue(property.write, nextValue, { recordInHistory: false })
                ),
              () => clearHoverPreviewSession(previewOwnerKey)
            ),
            true
          )}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "lineJoin") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const previewOwnerKey = `line-join:${property.write.elementId}:${property.id}`;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderLineJoinDropdown(
              {
                label: property.label,
                value: property.value,
                previewLineWidth: property.previewLineWidth,
                options: property.options
              },
              writable,
              (nextValue) =>
                commitAfterHoverPreview(previewOwnerKey, () =>
                  applyLineJoinValue(property.write, nextValue)
                ),
              undefined,
              valueClassName,
              (nextValue) =>
                applyHoverPreview(previewOwnerKey, () =>
                  applyLineJoinValue(property.write, nextValue, { recordInHistory: false })
                ),
              () => clearHoverPreviewSession(previewOwnerKey)
            ),
            true
          )}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "pathMorphingDecoration") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const previewOwnerKey = `path-morphing:${property.write.elementId}:${property.id}`;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderPathMorphingDecorationDropdown(
              {
                label: property.label,
                value: property.value,
                previewLineWidth: property.previewLineWidth,
                options: property.options
              },
              writable,
              (nextValue) =>
                commitAfterHoverPreview(previewOwnerKey, () =>
                  applyPathMorphingDecorationValue(property.write, nextValue)
                ),
              undefined,
              valueClassName,
              (nextValue) =>
                applyHoverPreview(previewOwnerKey, () =>
                  applyPathMorphingDecorationValue(property.write, nextValue, { recordInHistory: false })
                ),
              () => clearHoverPreviewSession(previewOwnerKey)
            ),
            true
          )}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "roundedCorners") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const minRadius = property.min;
      const maxRadius = Math.max(minRadius, property.max);
      const defaultRadius = clampNumber(property.defaultRadius, minRadius, maxRadius);
      const currentRadius = clampNumber(property.radius, minRadius, maxRadius);
      const sliderValue = property.enabled ? currentRadius : defaultRadius;
      return (
        <div key={property.id} className={propertyClassName}>
          <label className={css.checkboxControl}>
            <input
              className={css.checkboxInput}
              type="checkbox"
              checked={property.enabled}
              disabled={!writable}
              onChange={(event) =>
                applyRoundedCornersValue(
                  property.write,
                  event.currentTarget.checked,
                  event.currentTarget.checked ? sliderValue : defaultRadius
                )}
            />
            <span className={withValueProvenanceClass(css.checkboxLabel, provenance)}>{property.label}</span>
          </label>
          {property.enabled ? (
            <div className={css.roundedCornersControl}>
              <input
                className={css.rangeInput}
                type="range"
                min={minRadius}
                max={maxRadius}
                step={property.step}
                value={currentRadius}
                disabled={!writable}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (!Number.isFinite(next)) {
                    return;
                  }
                  applyRoundedCornersValue(property.write, true, clampNumber(next, minRadius, maxRadius));
                }}
              />
              <span className={css.roundedCornersValue}>{`${formatNumber(currentRadius)}pt`}</span>
            </div>
          ) : null}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    const writable = property.write.writable && capability.status !== "unsupported";
    const previewOwnerKey = `arrow-tip:${property.write.elementId}:${property.id}`;
    return (
      <div key={property.id} className={propertyClassName}>
        <div className={css.propertyLabel}>{property.label}</div>
        {maybeWrapWithProvenanceTooltip(
          provenance,
          renderArrowTipDropdown(
            {
              id: property.id,
              label: property.label,
              side: property.side,
              value: property.value,
              options: property.options,
              previewLineWidth: property.previewLineWidth
            },
            writable,
            (nextValue) =>
              commitAfterHoverPreview(previewOwnerKey, () =>
                applyArrowTipValue(property.write, property.side, nextValue)
              ),
            undefined,
            valueClassName,
            (nextValue) =>
              applyHoverPreview(previewOwnerKey, () =>
                applyArrowTipValue(property.write, property.side, nextValue, { recordInHistory: false })
              ),
            () => clearHoverPreviewSession(previewOwnerKey)
          ),
          true
        )}
        {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
      </div>
    );
  }

  function renderMultiProperty(property: MultiInspectorProperty) {
    const provenance = renderedMultiPropertyProvenance[property.id] ?? implicitDefaultProvenance(property);
    const valueClassName = withValueProvenanceClass(undefined, provenance);
    const propertyClassName = isPathMorphingSuboptionPropertyId(property.id)
      ? `${css.property} ${css.subProperty}`
      : css.property;
    if (property.kind === "number") {
      return (
        <div key={property.id} className={propertyClassName}>
          {renderMultiNumberField(property, false, provenance)}
        </div>
      );
    }

    if (property.kind === "length") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      return (
        <div key={property.id} className={propertyClassName}>
          {renderScrubbableNumberLabel(property.label, {
            writable,
            value: property.value,
            step: property.step,
            onPreview: (next) => applyMultiLengthValue(property, next, { recordInHistory: false }),
            onCommit: (next) => applyMultiLengthValue(property, next)
          })}
          <div className={css.controlRow}>
            {maybeWrapWithProvenanceTooltip(
              provenance,
              <input
                className={withValueProvenanceClass(css.numberInput, provenance)}
                type="number"
                step={property.step}
                value={property.mixed ? "" : formatNumber(property.value)}
                disabled={!writable}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (!Number.isFinite(next)) {
                    return;
                  }
                  applyMultiLengthValue(property, next);
                }}
              />,
              true
            )}
            <span className={css.unitLabel}>{property.unit}</span>
          </div>
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "nodeShape") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const dropdownValue: NodeShapeDropdownValue = property.mixed
        ? NODE_SHAPE_MIXED_OPTION_VALUE
        : property.value;
      const previewOwnerKey = `multi-node-shape:${property.id}`;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderNodeShapeDropdown(
              {
                label: property.label,
                value: property.value,
                options: property.options
              },
              writable,
              (nextValue) =>
                commitAfterHoverPreview(previewOwnerKey, () =>
                  applyNodeShapeValueMany(property.writes, nextValue)
                ),
              dropdownValue,
              valueClassName,
              (nextValue) =>
                applyHoverPreview(previewOwnerKey, () =>
                  applyNodeShapeValueMany(property.writes, nextValue, { recordInHistory: false })
                ),
              () => clearHoverPreviewSession(previewOwnerKey)
            ),
            true
          )}
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "nodeFont") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const nextWeight = property.weightMixed || property.weight === "normal" ? "bold" : "normal";
      const nextStyle = property.styleMixed || property.style === "normal" ? "italic" : "normal";
      const previewOwnerKey = `multi-node-font-size:${property.id}`;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderNodeFontToolbar(
            {
              family: property.family,
              familyMixed: property.familyMixed,
              weight: property.weight,
              weightMixed: property.weightMixed,
              style: property.style,
              styleMixed: property.styleMixed,
              sizePreset: property.sizePreset,
              sizePresetMixed: property.sizePresetMixed,
              customSizePt: property.customSizePt,
              sizeOptions: property.sizeOptions,
              label: property.label
            },
            writable,
            (nextFamily) =>
              applyNodeFontValueMany(property.writes, property.contexts, {
                family: nextFamily
              }),
            () =>
              applyNodeFontValueMany(property.writes, property.contexts, {
                weight: nextWeight
              }),
            () =>
              applyNodeFontValueMany(property.writes, property.contexts, {
                style: nextStyle
              }),
            (nextSizePreset) =>
              commitAfterHoverPreview(previewOwnerKey, () =>
                applyNodeFontValueMany(property.writes, property.contexts, {
                  sizePreset: nextSizePreset
                })
              ),
            valueClassName,
            (nextSizePreset) =>
              applyHoverPreview(previewOwnerKey, () =>
                applyNodeFontValueMany(
                  property.writes,
                  property.contexts,
                  {
                    sizePreset: nextSizePreset
                  },
                  { recordInHistory: false }
                )
              ),
            () => clearHoverPreviewSession(previewOwnerKey)
            ),
            true
          )}
          {property.notes.map((note) => (
            <div key={`${property.id}:${note}`} className={css.propertyNote}>
              {note}
            </div>
          ))}
          {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "color") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            <ColorPickerField
              ariaLabel={property.label}
              value={property.mixed ? null : (property.value ?? "none")}
              syntaxValue={property.mixed ? null : property.syntaxValue}
              mixed={property.mixed}
              options={property.options}
              namedColorSwatches={projectNamedColorSwatches}
              disabled={!writable}
              triggerLabelClassName={valueClassName}
              onChange={(nextValue) => {
                const firstWrite = property.writes[0];
                if (!firstWrite) {
                  return;
                }
                const change = normalizeColorSetPropertyChange(firstWrite, nextValue, property.syntaxValue);
                applySetPropertyMany(property.writes, change.value, {
                  clearKeys: change.clearKeys
                });
              }}
            />,
            true
          )}
          {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "fillMode") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const dropdownValue: FillModeDropdownValue = property.mixed
        ? FILL_MODE_MIXED_OPTION_VALUE
        : property.value;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderFillModeDropdown(
              {
                label: property.label,
                value: property.value,
                options: property.options
              },
              writable,
              (nextValue) => {
                applyFillModeValueMany(property.writes, nextValue, property.contexts);
                setFillAdvancedOptionsOpen(nextValue !== "solid");
              },
              dropdownValue,
              valueClassName
            ),
            true
          )}
          {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "fillShading") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const dropdownValue: FillShadingDropdownValue = property.mixed
        ? FILL_SHADING_MIXED_OPTION_VALUE
        : property.value;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderFillShadingDropdown(
              {
                label: property.label,
                value: property.value,
                options: property.options
              },
              writable,
              (nextValue) => applyFillShadingValueMany(property.writes, nextValue),
              dropdownValue,
              valueClassName
            ),
            true
          )}
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "fillPattern") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const dropdownValue: FillPatternDropdownValue = property.mixed
        ? FILL_PATTERN_MIXED_OPTION_VALUE
        : property.value;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderFillPatternDropdown(
              {
                label: property.label,
                value: property.value,
                options: property.options
              },
              writable,
              (nextValue) => applyFillPatternValueMany(property.writes, nextValue),
              dropdownValue,
              valueClassName
            ),
            true
          )}
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "fillPatternOption") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      return (
        <div key={property.id} className={propertyClassName}>
          {renderScrubbableNumberLabel(property.label, {
            writable,
            value: property.value,
            step: property.step,
            onPreview: (next) => applyMultiFillPatternOptionValue(property, next, { recordInHistory: false }),
            onCommit: (next) => applyMultiFillPatternOptionValue(property, next)
          })}
          <div className={css.controlRow}>
            {maybeWrapWithProvenanceTooltip(
              provenance,
              <input
                className={withValueProvenanceClass(css.numberInput, provenance)}
                type="number"
                step={property.step}
                value={property.mixed ? "" : formatNumber(property.value)}
                disabled={!writable}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (!Number.isFinite(next)) {
                    return;
                  }
                  applyMultiFillPatternOptionValue(property, next);
                }}
              />,
              true
            )}
            {property.unit ? <span className={css.unitLabel}>{property.unit}</span> : null}
          </div>
          {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "lineWidth") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const elementIds = property.writes
        .map((write) => write.elementId)
        .filter((id) => id.length > 0)
        .sort();
      const lineWidthKey = `multi:${property.id}:${elementIds.join("|")}`;
      const previewOwnerKey = `multi-line-width:${lineWidthKey}`;
      const presetLabel = property.mixed ? null : lineWidthPresetLabelFromValue(property.value);
      const showCustomRange =
        manualLineWidthCustomKeys.has(lineWidthKey) || (!property.mixed && presetLabel == null);
      const dropdownValue: LineWidthDropdownValue = showCustomRange
        ? LINE_WIDTH_CUSTOM_OPTION_VALUE
        : property.mixed
          ? LINE_WIDTH_MIXED_OPTION_VALUE
          : (presetLabel ?? LINE_WIDTH_CUSTOM_OPTION_VALUE);
      const sliderValue = property.mixed ? property.averageValue : property.value;
      const dropdownDisplayLabel = lineWidthValueLabel(dropdownValue);
      const dropdownPreviewLineWidth = lineWidthPreviewLineWidth(dropdownValue, sliderValue);
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            <CustomDropdown
              ariaLabel={`${property.label} preset`}
              value={dropdownValue}
              options={LINE_WIDTH_DROPDOWN_OPTIONS}
              disabled={!writable}
              onChange={(nextValue) => {
                commitAfterHoverPreview(previewOwnerKey, () => {
                  if (!writable) {
                    return;
                  }
                  if (nextValue === LINE_WIDTH_CUSTOM_OPTION_VALUE) {
                    enableManualCustomLineWidth(lineWidthKey);
                    return;
                  }
                  const presetValue = LINE_WIDTH_PRESET_BY_LABEL.get(nextValue);
                  if (presetValue == null) {
                    return;
                  }
                  disableManualCustomLineWidth(lineWidthKey);
                  applySetPropertyMany(property.writes, "true", {
                    key: nextValue,
                    clearKeys: LINE_WIDTH_ALL_OPTION_KEYS.filter((key) => key !== nextValue)
                  });
                });
              }}
              onOptionHover={(nextValue) => {
                if (!writable) {
                  return;
                }
                const presetValue = LINE_WIDTH_PRESET_BY_LABEL.get(nextValue);
                if (presetValue == null) {
                  clearHoverPreviewSession(previewOwnerKey);
                  return;
                }
                applyHoverPreview(previewOwnerKey, () => {
                  applySetPropertyMany(property.writes, "true", {
                    key: nextValue,
                    clearKeys: LINE_WIDTH_ALL_OPTION_KEYS.filter((key) => key !== nextValue),
                    recordInHistory: false
                  });
                });
              }}
              onOptionHoverEnd={() => clearHoverPreviewSession(previewOwnerKey)}
              renderValue={() => {
                return (
                  <span className={css.lineWidthValue}>
                    <span className={css.lineWidthValuePreview}>
                      <LineWidthPreview lineWidth={dropdownPreviewLineWidth} />
                    </span>
                    <span className={[css.lineWidthValueLabel, valueClassName ?? ""].filter(Boolean).join(" ")}>{dropdownDisplayLabel}</span>
                  </span>
                );
              }}
              renderOption={(option, state) => {
                const previewValue = lineWidthPreviewLineWidth(option.value, sliderValue);
                return (
                  <span className={css.lineWidthOption}>
                    <span className={css.lineWidthOptionPreview}>
                      <LineWidthPreview lineWidth={previewValue} />
                    </span>
                    <span className={css.lineWidthOptionLabel}>{option.label}</span>
                    <span className={css.lineWidthOptionCheck} aria-hidden="true">
                      {state.selected ? "✓" : ""}
                    </span>
                  </span>
                );
              }}
            />,
            true
          )}
          {showCustomRange ? (
            <>
              <input
                className={css.rangeInput}
                type="range"
                min={property.min}
                max={property.max}
                step={property.step}
                value={sliderValue}
                disabled={!writable}
                onChange={(event) => {
                  if (!writable) return;
                  const next = Number(event.currentTarget.value);
                  if (!Number.isFinite(next)) return;
                  applySetPropertyMany(property.writes, `${formatNumber(next)}pt`, {
                    key: LINE_WIDTH_NUMERIC_KEY,
                    clearKeys: LINE_WIDTH_PRESET_KEYS
                  });
                }}
              />
            </>
          ) : null}
          {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "dashStyle") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const dropdownValue: DashStyleDropdownValue = property.mixed ? DASH_STYLE_MIXED_OPTION_VALUE : property.value;
      const previewOwnerKey = `multi-dash-style:${property.id}`;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderDashStyleDropdown(
              {
                label: property.label,
                value: property.value,
                previewLineWidth: property.previewLineWidth,
                options: property.options
              },
              writable,
              (nextValue) =>
                commitAfterHoverPreview(previewOwnerKey, () =>
                  applyDashStyleValueMany(property.writes, nextValue)
                ),
              dropdownValue,
              valueClassName,
              (nextValue) =>
                applyHoverPreview(previewOwnerKey, () =>
                  applyDashStyleValueMany(property.writes, nextValue, { recordInHistory: false })
                ),
              () => clearHoverPreviewSession(previewOwnerKey)
            ),
            true
          )}
          {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "lineCap") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const dropdownValue: LineCapDropdownValue = property.mixed ? LINE_CAP_MIXED_OPTION_VALUE : property.value;
      const previewOwnerKey = `multi-line-cap:${property.id}`;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderLineCapDropdown(
            {
              label: property.label,
              value: property.value,
              previewLineWidth: property.previewLineWidth,
              options: property.options
            },
            writable,
            (nextValue) =>
              commitAfterHoverPreview(previewOwnerKey, () =>
                applyLineCapValueMany(property.writes, nextValue)
              ),
            dropdownValue,
            valueClassName,
            (nextValue) =>
              applyHoverPreview(previewOwnerKey, () =>
                applyLineCapValueMany(property.writes, nextValue, { recordInHistory: false })
              ),
            () => clearHoverPreviewSession(previewOwnerKey)
            ),
            true
          )}
          {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "lineJoin") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const dropdownValue: LineJoinDropdownValue = property.mixed ? LINE_JOIN_MIXED_OPTION_VALUE : property.value;
      const previewOwnerKey = `multi-line-join:${property.id}`;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderLineJoinDropdown(
            {
              label: property.label,
              value: property.value,
              previewLineWidth: property.previewLineWidth,
              options: property.options
            },
            writable,
            (nextValue) =>
              commitAfterHoverPreview(previewOwnerKey, () =>
                applyLineJoinValueMany(property.writes, nextValue)
              ),
            dropdownValue,
            valueClassName,
            (nextValue) =>
              applyHoverPreview(previewOwnerKey, () =>
                applyLineJoinValueMany(property.writes, nextValue, { recordInHistory: false })
              ),
            () => clearHoverPreviewSession(previewOwnerKey)
            ),
            true
          )}
          {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "pathMorphingDecoration") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const dropdownValue: PathMorphingDecorationDropdownValue = property.mixed
        ? PATH_MORPHING_DECORATION_MIXED_OPTION_VALUE
        : property.value;
      const previewOwnerKey = `multi-path-morphing:${property.id}`;
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderPathMorphingDecorationDropdown(
            {
              label: property.label,
              value: property.value,
              previewLineWidth: property.previewLineWidth,
              options: property.options
            },
            writable,
            (nextValue) =>
              commitAfterHoverPreview(previewOwnerKey, () =>
                applyPathMorphingDecorationValueMany(property.writes, nextValue)
              ),
            dropdownValue,
            valueClassName,
            (nextValue) =>
              applyHoverPreview(previewOwnerKey, () =>
                applyPathMorphingDecorationValueMany(property.writes, nextValue, { recordInHistory: false })
              ),
            () => clearHoverPreviewSession(previewOwnerKey)
            ),
            true
          )}
          {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "roundedCorners") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const minRadius = property.min;
      const maxRadius = Math.max(minRadius, property.max);
      const defaultRadius = clampNumber(property.defaultRadius, minRadius, maxRadius);
      const selectedRadius = property.mixed ? property.averageRadius : property.radius;
      const sliderValue = clampNumber(selectedRadius, minRadius, maxRadius);
      return (
        <div key={property.id} className={propertyClassName}>
          <label className={css.checkboxControl}>
            <input
              className={css.checkboxInput}
              type="checkbox"
              checked={property.mixed ? false : property.enabled}
              disabled={!writable}
              ref={(input) => {
                if (input) {
                  input.indeterminate = property.mixed;
                }
              }}
              onChange={(event) =>
                applyRoundedCornersValueMany(
                  property.writes,
                  event.currentTarget.checked,
                  event.currentTarget.checked ? sliderValue : defaultRadius
                )}
            />
            <span className={withValueProvenanceClass(css.checkboxLabel, provenance)}>{property.label}</span>
          </label>
          {property.enabled || property.anyEnabled ? (
            <div className={css.roundedCornersControl}>
              <input
                className={css.rangeInput}
                type="range"
                min={minRadius}
                max={maxRadius}
                step={property.step}
                value={sliderValue}
                disabled={!writable}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (!Number.isFinite(next)) {
                    return;
                  }
                  applyRoundedCornersValueMany(property.writes, true, clampNumber(next, minRadius, maxRadius));
                }}
              />
              <span className={css.roundedCornersValue}>{`${formatNumber(sliderValue)}pt`}</span>
            </div>
          ) : null}
          {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
        </div>
      );
    }

    const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
    const dropdownValue: ArrowTipDropdownValue = property.mixed
      ? ARROW_TIP_MIXED_OPTION_VALUE
      : property.value;
    const previewOwnerKey = `multi-arrow-tip:${property.id}:${property.side}`;

    return (
      <div key={property.id} className={propertyClassName}>
        <div className={css.propertyLabel}>{property.label}</div>
        {maybeWrapWithProvenanceTooltip(
          provenance,
          renderArrowTipDropdown(
          {
            id: property.id,
            label: property.label,
            side: property.side,
            value: property.value,
            options: property.options,
            previewLineWidth: property.previewLineWidth
          },
          writable,
          (nextValue) =>
            commitAfterHoverPreview(previewOwnerKey, () =>
              applyArrowTipValueMany(property.writes, property.side, nextValue)
            ),
          dropdownValue,
          valueClassName,
          (nextValue) =>
            applyHoverPreview(previewOwnerKey, () =>
              applyArrowTipValueMany(property.writes, property.side, nextValue, { recordInHistory: false })
            ),
          () => clearHoverPreviewSession(previewOwnerKey)
          ),
          true
        )}
        {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
      </div>
    );
  }

  function renderSingleSection(section: InspectorDescriptor["sections"][number]) {
    const strokeMoreOptionsProperties =
      section.id === "stroke"
        ? section.properties.filter((property) => isStrokeMoreOptionsPropertyId(property.id))
        : [];
    const forceShowStrokeMoreOptions = strokeMoreOptionsProperties.some((property) =>
      shouldAutoShowStrokeMoreOptions(property)
    );
    const showStrokeMoreOptions = forceShowStrokeMoreOptions || strokeMoreOptionsOpen;
    const fillAdvancedProperties =
      section.id === "fill"
        ? section.properties.filter((property) => isFillAdvancedPropertyId(property.id))
        : [];
    const fillModeProperty =
      section.id === "fill"
        ? section.properties.find((property): property is Extract<InspectorProperty, { kind: "fillMode" }> => property.kind === "fillMode")
        : undefined;
    const forceShowFillAdvancedOptions = fillAdvancedProperties.some((property) =>
      shouldAutoShowFillAdvancedOptions(property)
    );
    const showFillAdvancedOptions = forceShowFillAdvancedOptions || fillAdvancedOptionsOpen;
    const visibleProperties =
      section.id === "stroke" && !showStrokeMoreOptions
        ? section.properties.filter((property) => !isStrokeMoreOptionsPropertyId(property.id))
        : section.id === "fill" && !showFillAdvancedOptions
          ? section.properties.filter((property) => !isFillAdvancedPropertyId(property.id))
          : section.id === "fill" && showFillAdvancedOptions
            ? section.properties.filter((property) => property.id !== "fill-color")
        : section.properties;

    return (
      <div key={section.id} className={css.section}>
        <div className={css.sectionHeader}>
          <span>{section.title}</span>
        </div>
        <div className={css.sectionBody}>
          {visibleProperties.map((property, index) => {
            if (index > 0 && shouldRenderCompactNumberPair(visibleProperties[index - 1], property)) {
              return null;
            }
            const next = visibleProperties[index + 1];
            if (shouldRenderCompactNumberPair(property, next)) {
              const left = property as Extract<InspectorProperty, { kind: "number" }>;
              const right = next as Extract<InspectorProperty, { kind: "number" }>;
              return renderSingleNumberPair(
                left,
                right,
                renderedSinglePropertyProvenance[left.id] ?? null,
                renderedSinglePropertyProvenance[right.id] ?? null
              );
            }
            return renderProperty(property);
          })}
          {section.id === "stroke" &&
          strokeMoreOptionsProperties.length > 0 &&
          !forceShowStrokeMoreOptions ? (
            <button
              type="button"
              className={css.moreOptionsToggle}
              onClick={() => setStrokeMoreOptionsOpen((current) => !current)}
            >
              {showStrokeMoreOptions ? "fewer options.." : "more options.."}
            </button>
          ) : null}
          {section.id === "fill" &&
          fillAdvancedProperties.length > 0 &&
          !showFillAdvancedOptions &&
          fillModeProperty ? (
            <div className={css.fillQuickActions}>
              <button
                type="button"
                className={css.moreOptionsToggle}
                disabled={!fillModeProperty.write.writable || getInspectorPropertyCapabilityStatus(fillModeProperty).status === "unsupported"}
                onClick={() => {
                  if (!fillModeProperty.write.writable || getInspectorPropertyCapabilityStatus(fillModeProperty).status === "unsupported") {
                    return;
                  }
                  setFillAdvancedOptionsOpen(true);
                  applyFillModeValue(fillModeProperty.write, "gradient", fillModeProperty.context);
                }}
              >
                + gradient
              </button>
              <button
                type="button"
                className={css.moreOptionsToggle}
                disabled={!fillModeProperty.write.writable || getInspectorPropertyCapabilityStatus(fillModeProperty).status === "unsupported"}
                onClick={() => {
                  if (!fillModeProperty.write.writable || getInspectorPropertyCapabilityStatus(fillModeProperty).status === "unsupported") {
                    return;
                  }
                  setFillAdvancedOptionsOpen(true);
                  applyFillModeValue(fillModeProperty.write, "pattern", fillModeProperty.context);
                }}
              >
                + pattern
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function renderMultiSection(section: MultiInspectorSection) {
    const strokeMoreOptionsProperties =
      section.id === "stroke"
        ? section.properties.filter((property) => isStrokeMoreOptionsPropertyId(property.id))
        : [];
    const forceShowStrokeMoreOptions = strokeMoreOptionsProperties.some((property) =>
      shouldAutoShowStrokeMoreOptions(property)
    );
    const showStrokeMoreOptions = forceShowStrokeMoreOptions || strokeMoreOptionsOpen;
    const fillAdvancedProperties =
      section.id === "fill"
        ? section.properties.filter((property) => isFillAdvancedPropertyId(property.id))
        : [];
    const fillModeProperty =
      section.id === "fill"
        ? section.properties.find((property): property is Extract<MultiInspectorProperty, { kind: "fillMode" }> => property.kind === "fillMode")
        : undefined;
    const forceShowFillAdvancedOptions = fillAdvancedProperties.some((property) =>
      shouldAutoShowFillAdvancedOptions(property)
    );
    const showFillAdvancedOptions = forceShowFillAdvancedOptions || fillAdvancedOptionsOpen;
    const visibleProperties =
      section.id === "stroke" && !showStrokeMoreOptions
        ? section.properties.filter((property) => !isStrokeMoreOptionsPropertyId(property.id))
        : section.id === "fill" && !showFillAdvancedOptions
          ? section.properties.filter((property) => !isFillAdvancedPropertyId(property.id))
          : section.id === "fill" && showFillAdvancedOptions
            ? section.properties.filter((property) => property.id !== "fill-color")
        : section.properties;

    return (
      <div key={section.id} className={css.section}>
        <div className={css.sectionHeader}>
          <span>{section.title}</span>
        </div>
        <div className={css.sectionBody}>
          {visibleProperties.map((property, index) => {
            if (index > 0 && shouldRenderCompactNumberPair(visibleProperties[index - 1], property)) {
              return null;
            }
            const next = visibleProperties[index + 1];
            if (shouldRenderCompactNumberPair(property, next)) {
              const left = property as Extract<MultiInspectorProperty, { kind: "number" }>;
              const right = next as Extract<MultiInspectorProperty, { kind: "number" }>;
              return renderMultiNumberPair(
                left,
                right,
                renderedMultiPropertyProvenance[left.id] ?? null,
                renderedMultiPropertyProvenance[right.id] ?? null
              );
            }
            return renderMultiProperty(property);
          })}
          {section.id === "stroke" &&
          strokeMoreOptionsProperties.length > 0 &&
          !forceShowStrokeMoreOptions ? (
            <button
              type="button"
              className={css.moreOptionsToggle}
              onClick={() => setStrokeMoreOptionsOpen((current) => !current)}
            >
              {showStrokeMoreOptions ? "fewer options.." : "more options.."}
            </button>
          ) : null}
          {section.id === "fill" &&
          fillAdvancedProperties.length > 0 &&
          !showFillAdvancedOptions &&
          fillModeProperty ? (
            <div className={css.fillQuickActions}>
              <button
                type="button"
                className={css.moreOptionsToggle}
                disabled={!fillModeProperty.writes.some((write) => write.writable && write.elementId.length > 0)}
                onClick={() => {
                  if (!fillModeProperty.writes.some((write) => write.writable && write.elementId.length > 0)) {
                    return;
                  }
                  setFillAdvancedOptionsOpen(true);
                  applyFillModeValueMany(fillModeProperty.writes, "gradient", fillModeProperty.contexts);
                }}
              >
                + gradient
              </button>
              <button
                type="button"
                className={css.moreOptionsToggle}
                disabled={!fillModeProperty.writes.some((write) => write.writable && write.elementId.length > 0)}
                onClick={() => {
                  if (!fillModeProperty.writes.some((write) => write.writable && write.elementId.length > 0)) {
                    return;
                  }
                  setFillAdvancedOptionsOpen(true);
                  applyFillModeValueMany(fillModeProperty.writes, "pattern", fillModeProperty.contexts);
                }}
              >
                + pattern
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function makeGlobalTransformNumberProperty(
    key: "xscale" | "yscale",
    label: string
  ): Extract<InspectorProperty, { kind: "number" }> {
    return {
      kind: "number",
      id: key,
      label,
      value: globalTransformValues[key],
      step: 0.1,
      write: {
        mode: "setProperty",
        elementId: TIKZPICTURE_GLOBAL_TARGET_ID,
        level: "command",
        key,
        transformContext: {
          key,
          values: globalTransformValues
        },
        writable: true
      }
    };
  }

  function renderGlobalTransformPanel() {
    const xscale = makeGlobalTransformNumberProperty("xscale", "X scale");
    const yscale = makeGlobalTransformNumberProperty("yscale", "Y scale");
    return (
      <div className={css.elementInfo}>
        <div className={css.elementKind}>tikzpicture</div>
        <div className={css.section}>
          <div className={css.sectionHeader}>
            <span>Transform</span>
          </div>
          <div className={css.sectionBody}>{renderSingleNumberPair(xscale, yscale)}</div>
        </div>
      </div>
    );
  }

  function renderMultiArrangeQuickActions() {
    const alignHorizontalActions = MULTI_ARRANGE_ACTIONS.filter(
      (action) =>
        action.id === "align-left" ||
        action.id === "align-center" ||
        action.id === "align-right"
    );
    const alignVerticalActions = MULTI_ARRANGE_ACTIONS.filter(
      (action) =>
        action.id === "align-top" ||
        action.id === "align-middle" ||
        action.id === "align-bottom"
    );
    const distributeActions = MULTI_ARRANGE_ACTIONS.filter((action) => action.group === "distribute");

    const renderActionButton = (action: MultiArrangeAction) => {
      const availability = arrangeAvailability[action.id];
      const disabled = !availability.enabled;
      const title = disabled && availability.reason
        ? `${action.label}\n${availability.reason}`
        : action.label;
      const Icon = action.icon;
      return (
        <RenderedTooltip key={action.id} content={title}>
          <button
            type="button"
            className={css.multiArrangeIconButton}
            aria-label={action.label}
            disabled={disabled}
            onClick={() => {
              clearHoverPreviewSession();
              action.run(commandContext);
            }}
          >
            <Icon size={14} />
          </button>
        </RenderedTooltip>
      );
    };

    return (
      <div className={css.multiArrangeRow}>
        <div className={css.multiArrangeGroup} role="group" aria-label="Align selection horizontally">
          {alignHorizontalActions.map((action) => renderActionButton(action))}
        </div>
        <div className={css.multiArrangeGroup} role="group" aria-label="Align selection vertically">
          {alignVerticalActions.map((action) => renderActionButton(action))}
        </div>
        <div className={css.multiArrangeGroup} role="group" aria-label="Distribute selection">
          {distributeActions.map((action) => renderActionButton(action))}
        </div>
      </div>
    );
  }

  return (
    <div className={css.panel}>

      <div className={css.content}>
        {selectedSourceIds.length === 0 ? (
          renderGlobalTransformPanel()
        ) : selectedSourceIds.length === 1 ? (
          !renderedDescriptor ? (
            <p className={css.hint}>Inspector data is unavailable for the current selection.</p>
          ) : (
            <div className={css.elementInfo}>
              <div className={css.elementKind}>{renderedDescriptor.elementKind}</div>
              {renderedDescriptor.readOnlyReason ? (
                <div className={css.globalNote}>{renderedDescriptor.readOnlyReason}</div>
              ) : null}

              {renderedDescriptor.sections.map((section) => renderSingleSection(section))}
            </div>
          )
        ) : (
          <div className={css.elementInfo}>
            <div className={css.elementKind}>{renderedMultiModel?.selectionCount ?? selectedSourceIds.length} selected</div>
            {renderMultiArrangeQuickActions()}
            {!renderedMultiModel || renderedMultiModel.sections.length === 0 ? (
              <p className={css.hint}>No shared editable properties were found across the selected elements.</p>
            ) : (
              renderedMultiModel.sections.map((section) => renderMultiSection(section))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
