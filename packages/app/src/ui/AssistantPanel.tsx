import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getActiveEditorPlatform } from "../platform/current";
import { useEditorStore } from "../store/store";
import type { AssistantItem } from "../platform/types";
import css from "./AssistantPanel.module.css";

type AssistantPanelProps = {
  onSubmitPrompt: (prompt: string) => Promise<void>;
  onInterruptTurn: () => Promise<void>;
};

export function AssistantPanel({ onSubmitPrompt, onInterruptTurn }: AssistantPanelProps) {
  const activeDocumentId = useEditorStore((s) => s.activeDocumentId);
  const assistantAvailable = typeof getActiveEditorPlatform().assistant?.startTurn === "function";
  const doc = useEditorStore((s) => s.documents[s.activeDocumentId]);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const groupedItems = useMemo(() => {
    return (doc?.assistantItems ?? []).map((item) => ({
      key: item.id,
      item
    }));
  }, [doc?.assistantItems]);

  if (!assistantAvailable) {
    return <div className={css.empty}>Codex assistant is only available in the desktop app.</div>;
  }

  if (!doc) {
    return <div className={css.empty}>No active document.</div>;
  }

  const running = doc.assistantTurnStatus === "starting" || doc.assistantTurnStatus === "inProgress";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmitPrompt(nextPrompt);
      setPrompt("");
    } finally {
      setSubmitting(false);
    }
  }

  async function respondToApproval(
    requestId: string,
    decision: "accept" | "acceptForSession" | "decline" | "cancel"
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

      <div className={css.timeline} data-testid="assistant-timeline">
        {groupedItems.length === 0 ? <div className={css.empty}>Ask for help editing the current figure.</div> : null}
        {groupedItems.map(({ key, item }) => (
          <AssistantTimelineItem key={key} item={item} />
        ))}
        {doc.assistantPendingApprovals.map((approval) => (
          <div key={approval.requestId} className={css.card}>
            <div className={css.cardTitle}>Approval Required</div>
            <pre className={css.detail}>
              {JSON.stringify(approval, null, 2)}
            </pre>
            <div className={css.actions}>
              <button type="button" onClick={() => void respondToApproval(approval.requestId, "accept")}>Accept</button>
              <button type="button" onClick={() => void respondToApproval(approval.requestId, "decline")}>Decline</button>
              <button type="button" onClick={() => void respondToApproval(approval.requestId, "cancel")}>Cancel</button>
            </div>
          </div>
        ))}
      </div>

      <form className={css.composer} onSubmit={handleSubmit}>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Ask Codex to edit the current figure..."
          disabled={submitting || running}
          rows={4}
          data-testid="assistant-prompt"
        />
        <button type="submit" disabled={submitting || running || prompt.trim().length === 0} data-testid="assistant-send">
          Send
        </button>
      </form>
    </div>
  );
}

function AssistantTimelineItem({ item }: { item: AssistantItem }) {
  if (item.type === "userMessage") {
    const contentList = Array.isArray(item.content) ? item.content : [];
    return (
      <div className={`${css.card} ${css.userCard}`}>
        <div className={css.cardTitle}>You</div>
        <div className={css.messageBody}>
          {contentList.map((content, index) => (
            <div key={`${item.id}-${index}`}>
              {renderUserContent(content)}
            </div>
          ))}
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
      <div className={css.card}>
        <div className={css.cardTitle}>Reasoning</div>
        <div className={css.messageBody}>
          {item.summary ? <p>{asString(item.summary)}</p> : null}
          {item.content ? <pre className={css.detail}>{asString(item.content)}</pre> : null}
        </div>
      </div>
    );
  }

  return (
    <details className={css.details}>
      <summary>{item.type}</summary>
      <pre className={css.detail}>{JSON.stringify(item, null, 2)}</pre>
    </details>
  );
}

function renderUserContent(content: unknown): string {
  if (!content || typeof content !== "object") {
    return String(content ?? "");
  }
  const candidate = content as { type?: unknown; text?: unknown; path?: unknown; url?: unknown };
  if (candidate.type === "text") {
    return asString(candidate.text);
  }
  if (candidate.type === "localImage") {
    return asString(candidate.path);
  }
  return asString(candidate.url);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
