export const SOURCE_SELECTION_REQUEST_EVENT = "tikz-editor:source-selection-request";

export type SourceSelectionRequestDetail = {
  from: number;
  to: number;
  sourceId?: string;
  focus?: boolean;
};

export function requestSourceSelection(detail: SourceSelectionRequestDetail): void {
  window.dispatchEvent(
    new CustomEvent<SourceSelectionRequestDetail>(SOURCE_SELECTION_REQUEST_EVENT, { detail })
  );
}
