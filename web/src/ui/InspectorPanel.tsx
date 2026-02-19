import { useMemo } from "react";
import { formatNumber } from "tikz-editor/edit/format";
import { getInspectorDescriptor, type InspectorProperty, type SetPropertyWriteTarget } from "tikz-editor/edit/inspector";
import { useEditorStore } from "../store/store";
import css from "./InspectorPanel.module.css";

export function InspectorPanel() {
  const selectedIds = useEditorStore((s) => s.selectedElementIds);
  const snapshot = useEditorStore((s) => s.snapshot);
  const dispatch = useEditorStore((s) => s.dispatch);

  const selectedElements = snapshot.scene?.elements.filter((el) =>
    selectedIds.has(el.sourceId)
  ) ?? [];

  const descriptor = useMemo(() => {
    if (selectedElements.length !== 1) return null;
    return getInspectorDescriptor(selectedElements[0], {
      source: snapshot.source,
      editHandles: snapshot.editHandles
    });
  }, [selectedElements, snapshot.source, snapshot.editHandles]);

  function applySetProperty(write: SetPropertyWriteTarget, value: string): void {
    if (!write.writable || write.elementId.length === 0) return;
    dispatch({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "setProperty",
        elementId: write.elementId,
        level: write.level,
        key: write.key,
        value
      }
    });
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

  function propertyReadOnlyReason(property: InspectorProperty): string | null {
    if (property.kind === "number") {
      return property.readOnlyReason ?? property.write?.reason ?? null;
    }
    return property.write.reason ?? null;
  }

  function renderProperty(property: InspectorProperty) {
    const readOnlyReason = propertyReadOnlyReason(property);

    if (property.kind === "number") {
      const writable = property.write?.writable ?? false;
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
              disabled={!property.write.writable}
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
      return (
        <div key={property.id} className={css.property}>
          <div className={css.propertyLabel}>{property.label}</div>
          <input
            className={css.rangeInput}
            type="range"
            min={property.min}
            max={property.max}
            step={property.step}
            value={property.value}
            disabled={!property.write.writable}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (!Number.isFinite(next)) return;
              applySetProperty(property.write, `${formatNumber(next)}pt`);
            }}
          />
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
              disabled={!property.write.writable}
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

  return (
    <div className={css.panel}>
      <div className={css.header}>Inspector</div>
      <div className={css.content}>
        {selectedElements.length === 0 ? (
          <p className={css.hint}>Select an element on the canvas to inspect its properties.</p>
        ) : selectedElements.length > 1 ? (
          <p className={css.hint}>Select a single element to edit properties in Phase 2.</p>
        ) : !descriptor ? (
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
        )}
      </div>
    </div>
  );
}
