import { useMemo, useState, type Dispatch, type JSX, type SetStateAction } from "react";
import {
  buildDashStyleSetPropertyMutation,
  buildFillModeSetPropertyMutations,
  buildFillPatternSetPropertyMutation,
  buildFillShadingSetPropertyMutations,
  buildLineCapSetPropertyMutation,
  buildLineJoinSetPropertyMutation,
  buildNodeInnerSepSetPropertyMutation,
  buildNodeShapeSetPropertyMutation,
  buildRoundedCornersSetPropertyMutation,
  buildTransformSetPropertyMutations,
  type InspectorProperty,
  type SetPropertyWriteTarget
} from "tikz-editor/edit/inspector";
import {
  areStylesCascadeModelsIdentical,
  buildSharedStylesCascadeModel,
  buildStylesCascadeModel,
  planStylesSetPropertyActions,
  type StylesCascadeDeclaration,
  type StylesCascadeModel,
  type StylesCascadeSection,
  type StylesEditablePropertyCatalogEntry
} from "tikz-editor/edit/styles-cascade";
import type { SceneElement } from "tikz-editor/semantic/types";
import { getSharedEditAnalysisView } from "../edit-analysis-manager";
import { useProjectNamedColorSwatches } from "../project-named-colors";
import { useEditorStore } from "../store/store";
import { getInspectorPropertyCapabilityStatus } from "./capabilities";
import { ColorPickerField } from "./ColorPicker";
import { CustomDropdown, type CustomDropdownItem } from "./CustomDropdown";
import { SidePanel } from "./SidePanel";
import css from "./StylesPanel.module.css";

