import { getActiveEditorPlatform } from "../platform/current";
import type { DocumentFileRef } from "./types";
import { WORKSPACE_VERSION, type WorkspaceSeed } from "./reducer";

const WORKSPACE_STORAGE_KEY = "tikz-editor:workspace";

type PersistedWorkspaceV1 = {
  workspaceVersion: number;
  documents: Array<{
    id: string;
    title: string;
    source: string;
    savedSource?: string;
    fileRef?: DocumentFileRef | null;
  }>;
  tabOrder: string[];
  activeDocumentId: string;
  recentDocumentIds?: string[];
};

export function loadWorkspaceSeed(): WorkspaceSeed | null {
  try {
    const raw = getActiveEditorPlatform().persistence.load(WORKSPACE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceV1>;
    const migrated = migrateWorkspace(parsed);
    if (!migrated) {
      return null;
    }
    return migrated;
  } catch {
    return null;
  }
}

function migrateWorkspace(parsed: Partial<PersistedWorkspaceV1>): WorkspaceSeed | null {
  const version = typeof parsed.workspaceVersion === "number" ? parsed.workspaceVersion : 1;
  if (version !== 1) {
    return null;
  }
  const docs = Array.isArray(parsed.documents)
    ? parsed.documents
        .filter((doc): doc is NonNullable<PersistedWorkspaceV1["documents"]>[number] =>
          Boolean(doc && typeof doc.id === "string" && typeof doc.source === "string"))
        .map((doc) => ({
          id: doc.id,
          title: typeof doc.title === "string" && doc.title.trim().length > 0 ? doc.title : "Untitled",
          source: doc.source,
          savedSource: typeof doc.savedSource === "string" ? doc.savedSource : doc.source,
          fileRef: doc.fileRef && typeof doc.fileRef.name === "string"
            ? {
                kind: doc.fileRef.kind === "file" ? "file" : "virtual",
                name: doc.fileRef.name
              }
            : null
        }))
    : [];
  if (docs.length === 0) {
    return null;
  }
  const tabOrderRaw = Array.isArray(parsed.tabOrder) ? parsed.tabOrder.filter((id): id is string => typeof id === "string") : [];
  const docIds = new Set(docs.map((doc) => doc.id));
  const tabOrder = tabOrderRaw.filter((id) => docIds.has(id));
  const activeDocumentId =
    typeof parsed.activeDocumentId === "string" && docIds.has(parsed.activeDocumentId)
      ? parsed.activeDocumentId
      : tabOrder[0] ?? docs[0]!.id;
  const recentDocumentIds = Array.isArray(parsed.recentDocumentIds)
    ? parsed.recentDocumentIds.filter((id): id is string => typeof id === "string" && docIds.has(id))
    : [];

  return {
    workspaceVersion: WORKSPACE_VERSION,
    documents: docs,
    tabOrder: tabOrder.length > 0 ? tabOrder : docs.map((doc) => doc.id),
    activeDocumentId,
    recentDocumentIds
  };
}

export function saveWorkspace(state: {
  workspaceVersion: number;
  documents: Record<string, {
    id: string;
    title: string;
    source: string;
    savedSource: string;
    fileRef: DocumentFileRef | null;
  }>;
  tabOrder: string[];
  activeDocumentId: string;
}): void {
  const payload: PersistedWorkspaceV1 = {
    workspaceVersion: WORKSPACE_VERSION,
    documents: state.tabOrder
      .map((id) => state.documents[id])
      .filter((doc): doc is NonNullable<typeof state.documents[string]> => Boolean(doc))
      .map((doc) => ({
        id: doc.id,
        title: doc.title,
        source: doc.source,
        savedSource: doc.savedSource,
        fileRef: doc.fileRef
      })),
    tabOrder: [...state.tabOrder],
    activeDocumentId: state.activeDocumentId,
    recentDocumentIds: []
  };
  try {
    getActiveEditorPlatform().persistence.save(WORKSPACE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore persistence failures.
  }
}
