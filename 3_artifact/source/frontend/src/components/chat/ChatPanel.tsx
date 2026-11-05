"use client";

import { memo, useRef, useEffect, type ReactNode } from "react";
import { Bot, Loader2, AlertCircle, X, Plus, Info } from "lucide-react";
import { sanitizeStreamingMarkdown } from "@/lib/markdown";
import { PANEL_HEADER_CLASS } from "@/lib/panelHeader";
import { AiMessage, UserMessage } from "@/components/chat/ChatMessage";
import { AgentMarkdown } from "@/components/chat/AgentMarkdown";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChipBar } from "@/components/chat/ChipBar";
import { ProposalCard } from "@/components/chat/ProposalCard";
import { QuickReplies } from "@/components/chat/QuickReplies";
import { SessionHistory } from "@/components/chat/SessionHistory";
import { StarterPrompts } from "@/components/chat/StarterPrompts";
import type { ProposalResult } from "@/hooks/useChat";
import type { ChatMessage } from "@/lib/chat/state";
import type { QuestionProposal } from "@/types/chat";
import { progressLines } from "@/lib/runProgress";
import type { Document, Artifact, Run, Session, Source } from "@/types";

export interface ChatPanelProps {
  messages: ChatMessage[];
  streamText: string;
  status: string | null;
  busy: boolean;
  pending: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onStop?: () => void;
  restoredText?: { text: string; nonce: number } | null;
  onNewChat: () => void;
  /** All sessions of the project, newest first. */
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onClearError: () => void;
  onQuickReply: (text: "Yes" | "No") => void;
  onResolveProposal: (
    messageId: string,
    action: "accept" | "reject",
    questionIds: string[],
    revoke: boolean,
  ) => Promise<ProposalResult>;
  showStarters: boolean;
  documents: Document[];
  artifacts: Artifact[];
  onOpenSource: (source: Source) => void;
  chip: { id: string; title: string } | null;
  onClearChip: () => void;
  disabledReason?: string | null;
  /**
   * The active draft run, or null. Shown as a chat bubble: draft creation already starts
   * from a chat message, so its progress belongs there instead of a page-level overlay.
   */
  draftRun?: Run | null;
  /** Rendered at the bottom of the chat area, above the input (run progress). */
  progress?: ReactNode;
}

/**
 * Binds a proposal card to its message. Memoized with the message id instead of an inline
 * `onResolve` closure, so the cards skip the re-render on every streamed token.
 */
const MessageProposal = memo(function MessageProposal({
  messageId,
  proposal,
  disabled,
  onResolveProposal,
}: {
  messageId: string;
  proposal: QuestionProposal;
  disabled: boolean;
  onResolveProposal: ChatPanelProps["onResolveProposal"];
}) {
  return (
    <ProposalCard
      proposal={proposal}
      disabled={disabled}
      onResolve={(action, ids, revoke) => onResolveProposal(messageId, action, ids, revoke)}
    />
  );
});

