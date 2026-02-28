import { useMemo, useState } from "react";
import { formatNumber } from "tikz-editor/edit/format";
import {
  buildArrowTipSetPropertyMutation,
  buildDashStyleSetPropertyMutation,
  buildLineCapSetPropertyMutation,
  buildLineJoinSetPropertyMutation,
  buildPathMorphingDecorationSetPropertyMutations,
  getInspectorDescriptor,
  LINE_WIDTH_PRESETS,
  type ArrowTipPresetId,
  type ArrowTipSide,
  type ArrowTipWriteTarget,
  type DashStylePresetId,
  type InspectorDescriptor,
  type InspectorProperty,
  type LineCapPresetId,
  type LineJoinPresetId,
  type PathMorphingDecorationPresetId,
  type SetPropertyWriteTarget
} from "tikz-editor/edit/inspector";
import { makeDefaultArrowMarker } from "tikz-editor/semantic/style/arrows";
import type { ArrowTipKind, SceneElement } from "tikz-editor/semantic/types";
import { renderArrowTipPreviewPaths } from "tikz-editor/svg/arrows/preview";
import { renderPathMorphingDecorationPreviewSvg } from "tikz-editor/svg/decorations/preview";
import { useEditorStore } from "../store/store";
import { getInspectorPropertyCapabilityStatus } from "./capabilities";
import { ColorPickerField } from "./ColorPicker";
import { CustomDropdown, type CustomDropdownOption } from "./CustomDropdown";
import css from "./InspectorPanel.module.css";

type MultiInspectorNumberProperty = {
  kind: "number";
  id: string;
  label: string;
  value: number;
  mixed: boolean;
  step: number;
  unit?: string;
  readOnlyReason?: string;
};

