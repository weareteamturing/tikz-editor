import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getActiveEditorPlatform } from "../platform/current";
import { useEditorStore } from "../store/store";
import { CustomDropdown, type CustomDropdownOption } from "./CustomDropdown";
import type {
  AssistantAccountSnapshot,
  AssistantItem,
  AssistantModelOption,
  AssistantPendingApproval
} from "../platform/types";
import css from "./AssistantPanel.module.css";

type AssistantPanelProps = {
  onSubmitPrompt: (prompt: string, model: string | null) => Promise<void>;
  onInterruptTurn: () => Promise<void>;
};

const AUTO_MODEL_VALUE = "__auto__";

export function AssistantPanel({ onSubmitPrompt, onInterruptTurn }: AssistantPanelProps) {
  const activeDocumentId = useEditorStore((s) => s.activeDocumentId);
  const assistantApi = getActiveEditorPlatform().assistant;
  const assistantAvailable = typeof assistantApi?.startTurn === "function";
  const doc = useEditorStore((s) => s.documents[s.activeDocumentId]);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [modelOptions, setModelOptions] = useState<AssistantModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(AUTO_MODEL_VALUE);
  const [accountSnapshot, setAccountSnapshot] = useState<AssistantAccountSnapshot | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaRequested, setMetaRequested] = useState(false);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);

  const groupedItems = useMemo(() => {
    return (doc?.assistantItems ?? []).map((item) => ({
      key: item.id,
      item
    }));
  }, [doc?.assistantItems]);
  const dropdownOptions = useMemo<Array<CustomDropdownOption<string>>>(() => (
    [
      { value: AUTO_MODEL_VALUE, label: "Auto model" },
      ...modelOptions.map((option) => ({ value: option.id, label: option.label }))
    ]
  ), [modelOptions]);
  const accountMeta = useMemo(() => summarizeAccountMeta(accountSnapshot), [accountSnapshot]);
  const rateMeta = useMemo(() => summarizeRateMeta(accountSnapshot), [accountSnapshot]);
  const dropdownMetaLines = useMemo(() => {
    return [accountMeta, rateMeta, metaError].filter((line): line is string => Boolean(line && line.trim()));
  }, [accountMeta, metaError, rateMeta]);

  useEffect(() => {
    if (!metaRequested) {
      return;
    }
    let disposed = false;
    async function loadAssistantMeta(): Promise<void> {
      try {
        const [models, account] = await Promise.all([
          assistantApi?.listModels?.() ?? Promise.resolve([]),
          assistantApi?.readAccountSnapshot?.() ?? Promise.resolve(null)
        ]);
        if (disposed) {
          return;
        }
        setModelOptions(models);
        setAccountSnapshot(account);
        setMetaError(null);
      } catch (error) {
        if (disposed) {
          return;
        }
        setMetaError(error instanceof Error ? error.message : String(error));
      }
    }
    void loadAssistantMeta();
    return () => {
      disposed = true;
    };
  }, [assistantApi, metaRequested]);

  useEffect(() => {
    if (!shouldStickToBottomRef.current) {
      return;
    }
    const timeline = timelineRef.current;
    if (!timeline) {
      return;
    }
    timeline.scrollTop = timeline.scrollHeight;
  }, [groupedItems.length, doc?.assistantPendingApprovals.length]);

  if (!assistantAvailable) {
    return <div className={css.empty}>Codex assistant is only available in the desktop app.</div>;
  }

  if (!doc) {
    return <div className={css.empty}>No active document.</div>;
  }

  const running = doc.assistantTurnStatus === "starting" || doc.assistantTurnStatus === "inProgress";

  async function submitPrompt(): Promise<void> {
    const nextPrompt = prompt.trim();
    if (!nextPrompt || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmitPrompt(nextPrompt, selectedModel === AUTO_MODEL_VALUE ? null : selectedModel);
      setPrompt("");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitPrompt();
  }

  async function respondToApproval(
    requestId: string,
    decision: "accept" | "acceptForSession" | "decline" | "cancel" | string
  ): Promise<void> {
    await getActiveEditorPlatform().assistant?.respondToApproval?.({
      documentId: activeDocumentId,
      requestId,
      decision
    });
  }

  return (
    <div className={css.panel} data-testid="assistant-panel">
      <div className={css.header}>
        <div>
          <div className={css.title}>Assistant</div>
          <div className={css.meta}>
            {doc.assistantTurnStatus}
            {doc.assistantThreadId ? ` · ${doc.assistantThreadId}` : ""}
          </div>
        </div>
        <button
          type="button"
          className={css.interrupt}
          onClick={() => void onInterruptTurn()}
          disabled={!running}
          data-testid="assistant-interrupt"
        >
          Interrupt
        </button>
      </div>

      {doc.assistantError ? <div className={css.error}>{doc.assistantError}</div> : null}

      <div
        className={css.timeline}
        data-testid="assistant-timeline"
        ref={timelineRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
          shouldStickToBottomRef.current = distanceFromBottom <= 48;
        }}
      >
        {groupedItems.length === 0 ? <div className={css.empty}>Ask for help editing the current figure.</div> : null}
        {groupedItems.map(({ key, item }) => (
          <AssistantTimelineItem key={key} item={item} />
        ))}
        {doc.assistantPendingApprovals.map((approval) => (
          <div key={approval.requestId} className={css.card}>
            <div className={css.cardTitle}>Approval Required</div>
            <ApprovalPreview approval={approval} />
            <div className={css.actions}>
              {approvalActions(approval).map((action) => (
                <button key={action.value} type="button" onClick={() => void respondToApproval(approval.requestId, action.value)}>
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <form className={css.composer} onSubmit={handleSubmit}>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submitPrompt();
            }
          }}
          placeholder="Ask Codex to edit the current figure..."
          disabled={submitting || running}
          rows={4}
          data-testid="assistant-prompt"
        />
        <div className={css.composerRow}>
          <div className={css.modelPicker}>
            <CustomDropdown
              ariaLabel="Model"
              options={dropdownOptions}
              value={selectedModel}
              onChange={(value) => setSelectedModel(value)}
              onOpen={() => {
                if (!metaRequested) {
                  setMetaRequested(true);
                }
              }}
              disabled={submitting || running}
              menuHeader={dropdownMetaLines.length > 0 ? (
                <div className={css.dropdownMeta}>
                  {dropdownMetaLines.map((line, index) => (
                    <div key={`${index}:${line}`}>{line}</div>
                  ))}
                </div>
              ) : null}
              triggerClassName={css.modelTrigger}
              menuClassName={css.modelMenu}
              optionClassName={css.modelOption}
              optionSelectedClassName={css.modelOptionSelected}
            />
          </div>
          <button type="submit" disabled={submitting || running || prompt.trim().length === 0} data-testid="assistant-send">
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function AssistantTimelineItem({ item }: { item: AssistantItem }) {
  if (item.type === "userMessage") {
    const contentList = Array.isArray(item.content) ? item.content : [];
    const normalized = normalizeUserMessage(contentList);
    return (
      <div className={`${css.card} ${css.userCard}`}>
        <div className={css.cardTitle}>You</div>
        <div className={css.messageBody}>
          <div>{renderTextWithBreaks(normalized.visibleText)}</div>
          {normalized.hasAttachment ? <div className={css.attachmentHint}>PNG snapshot attached</div> : null}
          {normalized.rawPrompt && normalized.rawPrompt !== normalized.visibleText ? (
            <details className={css.rawPrompt}>
              <summary className={css.rawPromptSummary}>Expand to see packaging</summary>
              <pre className={css.detail}>{normalized.rawPrompt}</pre>
            </details>
          ) : null}
        </div>
      </div>
    );
  }

  if (item.type === "agentMessage") {
    return (
      <div className={`${css.card} ${css.agentCard}`}>
        <div className={css.cardTitle}>Codex</div>
        <div className={css.messageBody}>
          <Markdown remarkPlugins={[remarkGfm]}>{asString(item.text)}</Markdown>
        </div>
      </div>
    );
  }

  if (item.type === "plan") {
    return (
      <div className={css.card}>
        <div className={css.cardTitle}>Plan</div>
        <div className={css.messageBody}>
          <Markdown remarkPlugins={[remarkGfm]}>{asString(item.text)}</Markdown>
        </div>
      </div>
    );
  }

  if (item.type === "reasoning") {
    return (
      <div className={css.reasoningInline}>
        <div className={css.reasoningBody}>
          {item.summary ? <Markdown remarkPlugins={[remarkGfm]}>{asString(item.summary)}</Markdown> : null}
          {item.content ? <Markdown remarkPlugins={[remarkGfm]}>{asString(item.content)}</Markdown> : null}
        </div>
      </div>
    );
  }

  if (item.type === "commandExecution") {
    const command = displayCommand(item.command);
    const status = asString(item.status) || "completed";
    return (
      <details className={css.details}>
        <summary>{command ? <>Ran <code>{command}</code></> : "Ran command"}</summary>
        <div className={css.messageBody}>
          <div className={css.attachmentHint}>
            Status: {status}
            {typeof item.exitCode === "number" ? ` · exit ${item.exitCode}` : ""}
            {typeof item.durationMs === "number" ? ` · ${item.durationMs}ms` : ""}
          </div>
          {item.aggregatedOutput ? <pre className={css.detail}>{asString(item.aggregatedOutput)}</pre> : null}
        </div>
      </details>
    );
  }

  if (item.type === "dynamicToolCall") {
    const contentItems = Array.isArray(item.contentItems) ? item.contentItems : [];
    const previewImage = extractContentImageUrl(contentItems);
    const previewText = extractContentText(contentItems);
    const isPngPreview = item.tool === "get_latest_preview_png" || Boolean(previewImage);
    return (
      <details className={css.details}>
        <summary>{isPngPreview ? "Requested PNG snapshot" : "Requested tool call"}</summary>
        <div className={css.messageBody}>
          {previewText ? <div className={css.attachmentHint}>{previewText}</div> : null}
          {previewImage ? <img alt="Tool preview" src={previewImage} className={css.toolPreviewImage} /> : null}
        </div>
      </details>
    );
  }

  return (
    <details className={css.details}>
      <summary>{item.type}</summary>
      <pre className={css.detail}>{JSON.stringify(item, null, 2)}</pre>
    </details>
  );
}

function normalizeUserMessage(contentList: unknown[]): {
  visibleText: string;
  rawPrompt: string | null;
  hasAttachment: boolean;
} {
  let rawPrompt = "";
  let hasAttachment = false;
  for (const content of contentList) {
    if (!content || typeof content !== "object") {
      continue;
    }
    const candidate = content as { type?: unknown; text?: unknown };
    if (candidate.type === "text") {
      const next = asString(candidate.text);
      rawPrompt = rawPrompt ? `${rawPrompt}\n\n${next}` : next;
    } else {
      hasAttachment = true;
    }
  }
  const extracted = extractUserRequest(rawPrompt);
  return {
    visibleText: extracted ?? rawPrompt,
    rawPrompt: rawPrompt || null,
    hasAttachment
  };
}

function extractUserRequest(text: string): string | null {
  const marker = "User request:";
  const index = text.lastIndexOf(marker);
  if (index < 0) {
    return null;
  }
  const extracted = text.slice(index + marker.length).trim();
  return extracted || null;
}

function renderTextWithBreaks(text: string): ReactNode {
  const lines = text.split("\n");
  return lines.map((line, index) => (
    <Fragment key={`${index}:${line}`}>
      {index > 0 ? <br /> : null}
      {line}
    </Fragment>
  ));
}

function summarizeAccountMeta(snapshot: AssistantAccountSnapshot | null): string | null {
  const accountResult = asRecord(snapshot?.account);
  const account = asRecord(accountResult?.account);
  const name = typeof account?.name === "string" && account.name.trim() ? account.name : null;
  const email = typeof account?.email === "string" && account.email.trim() ? account.email : null;
  if (name && email) {
    return `Account: ${name} (${email})`;
  }
  if (email) {
    return `Account: ${email}`;
  }
  if (name) {
    return `Account: ${name}`;
  }
  const requiresAuth = accountResult?.requiresOpenaiAuth;
  if (typeof requiresAuth === "boolean") {
    return requiresAuth ? "Account: Sign-in required" : "Account: Ready";
  }
  return null;
}

function summarizeRateMeta(snapshot: AssistantAccountSnapshot | null): string | null {
  const rateResult = asRecord(snapshot?.rateLimits);
  const primary = extractRateWindow(asRecord(rateResult?.rateLimits));
  if (primary) {
    return `Quota: ${primary}`;
  }

  const limitsById = asRecord(rateResult?.rateLimitsByLimitId);
  if (limitsById) {
    const firstSnapshot = Object.values(limitsById)
      .map((value) => asRecord(value))
      .find((value) => value != null);
    const fallback = extractRateWindow(firstSnapshot);
    if (fallback) {
      return `Quota: ${fallback}`;
    }
  }
  return null;
}

function extractRateWindow(snapshot: Record<string, unknown> | null | undefined): string | null {
  if (!snapshot) {
    return null;
  }
  const primary = asRecord(snapshot.primary);
  const secondary = asRecord(snapshot.secondary);
  const primaryText = formatRateWindow(primary, "short");
  const secondaryText = formatRateWindow(secondary, "day");

  if (primaryText && secondaryText) {
    return `${primaryText} · ${secondaryText}`;
  }
  return primaryText ?? secondaryText;
}

function formatRateWindow(
  window: Record<string, unknown> | null | undefined,
  fallbackLabel: "short" | "day"
): string | null {
  if (!window) {
    return null;
  }
  const usedPercent = asNumber(window.usedPercent);
  if (usedPercent == null) {
    return null;
  }
  const durationMins = asNumber(window.windowDurationMins);
  const durationLabel = durationMins != null
    ? durationMins === 60 * 24 * 7
      ? "week"
      : durationMins >= 60
      ? `${Math.round(durationMins / 60)}h`
      : `${Math.round(durationMins)}m`
    : fallbackLabel;
  return `${usedPercent}% used (${durationLabel})`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function ApprovalPreview({ approval }: { approval: AssistantPendingApproval }) {
  if (approval.kind === "command") {
    const command = displayCommand(approval.command);
    const reason = asString(approval.reason);
    const availableDecisions = formatAvailableDecisions(approval.availableDecisions);
    return (
      <div className={css.messageBody}>
        {reason ? <div>{reason}</div> : null}
        {command ? <div className={css.attachmentHint}>Command: <code>{command}</code></div> : null}
        {approval.cwd ? <div className={css.attachmentHint}>CWD: {approval.cwd}</div> : null}
        {availableDecisions ? <div className={css.attachmentHint}>Choices: {availableDecisions}</div> : null}
      </div>
    );
  }

  if (approval.kind === "fileChange") {
    return (
      <div className={css.messageBody}>
        {approval.reason ? <div>{approval.reason}</div> : null}
        {approval.grantRoot ? <div className={css.attachmentHint}>Requested root: {approval.grantRoot}</div> : null}
      </div>
    );
  }

  return <pre className={css.detail}>{JSON.stringify(approval.payload, null, 2)}</pre>;
}

function displayCommand(command: unknown): string | null {
  if (Array.isArray(command)) {
    const parts = command.map((part) => asString(part)).filter((part) => part.length > 0);
    return parts.length > 0 ? parts.join(" ") : null;
  }
  const text = asString(command).trim();
  if (!text) {
    return null;
  }
  const shellWrapped = text.match(/^\/bin\/zsh -lc ['"](.*)['"]$/);
  if (shellWrapped && shellWrapped[1]) {
    return shellWrapped[1];
  }
  return text;
}

function formatAvailableDecisions(choices: unknown[] | undefined): string | null {
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const labels = choices
    .map((choice) => {
      if (typeof choice === "string") {
        return choice;
      }
      const record = asRecord(choice);
      if (!record) {
        return null;
      }
      const keys = Object.keys(record);
      return keys.length > 0 ? keys[0] : null;
    })
    .filter((value): value is string => Boolean(value && value.trim()));
  return labels.length > 0 ? labels.join(", ") : null;
}

function extractContentText(contentItems: unknown[]): string | null {
  for (const item of contentItems) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    if (record.type === "inputText" && typeof record.text === "string" && record.text.trim()) {
      return record.text;
    }
  }
  return null;
}

function extractContentImageUrl(contentItems: unknown[]): string | null {
  for (const item of contentItems) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    if (record.type === "inputImage" && typeof record.imageUrl === "string" && record.imageUrl.trim()) {
      return record.imageUrl;
    }
  }
  return null;
}

function approvalActions(approval: AssistantPendingApproval): Array<{ value: string; label: string }> {
  if (approval.kind !== "command") {
    return [
      { value: "accept", label: "Accept" },
      { value: "decline", label: "Decline" },
      { value: "cancel", label: "Cancel" }
    ];
  }
  const offered = Array.isArray(approval.availableDecisions)
    ? approval.availableDecisions
      .map((choice) => {
        if (typeof choice === "string") {
          return choice;
        }
        const record = asRecord(choice);
        if (!record) {
          return null;
        }
        const keys = Object.keys(record);
        return keys.length > 0 ? keys[0] : null;
      })
      .filter((value): value is string => Boolean(value && value.trim()))
    : [];
  if (offered.length === 0) {
    return [
      { value: "accept", label: "Accept" },
      { value: "decline", label: "Decline" },
      { value: "cancel", label: "Cancel" }
    ];
  }
  return offered.map((value) => ({
    value,
    label: humanizeDecision(value)
  }));
}

function humanizeDecision(value: string): string {
  switch (value) {
    case "accept":
      return "Accept";
    case "acceptForSession":
      return "Accept for Session";
    case "decline":
      return "Decline";
    case "cancel":
      return "Cancel";
    case "acceptWithExecpolicyAmendment":
      return "Accept with Amendment";
    default:
      return value;
  }
}
