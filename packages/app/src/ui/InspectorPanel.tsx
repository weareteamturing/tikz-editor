import { useCallback, useEffect, useMemo, useState, type JSX, type PointerEvent as ReactPointerEvent } from "react";
import {
  RiBold,
  RiFontMono,
  RiFontSansSerif,
  RiFontSerif,
  RiItalic
} from "@remixicon/react";
import { formatNumber } from "tikz-editor/edit/format";
import {
  buildArrowTipSetPropertyMutation,
  buildDashStyleSetPropertyMutation,
  buildFillModeSetPropertyMutations,
  buildNodeFontSetPropertyMutation,
  buildNodeInnerSepSetPropertyMutation,
  buildNodeMinimumDimensionSetPropertyMutations,
  buildNodeShapeSetPropertyMutation,
  NODE_INNER_SEP_DEFAULT,
  buildFillPatternOptionSetPropertyMutation,
  buildFillPatternSetPropertyMutation,
  buildFillShadingSetPropertyMutations,
  buildLineCapSetPropertyMutation,
  buildLineJoinSetPropertyMutation,
  buildPathMorphingDecorationSetPropertyMutations,
  buildRoundedCornersSetPropertyMutation,
  buildShadowMutationContextForPreset,
  buildShadowSetPropertyMutations,
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
  type InspectorProperty,
  type LineCapPresetId,
  type LineJoinPresetId,
  type NodeFontFamilyId,
  type NodeFontMutationContext,
  type NodeFontSizePresetId,
  type NodeMinimumDimensionKey,
  type NodeShapePresetId,
  type PathMorphingDecorationPresetId,
  type SetPropertyWriteTarget,
  type ShadowMutationContext,
  type ShadowPresetId
} from "tikz-editor/edit/inspector";
import { useEditorStore } from "../store/store";
import { getInspectorPropertyCapabilityStatus } from "./capabilities";
import { ColorPickerField } from "./ColorPicker";
import { CustomDropdown } from "./CustomDropdown";
import { RenderedTooltip } from "./RenderedTooltip";
import { MULTI_ARRANGE_ACTIONS, type MultiArrangeAction } from "./inspector-panel/arrange-actions";
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
  clampNumber,
  dashStylePreviewPreset,
  dashStyleValueLabel,
  fillModeValueLabel,
  fillPatternPreviewPreset,
  fillPatternValueLabel,
  fillShadingValueLabel,
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
  type InspectorPropertyProvenance,
  type MultiInspectorProperty,
  type NodeFontSizeDropdownValue,
  type NodeShapeDropdownValue,
  type PathMorphingDecorationDropdownValue
} from "./inspector-panel/panel-helpers";
import { InspectorMultiSection, InspectorSingleSection } from "./inspector-panel/InspectorSections";
import {
  renderMultiInspectorProperty,
  renderSingleInspectorProperty
} from "./inspector-panel/property-renderers";
import {
  renderNodeFontSizeDropdown,
} from "./inspector-panel/property-dropdowns";
import { useInspectorModel } from "./inspector-panel/useInspectorModel";
import { useInspectorPreviewScrub } from "./inspector-panel/useInspectorPreviewScrub";
import { useInspectorMutations, type ApplySetPropertyOptions } from "./inspector-panel/useInspectorMutations";
import { SidePanel } from "./SidePanel";
import css from "./InspectorPanel.module.css";

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