export function StylesPanel() {
  const selectedIds = useEditorStore((s) => s.selectedElementIds);
  const activeDocumentId = useEditorStore((s) => s.activeDocumentId);
  const activeFigureId = useEditorStore((s) => s.activeFigureId);
  const snapshot = useEditorStore((s) => s.snapshot);
  const source = useEditorStore((s) => s.source);
  const sourceRevision = useEditorStore((s) => s.sourceRevision);
  const dispatch = useEditorStore((s) => s.dispatch);
  const [pendingAddBySection, setPendingAddBySection] = useState<Record<string, string>>({});

  const selectedSourceIds = useMemo(() => [...selectedIds], [selectedIds]);
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

  const models = useMemo(
    () =>
      selectedElements.map((element) =>
        buildStylesCascadeModel(element, {
          source: snapshot.source,
          editHandles: snapshot.editHandles,
          parseOptions
        })
      ),
    [parseOptions, selectedElements, snapshot.editHandles, snapshot.source]
  );
  const model = useMemo<StylesCascadeModel | null>(() => {
    if (models.length === 0) {
      return null;
    }
    if (models.length === 1) {
      return models[0] ?? null;
    }
    return buildSharedStylesCascadeModel(models);
  }, [models]);
  const projectNamedColorSwatches = useProjectNamedColorSwatches(source);

  function dispatchActions(actions: ReturnType<typeof planStylesSetPropertyActions>): void {
    const mergeKey = `styles:${Date.now().toString(36)}`;
    for (const action of actions) {
      dispatch({ type: "APPLY_EDIT_ACTION", historyMergeKey: mergeKey, action });
    }
  }

  function applySimpleMutation(writeTargets: readonly SetPropertyWriteTarget[], key: string, value: string, clearKeys?: string[]): void {
    dispatchActions(planStylesSetPropertyActions(writeTargets, { key, value, clearKeys }));
  }

  function applyPropertyChange(declaration: StylesCascadeDeclaration, property: InspectorProperty, nextValue: string | number | boolean): void {
    const writeTargets = declaration.writeTargets;
    if (writeTargets.length === 0) {
      return;
    }

    switch (property.kind) {
      case "color":
        applySimpleMutation(writeTargets, property.write.key, String(nextValue));
        return;
      case "number": {
        const writes = property.write ? writeTargets.map((target) => ({ ...target, key: property.write!.key, transformContext: property.write!.transformContext })) : [];
        if (property.write?.transformContext) {
          const mutations = buildTransformSetPropertyMutations(property.write.transformContext.values, property.write.transformContext.key, Number(nextValue));
          for (const mutation of mutations) {
            dispatchActions(planStylesSetPropertyActions(writes, mutation));
          }
          return;
        }
        const key = property.write?.key ?? "";
        if (key.length > 0) {
          applySimpleMutation(writeTargets, key, String(nextValue), property.clearKeys);
        }
        return;
      }
      case "length":
        if (property.id === "node-inner-sep") {
          const mutation = buildNodeInnerSepSetPropertyMutation(Number(nextValue));
          applySimpleMutation(writeTargets, mutation.key, mutation.value, mutation.clearKeys);
          return;
        }
        applySimpleMutation(writeTargets, property.write.key, `${nextValue}${property.unit}`);
        return;
      case "lineWidth":
        applySimpleMutation(writeTargets, property.write.key, `${nextValue}pt`);
        return;
      case "dashStyle": {
        const mutation = buildDashStyleSetPropertyMutation(String(nextValue) as Exclude<typeof property.value, "custom">);
        applySimpleMutation(writeTargets, mutation.key, mutation.value, mutation.clearKeys);
        return;
      }
      case "lineCap": {
        const mutation = buildLineCapSetPropertyMutation(String(nextValue) as Exclude<typeof property.value, "custom">);
        applySimpleMutation(writeTargets, mutation.key, mutation.value, mutation.clearKeys);
        return;
      }
      case "lineJoin": {
        const mutation = buildLineJoinSetPropertyMutation(String(nextValue) as Exclude<typeof property.value, "custom">);
        applySimpleMutation(writeTargets, mutation.key, mutation.value, mutation.clearKeys);
        return;
      }
      case "fillMode": {
        const mutations = buildFillModeSetPropertyMutations(String(nextValue) as Exclude<typeof property.value, "custom">, property.context);
        for (const mutation of mutations) {
          applySimpleMutation(writeTargets, mutation.key, mutation.value, mutation.clearKeys);
        }
        return;
      }
      case "fillShading": {
        const mutations = buildFillShadingSetPropertyMutations(String(nextValue) as Exclude<typeof property.value, "custom">);
        for (const mutation of mutations) {
          applySimpleMutation(writeTargets, mutation.key, mutation.value, mutation.clearKeys);
        }
        return;
      }
      case "fillPattern": {
        const mutation = buildFillPatternSetPropertyMutation(String(nextValue) as Exclude<typeof property.value, "custom">);
        applySimpleMutation(writeTargets, mutation.key, mutation.value, mutation.clearKeys);
        return;
      }
      case "roundedCorners": {
        const mutation = buildRoundedCornersSetPropertyMutation(Boolean(nextValue), property.radius);
        applySimpleMutation(writeTargets, mutation.key, mutation.value, mutation.clearKeys);
        return;
      }
      case "nodeShape": {
        const mutation = buildNodeShapeSetPropertyMutation(String(nextValue) as Exclude<typeof property.value, "custom">);
        applySimpleMutation(writeTargets, mutation.key, mutation.value, mutation.clearKeys);
        return;
      }
      default:
        return;
    }
  }

  function addProperty(section: StylesCascadeSection, propertyId: string): void {
    if (section.declarations.some((declaration) => declaration.propertyId === propertyId)) {
      setPendingAddBySection((current) => ({ ...current, [section.id]: "" }));
      return;
    }
    const template = section.addPropertyTemplates[propertyId];
    if (!template) {
      return;
    }
    const declaration: StylesCascadeDeclaration = {
      id: `pending:${propertyId}`,
      propertyId,
      label: template.label,
      cssValue: "",
      status: "active",
      property: template,
      writeTargets: section.writeTargets,
      sourceText: template.label
    };
    switch (template.kind) {
      case "color":
        applyPropertyChange(declaration, template, template.syntaxValue ?? template.value ?? "black");
        break;
      case "number":
      case "length":
      case "lineWidth":
        applyPropertyChange(declaration, template, template.value);
        break;
      case "dashStyle":
      case "lineCap":
      case "lineJoin":
      case "fillMode":
      case "fillShading":
      case "fillPattern":
      case "nodeShape":
        applyPropertyChange(declaration, template, template.value);
        break;
      case "roundedCorners":
        applyPropertyChange(declaration, template, template.enabled);
        break;
      default:
        break;
    }
    setPendingAddBySection((current) => ({ ...current, [section.id]: "" }));
  }

  if (selectedSourceIds.length === 0) {
    return (
      <SidePanel className={css.panel}>
        <SidePanel.Content>
          <p className={css.hint}>Select an element to inspect its style cascade.</p>
        </SidePanel.Content>
      </SidePanel>
    );
  }

  if (selectedSourceIds.length > 1 && !areStylesCascadeModelsIdentical(models)) {
    return (
      <SidePanel className={css.panel}>
        <SidePanel.Content>
          <p className={css.hint}>Styles are available for a single element, or for multiple selected elements with identical cascades.</p>
        </SidePanel.Content>
      </SidePanel>
    );
  }

  if (!model) {
    return (
      <SidePanel className={css.panel}>
        <SidePanel.Content>
          <p className={css.hint}>Styles data is unavailable for the current selection.</p>
        </SidePanel.Content>
      </SidePanel>
    );
  }

  return (
    <SidePanel className={css.panel}>
      <SidePanel.Header>
        {model.elementIds.length > 1 ? `${model.elementIds.length} selected (matching styles)` : model.elementKind}
      </SidePanel.Header>
      <SidePanel.Content className={css.content}>
        {model.sections.map((section) => (
          <SidePanel.Section key={section.id}>
            <SidePanel.SectionHeader>
              <div className={css.sectionTitleWrap}>
                <div className={css.sectionTitle}>{section.title}</div>
                {section.subtitle ? <div className={css.sectionMeta}>{section.subtitle}</div> : null}
              </div>
              {section.sourceLocation ? <div className={css.sectionLocation}>{section.sourceLocation}</div> : null}
            </SidePanel.SectionHeader>
            <SidePanel.SectionBody className={css.ruleBody}>
              {section.declarations.map((declaration) => renderDeclaration(declaration, projectNamedColorSwatches, applyPropertyChange))}
              {section.writable ? renderAddProperty(section, pendingAddBySection[section.id] ?? "", setPendingAddBySection, addProperty) : null}
            </SidePanel.SectionBody>
          </SidePanel.Section>
        ))}
      </SidePanel.Content>
    </SidePanel>
  );
}

