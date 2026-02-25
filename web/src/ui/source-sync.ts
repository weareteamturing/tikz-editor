export const SOURCE_SELECTION_REQUEST_EVENT = "tikz-editor:source-selection-request";
export const SOURCE_SELECTION_CHANGED_EVENT = "tikz-editor:source-selection-changed";

export type SourceSelectionRequestDetail = {
  from: number;
  to: number;
  anchor?: number;
  head?: number;
  sourceId?: string;
  focus?: boolean;
};

export type SourceSelectionChangeDetail = {
  from: number;
  to: number;
  anchor: number;
  head: number;
  sourceId: string | null;
};

export function requestSourceSelection(detail: SourceSelectionRequestDetail): void {
  window.dispatchEvent(
    new CustomEvent<SourceSelectionRequestDetail>(SOURCE_SELECTION_REQUEST_EVENT, { detail })
  );
}

export function notifySourceSelectionChanged(detail: SourceSelectionChangeDetail): void {
  window.dispatchEvent(
    new CustomEvent<SourceSelectionChangeDetail>(SOURCE_SELECTION_CHANGED_EVENT, { detail })
  );
}
