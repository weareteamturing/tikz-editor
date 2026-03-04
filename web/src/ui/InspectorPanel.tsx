import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
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
import type { SceneElement } from "tikz-editor/semantic/types";
import { collectProjectNamedColorSwatches } from "../project-named-colors";
import { useEditorStore } from "../store/store";
import { getInspectorPropertyCapabilityStatus } from "./capabilities";
import { ColorPickerField } from "./ColorPicker";
import { CustomDropdown } from "./CustomDropdown";
import { actionAvailability, alignSelection, distributeSelection } from "./editor-commands";
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
  clampNumber,
  dashStylePreviewPreset,
  dashStyleValueLabel,
  fillModeValueLabel,
  fillPatternPreviewPreset,
  fillPatternValueLabel,
  fillShadingValueLabel,
  isFillAdvancedPropertyId,
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
  type MultiInspectorProperty,
  type MultiInspectorSection,
  type NodeFontSizeDropdownValue,
  type NodeShapeDropdownValue,
  type PathMorphingDecorationDropdownValue
} from "./inspector-panel/panel-helpers";
import css from "./InspectorPanel.module.css";


type ApplySetPropertyOptions = {
  key?: string;
  clearKeys?: string[];
  recordInHistory?: boolean;
};

type HoverPreviewSession = {
  ownerKey: string;
  baseSource: string;
};