type MultiInspectorColorProperty = {
  kind: "color";
  id: string;
  label: string;
  value: string | null;
  syntaxValue: string | null;
  mixed: boolean;
  options: string[];
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

type MultiInspectorLineWidthProperty = {
  kind: "lineWidth";
  id: string;
  label: string;
  value: number;
  averageValue: number;
  mixed: boolean;
  min: number;
  max: number;
  step: number;
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

type MultiInspectorDashStyleProperty = {
  kind: "dashStyle";
  id: string;
  label: string;
  value: DashStylePresetId;
  mixed: boolean;
  previewLineWidth: number;
  options: Array<{ value: Exclude<DashStylePresetId, "custom">; label: string }>;
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

type MultiInspectorLineCapProperty = {
  kind: "lineCap";
  id: string;
  label: string;
  value: LineCapPresetId;
  mixed: boolean;
  previewLineWidth: number;
  options: Array<{ value: Exclude<LineCapPresetId, "custom">; label: string }>;
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

type MultiInspectorLineJoinProperty = {
  kind: "lineJoin";
  id: string;
  label: string;
  value: LineJoinPresetId;
  mixed: boolean;
  previewLineWidth: number;
  options: Array<{ value: Exclude<LineJoinPresetId, "custom">; label: string }>;
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

type MultiInspectorPathMorphingDecorationProperty = {
  kind: "pathMorphingDecoration";
  id: string;
  label: string;
  value: PathMorphingDecorationPresetId;
  mixed: boolean;
  previewLineWidth: number;
  options: Array<{ value: Exclude<PathMorphingDecorationPresetId, "custom">; label: string }>;
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

type MultiInspectorArrowTipProperty = {
  kind: "arrowTip";
  id: string;
  label: string;
  side: ArrowTipSide;
  value: ArrowTipPresetId;
  mixed: boolean;
  previewLineWidth: number;
  options: Array<{ value: Exclude<ArrowTipPresetId, "custom">; label: string }>;
  writes: ArrowTipWriteTarget[];
  readOnlyReason?: string;
};

type MultiInspectorProperty =
  | MultiInspectorNumberProperty
  | MultiInspectorColorProperty
  | MultiInspectorLineWidthProperty
  | MultiInspectorDashStyleProperty
  | MultiInspectorLineCapProperty
  | MultiInspectorLineJoinProperty
  | MultiInspectorPathMorphingDecorationProperty
  | MultiInspectorArrowTipProperty;

type MultiInspectorSection = {
  id: string;
  title: string;
  sourceLevel: InspectorDescriptor["sections"][number]["sourceLevel"];
  properties: MultiInspectorProperty[];
};

type MultiInspectorModel = {
  selectionCount: number;
  elementKinds: string[];
  sections: MultiInspectorSection[];
};

const VALUE_EPSILON = 1e-6;
const LINE_WIDTH_CUSTOM_OPTION_VALUE = "__custom-line-width__";
const LINE_WIDTH_MIXED_OPTION_VALUE = "__mixed-line-width__";
const LINE_WIDTH_PRESET_EPSILON = 0.02;
const ARROW_TIP_MIXED_OPTION_VALUE = "__mixed-arrow-tip__";
const DASH_STYLE_MIXED_OPTION_VALUE = "__mixed-dash-style__";
const LINE_CAP_MIXED_OPTION_VALUE = "__mixed-line-cap__";
const LINE_JOIN_MIXED_OPTION_VALUE = "__mixed-line-join__";
const PATH_MORPHING_DECORATION_MIXED_OPTION_VALUE = "__mixed-path-morphing-decoration__";
const OPTIONAL_MULTI_PROPERTY_IDS = new Set(["line-cap", "line-join"]);
type LineWidthDropdownValue = string;
type ArrowTipDropdownValue = ArrowTipPresetId | typeof ARROW_TIP_MIXED_OPTION_VALUE;
type DashStyleDropdownValue = DashStylePresetId | typeof DASH_STYLE_MIXED_OPTION_VALUE;
type LineCapDropdownValue = LineCapPresetId | typeof LINE_CAP_MIXED_OPTION_VALUE;
type LineJoinDropdownValue = LineJoinPresetId | typeof LINE_JOIN_MIXED_OPTION_VALUE;
type PathMorphingDecorationDropdownValue =
  | PathMorphingDecorationPresetId
  | typeof PATH_MORPHING_DECORATION_MIXED_OPTION_VALUE;

const LINE_WIDTH_PRESET_BY_LABEL = new Map<string, number>(
  LINE_WIDTH_PRESETS.map((preset) => [preset.label, preset.value] as const)
);
const LINE_WIDTH_DROPDOWN_OPTIONS: Array<CustomDropdownOption<LineWidthDropdownValue>> = [
  ...LINE_WIDTH_PRESETS.map((preset) => ({
    value: preset.label,
    label: preset.label
  })),
  {
    value: LINE_WIDTH_CUSTOM_OPTION_VALUE,
    label: "Custom line width"
  }
];
const LINE_WIDTH_NUMERIC_KEY = "line width";
const LINE_WIDTH_PRESET_KEYS = LINE_WIDTH_PRESETS.map((preset) => preset.label);
const LINE_WIDTH_ALL_OPTION_KEYS = [LINE_WIDTH_NUMERIC_KEY, ...LINE_WIDTH_PRESET_KEYS];

export function InspectorPanel() {
  const selectedIds = useEditorStore((s) => s.selectedElementIds);
  const snapshot = useEditorStore((s) => s.snapshot);
  const dispatch = useEditorStore((s) => s.dispatch);
  const [manualLineWidthCustomKeys, setManualLineWidthCustomKeys] = useState<Set<string>>(
    () => new Set()
  );

  const selectedSourceIds = useMemo(() => [...selectedIds], [selectedIds]);

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

  function applySetProperty(
    write: SetPropertyWriteTarget,
    value: string,
    options: { key?: string; clearKeys?: string[] } = {}
  ): void {
    if (!write.writable || write.elementId.length === 0) return;
    dispatch({
      type: "APPLY_EDIT_ACTION",
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
    options: { key?: string; clearKeys?: string[] } = {}
  ): void {
    const writable = writes.filter((write) => write.writable && write.elementId.length > 0);
    if (writable.length === 0) {
      return;
    }

    const mergeKey = `multi-set:${Date.now().toString(36)}`;
    for (const write of writable) {
      dispatch({
        type: "APPLY_EDIT_ACTION",
        historyMergeKey: mergeKey,
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

  function applyArrowTipValue(write: ArrowTipWriteTarget, side: ArrowTipSide, value: Exclude<ArrowTipPresetId, "custom">): void {
    const mutation = buildArrowTipSetPropertyMutation(write.arrowContext, side, value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys
    });
  }

  function applyArrowTipValueMany(
    writes: readonly ArrowTipWriteTarget[],
    side: ArrowTipSide,
    value: Exclude<ArrowTipPresetId, "custom">
  ): void {
    const writable = writes.filter((write) => write.writable && write.elementId.length > 0);
    if (writable.length === 0) {
      return;
    }

    const mergeKey = `multi-set:${Date.now().toString(36)}`;
    for (const write of writable) {
      const mutation = buildArrowTipSetPropertyMutation(write.arrowContext, side, value);
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

  function applyDashStyleValue(
    write: SetPropertyWriteTarget,
    value: Exclude<DashStylePresetId, "custom">
  ): void {
    const mutation = buildDashStyleSetPropertyMutation(value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys
    });
  }

  function applyDashStyleValueMany(
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<DashStylePresetId, "custom">
  ): void {
    const mutation = buildDashStyleSetPropertyMutation(value);
    applySetPropertyMany(writes, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys
    });
  }

  function applyLineCapValue(
    write: SetPropertyWriteTarget,
    value: Exclude<LineCapPresetId, "custom">
  ): void {
    const mutation = buildLineCapSetPropertyMutation(value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys
    });
  }

  function applyLineCapValueMany(
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<LineCapPresetId, "custom">
  ): void {
    const mutation = buildLineCapSetPropertyMutation(value);
    applySetPropertyMany(writes, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys
    });
  }

  function applyLineJoinValue(
    write: SetPropertyWriteTarget,
    value: Exclude<LineJoinPresetId, "custom">
  ): void {
    const mutation = buildLineJoinSetPropertyMutation(value);
    applySetProperty(write, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys
    });
  }

  function applyLineJoinValueMany(
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<LineJoinPresetId, "custom">
  ): void {
    const mutation = buildLineJoinSetPropertyMutation(value);
    applySetPropertyMany(writes, mutation.value, {
      key: mutation.key,
      clearKeys: mutation.clearKeys
    });
  }

  function applyPathMorphingDecorationValue(
    write: SetPropertyWriteTarget,
    value: Exclude<PathMorphingDecorationPresetId, "custom">
  ): void {
    if (!write.writable || write.elementId.length === 0) {
      return;
    }
    const mutations = buildPathMorphingDecorationSetPropertyMutations(value);
    if (mutations.length === 0) {
      return;
    }

    const mergeKey = `multi-set:${Date.now().toString(36)}`;
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

  function applyPathMorphingDecorationValueMany(
    writes: readonly SetPropertyWriteTarget[],
    value: Exclude<PathMorphingDecorationPresetId, "custom">
  ): void {
    const writable = writes.filter((write) => write.writable && write.elementId.length > 0);
    if (writable.length === 0) {
      return;
    }

    const mutations = buildPathMorphingDecorationSetPropertyMutations(value);
    if (mutations.length === 0) {
      return;
    }

    const mergeKey = `multi-set:${Date.now().toString(36)}`;
    for (const write of writable) {
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

  function handleNumberChange(property: Extract<InspectorProperty, { kind: "number" }>, raw: string): void {
    const write = property.write;
    if (!write || write.mode !== "moveAxis" || !write.writable) return;
    const next = Number(raw);
    if (!Number.isFinite(next)) return;

    const delta =
      write.axis === "x"
        ? { x: next - write.baseX, y: 0 }
        : { x: 0, y: next - write.baseY };
    if (Math.abs(delta.x) + Math.abs(delta.y) <= 1e-9) return;

    dispatch({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveElement",
        elementId: write.elementId,
        delta
      }
    });
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
    valueOverride?: ArrowTipDropdownValue
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
    valueOverride?: DashStyleDropdownValue
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
    valueOverride?: LineCapDropdownValue
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
    valueOverride?: LineJoinDropdownValue
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
    valueOverride?: PathMorphingDecorationDropdownValue
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

  function renderProperty(property: InspectorProperty) {
    const capability = getInspectorPropertyCapabilityStatus(property);
    const capabilityReadOnlyReason =
      capability.status === "unsupported" ? capability.reason : null;
    const readOnlyReason =
      property.kind === "number"
        ? property.readOnlyReason ?? property.write?.reason ?? capabilityReadOnlyReason
        : property.write.reason ?? capabilityReadOnlyReason;

    if (property.kind === "number") {
      const writable = (property.write?.writable ?? false) && capability.status !== "unsupported";
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
              onChange={(event) => handleNumberChange(property, event.currentTarget.value)}
            />
            {property.unit ? <span className={css.unitLabel}>{property.unit}</span> : null}
          </div>
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
            disabled={!writable}
            onChange={(nextValue) => applySetProperty(property.write, nextValue)}
          />
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "lineWidth") {
      const writable = property.write.writable && capability.status !== "unsupported";
      const lineWidthKey = `${property.write.elementId}:${property.id}`;
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
            }}
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
            (nextValue) => applyDashStyleValue(property.write, nextValue)
          )}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "lineCap") {
      const writable = property.write.writable && capability.status !== "unsupported";
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
            (nextValue) => applyLineCapValue(property.write, nextValue)
          )}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "lineJoin") {
      const writable = property.write.writable && capability.status !== "unsupported";
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
            (nextValue) => applyLineJoinValue(property.write, nextValue)
          )}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "pathMorphingDecoration") {
      const writable = property.write.writable && capability.status !== "unsupported";
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
            (nextValue) => applyPathMorphingDecorationValue(property.write, nextValue)
          )}
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    const writable = property.write.writable && capability.status !== "unsupported";
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
          (nextValue) => applyArrowTipValue(property.write, property.side, nextValue)
        )}
        {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
      </div>
    );
  }

  function renderMultiProperty(property: MultiInspectorProperty) {
    if (property.kind === "number") {
      return (
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          <div className={css.controlRow}>
            <input
              className={css.numberInput}
              type="number"
              step={property.step}
              value={property.mixed ? "" : formatNumber(property.value)}
              disabled
            />
            {property.unit ? <span className={css.unitLabel}>{property.unit}</span> : null}
          </div>
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
            disabled={!writable}
            onChange={(nextValue) => applySetPropertyMany(property.writes, nextValue)}
          />
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
            }}
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
            (nextValue) => applyDashStyleValueMany(property.writes, nextValue),
            dropdownValue
          )}
          {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "lineCap") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const dropdownValue: LineCapDropdownValue = property.mixed ? LINE_CAP_MIXED_OPTION_VALUE : property.value;
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
            (nextValue) => applyLineCapValueMany(property.writes, nextValue),
            dropdownValue
          )}
          {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
        </div>
      );
    }

    if (property.kind === "lineJoin") {
      const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
      const dropdownValue: LineJoinDropdownValue = property.mixed ? LINE_JOIN_MIXED_OPTION_VALUE : property.value;
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
            (nextValue) => applyLineJoinValueMany(property.writes, nextValue),
            dropdownValue
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
            (nextValue) => applyPathMorphingDecorationValueMany(property.writes, nextValue),
            dropdownValue
          )}
          {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
        </div>
      );
    }

    const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
    const dropdownValue: ArrowTipDropdownValue = property.mixed
      ? ARROW_TIP_MIXED_OPTION_VALUE
      : property.value;

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
          (nextValue) => applyArrowTipValueMany(property.writes, property.side, nextValue),
          dropdownValue
        )}
        {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
      </div>
    );
  }

  return (
    <div className={css.panel}>
      <div className={css.header}>Inspector</div>
      <div className={css.content}>
        {selectedSourceIds.length === 0 ? (
          <p className={css.hint}>Select an element on the canvas to inspect its properties.</p>
        ) : selectedSourceIds.length === 1 ? (
          !descriptor ? (
            <p className={css.hint}>Inspector data is unavailable for the current selection.</p>
          ) : (
            <div className={css.elementInfo}>
              <div className={css.elementKind}>{descriptor.elementKind}</div>
              <div className={css.elementId}>{descriptor.elementId}</div>
              {descriptor.readOnlyReason ? (
                <div className={css.globalNote}>{descriptor.readOnlyReason}</div>
              ) : null}

              {descriptor.sections.map((section) => (
                <div key={section.id} className={css.section}>
                  <div className={css.sectionHeader}>
                    <span>{section.title}</span>
                    <span className={css.sectionLevel}>{section.sourceLevel}</span>
                  </div>
                  <div className={css.sectionBody}>
                    {section.properties.map((property) => renderProperty(property))}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : !multiModel || multiModel.sections.length === 0 ? (
          <p className={css.hint}>No shared editable properties were found across the selected elements.</p>
        ) : (
          <div className={css.elementInfo}>
            <div className={css.elementKind}>{multiModel.selectionCount} selected</div>
            <div className={css.elementId}>{multiModel.elementKinds.join(", ")}</div>
            <div className={css.globalNote}>Shared properties are shown. Mixed values appear as blank inputs.</div>

            {multiModel.sections.map((section) => (
              <div key={section.id} className={css.section}>
                <div className={css.sectionHeader}>
                  <span>{section.title}</span>
                  <span className={css.sectionLevel}>{section.sourceLevel}</span>
                </div>
                <div className={css.sectionBody}>
                  {section.properties.map((property) => renderMultiProperty(property))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function buildMultiInspectorModel(descriptors: InspectorDescriptor[], selectionCount: number): MultiInspectorModel {
  if (descriptors.length === 0) {
    return {
      selectionCount,
      elementKinds: [],
      sections: []
    };
  }

  const first = descriptors[0];
  const sections: MultiInspectorSection[] = [];

  for (const baseSection of first.sections) {
    const matchingSections = descriptors
      .map((descriptor) => descriptor.sections.find((section) => section.id === baseSection.id))
      .filter((section): section is NonNullable<typeof section> => section != null);
    if (matchingSections.length !== descriptors.length) {
      continue;
    }

    const orderedPropertyIds: string[] = [];
    const seenPropertyIds = new Set<string>();
    for (const property of baseSection.properties) {
      if (seenPropertyIds.has(property.id)) {
        continue;
      }
      seenPropertyIds.add(property.id);
      orderedPropertyIds.push(property.id);
    }
    for (const section of matchingSections) {
      for (const property of section.properties) {
        if (seenPropertyIds.has(property.id)) {
          continue;
        }
        seenPropertyIds.add(property.id);
        orderedPropertyIds.push(property.id);
      }
    }

    const properties: MultiInspectorProperty[] = [];
    for (const propertyId of orderedPropertyIds) {
      const matchingProperties = matchingSections
        .map((section) => section.properties.find((property) => property.id === propertyId))
        .filter((property): property is InspectorProperty => property != null);
      if (matchingProperties.length === 0) {
        continue;
      }
      const allowPartial = OPTIONAL_MULTI_PROPERTY_IDS.has(propertyId);
      if (!allowPartial && matchingProperties.length !== descriptors.length) {
        continue;
      }
      const kinds = new Set(matchingProperties.map((property) => property.kind));
      if (kinds.size !== 1) {
        continue;
      }

      const multi = buildMultiInspectorProperty(matchingProperties);
      if (multi) {
        properties.push(multi);
      }
    }

    if (properties.length > 0) {
      sections.push({
        id: baseSection.id,
        title: baseSection.title,
        sourceLevel: baseSection.sourceLevel,
        properties
      });
    }
  }

  return {
    selectionCount,
    elementKinds: dedupeStrings(descriptors.map((descriptor) => descriptor.elementKind)),
    sections
  };
}

function buildMultiInspectorProperty(properties: InspectorProperty[]): MultiInspectorProperty | null {
  const base = properties[0];
  if (!base) {
    return null;
  }

  if (base.kind === "number") {
    const sameKind = properties.every((property) => property.kind === "number");
    if (!sameKind) return null;
    const numberProperties = properties as Array<Extract<InspectorProperty, { kind: "number" }>>;

    return {
      kind: "number",
      id: base.id,
      label: base.label,
      value: numberProperties[0]?.value ?? 0,
      mixed: !numbersAreEqual(numberProperties.map((property) => property.value)),
      step: base.step,
      unit: base.unit,
      readOnlyReason: "Multi-element transform editing is not yet supported."
    };
  }

  if (base.kind === "color") {
    const sameKind = properties.every((property) => property.kind === "color");
    if (!sameKind) return null;
    const colorProperties = properties as Array<Extract<InspectorProperty, { kind: "color" }>>;
    const values = colorProperties.map((property) => property.value);
    const syntaxValues = colorProperties.map((property) => property.syntaxValue);
    const mixed = !allValuesEqual(values) || !allValuesEqual(syntaxValues);
    const writes = colorProperties.map((property) => property.write);

    return {
      kind: "color",
      id: base.id,
      label: base.label,
      value: mixed ? null : (values[0] ?? null),
      syntaxValue: mixed ? null : (syntaxValues[0] ?? null),
      mixed,
      options: dedupeStrings(colorProperties.flatMap((property) => property.options)),
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "lineWidth") {
    const sameKind = properties.every((property) => property.kind === "lineWidth");
    if (!sameKind) return null;
    const widthProperties = properties as Array<Extract<InspectorProperty, { kind: "lineWidth" }>>;
    const values = widthProperties.map((property) => property.value);
    const writes = widthProperties.map((property) => property.write);

    return {
      kind: "lineWidth",
      id: base.id,
      label: base.label,
      value: values[0] ?? 0,
      averageValue: averageNumbers(values),
      mixed: !numbersAreEqual(values),
      min: base.min,
      max: base.max,
      step: base.step,
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "dashStyle") {
    const sameKind = properties.every((property) => property.kind === "dashStyle");
    if (!sameKind) return null;
    const dashProperties = properties as Array<Extract<InspectorProperty, { kind: "dashStyle" }>>;
    const values = dashProperties.map((property) => property.value);
    const writes = dashProperties.map((property) => property.write);

    return {
      kind: "dashStyle",
      id: base.id,
      label: base.label,
      value: values[0] ?? "solid",
      mixed: !allValuesEqual(values),
      previewLineWidth: averageNumbers(dashProperties.map((property) => property.previewLineWidth)),
      options: base.options,
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "lineCap") {
    const sameKind = properties.every((property) => property.kind === "lineCap");
    if (!sameKind) return null;
    const lineCapProperties = properties as Array<Extract<InspectorProperty, { kind: "lineCap" }>>;
    const values = lineCapProperties.map((property) => property.value);
    const writes = lineCapProperties.map((property) => property.write);

    return {
      kind: "lineCap",
      id: base.id,
      label: base.label,
      value: values[0] ?? "butt",
      mixed: !allValuesEqual(values),
      previewLineWidth: averageNumbers(lineCapProperties.map((property) => property.previewLineWidth)),
      options: base.options,
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "lineJoin") {
    const sameKind = properties.every((property) => property.kind === "lineJoin");
    if (!sameKind) return null;
    const lineJoinProperties = properties as Array<Extract<InspectorProperty, { kind: "lineJoin" }>>;
    const values = lineJoinProperties.map((property) => property.value);
    const writes = lineJoinProperties.map((property) => property.write);

    return {
      kind: "lineJoin",
      id: base.id,
      label: base.label,
      value: values[0] ?? "miter",
      mixed: !allValuesEqual(values),
      previewLineWidth: averageNumbers(lineJoinProperties.map((property) => property.previewLineWidth)),
      options: base.options,
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "pathMorphingDecoration") {
    const sameKind = properties.every((property) => property.kind === "pathMorphingDecoration");
    if (!sameKind) return null;
    const pathMorphingProperties = properties as Array<Extract<InspectorProperty, { kind: "pathMorphingDecoration" }>>;
    const values = pathMorphingProperties.map((property) => property.value);
    const writes = pathMorphingProperties.map((property) => property.write);

    return {
      kind: "pathMorphingDecoration",
      id: base.id,
      label: base.label,
      value: values[0] ?? "none",
      mixed: !allValuesEqual(values),
      previewLineWidth: averageNumbers(pathMorphingProperties.map((property) => property.previewLineWidth)),
      options: base.options,
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  const sameKind = properties.every((property) => property.kind === "arrowTip");
  if (!sameKind) return null;
  const arrowProperties = properties as Array<Extract<InspectorProperty, { kind: "arrowTip" }>>;
  const values = arrowProperties.map((property) => property.value);
  const writes = arrowProperties.map((property) => property.write);

  return {
    kind: "arrowTip",
    id: base.id,
    label: base.label,
    side: base.side,
    value: values[0] ?? "none",
    mixed: !allValuesEqual(values),
    previewLineWidth: averageNumbers(arrowProperties.map((property) => property.previewLineWidth)),
    options: base.options,
    writes,
    readOnlyReason: deriveReadOnlyReason(writes)
  };
}

function deriveReadOnlyReason(
  writes: readonly Pick<SetPropertyWriteTarget, "writable" | "elementId" | "reason">[]
): string | undefined {
  if (writes.some((write) => write.writable && write.elementId.length > 0)) {
    return undefined;
  }

  const firstReason = writes.find((write) => (write.reason ?? "").trim().length > 0)?.reason;
  if (firstReason) {
    return firstReason;
  }

  return "This property is read-only for the current selection.";
}

function numbersAreEqual(values: readonly number[]): boolean {
  if (values.length <= 1) return true;
  const first = values[0] ?? 0;
  return values.every((value) => Math.abs(value - first) <= VALUE_EPSILON);
}

function averageNumbers(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total / values.length;
}

function allValuesEqual<T>(values: readonly T[]): boolean {
  if (values.length <= 1) return true;
  const first = values[0];
  return values.every((value) => value === first);
}

function lineWidthPresetLabelFromValue(value: number): string | null {
  for (const preset of LINE_WIDTH_PRESETS) {
    if (Math.abs(preset.value - value) <= LINE_WIDTH_PRESET_EPSILON) {
      return preset.label;
    }
  }
  return null;
}

function lineWidthValueLabel(value: LineWidthDropdownValue): string {
  if (value === LINE_WIDTH_MIXED_OPTION_VALUE) {
    return "Mixed";
  }
  if (value === LINE_WIDTH_CUSTOM_OPTION_VALUE) {
    return "Custom line width";
  }
  return LINE_WIDTH_PRESET_BY_LABEL.has(value) ? value : "Custom line width";
}

function lineWidthPreviewLineWidth(value: LineWidthDropdownValue, fallbackLineWidth: number): number {
  if (value === LINE_WIDTH_CUSTOM_OPTION_VALUE || value === LINE_WIDTH_MIXED_OPTION_VALUE) {
    return fallbackLineWidth;
  }
  return LINE_WIDTH_PRESET_BY_LABEL.get(value) ?? fallbackLineWidth;
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
}

function toDashStyleDropdownOptions(
  options: ReadonlyArray<{ value: Exclude<DashStylePresetId, "custom">; label: string }>
): Array<CustomDropdownOption<DashStyleDropdownValue>> {
  return options.map((option) => ({
    value: option.value,
    label: option.label
  }));
}

function dashStyleValueLabel(
  value: DashStyleDropdownValue,
  options: ReadonlyArray<{ value: Exclude<DashStylePresetId, "custom">; label: string }>
): string {
  if (value === DASH_STYLE_MIXED_OPTION_VALUE) {
    return "Mixed";
  }
  if (value === "custom") {
    return "Custom";
  }
  return options.find((option) => option.value === value)?.label ?? "Custom";
}

function isSelectableDashStyleValue(
  value: DashStyleDropdownValue
): value is Exclude<DashStylePresetId, "custom"> {
  return value !== "custom" && value !== DASH_STYLE_MIXED_OPTION_VALUE;
}

function dashStylePreviewPreset(value: DashStyleDropdownValue): Exclude<DashStylePresetId, "custom"> {
  if (value === DASH_STYLE_MIXED_OPTION_VALUE || value === "custom") {
    return "dashed";
  }
  return value;
}

function toLineCapDropdownOptions(
  options: ReadonlyArray<{ value: Exclude<LineCapPresetId, "custom">; label: string }>
): Array<CustomDropdownOption<LineCapDropdownValue>> {
  return options.map((option) => ({
    value: option.value,
    label: option.label
  }));
}

function lineCapValueLabel(
  value: LineCapDropdownValue,
  options: ReadonlyArray<{ value: Exclude<LineCapPresetId, "custom">; label: string }>
): string {
  if (value === LINE_CAP_MIXED_OPTION_VALUE) {
    return "Mixed";
  }
  if (value === "custom") {
    return "Custom";
  }
  return options.find((option) => option.value === value)?.label ?? "Custom";
}

function isSelectableLineCapValue(
  value: LineCapDropdownValue
): value is Exclude<LineCapPresetId, "custom"> {
  return value !== "custom" && value !== LINE_CAP_MIXED_OPTION_VALUE;
}

function lineCapPreviewPreset(value: LineCapDropdownValue): Exclude<LineCapPresetId, "custom"> {
  if (value === LINE_CAP_MIXED_OPTION_VALUE || value === "custom") {
    return "butt";
  }
  return value;
}

function toLineJoinDropdownOptions(
  options: ReadonlyArray<{ value: Exclude<LineJoinPresetId, "custom">; label: string }>
): Array<CustomDropdownOption<LineJoinDropdownValue>> {
  return options.map((option) => ({
    value: option.value,
    label: option.label
  }));
}

function lineJoinValueLabel(
  value: LineJoinDropdownValue,
  options: ReadonlyArray<{ value: Exclude<LineJoinPresetId, "custom">; label: string }>
): string {
  if (value === LINE_JOIN_MIXED_OPTION_VALUE) {
    return "Mixed";
  }
  if (value === "custom") {
    return "Custom";
  }
  return options.find((option) => option.value === value)?.label ?? "Custom";
}

function isSelectableLineJoinValue(
  value: LineJoinDropdownValue
): value is Exclude<LineJoinPresetId, "custom"> {
  return value !== "custom" && value !== LINE_JOIN_MIXED_OPTION_VALUE;
}

function lineJoinPreviewPreset(value: LineJoinDropdownValue): Exclude<LineJoinPresetId, "custom"> {
  if (value === LINE_JOIN_MIXED_OPTION_VALUE || value === "custom") {
    return "miter";
  }
  return value;
}

function toPathMorphingDecorationDropdownOptions(
  options: ReadonlyArray<{ value: Exclude<PathMorphingDecorationPresetId, "custom">; label: string }>
): Array<CustomDropdownOption<PathMorphingDecorationDropdownValue>> {
  return options.map((option) => ({
    value: option.value,
    label: option.label
  }));
}

function pathMorphingDecorationValueLabel(
  value: PathMorphingDecorationDropdownValue,
  options: ReadonlyArray<{ value: Exclude<PathMorphingDecorationPresetId, "custom">; label: string }>
): string {
  if (value === PATH_MORPHING_DECORATION_MIXED_OPTION_VALUE) {
    return "Mixed";
  }
  if (value === "custom") {
    return "Custom";
  }
  return options.find((option) => option.value === value)?.label ?? "Custom";
}

function isSelectablePathMorphingDecorationValue(
  value: PathMorphingDecorationDropdownValue
): value is Exclude<PathMorphingDecorationPresetId, "custom"> {
  return value !== "custom" && value !== PATH_MORPHING_DECORATION_MIXED_OPTION_VALUE;
}

function pathMorphingDecorationPreviewPreset(
  value: PathMorphingDecorationDropdownValue
): Exclude<PathMorphingDecorationPresetId, "custom"> {
  if (value === PATH_MORPHING_DECORATION_MIXED_OPTION_VALUE || value === "custom") {
    return "zigzag";
  }
  return value;
}

function toArrowTipDropdownOptions(
  options: ReadonlyArray<{ value: Exclude<ArrowTipPresetId, "custom">; label: string }>
): Array<CustomDropdownOption<ArrowTipDropdownValue>> {
  return options.map((option) => ({
    value: option.value,
    label: option.label
  }));
}

function arrowTipValueLabel(
  value: ArrowTipDropdownValue,
  options: ReadonlyArray<{ value: Exclude<ArrowTipPresetId, "custom">; label: string }>
): string {
  if (value === ARROW_TIP_MIXED_OPTION_VALUE) {
    return "Mixed";
  }
  if (value === "custom") {
    return "Custom";
  }
  return options.find((option) => option.value === value)?.label ?? "Custom";
}

function isSelectableArrowTipValue(
  value: ArrowTipDropdownValue
): value is Exclude<ArrowTipPresetId, "custom"> {
  return value !== "custom" && value !== ARROW_TIP_MIXED_OPTION_VALUE;
}

function arrowTipPreviewPreset(value: ArrowTipDropdownValue): Exclude<ArrowTipPresetId, "custom"> {
  if (value === ARROW_TIP_MIXED_OPTION_VALUE || value === "custom") {
    return "arrow";
  }
  return value;
}

function LineWidthPreview({ lineWidth }: { lineWidth: number }) {
  const strokeWidth = Math.max(1, Math.min(12, lineWidth * 2));
  return (
    <svg className={css.lineWidthSvg} viewBox="0 0 56 16" aria-hidden="true" focusable="false">
      <line x1={4} y1={8} x2={52} y2={8} className={css.lineWidthSvgLine} style={{ strokeWidth }} />
    </svg>
  );
}

function DashStylePreview({
  preset,
  lineWidth
}: {
  preset: Exclude<DashStylePresetId, "custom">;
  lineWidth: number;
}) {
  const dashArray = dashStyleDashArrayForPreview(preset, lineWidth);
  const strokeWidth = Math.max(1, Math.min(3.2, lineWidth * 1.4));
  return (
    <svg className={css.dashStyleSvg} viewBox="0 0 56 16" aria-hidden="true" focusable="false">
      <line
        x1={4}
        y1={8}
        x2={52}
        y2={8}
        className={css.dashStyleSvgLine}
        style={dashArray ? { strokeDasharray: dashArray, strokeWidth } : { strokeWidth }}
      />
    </svg>
  );
}

function dashStyleDashArrayForPreview(
  preset: Exclude<DashStylePresetId, "custom">,
  lineWidth: number
): string | undefined {
  if (preset === "solid") {
    return undefined;
  }
  if (preset === "dashed") {
    return "3 3";
  }
  if (preset === "densely dashed") {
    return "4 2";
  }
  if (preset === "loosely dashed") {
    return "6 4";
  }
  if (preset === "dotted") {
    return `${formatNumber(lineWidth)} 2`;
  }
  if (preset === "densely dotted") {
    return `${formatNumber(lineWidth)} 1`;
  }
  return `${formatNumber(lineWidth)} 4`;
}

function LineCapPreview({
  preset,
  lineWidth: _lineWidth
}: {
  preset: Exclude<LineCapPresetId, "custom">;
  lineWidth: number;
}) {
  const strokeWidth = 8;
  const baseStart = 18;
  const baseEnd = 46;
  const y = 10;
  return (
    <svg className={css.lineCapSvg} viewBox="0 0 64 20" aria-hidden="true" focusable="false">
      <line x1={baseStart} y1={2} x2={baseStart} y2={18} className={css.lineCapSvgGuide} />
      <line x1={baseEnd} y1={2} x2={baseEnd} y2={18} className={css.lineCapSvgGuide} />
      <line
        x1={baseStart}
        y1={y}
        x2={baseEnd}
        y2={y}
        className={css.lineCapSvgLine}
        style={{ strokeLinecap: preset, strokeWidth }}
      />
      <line x1={baseStart} y1={y} x2={baseEnd} y2={y} className={css.lineCapSvgCenter} />
    </svg>
  );
}

function LineJoinPreview({
  preset,
  lineWidth: _lineWidth
}: {
  preset: Exclude<LineJoinPresetId, "custom">;
  lineWidth: number;
}) {
  const strokeWidth = 8;
  const points = "8,16 24,4 40,16 56,4";
  return (
    <svg className={css.lineJoinSvg} viewBox="0 0 64 20" aria-hidden="true" focusable="false">
      <polyline
        points={points}
        className={css.lineJoinSvgLine}
        style={{ strokeLinejoin: preset, strokeWidth, strokeMiterlimit: 10 }}
      />
      <polyline points={points} className={css.lineJoinSvgCenter} />
    </svg>
  );
}

function PathMorphingDecorationPreview({
  preset,
  lineWidth
}: {
  preset: Exclude<PathMorphingDecorationPresetId, "custom">;
  lineWidth: number;
}) {
  const svgMarkup = renderPathMorphingDecorationPreviewSvg(preset, lineWidth);
  return (
    <span
      className={css.pathMorphingDecorationSvg}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
}

function ArrowTipPreview({
  side,
  preset,
  lineWidth
}: {
  side: ArrowTipSide;
  preset: Exclude<ArrowTipPresetId, "custom">;
  lineWidth: number;
}) {
  const y = 8;
  const lineMin = 4;
  const lineMax = 52;
  const strokeWidth = Math.max(1, Math.min(3.2, lineWidth * 1.4));
  const tipScale = 2.35;
  const tipKind = arrowTipKindForPreview(preset);
  const marker = tipKind ? makeDefaultArrowMarker(tipKind, lineWidth) : null;
  const tip = marker?.tips[0] ?? null;
  const preview = tip ? renderArrowTipPreviewPaths(tip, lineWidth, "currentColor", { anchor: "back" }) : null;
  const previewPaths = preview?.paths ?? [];
  const directionScale = side === "start" ? -1 : 1;
  const rawForwardExtentPx = preview ? Math.max(0, preview.xBounds.max * tipScale) : 0;
  const maxForwardExtentPx = Math.max(0, lineMax - lineMin - 10);
  const forwardExtentPx = Math.min(rawForwardExtentPx, maxForwardExtentPx);
  const tipX = side === "start" ? lineMin + forwardExtentPx : lineMax - forwardExtentPx;
  const shaftStart = side === "start" ? tipX : lineMin;
  const shaftEnd = side === "start" ? lineMax : tipX;

  return (
    <svg className={css.arrowTipSvg} viewBox="0 0 56 16" aria-hidden="true" focusable="false">
      <line
        x1={shaftStart}
        y1={y}
        x2={shaftEnd}
        y2={y}
        className={css.arrowTipSvgLine}
        style={{ strokeWidth }}
      />
      {previewPaths.length > 0 ? (
        <g transform={`translate(${tipX} ${y}) scale(${directionScale * tipScale} ${-tipScale})`}>
          {previewPaths.map((path, index) => (
            <path
              // preview path order is deterministic from core arrow shape generation
              key={`${preset}:${index}`}
              d={path.d}
              stroke={path.stroke}
              fill={path.fill}
              strokeWidth={path.strokeWidth}
              strokeLinecap={path.lineCap}
              strokeLinejoin={path.lineJoin}
            />
          ))}
        </g>
      ) : null}
    </svg>
  );
}

function arrowTipKindForPreview(preset: Exclude<ArrowTipPresetId, "custom">): ArrowTipKind | null {
  if (preset === "none") {
    return null;
  }
  if (preset === "arrow") {
    return "cm-rightarrow";
  }
  if (preset === "stealth") {
    return "stealth";
  }
  if (preset === "latex") {
    return "latex";
  }
  if (preset === "triangle") {
    return "triangle";
  }
  if (preset === "circle") {
    return "circle";
  }
  if (preset === "square") {
    return "square";
  }
  if (preset === "kite") {
    return "kite";
  }
  if (preset === "bar") {
    return "bar";
  }
  return "hooks";
}