function renderDeclaration(
  declaration: StylesCascadeDeclaration,
  namedColorSwatches: ReturnType<typeof useProjectNamedColorSwatches>,
  applyPropertyChange: (declaration: StylesCascadeDeclaration, property: InspectorProperty, nextValue: string | number | boolean) => void
): JSX.Element {
  const property = declaration.property;
  const capability = property ? getInspectorPropertyCapabilityStatus(property) : null;
  const writable = property != null && declaration.writeTargets.length > 0 && capability?.status !== "unsupported";
  const className = [
    css.declaration,
    declaration.status === "overridden" ? css.declarationOverridden : "",
    declaration.status === "inactive-default" ? css.declarationInactive : "",
    declaration.status === "unsupported" ? css.declarationUnsupported : ""
  ].filter(Boolean).join(" ");

  return (
    <div key={declaration.id} className={className}>
      <div className={css.propertyName}>{toPropertySlug(declaration)}</div>
      <div className={css.valueWrap}>
        {property ? renderPropertyEditor(property, declaration, writable, namedColorSwatches, applyPropertyChange) : <span className={css.valueText}>{declaration.cssValue}</span>}
      </div>
    </div>
  );
}

function toPropertySlug(declaration: StylesCascadeDeclaration): string {
  if (
    declaration.property
    && "write" in declaration.property
    && declaration.property.write
    && declaration.property.write.key.length > 0
  ) {
    return declaration.property.write.key;
  }
  const raw = declaration.sourceText.trim();
  const eqIndex = raw.indexOf("=");
  if (eqIndex > 0) {
    return raw.slice(0, eqIndex).trim();
  }
  const colonIndex = raw.indexOf(":");
  if (colonIndex > 0) {
    return raw.slice(0, colonIndex).trim().toLowerCase().replace(/\s+/g, " ");
  }
  return declaration.label.trim().toLowerCase().replace(/\s+/g, " ");
}