type FrozenInspectorView = {
  selectedSourceIds: string[];
  descriptor: InspectorDescriptor | null;
  multiModel: MultiInspectorModel | null;
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
  const source = useEditorStore((s) => s.source);
  const snapshot = useEditorStore((s) => s.snapshot);
  const dispatch = useEditorStore((s) => s.dispatch);
  const [manualLineWidthCustomKeys, setManualLineWidthCustomKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [strokeMoreOptionsOpen, setStrokeMoreOptionsOpen] = useState(false);
  const [fillAdvancedOptionsOpen, setFillAdvancedOptionsOpen] = useState(false);
  const [frozenInspectorView, setFrozenInspectorView] = useState<FrozenInspectorView | null>(null);
  const hoverPreviewSessionRef = useRef<HoverPreviewSession | null>(null);

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
      if (!selectedIds.has(element.sourceId) || bySource.has(element.sourceId)) {
        continue;
      }
      bySource.set(element.sourceId, element);
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

  const usingFrozenInspectorView =
    frozenInspectorView != null &&
    sameOrderedStringArrays(frozenInspectorView.selectedSourceIds, selectedSourceIds);
  const renderedDescriptor = usingFrozenInspectorView
    ? frozenInspectorView.descriptor
    : descriptor;
  const renderedMultiModel = usingFrozenInspectorView
    ? frozenInspectorView.multiModel
    : multiModel;
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
    () => actionAvailability(commandContext, null),
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
        multiModel
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
  }, [descriptor, dispatch, multiModel, selectedSourceIds]);

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

  useEffect(() => {
    clearHoverPreviewSession();
  }, [selectedSourceIds, clearHoverPreviewSession]);

  useEffect(() => {
    return () => {
      clearHoverPreviewSession();
    };
  }, [clearHoverPreviewSession]);

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

  function handleNumberChange(property: Extract<InspectorProperty, { kind: "number" }>, raw: string): void {
    const write = property.write;
    if (!write || write.mode !== "setProperty" || !write.writable || write.elementId.length === 0) return;
    const next = Number(raw);
    if (!Number.isFinite(next)) return;
    if (!write.transformContext) {
      applySetProperty(write, formatNumberWriteValue(property, next), {
        clearKeys: property.clearKeys
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

  function handleMultiNumberChange(property: Extract<MultiInspectorProperty, { kind: "number" }>, raw: string): void {
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
    compact = false
  ): JSX.Element {
    const { writable, readOnlyReason } = getSingleNumberPropertyState(property);
    return (
      <div className={compact ? css.compactNumberField : undefined}>
        <div className={css.propertyLabel}>{property.label}</div>
        <div className={css.controlRow}>
          <input
            className={css.numberInput}
            type="number"
            step={property.step}
            value={formatNumber(property.value)}
            disabled={!writable}
            onChange={(event) => handleNumberChange(property, event.currentTarget.value)}
          />
          {property.unit ? <span className={css.unitLabel}>{property.unit}</span> : null}
        </div>
        {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
      </div>
    );
  }

  function renderMultiNumberField(
    property: Extract<MultiInspectorProperty, { kind: "number" }>,
    compact = false
  ): JSX.Element {
    const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
    return (
      <div className={compact ? css.compactNumberField : undefined}>
        <div className={css.propertyLabel}>{property.label}</div>
        <div className={css.controlRow}>
          <input
            className={css.numberInput}
            type="number"
            step={property.step}
            value={property.mixed ? "" : formatNumber(property.value)}
            disabled={!writable}
            onChange={(event) => handleMultiNumberChange(property, event.currentTarget.value)}
          />
          {property.unit ? <span className={css.unitLabel}>{property.unit}</span> : null}
        </div>
        {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
      </div>
    );
  }

  function renderSingleNumberPair(
    left: Extract<InspectorProperty, { kind: "number" }>,
    right: Extract<InspectorProperty, { kind: "number" }>
  ): JSX.Element {
    return (
      <div key={`${left.id}:${right.id}`} className={css.compactNumberPair}>
        {renderSingleNumberField(left, true)}
        {renderSingleNumberField(right, true)}
      </div>
    );
  }

  function renderMultiNumberPair(
    left: Extract<MultiInspectorProperty, { kind: "number" }>,
    right: Extract<MultiInspectorProperty, { kind: "number" }>
  ): JSX.Element {
    return (
      <div key={`${left.id}:${right.id}`} className={css.compactNumberPair}>
        {renderMultiNumberField(left, true)}
        {renderMultiNumberField(right, true)}
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
            <span className={css.arrowTipValueLabel}>{displayLabel}</span>
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
            <span className={css.dashStyleValueLabel}>{displayLabel}</span>
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
            <span className={css.lineCapValueLabel}>{displayLabel}</span>
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
            <span className={css.lineJoinValueLabel}>{displayLabel}</span>
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
            <span className={css.pathMorphingDecorationValueLabel}>{displayLabel}</span>
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
    valueOverride?: FillModeDropdownValue
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
        renderValue={() => <span>{displayLabel}</span>}
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
    valueOverride?: FillShadingDropdownValue
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
        renderValue={() => <span>{displayLabel}</span>}
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
    valueOverride?: FillPatternDropdownValue
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
            <span className={css.fillPatternValueLabel}>{displayLabel}</span>
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
    valueOverride?: NodeShapeDropdownValue
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
        renderValue={() => <span>{displayLabel}</span>}
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
    valueOverride?: NodeFontSizeDropdownValue
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
        renderValue={() => <span>{displayLabel}</span>}
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
    onSizePresetChange: (sizePreset: Exclude<NodeFontSizePresetId, "custom">) => void
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
              <RiFontSerif size={14} />
            </button>
            <button
              type="button"
              className={nodeFontButtonClass(property.family === "sans" && !property.familyMixed, property.familyMixed)}
              disabled={!writable}
              aria-label="Sans family"
              aria-pressed={!property.familyMixed && property.family === "sans"}
              onClick={() => onFamilyChange("sans")}
            >
              <RiFontSansSerif size={14} />
            </button>
            <button
              type="button"
              className={nodeFontButtonClass(property.family === "monospace" && !property.familyMixed, property.familyMixed)}
              disabled={!writable}
              aria-label="Monospace family"
              aria-pressed={!property.familyMixed && property.family === "monospace"}
              onClick={() => onFamilyChange("monospace")}
            >
              <RiFontMono size={14} />
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
              <RiBold size={14} />
            </button>
            <button
              type="button"
              className={nodeFontButtonClass(italicActive, property.styleMixed)}
              disabled={!writable}
              aria-label="Italic"
              aria-pressed={italicActive}
              onClick={onStyleToggle}
            >
              <RiItalic size={14} />
            </button>
          </div>
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
            sizeValue
          )}
        </div>
      </div>
    );
  }

  function renderProperty(property: InspectorProperty) {
    const capability = getInspectorPropertyCapabilityStatus(property);
    const capabilityReadOnlyReason =
      capability.status === "unsupported" ? capability.reason : null;
    const readOnlyReason = (() => {
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

    if (property.kind === "number") {
      return (
        <div key={property.id} className={css.property}>
          {renderSingleNumberField(property)}
        </div>
      );
    }

    if (property.kind === "length") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          <div className={css.controlRow}>
            <input
              className={css.numberInput}
              type="number"
              step={property.step}
              value={formatNumber(property.value)}
              disabled={!writable}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                if (!Number.isFinite(next)) {
                  return;
                }
                applyNodeInnerSepValue(property.write, next);
              }}
            />
            <span className={css.unitLabel}>{property.unit}</span>
          </div>
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "nodeShape") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          {renderNodeShapeDropdown(
            {
              label: property.label,
              value: property.value,
              options: property.options
            },
            writable,
            (nextValue) => applyNodeShapeValue(property.write, nextValue)
          )}
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "nodeFont") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          {renderNodeFontToolbar(
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
              applyNodeFontValue(property.write, property.context, {
                family: property.family,
                weight: property.weight,
                style: property.style,
                sizePreset: nextSizePreset,
                customSizePt: property.customSizePt
              })
          )}
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "color") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          <ColorPickerField
            ariaLabel={property.label}
            value={property.value ?? "none"}
            syntaxValue={property.syntaxValue}
            options={property.options}
            namedColorSwatches={projectNamedColorSwatches}
            disabled={!writable}
            onChange={(nextValue) =>
              applySetProperty(property.write, nextValue, {
                clearKeys: colorSyntaxClearKeys(property.syntaxValue)
              })
            }
          />
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "fillMode") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          {renderFillModeDropdown(
            {
              label: property.label,
              value: property.value,
              options: property.options
            },
            writable,
            (nextValue) => {
              applyFillModeValue(property.write, nextValue, property.context);
              setFillAdvancedOptionsOpen(nextValue !== "solid");
            }
          )}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "fillShading") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          {renderFillShadingDropdown(
            {
              label: property.label,
              value: property.value,
              options: property.options
            },
            writable,
            (nextValue) => applyFillShadingValue(property.write, nextValue)
          )}
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "fillPattern") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          {renderFillPatternDropdown(
            {
              label: property.label,
              value: property.value,
              options: property.options
            },
            writable,
            (nextValue) => applyFillPatternValue(property.write, nextValue)
          )}
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "fillPatternOption") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          <div className={css.controlRow}>
            <input
              className={css.numberInput}
              type="number"
              step={property.step}
              value={formatNumber(property.value)}
              disabled={!writable}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                if (!Number.isFinite(next)) {
                  return;
                }
                applyFillPatternOptionValue(property.write, property.option, next, property.context);
              }}
            />
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
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
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
                <span className={css.lineWidthValueLabel}>{dropdownDisplayLabel}</span>
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
          />
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
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          {renderDashStyleDropdown(
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
            (nextValue) =>
              applyHoverPreview(previewOwnerKey, () =>
                applyDashStyleValue(property.write, nextValue, { recordInHistory: false })
              ),
            () => clearHoverPreviewSession(previewOwnerKey)
          )}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "lineCap") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const previewOwnerKey = `line-cap:${property.write.elementId}:${property.id}`;
      return (
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          {renderLineCapDropdown(
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
            (nextValue) =>
              applyHoverPreview(previewOwnerKey, () =>
                applyLineCapValue(property.write, nextValue, { recordInHistory: false })
              ),
            () => clearHoverPreviewSession(previewOwnerKey)
          )}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "lineJoin") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const previewOwnerKey = `line-join:${property.write.elementId}:${property.id}`;
      return (
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          {renderLineJoinDropdown(
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
            (nextValue) =>
              applyHoverPreview(previewOwnerKey, () =>
                applyLineJoinValue(property.write, nextValue, { recordInHistory: false })
              ),
            () => clearHoverPreviewSession(previewOwnerKey)
          )}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "pathMorphingDecoration") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const previewOwnerKey = `path-morphing:${property.write.elementId}:${property.id}`;
      return (
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          {renderPathMorphingDecorationDropdown(
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
            (nextValue) =>
              applyHoverPreview(previewOwnerKey, () =>
                applyPathMorphingDecorationValue(property.write, nextValue, { recordInHistory: false })
              ),
            () => clearHoverPreviewSession(previewOwnerKey)
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
        <div key={property.id} className={css.property}>
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
            <span className={css.checkboxLabel}>{property.label}</span>
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
      <div key={property.id} className={css.property}>
        <div className={css.propertyLabel}>{property.label}</div>
        {renderArrowTipDropdown(
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
          (nextValue) =>
            applyHoverPreview(previewOwnerKey, () =>
              applyArrowTipValue(property.write, property.side, nextValue, { recordInHistory: false })
            ),
          () => clearHoverPreviewSession(previewOwnerKey)
        )}
        {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
      </div>
    );
  }

  function renderMultiProperty(property: MultiInspectorProperty) {
    if (property.kind === "number") {
      return (
        <div key={property.id} className={css.property}>
          {renderMultiNumberField(property)}
        </div>
      );
    }

    if (property.kind === "length") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      return (
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          <div className={css.controlRow}>
            <input
              className={css.numberInput}
              type="number"
              step={property.step}
              value={property.mixed ? "" : formatNumber(property.value)}
              disabled={!writable}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                if (!Number.isFinite(next)) {
                  return;
                }
                applyNodeInnerSepValueMany(property.writes, next);
              }}
            />
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
      return (
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          {renderNodeShapeDropdown(
            {
              label: property.label,
              value: property.value,
              options: property.options
            },
            writable,
            (nextValue) => applyNodeShapeValueMany(property.writes, nextValue),
            dropdownValue
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
      return (
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          {renderNodeFontToolbar(
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
              applyNodeFontValueMany(property.writes, property.contexts, {
                sizePreset: nextSizePreset
              })
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
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          <ColorPickerField
            ariaLabel={property.label}
            value={property.mixed ? null : (property.value ?? "none")}
            syntaxValue={property.mixed ? null : property.syntaxValue}
            mixed={property.mixed}
            options={property.options}
            namedColorSwatches={projectNamedColorSwatches}
            disabled={!writable}
            onChange={(nextValue) =>
              applySetPropertyMany(property.writes, nextValue, {
                clearKeys: colorSyntaxClearKeys(property.syntaxValue)
              })
            }
          />
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
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          {renderFillModeDropdown(
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
            dropdownValue
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
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          {renderFillShadingDropdown(
            {
              label: property.label,
              value: property.value,
              options: property.options
            },
            writable,
            (nextValue) => applyFillShadingValueMany(property.writes, nextValue),
            dropdownValue
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
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          {renderFillPatternDropdown(
            {
              label: property.label,
              value: property.value,
              options: property.options
            },
            writable,
            (nextValue) => applyFillPatternValueMany(property.writes, nextValue),
            dropdownValue
          )}
          {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
          {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "fillPatternOption") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      return (
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          <div className={css.controlRow}>
            <input
              className={css.numberInput}
              type="number"
              step={property.step}
              value={property.mixed ? "" : formatNumber(property.value)}
              disabled={!writable}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                if (!Number.isFinite(next)) {
                  return;
                }
                applyFillPatternOptionValueMany(property.writes, property.option, next, property.contexts);
              }}
            />
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
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
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
                  <span className={css.lineWidthValueLabel}>{dropdownDisplayLabel}</span>
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
          />
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
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          {renderDashStyleDropdown(
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
            (nextValue) =>
              applyHoverPreview(previewOwnerKey, () =>
                applyDashStyleValueMany(property.writes, nextValue, { recordInHistory: false })
              ),
            () => clearHoverPreviewSession(previewOwnerKey)
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
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          {renderLineCapDropdown(
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
            (nextValue) =>
              applyHoverPreview(previewOwnerKey, () =>
                applyLineCapValueMany(property.writes, nextValue, { recordInHistory: false })
              ),
            () => clearHoverPreviewSession(previewOwnerKey)
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
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          {renderLineJoinDropdown(
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
            (nextValue) =>
              applyHoverPreview(previewOwnerKey, () =>
                applyLineJoinValueMany(property.writes, nextValue, { recordInHistory: false })
              ),
            () => clearHoverPreviewSession(previewOwnerKey)
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
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          {renderPathMorphingDecorationDropdown(
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
            (nextValue) =>
              applyHoverPreview(previewOwnerKey, () =>
                applyPathMorphingDecorationValueMany(property.writes, nextValue, { recordInHistory: false })
              ),
            () => clearHoverPreviewSession(previewOwnerKey)
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
        <div key={property.id} className={css.property}>
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
            <span className={css.checkboxLabel}>{property.label}</span>
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
      <div key={property.id} className={css.property}>
        <div className={css.propertyLabel}>{property.label}</div>
        {renderArrowTipDropdown(
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
          (nextValue) =>
            applyHoverPreview(previewOwnerKey, () =>
              applyArrowTipValueMany(property.writes, property.side, nextValue, { recordInHistory: false })
            ),
          () => clearHoverPreviewSession(previewOwnerKey)
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
              return renderSingleNumberPair(
                property as Extract<InspectorProperty, { kind: "number" }>,
                next as Extract<InspectorProperty, { kind: "number" }>
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
              return renderMultiNumberPair(
                property as Extract<MultiInspectorProperty, { kind: "number" }>,
                next as Extract<MultiInspectorProperty, { kind: "number" }>
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
        <button
          key={action.id}
          type="button"
          className={css.multiArrangeIconButton}
          aria-label={action.label}
          title={title}
          disabled={disabled}
          onClick={() => {
            clearHoverPreviewSession();
            action.run(commandContext);
          }}
        >
          <Icon size={14} />
        </button>
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
      <div className={css.header}>Inspector</div>
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