export function ChatPanel({
  messages,
  streamText,
  status,
  busy,
  pending,
  error,
  onSend,
  onStop,
  restoredText,
  onNewChat,
  sessions,
  activeSessionId,
  onSelectSession,
  onClearError,
  onQuickReply,
  onResolveProposal,
  showStarters,
  documents,
  artifacts,
  onOpenSource,
  chip,
  onClearChip,
  disabledReason,
  draftRun = null,
  progress,
}: ChatPanelProps) {
  const draftLabel =
    draftRun !== null
      ? (progressLines(draftRun).find((l) => l.state === "active")?.label ?? "Der Entwurf wird erstellt\u2026")
      : null;
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // Smart auto-scroll
  useEffect(() => {
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamText, status]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    function handleScroll() {
      if (!container) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 80;
    }
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  const last = messages[messages.length - 1];
  const lastHasOpenCard = last?.proposal?.status === "open";
  const showQuickReplies =
    pending && !busy && last !== undefined && last.role === "assistant" && !lastHasOpenCard;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className={`${PANEL_HEADER_CLASS} justify-between`}>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-placeholder">Chat</span>
        <div className="flex items-center gap-2">
          <SessionHistory sessions={sessions} activeSessionId={activeSessionId} onSelect={onSelectSession} />
          <button
            type="button"
            onClick={onNewChat}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border border-panel text-text-secondary transition-colors hover:bg-input-bg"
          >
            <Plus size={11} strokeWidth={2} />
            New chat
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-5 py-6">
        <div className="flex flex-col gap-5 max-w-2xl mx-auto">
          {messages.map((msg, index) => (
            <div key={msg.id} className="flex flex-col gap-2">
              {msg.role === "user" ? (
                <UserMessage message={msg} />
              ) : (
                <AiMessage
                  message={msg}
                  documents={documents}
                  artifacts={artifacts}
                  onOpenSource={onOpenSource}
                />
              )}
              {msg.proposal != null && (
                <MessageProposal
                  key={msg.proposal.id}
                  messageId={msg.id}
                  proposal={msg.proposal}
                  disabled={busy}
                  onResolveProposal={onResolveProposal}
                />
              )}
              {index === messages.length - 1 && showQuickReplies && (
                <QuickReplies onReply={onQuickReply} />
              )}
            </div>
          ))}

          {showStarters && <StarterPrompts artifacts={artifacts} onSend={onSend} disabled={busy} />}

          {busy && streamText && (
            <div className="flex gap-3 items-start">
              <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 bg-brand-light">
                <Bot size={13} strokeWidth={1.75} className="text-brand" />
              </div>
              <div
                className="chat-text px-4 py-3 bg-input-bg prose"
                style={{ borderRadius: "4px 18px 18px 18px", maxWidth: "85%" }}
              >
                <AgentMarkdown
                  content={sanitizeStreamingMarkdown(streamText)}
                  documents={documents}
                  artifacts={artifacts}
                  onOpenSource={onOpenSource}
                />
                <span className="inline-block w-1.5 h-4 bg-accent-blueberry animate-pulse ml-0.5 align-middle" />
              </div>
            </div>
          )}

          {busy && streamText && status !== null && (
            <div data-testid="stream-status" className="flex gap-3 items-start">
              <div className="shrink-0 w-7" />
              <div className="flex items-center gap-2 px-4 py-3 rounded-[4px_18px_18px_18px] bg-input-bg">
                <Loader2 className="h-4 w-4 animate-spin text-accent-blueberry" />
                <span className="chat-text text-text-secondary">{status}</span>
              </div>
            </div>
          )}

          {busy && !streamText && (
            <div className="flex gap-3 items-start">
              <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 bg-brand-light">
                <Bot size={13} strokeWidth={1.75} className="text-brand" />
              </div>
              <div className="flex items-center gap-2 px-4 py-3 rounded-[4px_18px_18px_18px] bg-input-bg">
                <Loader2 className="h-4 w-4 animate-spin text-accent-blueberry" />
                <span className="chat-text text-text-secondary">{status ?? "Thinking\u2026"}</span>
              </div>
            </div>
          )}

          {draftLabel !== null && (
            <div data-testid="draft-progress" role="status" className="flex gap-3 items-start">
              <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 bg-brand-light">
                <Bot size={13} strokeWidth={1.75} className="text-brand" />
              </div>
              <div className="flex items-center gap-2 px-4 py-3 rounded-[4px_18px_18px_18px] bg-input-bg">
                <Loader2 className="h-4 w-4 animate-spin text-accent-blueberry" />
                <span className="chat-text text-text-secondary">{draftLabel}</span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="flex flex-col">
        {progress && <div className="mx-4 mb-2">{progress}</div>}
        {error && (
          <div className="mx-4 mb-2 flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200">
            <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
            <p className="text-xs text-red-700 flex-1 leading-relaxed">{error}</p>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={onClearError}
              className="shrink-0 text-red-400 hover:text-red-600 transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        )}
        {chip && <ChipBar title={chip.title} onClear={onClearChip} />}
        {showStarters && (
          <p className="mx-5 mb-2 flex items-center justify-center gap-1.5 text-center text-xs text-text-secondary">
            <Info size={12} strokeWidth={1.75} className="shrink-0" />
            Im Kontext: Dokumente, freigegebene Artefakte und geöffnete Entwürfe.
          </p>
        )}
        <ChatInput
          onSend={onSend}
          disabled={busy || Boolean(disabledReason)}
          busy={busy}
          onStop={onStop}
          restored={restoredText}
          disabledReason={disabledReason}
          documents={documents}
        />
      </div>
    </div>
  );
}
