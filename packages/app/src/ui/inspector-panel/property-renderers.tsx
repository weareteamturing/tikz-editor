import type { JSX } from "react";
import { formatNumber } from "tikz-editor/edit/format";
import type { InspectorProperty } from "tikz-editor/edit/inspector";
import { ColorPickerField } from "../ColorPicker";
import { CustomDropdown } from "../CustomDropdown";
import css from "../InspectorPanel.module.css";
import { getInspectorPropertyCapabilityStatus } from "../capabilities";
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
  NODE_SHAPE_MIXED_OPTION_VALUE,
  PATH_MORPHING_DECORATION_MIXED_OPTION_VALUE,
  SHADOW_PRESET_MIXED_OPTION_VALUE,
  LineWidthPreview,
  clampNumber,
  isPathMorphingSuboptionPropertyId,
  lineWidthPresetLabelFromValue,
  lineWidthPreviewLineWidth,
  lineWidthValueLabel,
  type ArrowTipDropdownValue,
  type DashStyleDropdownValue,
  type FillModeDropdownValue,
  type FillPatternDropdownValue,
  type FillShadingDropdownValue,
  type LineCapDropdownValue,
  type LineJoinDropdownValue,
  type LineWidthDropdownValue,
  type MultiInspectorProperty,
  type NodeShapeDropdownValue,
  type PathMorphingDecorationDropdownValue
} from "./panel-helpers";
import {
  renderArrowTipDropdown,
  renderDashStyleDropdown,
  renderFillModeDropdown,
  renderFillPatternDropdown,
  renderFillShadingDropdown,
  renderLineCapDropdown,
  renderLineJoinDropdown,
  renderNodeShapeDropdown,
  renderPathMorphingDecorationDropdown,
  renderShadowPresetDropdown
} from "./property-dropdowns";

type RenderPropertyApi = any;

export function renderSingleInspectorProperty(property: InspectorProperty, api: RenderPropertyApi) {
  const {
    renderedSinglePropertyProvenance,
    implicitDefaultProvenance,
    withValueProvenanceClass,
    renderSingleTextField,
    renderSingleNumberField,
    renderScrubbableNumberLabel,
    applySingleLengthValue,
    maybeWrapWithProvenanceTooltip,
    commitAfterHoverPreview,
    applyNodeShapeValue,
    applyHoverPreview,
    clearHoverPreviewSession,
    renderNodeFontToolbar,
    applyNodeFontValue,
    normalizeColorSetPropertyChange,
    applySetProperty,
    projectNamedColorSwatches,
    applyFillModeValue,
    setFillAdvancedOptionsOpen,
    applyFillShadingValue,
    applyFillPatternValue,
    applySingleFillPatternOptionValue,
    manualLineWidthCustomKeys,
    enableManualCustomLineWidth,
    disableManualCustomLineWidth,
    applyDashStyleValue,
    applyLineCapValue,
    applyLineJoinValue,
    applyPathMorphingDecorationValue,
    applyRoundedCornersValue,
    applyArrowTipValue,
    applyShadowPropertyValue,
    applyShadowPresetValue
  } = api;
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
            onPreview: (next: number) => applySingleLengthValue(property, next, { recordInHistory: false }),
            onCommit: (next: number) => applySingleLengthValue(property, next)
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
              (nextFamily: any) =>
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
              (nextSizePreset: any) =>
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
              (nextSizePreset: any) =>
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
                if (property.write.shadowContext) {
                  applyShadowPropertyValue(property.write, property.id, nextValue);
                  return;
                }
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
            onPreview: (next: number) => applySingleFillPatternOptionValue(property, next, { recordInHistory: false }),
            onCommit: (next: number) => applySingleFillPatternOptionValue(property, next)
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
                  event.currentTarget.checked ? sliderValue : defaultRadius,
                  property.disableRequiresSharpCorners
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

    if (property.kind === "shadowPreset") {
      const writable = property.write.writable && capability.status !== "unsupported";
      return (
        <div key={property.id} className={propertyClassName}>
          <div className={css.propertyLabel}>{property.label}</div>
          {maybeWrapWithProvenanceTooltip(
            provenance,
            renderShadowPresetDropdown(
              {
                label: property.label,
                value: property.value,
                options: property.options
              },
              writable,
              (nextValue) => applyShadowPresetValue(property.write, property.context, nextValue),
              undefined,
              valueClassName
            ),
            true
          )}
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


export function renderMultiInspectorProperty(property: MultiInspectorProperty, api: RenderPropertyApi) {
  const {
    renderedMultiPropertyProvenance,
    implicitDefaultProvenance,
    withValueProvenanceClass,
    renderMultiNumberField,
    renderScrubbableNumberLabel,
    applyMultiLengthValue,
    maybeWrapWithProvenanceTooltip,
    commitAfterHoverPreview,
    applyNodeShapeValueMany,
    applyHoverPreview,
    clearHoverPreviewSession,
    renderNodeFontToolbar,
    applyNodeFontValueMany,
    normalizeColorSetPropertyChange,
    applySetPropertyMany,
    projectNamedColorSwatches,
    applyFillModeValueMany,
    setFillAdvancedOptionsOpen,
    applyFillShadingValueMany,
    applyFillPatternValueMany,
    applyMultiFillPatternOptionValue,
    manualLineWidthCustomKeys,
    enableManualCustomLineWidth,
    disableManualCustomLineWidth,
    applyDashStyleValueMany,
    applyLineCapValueMany,
    applyLineJoinValueMany,
    applyPathMorphingDecorationValueMany,
    applyRoundedCornersValueMany,
    applyArrowTipValueMany,
    applyShadowPresetValue
  } = api;
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
            onPreview: (next: number) => applyMultiLengthValue(property, next, { recordInHistory: false }),
            onCommit: (next: number) => applyMultiLengthValue(property, next)
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
            (nextFamily: any) =>
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
            (nextSizePreset: any) =>
              commitAfterHoverPreview(previewOwnerKey, () =>
                applyNodeFontValueMany(property.writes, property.contexts, {
                  sizePreset: nextSizePreset
                })
              ),
            valueClassName,
            (nextSizePreset: any) =>
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
            onPreview: (next: number) => applyMultiFillPatternOptionValue(property, next, { recordInHistory: false }),
            onCommit: (next: number) => applyMultiFillPatternOptionValue(property, next)
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
                  event.currentTarget.checked ? sliderValue : defaultRadius,
                  property.disableRequiresSharpCorners
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

  if (property.kind === "arrowTip") {
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

  if (property.kind === "shadowPreset") {
    const writable = property.writes.some((write) => write.writable && write.elementId.length > 0);
    const dropdownValue = property.mixed ? SHADOW_PRESET_MIXED_OPTION_VALUE : property.value;
    return (
      <div key={property.id} className={propertyClassName}>
        <div className={css.propertyLabel}>{property.label}</div>
        {maybeWrapWithProvenanceTooltip(
          provenance,
          renderShadowPresetDropdown(
            {
              label: property.label,
              value: property.value,
              options: property.options
            },
            writable,
            (nextValue) => {
              for (let i = 0; i < property.writes.length; i++) {
                const write = property.writes[i];
                const context = property.contexts[i];
                if (write && context) {
                  applyShadowPresetValue(write, context, nextValue);
                }
              }
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

  return null;
}
