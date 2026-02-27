import { useMemo, useState } from "react";
import { formatNumber } from "tikz-editor/edit/format";
import {
  getInspectorDescriptor,
  LINE_WIDTH_PRESETS,
  type ArrowDirectionPreset,
  type InspectorDescriptor,
  type InspectorProperty,
  type SetPropertyWriteTarget
} from "tikz-editor/edit/inspector";
import type { SceneElement } from "tikz-editor/semantic/types";
import { useEditorStore } from "../store/store";
import { getInspectorPropertyCapabilityStatus } from "./capabilities";
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

type MultiInspectorArrowTipProperty = {
  kind: "arrowTip";
  id: string;
  label: string;
  value: ArrowDirectionPreset;
  mixed: boolean;
  options: Array<{ value: ArrowDirectionPreset; label: string; preview: string }>;
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

type MultiInspectorProperty =
  | MultiInspectorNumberProperty
  | MultiInspectorColorProperty
  | MultiInspectorLineWidthProperty
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
type LineWidthDropdownValue = string;
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
      const selected = property.value ?? "none";
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          <div className={css.controlRow}>
            <span
              className={css.swatch}
              style={{
                background: selected === "none" ? "transparent" : selected,
                borderStyle: selected === "none" ? "dashed" : "solid"
              }}
            />
            <select
              className={css.select}
              value={selected}
              disabled={!writable}
              onChange={(event) => applySetProperty(property.write, event.currentTarget.value)}
            >
              {property.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
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
            renderOption={(option) => {
              if (option.value === LINE_WIDTH_CUSTOM_OPTION_VALUE) {
                return <span className={css.lineWidthCustomOption}>{option.label}</span>;
              }
              const previewValue = LINE_WIDTH_PRESET_BY_LABEL.get(option.value) ?? property.value;
              return (
                <span className={css.lineWidthOption}>
                  <span className={css.lineWidthOptionLabel}>{option.label}</span>
                  <span className={css.lineWidthOptionRail}>
                    <span
                      className={css.lineWidthOptionStroke}
                      style={{ height: `${Math.max(1, Math.min(12, previewValue * 2))}px` }}
                    />
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
          <div className={css.linePreviewRow}>
            <span className={css.linePreviewRail}>
              <span
                className={css.linePreviewStroke}
                style={{ height: `${Math.max(1, Math.min(12, property.value * 2))}px` }}
              />
            </span>
            <span className={css.valueLabel}>
              {formatNumber(property.value)}pt{property.presetLabel ? ` (${property.presetLabel})` : ""}
            </span>
          </div>
          {readOnlyReason ? <div className={css.propertyNote}>{readOnlyReason}</div> : null}
        </div>
      );
    }

    return (
      <div key={property.id} className={css.property}>
        <div className={css.propertyLabel}>{property.label}</div>
        <div className={css.arrowGrid}>
          {property.options.map((option) => (
            <button
              key={option.value}
              className={`${css.arrowBtn} ${property.value === option.value ? css.arrowBtnActive : ""}`}
              disabled={!(property.write.writable && capability.status !== "unsupported")}
              onClick={() => applySetProperty(property.write, option.value)}
              title={option.label}
            >
              <span className={css.arrowPreview}>{option.preview}</span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
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
      const selected = property.mixed ? "" : (property.value ?? "none");
      return (
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          <div className={css.controlRow}>
            <span
              className={css.swatch}
              style={{
                background: selected === "none" || selected.length === 0 ? "transparent" : selected,
                borderStyle: selected === "none" || selected.length === 0 ? "dashed" : "solid"
              }}
            />
            <select
              className={css.select}
              value={selected}
              disabled={!writable}
              onChange={(event) => {
                const next = event.currentTarget.value;
                if (next.length === 0) return;
                applySetPropertyMany(property.writes, next);
              }}
            >
              <option value=""> </option>
              {property.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
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
      const presetLabel = property.mixed ? null : lineWidthPresetLabelFromValue(property.value);
      const showCustomRange =
        manualLineWidthCustomKeys.has(lineWidthKey) || (!property.mixed && presetLabel == null);
      const dropdownValue: LineWidthDropdownValue = showCustomRange
        ? LINE_WIDTH_CUSTOM_OPTION_VALUE
        : property.mixed
          ? LINE_WIDTH_MIXED_OPTION_VALUE
          : (presetLabel ?? LINE_WIDTH_CUSTOM_OPTION_VALUE);
      const sliderValue = property.mixed ? property.averageValue : property.value;
      const summaryLabel = property.mixed
        ? "Mixed values"
        : `${formatNumber(property.value)}pt${presetLabel ? ` (${presetLabel})` : ""}`;
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
            renderValue={(option) => {
              if (property.mixed && !showCustomRange) {
                return "Mixed";
              }
              return option?.label ?? "";
            }}
            renderOption={(option) => {
              if (option.value === LINE_WIDTH_CUSTOM_OPTION_VALUE) {
                return <span className={css.lineWidthCustomOption}>{option.label}</span>;
              }
              const previewValue = LINE_WIDTH_PRESET_BY_LABEL.get(option.value) ?? property.value;
              return (
                <span className={css.lineWidthOption}>
                  <span className={css.lineWidthOptionLabel}>{option.label}</span>
                  <span className={css.lineWidthOptionRail}>
                    <span
                      className={css.lineWidthOptionStroke}
                      style={{ height: `${Math.max(1, Math.min(12, previewValue * 2))}px` }}
                    />
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
              <div className={css.linePreviewRow}>
                <span className={css.linePreviewRail}>
                  <span
                    className={css.linePreviewStroke}
                    style={{ height: `${Math.max(1, Math.min(12, sliderValue * 2))}px` }}
                  />
                </span>
                <span className={css.valueLabel}>{formatNumber(sliderValue)}pt</span>
              </div>
            </>
          ) : (
            <div className={css.valueLabel}>{summaryLabel}</div>
          )}
          {property.readOnlyReason ? <div className={css.propertyNote}>{property.readOnlyReason}</div> : null}
        </div>
      );
    }

    const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
    const selected = property.mixed ? "" : property.value;
    return (
      <div key={property.id} className={css.property}>
        <div className={css.propertyLabel}>{property.label}</div>
        <select
          className={css.select}
          value={selected}
          disabled={!writable}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (next.length === 0) return;
            applySetPropertyMany(property.writes, next);
          }}
        >
          <option value=""> </option>
          {property.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.preview} {option.label}
            </option>
          ))}
        </select>
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

    const properties: MultiInspectorProperty[] = [];
    for (const baseProperty of baseSection.properties) {
      const matchingProperties = matchingSections
        .map((section) => section.properties.find((property) => property.id === baseProperty.id))
        .filter((property): property is InspectorProperty => property != null);
      if (matchingProperties.length !== descriptors.length) {
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
    const mixed = !allValuesEqual(values);
    const writes = colorProperties.map((property) => property.write);

    return {
      kind: "color",
      id: base.id,
      label: base.label,
      value: mixed ? null : (values[0] ?? null),
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

  const sameKind = properties.every((property) => property.kind === "arrowTip");
  if (!sameKind) return null;
  const arrowProperties = properties as Array<Extract<InspectorProperty, { kind: "arrowTip" }>>;
  const values = arrowProperties.map((property) => property.value);
  const writes = arrowProperties.map((property) => property.write);

  return {
    kind: "arrowTip",
    id: base.id,
    label: base.label,
    value: values[0] ?? "-",
    mixed: !allValuesEqual(values),
    options: base.options,
    writes,
    readOnlyReason: deriveReadOnlyReason(writes)
  };
}

function deriveReadOnlyReason(writes: readonly SetPropertyWriteTarget[]): string | undefined {
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