export function InspectorPanel() {
  const selectedIds = useEditorStore((s) => s.selectedElementIds);
  const dispatch = useEditorStore((s) => s.dispatch);

  const {
    source,
    snapshot,
    selectedSourceIds,
    projectNamedColorSwatches,
    globalTransformValues,
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
    setFrozenInspectorView
  } = useInspectorModel({
    selectedIds,
    dispatch,
    getInspectorDescriptor
  });

  const [manualLineWidthCustomKeys, setManualLineWidthCustomKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [strokeMoreOptionsOpen, setStrokeMoreOptionsOpen] = useState(false);
  const [fillMoreOptionsOpen, setFillMoreOptionsOpen] = useState(false);
  const [fillAdvancedOptionsOpen, setFillAdvancedOptionsOpen] = useState(false);

  const {
    clearHoverPreviewSession,
    applyHoverPreview,
    commitAfterHoverPreview,
    beginNumberLabelScrub
  } = useInspectorPreviewScrub({
    dispatch,
    selectedSourceIds,
    descriptor,
    multiModel,
    singlePropertyProvenance,
    multiPropertyProvenance,
    setFrozenInspectorView
  });

  const {
    applySetProperty,
    applySetPropertyMany,
    normalizeColorSetPropertyChange,
    applyArrowTipValue,
    applyArrowTipValueMany,
    applyDashStyleValue,
    applyDashStyleValueMany,
    applyLineCapValue,
    applyLineCapValueMany,
    applyLineJoinValue,
    applyLineJoinValueMany,
    applyFillModeValue,
    applyFillModeValueMany,
    applyFillShadingValue,
    applyFillShadingValueMany,
    applyFillPatternValue,
    applyFillPatternValueMany,
    applyFillPatternOptionValue,
    applyFillPatternOptionValueMany,
    applyPathMorphingDecorationValue,
    applyPathMorphingDecorationValueMany,
    applyRoundedCornersValue,
    applyRoundedCornersValueMany,
    applyNodeShapeValue,
    applyNodeShapeValueMany,
    applyNodeInnerSepValue,
    applyNodeInnerSepValueMany,
    applyNodeFontValue,
    applyNodeFontValueMany
  } = useInspectorMutations(dispatch);

  useEffect(() => {
    setStrokeMoreOptionsOpen(false);
    setFillAdvancedOptionsOpen(false);
  }, [selectedIds]);

  function handleNumberChange(
    property: Extract<InspectorProperty, { kind: "number" }>,
    raw: string,
    options: NumberChangeOptions = {}
  ): void {
    const write = property.write;
    if (!write || write.mode !== "setProperty" || !write.writable || write.elementId.length === 0) return;
    const parsed = Number(raw);
    const next =
      Number.isFinite(parsed) && property.min != null && property.max != null
        ? clampNumber(parsed, property.min, property.max)
        : Number.isFinite(parsed) && property.min != null
          ? Math.max(parsed, property.min)
          : Number.isFinite(parsed) && property.max != null
            ? Math.min(parsed, property.max)
            : parsed;
    if (!Number.isFinite(next)) return;
    if (write.shadowContext) {
      applyShadowParamValue(write, property.id, next, options);
      return;
    }
    if (!write.transformContext) {
      applySetProperty(write, formatNumberWriteValue(property, next), {
        clearKeys: property.clearKeys,
        recordInHistory: options.recordInHistory
      });
      return;
    }

    const mutations = buildTransformSetPropertyMutations(
      write.transformContext,
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
    const parsed = Number(raw);
    const next =
      Number.isFinite(parsed) && property.min != null && property.max != null
        ? clampNumber(parsed, property.min, property.max)
        : Number.isFinite(parsed) && property.min != null
          ? Math.max(parsed, property.min)
          : Number.isFinite(parsed) && property.max != null
            ? Math.min(parsed, property.max)
            : parsed;
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
        write.transformContext,
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
    if (
      (property.id === "node-minimum-width" || property.id === "node-minimum-height")
      && property.minimumDimensionsContext
    ) {
      const editedKey: NodeMinimumDimensionKey =
        property.id === "node-minimum-width" ? "minimum width" : "minimum height";
      const mutations = buildNodeMinimumDimensionSetPropertyMutations(
        property.minimumDimensionsContext,
        editedKey,
        value
      );
      if (mutations.length === 0) {
        return;
      }
      const mergeKey = options.recordInHistory === false ? undefined : `single-set:${Date.now().toString(36)}`;
      for (const mutation of mutations) {
        dispatch({
          type: "APPLY_EDIT_ACTION",
          historyMergeKey: mergeKey,
          recordInHistory: options.recordInHistory,
          action: {
            kind: "setProperty",
            elementId: property.write.elementId,
            level: property.write.level,
            key: mutation.key,
            value: mutation.value,
            clearKeys: mutation.clearKeys
          }
        });
      }
      return;
    }
    if (property.write.shadowContext) {
      applyShadowParamValue(property.write, property.id, value, options);
      return;
    }
    applySetProperty(property.write, `${formatNumber(value)}pt`, {
      clearKeys: property.clearKeys,
      recordInHistory: options.recordInHistory
    });
  }

  function applyShadowParamValue(
    write: SetPropertyWriteTarget,
    propertyId: string,
    value: number | string | null,
    options: NumberChangeOptions = {}
  ): void {
    if (!write.shadowContext || !write.writable || write.elementId.length === 0) return;
    const ctx = write.shadowContext;
    let nextContext: ShadowMutationContext;
    if (propertyId === "shadow-xshift") {
      nextContext = { ...ctx, xshiftPt: value as number };
    } else if (propertyId === "shadow-yshift") {
      nextContext = { ...ctx, yshiftPt: value as number };
    } else if (propertyId === "shadow-scale") {
      nextContext = { ...ctx, scale: value as number };
    } else if (propertyId === "shadow-opacity") {
      nextContext = { ...ctx, opacity: value as number };
    } else if (propertyId === "shadow-color") {
      nextContext = { ...ctx, color: value as string | null };
    } else {
      return;
    }
    const mutations = buildShadowSetPropertyMutations(nextContext);
    if (mutations.length === 0) return;
    const mergeKey = options.recordInHistory === false ? undefined : `single-set:${Date.now().toString(36)}`;
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

  function applyShadowPresetValue(
    write: SetPropertyWriteTarget,
    context: ShadowMutationContext,
    nextPreset: ShadowPresetId
  ): void {
    if (!write.writable || write.elementId.length === 0) return;
    const nextContext =
      nextPreset === context.preset ? context : buildShadowMutationContextForPreset(nextPreset);
    const mutations = buildShadowSetPropertyMutations(nextContext);
    if (mutations.length === 0) return;
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

  function applyMultiLengthValue(
    property: Extract<MultiInspectorProperty, { kind: "length" }>,
    value: number,
    options: NumberChangeOptions = {}
  ): void {
    if (
      (property.id === "node-minimum-width" || property.id === "node-minimum-height")
      && property.minimumDimensionsContexts
    ) {
      const editedKey: NodeMinimumDimensionKey =
        property.id === "node-minimum-width" ? "minimum width" : "minimum height";
      const writableEntries = property.writes
        .map((write, index) => {
          const context = property.minimumDimensionsContexts?.[index];
          return context ? { write, context } : null;
        })
        .filter(
          (
            entry
          ): entry is { write: SetPropertyWriteTarget; context: NonNullable<(typeof property.minimumDimensionsContexts)[number]> } =>
            entry != null && entry.write.writable && entry.write.elementId.length > 0
        );
      if (writableEntries.length === 0) {
        return;
      }
      const mergeKey = options.recordInHistory === false ? undefined : `multi-set:${Date.now().toString(36)}`;
      for (const { write, context } of writableEntries) {
        const mutations = buildNodeMinimumDimensionSetPropertyMutations(context, editedKey, value);
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
      return;
    }
    applySetPropertyMany(property.writes, `${formatNumber(value)}pt`, {
      clearKeys: property.clearKeys,
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
        min={property.min}
        max={property.max}
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
          min: property.min,
          max: property.max,
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
        min={property.min}
        max={property.max}
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
          min: property.min,
          max: property.max,
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

  function renderSingleLengthField(
    property: Extract<InspectorProperty, { kind: "length" }>,
    compact = false,
    provenance: InspectorPropertyProvenance | null = null
  ): JSX.Element {
    const capability = getInspectorPropertyCapabilityStatus(property);
    const capabilityReadOnlyReason =
      capability.status === "unsupported" ? capability.reason : null;
    const readOnlyReason = property.readOnlyReason ?? property.write.reason ?? capabilityReadOnlyReason;
    const writable = property.write.writable && capability.status !== "unsupported";
    const input = (
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
      />
    );
    return (
      <div className={compact ? css.compactNumberField : undefined}>
        {renderScrubbableNumberLabel(property.label, {
          writable,
          value: property.value,
          step: property.step,
          onPreview: (next) => applySingleLengthValue(property, next, { recordInHistory: false }),
          onCommit: (next) => applySingleLengthValue(property, next)
        })}
        <div className={css.controlRow}>
          {maybeWrapWithProvenanceTooltip(provenance, input, true)}
          <span className={css.unitLabel}>{property.unit}</span>
        </div>
        {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
        {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
      </div>
    );
  }

  function renderMultiLengthField(
    property: Extract<MultiInspectorProperty, { kind: "length" }>,
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
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (!Number.isFinite(next)) {
            return;
          }
          applyMultiLengthValue(property, next);
        }}
      />
    );
    return (
      <div className={compact ? css.compactNumberField : undefined}>
        {renderScrubbableNumberLabel(property.label, {
          writable,
          value: property.value,
          step: property.step,
          onPreview: (next) => applyMultiLengthValue(property, next, { recordInHistory: false }),
          onCommit: (next) => applyMultiLengthValue(property, next)
        })}
        <div className={css.controlRow}>
          {maybeWrapWithProvenanceTooltip(provenance, input, true)}
          <span className={css.unitLabel}>{property.unit}</span>
        </div>
        {property.note ? <div className={css.propertyNote}>{property.note}</div> : null}
        {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
      </div>
    );
  }

  function renderSingleNumberPair(
    left: Extract<InspectorProperty, { kind: "number" }>,
    right: Extract<InspectorProperty, { kind: "number" }>,
    leftProvenance: InspectorPropertyProvenance | null = null,
    rightProvenance: InspectorPropertyProvenance | null = null
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

  function renderSingleLengthPair(
    left: Extract<InspectorProperty, { kind: "length" }>,
    right: Extract<InspectorProperty, { kind: "length" }>,
    leftProvenance: InspectorPropertyProvenance | null = null,
    rightProvenance: InspectorPropertyProvenance | null = null
  ): JSX.Element {
    return (
      <div key={`${left.id}:${right.id}`} className={css.compactNumberPair}>
        {renderSingleLengthField(left, true, leftProvenance)}
        {renderSingleLengthField(right, true, rightProvenance)}
      </div>
    );
  }

  function renderMultiLengthPair(
    left: Extract<MultiInspectorProperty, { kind: "length" }>,
    right: Extract<MultiInspectorProperty, { kind: "length" }>,
    leftProvenance: InspectorPropertyProvenance | null,
    rightProvenance: InspectorPropertyProvenance | null
  ): JSX.Element {
    return (
      <div key={`${left.id}:${right.id}`} className={css.compactNumberPair}>
        {renderMultiLengthField(left, true, leftProvenance)}
        {renderMultiLengthField(right, true, rightProvenance)}
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

  const propertyRendererApi = {
    renderedSinglePropertyProvenance,
    renderedMultiPropertyProvenance,
    implicitDefaultProvenance,
    withValueProvenanceClass,
    renderSingleTextField,
    renderSingleNumberField,
    renderMultiNumberField,
    renderScrubbableNumberLabel,
    applySingleLengthValue,
    applyMultiLengthValue,
    maybeWrapWithProvenanceTooltip,
    commitAfterHoverPreview,
    applyNodeShapeValue,
    applyNodeShapeValueMany,
    applyHoverPreview,
    clearHoverPreviewSession,
    renderNodeFontToolbar,
    applyNodeFontValue,
    applyNodeFontValueMany,
    normalizeColorSetPropertyChange,
    applySetProperty,
    applySetPropertyMany,
    projectNamedColorSwatches,
    applyFillModeValue,
    applyFillModeValueMany,
    setFillAdvancedOptionsOpen,
    applyFillShadingValue,
    applyFillShadingValueMany,
    applyFillPatternValue,
    applyFillPatternValueMany,
    applySingleFillPatternOptionValue,
    applyMultiFillPatternOptionValue,
    manualLineWidthCustomKeys,
    enableManualCustomLineWidth,
    disableManualCustomLineWidth,
    applyDashStyleValue,
    applyDashStyleValueMany,
    applyLineCapValue,
    applyLineCapValueMany,
    applyLineJoinValue,
    applyLineJoinValueMany,
    applyPathMorphingDecorationValue,
    applyPathMorphingDecorationValueMany,
    applyRoundedCornersValue,
    applyRoundedCornersValueMany,
    applyArrowTipValue,
    applyArrowTipValueMany,
    applyShadowPropertyValue: applyShadowParamValue,
    applyShadowPresetValue
  };

  function renderProperty(property: InspectorProperty) {
    return renderSingleInspectorProperty(property, propertyRendererApi);
  }

  function renderMultiProperty(property: MultiInspectorProperty) {
    return renderMultiInspectorProperty(property, propertyRendererApi);
  }

  const singleFillModeProperty = useMemo(
    () =>
      renderedDescriptor?.sections
        .find((section) => section.id === "fill")
        ?.properties.find(
          (property): property is Extract<InspectorProperty, { kind: "fillMode" }> =>
            property.kind === "fillMode"
        ),
    [renderedDescriptor]
  );
  const fillModeSingleCanWrite = Boolean(
    singleFillModeProperty &&
      singleFillModeProperty.write.writable &&
      getInspectorPropertyCapabilityStatus(singleFillModeProperty).status !== "unsupported"
  );
  const onEnableGradientFillSingle = useCallback(() => {
    if (!singleFillModeProperty || !fillModeSingleCanWrite) {
      return;
    }
    setFillAdvancedOptionsOpen(true);
    applyFillModeValue(singleFillModeProperty.write, "gradient", singleFillModeProperty.context);
  }, [singleFillModeProperty, fillModeSingleCanWrite, applyFillModeValue]);
  const onEnablePatternFillSingle = useCallback(() => {
    if (!singleFillModeProperty || !fillModeSingleCanWrite) {
      return;
    }
    setFillAdvancedOptionsOpen(true);
    applyFillModeValue(singleFillModeProperty.write, "pattern", singleFillModeProperty.context);
  }, [singleFillModeProperty, fillModeSingleCanWrite, applyFillModeValue]);

  const multiFillModeProperty = useMemo(
    () =>
      renderedMultiModel?.sections
        .find((section) => section.id === "fill")
        ?.properties.find(
          (property): property is Extract<MultiInspectorProperty, { kind: "fillMode" }> =>
            property.kind === "fillMode"
        ),
    [renderedMultiModel]
  );
  const fillModeMultiCanWrite = Boolean(
    multiFillModeProperty?.writes.some((write) => write.writable && write.elementId.length > 0)
  );
  const onEnableGradientFillMulti = useCallback(() => {
    if (!multiFillModeProperty || !fillModeMultiCanWrite) {
      return;
    }
    setFillAdvancedOptionsOpen(true);
    applyFillModeValueMany(multiFillModeProperty.writes, "gradient", multiFillModeProperty.contexts);
  }, [multiFillModeProperty, fillModeMultiCanWrite, applyFillModeValueMany]);
  const onEnablePatternFillMulti = useCallback(() => {
    if (!multiFillModeProperty || !fillModeMultiCanWrite) {
      return;
    }
    setFillAdvancedOptionsOpen(true);
    applyFillModeValueMany(multiFillModeProperty.writes, "pattern", multiFillModeProperty.contexts);
  }, [multiFillModeProperty, fillModeMultiCanWrite, applyFillModeValueMany]);

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
      <>
        <SidePanel.Header>tikzpicture</SidePanel.Header>
        <SidePanel.Content className={css.content}>
          <div className={css.elementInfo}>
            <SidePanel.Section>
              <SidePanel.SectionHeader>
                <span>Transform</span>
              </SidePanel.SectionHeader>
              <SidePanel.SectionBody>{renderSingleNumberPair(xscale, yscale)}</SidePanel.SectionBody>
            </SidePanel.Section>
          </div>
        </SidePanel.Content>
      </>
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
    <SidePanel className={css.panel}>
      {selectedSourceIds.length === 0 ? (
        renderGlobalTransformPanel()
      ) : selectedSourceIds.length === 1 ? (
        !renderedDescriptor ? (
          <SidePanel.Content>
            <p className={css.hint}>Inspector data is unavailable for the current selection.</p>
          </SidePanel.Content>
        ) : (
          <>
            <SidePanel.Header>{renderedDescriptor.elementKind}</SidePanel.Header>
            <SidePanel.Content className={css.content}>
              <div className={css.elementInfo}>
                {renderedDescriptor.readOnlyReason ? (
                  <div className={css.globalNote}>{renderedDescriptor.readOnlyReason}</div>
                ) : null}

                {renderedDescriptor.sections.map((section) => (
                  <InspectorSingleSection
                    key={section.id}
                    section={section}
                    strokeMoreOptionsOpen={strokeMoreOptionsOpen}
                    setStrokeMoreOptionsOpen={setStrokeMoreOptionsOpen}
                    fillMoreOptionsOpen={fillMoreOptionsOpen}
                    setFillMoreOptionsOpen={setFillMoreOptionsOpen}
                    fillAdvancedOptionsOpen={fillAdvancedOptionsOpen}
                    setFillAdvancedOptionsOpen={setFillAdvancedOptionsOpen}
                    renderedSinglePropertyProvenance={renderedSinglePropertyProvenance}
                    renderSingleNumberPair={renderSingleNumberPair}
                    renderSingleLengthPair={renderSingleLengthPair}
                    renderProperty={renderProperty}
                    onEnableGradientFillSingle={onEnableGradientFillSingle}
                    onEnablePatternFillSingle={onEnablePatternFillSingle}
                    fillModeSingleCanWrite={fillModeSingleCanWrite}
                  />
                ))}
              </div>
            </SidePanel.Content>
          </>
        )
      ) : (
        <>
          <SidePanel.Header>
            {renderedMultiModel?.selectionCount ?? selectedSourceIds.length} selected
          </SidePanel.Header>
          <SidePanel.Content className={css.content}>
            <div className={css.elementInfo}>
              {renderMultiArrangeQuickActions()}
              {!renderedMultiModel || renderedMultiModel.sections.length === 0 ? (
                <p className={css.hint}>No shared editable properties were found across the selected elements.</p>
              ) : (
                renderedMultiModel.sections.map((section) => (
                  <InspectorMultiSection
                    key={section.id}
                    section={section}
                    strokeMoreOptionsOpen={strokeMoreOptionsOpen}
                    setStrokeMoreOptionsOpen={setStrokeMoreOptionsOpen}
                    fillMoreOptionsOpen={fillMoreOptionsOpen}
                    setFillMoreOptionsOpen={setFillMoreOptionsOpen}
                    fillAdvancedOptionsOpen={fillAdvancedOptionsOpen}
                    setFillAdvancedOptionsOpen={setFillAdvancedOptionsOpen}
                    renderedMultiPropertyProvenance={renderedMultiPropertyProvenance}
                    renderMultiNumberPair={renderMultiNumberPair}
                    renderMultiLengthPair={renderMultiLengthPair}
                    renderMultiProperty={renderMultiProperty}
                    onEnableGradientFillMulti={onEnableGradientFillMulti}
                    onEnablePatternFillMulti={onEnablePatternFillMulti}
                    fillModeMultiCanWrite={fillModeMultiCanWrite}
                  />
                ))
              )}
            </div>
          </SidePanel.Content>
        </>
      )}
    </SidePanel>
  );
}
