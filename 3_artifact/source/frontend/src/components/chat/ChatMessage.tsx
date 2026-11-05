"use client";

import { memo } from "react";
import { Bot, CheckCircle2, User } from "lucide-react";
import { AgentMarkdown } from "@/components/chat/AgentMarkdown";
import type { ChatMessage } from "@/lib/chat/state";
import type { Document, Artifact, Source } from "@/types";

/** Every chat reply is the Analyst's, also the fixed texts written by the backend. */
const ANALYST_STYLE = { color: "#065F46", bg: "#ECFDF5", label: "Analyst" };

interface AiMessageProps {
  message: ChatMessage;
  documents?: Document[];
  artifacts?: Artifact[];
  onOpenSource?: (source: Source) => void;
}

/** Memoized so earlier messages skip re-rendering while a reply streams in. */
export const AiMessage = memo(function AiMessage({ message, documents, artifacts, onOpenSource }: AiMessageProps) {
  const agent = ANALYST_STYLE;

  // A local status note (e.g. "draft finished"): plain text with a check icon, no avatar/markdown,
  // so it reads as a system confirmation rather than another chat reply.
  if (message.kind === "note") {
    return (
      <div className="flex gap-3 items-start">
        <div
          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5"
          style={{ backgroundColor: "#ECFDF5" }}
        >
          <CheckCircle2 size={14} strokeWidth={2} style={{ color: "#059669" }} />
        </div>
        <div
          className="chat-text px-4 py-3 text-text-secondary"
          style={{ borderRadius: "4px 18px 18px 18px", maxWidth: "85%" }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 items-start">
      <div
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5"
        style={{ backgroundColor: agent.bg }}
      >
        <Bot size={13} strokeWidth={1.75} style={{ color: agent.color }} />
      </div>
      <div className="flex flex-col gap-2" style={{ maxWidth: "85%" }}>
        <span
          className="text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: agent.color }}
        >
          {agent.label}
        </span>

        <div
          className="chat-text px-4 py-3 bg-input-bg prose"
          style={{ borderRadius: "4px 18px 18px 18px" }}
        >
          <AgentMarkdown
            content={message.content}
            documents={documents}
            artifacts={artifacts}
            onOpenSource={onOpenSource}
          />
        </div>
      </div>
    </div>
  );
});

interface UserMessageProps {
  message: ChatMessage;
}

export const UserMessage = memo(function UserMessage({ message }: UserMessageProps) {
  return (
    <div className="flex gap-3 items-start justify-end">
      <div className="flex flex-col items-end gap-1" style={{ maxWidth: "85%" }}>
        <div
          className="chat-text px-4 py-3 text-white whitespace-pre-wrap bg-brand"
          style={{ borderRadius: "18px 4px 18px 18px" }}
        >
          {message.content}
        </div>
      </div>
      <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 bg-brand">
        <User size={13} strokeWidth={1.75} className="text-white" />
      </div>
    </div>
  );
});