function renderPropertyEditor(
  property: InspectorProperty,
  declaration: StylesCascadeDeclaration,
  writable: boolean,
  namedColorSwatches: ReturnType<typeof useProjectNamedColorSwatches>,
  applyPropertyChange: (declaration: StylesCascadeDeclaration, property: InspectorProperty, nextValue: string | number | boolean) => void
): JSX.Element {
  switch (property.kind) {
    case "color":
      return (
        <ColorPickerField
          ariaLabel={property.label}
          value={property.value}
          syntaxValue={property.syntaxValue}
          options={property.options}
          namedColorSwatches={namedColorSwatches}
          disabled={!writable}
          onChange={(value) => applyPropertyChange(declaration, property, value)}
        />
      );
    case "number":
      return (
        <input
          className={css.numberInput}
          type="number"
          step={property.step}
          value={property.value}
          disabled={!writable}
          onChange={(event) => applyPropertyChange(declaration, property, Number(event.target.value))}
        />
      );
    case "length":
    case "lineWidth":
      return (
        <input
          className={css.numberInput}
          type="number"
          step={property.step}
          value={property.value}
          min={property.kind === "lineWidth" ? property.min : undefined}
          max={property.kind === "lineWidth" ? property.max : undefined}
          disabled={!writable}
          onChange={(event) => applyPropertyChange(declaration, property, Number(event.target.value))}
        />
      );
    case "dashStyle":
    case "lineCap":
    case "lineJoin":
    case "fillMode":
    case "fillShading":
    case "fillPattern":
    case "nodeShape": {
      const options: CustomDropdownItem<string>[] = property.options.map((option) => ({ value: option.value, label: option.label }));
      return (
        <CustomDropdown
          ariaLabel={property.label}
          value={String(property.value)}
          disabled={!writable}
          options={options}
          onChange={(value) => applyPropertyChange(declaration, property, value)}
        />
      );
    }
    case "roundedCorners":
      return (
        <label className={css.checkboxLabel}>
          <input
            type="checkbox"
            checked={property.enabled}
            disabled={!writable}
            onChange={(event) => applyPropertyChange(declaration, property, event.target.checked)}
          />
          <span>{property.enabled ? `${property.radius.toFixed(1)}pt` : "off"}</span>
        </label>
      );
    default:
      return <span className={css.valueText}>{declaration.cssValue}</span>;
  }
}

function renderAddProperty(
  section: StylesCascadeSection,
  pendingValue: string,
  setPendingAddBySection: Dispatch<SetStateAction<Record<string, string>>>,
  addProperty: (section: StylesCascadeSection, propertyId: string) => void
): JSX.Element {
  const options: CustomDropdownItem<string>[] = section.addableProperties.map((property) => ({ value: property.propertyId, label: property.label }));
  return (
    <div className={css.addRow}>
      <span className={css.addLabel}>Add property</span>
      <CustomDropdown
        ariaLabel={`Add property to ${section.title}`}
        value={pendingValue}
        options={[{ value: "", label: "Select property" }, ...options]}
        onChange={(value) => {
          setPendingAddBySection((current) => ({ ...current, [section.id]: value }));
          if (value) {
            addProperty(section, value);
          }
        }}
      />
    </div>
  );
}
