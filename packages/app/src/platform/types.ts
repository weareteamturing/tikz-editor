import type { DocumentFileRef } from "../store/types.js";
import type { AppMenuCommandId, AppMenuDefinition } from "../app-menu/index.js";

export type MenuCommandOrigin = "menu" | "shortcut" | "context-menu" | "platform";

export type MenuCommandHandler = (commandId: AppMenuCommandId, origin: MenuCommandOrigin) => void;

export type PlatformPersistence = {
  load: (key: string) => string | null;
  save: (key: string, value: string) => void;
};

export type PlatformClipboard = {
  readText?: () => Promise<string>;
  writeText?: (text: string) => Promise<void>;
};

export type PlatformFileApi = {
  openText?: () => Promise<{ source: string; fileRef: DocumentFileRef | null } | null>;
  bindOpenRequest?: (
    handler: (opened: { source: string; fileRef: DocumentFileRef | null }) => void
  ) => (() => void) | void;
  saveText?: (
    text: string,
    options?: { suggestedName?: string; fileRef?: DocumentFileRef | null; mode?: "save" | "save-as" }
  ) => Promise<
    | { status: "saved"; fileRef: DocumentFileRef | null }
    | { status: "cancelled"; fileRef: DocumentFileRef | null }
    | { status: "failed"; fileRef: DocumentFileRef | null; reason?: string }
  >;
  exportFile?: (content: BlobPart[], options: { fileName: string; mimeType: string }) => Promise<boolean>;
};

export type PlatformMenu = {
  usesNativeMenuBar?: boolean;
  bindCommandHandler?: (handler: MenuCommandHandler) => (() => void) | void;
  dispatchCommand?: (commandId: AppMenuCommandId, origin?: MenuCommandOrigin) => void;
  syncNativeMenu?: (payload: {
    definition: AppMenuDefinition;
    commandStates: Record<AppMenuCommandId, { enabled: boolean; checked?: boolean }>;
  }) => Promise<void> | void;
};

export type PlatformWindowApi = {
  setDocumentState?: (state: { title?: string; dirty?: boolean }) => void;
  bindCloseRequest?: (handler: () => void) => (() => void) | void;
  close?: () => Promise<void> | void;
  openExternalUrl?: (url: string) => Promise<boolean> | boolean;
};

export type AssistantChatContent =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string };

export type AssistantItem =
  | { type: "userMessage"; id: string; content: AssistantChatContent[] }
  | { type: "agentMessage"; id: string; text: string; phase?: "commentary" | "final_answer" | string }
  | { type: "plan"; id: string; text: string }
  | { type: "reasoning"; id: string; summary?: string; content?: string }
  | {
      type: "commandExecution";
      id: string;
      command?: string | string[];
      cwd?: string;
      status?: string;
      aggregatedOutput?: string;
      exitCode?: number;
      durationMs?: number;
    }
  | { type: "fileChange"; id: string; status?: string; changes?: Array<{ path: string; kind?: string; diff?: string }> }
  | { type: "mcpToolCall"; id: string; server?: string; tool?: string; status?: string; arguments?: unknown; result?: unknown; error?: unknown }
  | { type: "dynamicToolCall"; id: string; tool?: string; arguments?: unknown; status?: string; contentItems?: unknown[]; success?: boolean; durationMs?: number }
  | { type: "webSearch"; id: string; query?: string; action?: unknown }
  | { type: "imageView"; id: string; path: string }
  | { type: "enteredReviewMode"; id: string; review?: string }
  | { type: "exitedReviewMode"; id: string; review?: string }
  | { type: "contextCompaction"; id: string }
  | { type: string; id: string; [key: string]: unknown };

export type AssistantPendingApproval =
  | {
      kind: "command";
      requestId: string;
      itemId: string;
      threadId: string;
      turnId: string;
      reason?: string;
      command?: string | string[];
      cwd?: string;
      availableDecisions?: unknown[];
    }
  | {
      kind: "fileChange";
      requestId: string;
      itemId: string;
      threadId: string;
      turnId: string;
      reason?: string;
      grantRoot?: string;
    }
  | {
      kind: "toolInput";
      requestId: string;
      threadId: string;
      turnId?: string;
      payload: unknown;
    };

export type AssistantTurnStatus = "idle" | "starting" | "inProgress" | "completed" | "failed" | "interrupted";

export type AssistantThreadSummary = {
  threadId: string;
  workspacePath: string;
  figurePath: string;
  previewPath: string;
};

export type AssistantThreadState = AssistantThreadSummary & {
  items: AssistantItem[];
};

export type AssistantModelOption = {
  id: string;
  label: string;
};

export type AssistantAccountSnapshot = {
  account: unknown;
  rateLimits: unknown;
};

export type AssistantDynamicToolResult = {
  success?: boolean;
  contentItems?: unknown[];
};

export type AssistantEvent =
  | { type: "thread-ready"; documentId: string; thread: AssistantThreadSummary }
  | { type: "thread-state"; documentId: string; state: AssistantThreadState }
  | { type: "turn-status"; documentId: string; turnId?: string; status: AssistantTurnStatus; error?: string | null }
  | { type: "item-started"; documentId: string; item: AssistantItem }
  | { type: "item-updated"; documentId: string; item: AssistantItem }
  | { type: "item-completed"; documentId: string; item: AssistantItem }
  | { type: "item-delta"; documentId: string; itemId: string; deltaType: string; delta: string }
  | { type: "approval-requested"; documentId: string; approval: AssistantPendingApproval }
  | { type: "approval-cleared"; documentId: string; requestId: string }
  | { type: "source-updated"; documentId: string; source: string; revisionToken: string }
  | { type: "dynamic-tool-call"; documentId: string; requestId: string; itemId?: string; tool: string; arguments?: unknown }
  | { type: "error"; documentId?: string; message: string };

export type AssistantApi = {
  ensureDocumentThread?: (params: {
    documentId: string;
    source: string;
    threadId?: string | null;
    workspacePath?: string | null;
    figurePath?: string | null;
    previewPath?: string | null;
  }) => Promise<AssistantThreadSummary>;
  startTurn?: (params: {
    documentId: string;
    prompt: string;
    source: string;
    pngBase64?: string | null;
    threadId?: string | null;
    workspacePath?: string | null;
    figurePath?: string | null;
    previewPath?: string | null;
    model?: string | null;
  }) => Promise<{ turnId: string | null }>;
  interruptTurn?: (params: { documentId: string }) => Promise<void>;
  syncSource?: (params: { documentId: string; source: string }) => Promise<void>;
  respondToApproval?: (params: { documentId: string; requestId: string; decision: "accept" | "acceptForSession" | "decline" | "cancel" | string }) => Promise<void>;
  respondToDynamicToolCall?: (params: { documentId: string; requestId: string; result: AssistantDynamicToolResult }) => Promise<void>;
  loadThreadState?: (params: { documentId: string }) => Promise<AssistantThreadState | null>;
  listModels?: () => Promise<AssistantModelOption[]>;
  readAccountSnapshot?: () => Promise<AssistantAccountSnapshot | null>;
  bindEvents?: (handler: (event: AssistantEvent) => void) => (() => void) | void;
};

export type EditorPlatform = {
  id: string;
  persistence: PlatformPersistence;
  clipboard?: PlatformClipboard;
  files?: PlatformFileApi;
  menu?: PlatformMenu;
  window?: PlatformWindowApi;
  assistant?: AssistantApi;
};
