"use client";

import { useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AgentMarkdown } from "@/components/chat/AgentMarkdown";
import { ReferenceText, type ReferenceTextProps } from "@/components/comments/ReferenceText";
import { ROLE_STYLE } from "@/components/comments/roleStyle";
import { resultLabel, roleLabel, sourceCitations } from "@/lib/commentView";
import { MIN_SHARED_RATIO, sharedRatio, wordDiff } from "@/lib/textDiff";
import type { Artifact, Comment, Document, Source, Suggestion } from "@/types";

export interface CommentCardProps {
  comment: Comment;
  /** Why every action is disabled (run active, editor open), or null. */
  disabledReason: string | null;
  /** The backend left the comment open because the passage could not be located. */
  notLocated: boolean;
  onAccept(): void;
  onEdit(suggestion: Suggestion): void;
  onReject(): void;
  onAsk(): void;
  onMarkDone(): void;
  /** A request for this comment is in flight. */
  busy?: boolean;
  /** This comment is the one the chat chip refers to. */
  asked?: boolean;
  /**
   * Details, diff and actions are shown (default). Collapsed, only the header (label, tags, title)
   * remains. The parent owns the state; the card never collapses itself.
   */
  expanded?: boolean;
  /** This comment is the active one (its passage is selected in the text). */
  active?: boolean;
  /** The header was clicked: the parent selects the comment (its passage scrolls into view) and expands it. */
  onActivate?: () => void;
  /** The chevron was clicked: the parent toggles the expansion without selecting the comment. */
  onToggleExpanded?: () => void;
  /** An open comment without a resolvable text passage: the header says so. */
  noPassage?: boolean;
  documents?: Document[];
  artifacts?: Artifact[];
  onOpenSource?: (source: Source) => void;
}

type Mode = "idle" | "editing";

const BUTTON =
  "px-2.5 py-1 rounded-lg text-[11px] font-medium border border-panel text-text-secondary transition-colors hover:bg-input-bg disabled:opacity-50 disabled:cursor-not-allowed";
const PRIMARY =
  "px-2.5 py-1 rounded-lg text-[11px] font-medium text-white bg-brand transition-colors hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed";

type RefProps = Pick<ReferenceTextProps, "documents" | "artifacts" | "onOpenSource">;

function SuggestionView({ suggestion, ...refs }: { suggestion: Suggestion } & RefProps) {
  if (suggestion.kind === "workshop_question") {
    return (
      <p className="text-xs text-text-primary whitespace-pre-wrap">
        <ReferenceText text={suggestion.text} {...refs} />
      </p>
    );
  }
  const segments = wordDiff(suggestion.find, suggestion.replace);
  if (sharedRatio(segments) >= MIN_SHARED_RATIO) {
    return (
      <pre data-testid="inline-diff" className="whitespace-pre-wrap rounded-md bg-input-bg px-2 py-1 text-xs text-text-primary">
        {segments.map((seg, i) =>
          seg.type === "removed" ? (
            <del key={i} className="rounded-sm bg-red-100 text-red-900 line-through decoration-red-700">
              <ReferenceText text={seg.text} {...refs} />
            </del>
          ) : seg.type === "added" ? (
            <ins key={i} className="rounded-sm bg-green-100 text-green-900 no-underline">
              <ReferenceText text={seg.text} {...refs} />
            </ins>
          ) : (
            <ReferenceText key={i} text={seg.text} {...refs} />
          ),
        )}
      </pre>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-xs">
      <pre className="whitespace-pre-wrap rounded-md bg-red-50 px-2 py-1 text-red-900">
        <ReferenceText text={suggestion.find} {...refs} />
      </pre>
      <span aria-hidden="true" className="text-muted-light">
        &rarr;
      </span>
      <pre className="whitespace-pre-wrap rounded-md bg-green-50 px-2 py-1 text-green-900">
        <ReferenceText text={suggestion.replace} {...refs} />
      </pre>
    </div>
  );
}

/** One comment: label, title, explanation with sources, exactly one suggestion, four actions. */
export function CommentCard({
  comment,
  disabledReason,
  notLocated,
  onAccept,
  onEdit,
  onReject,
  onAsk,
  onMarkDone,
  busy = false,
  asked = false,
  expanded = true,
  active = false,
  onActivate,
  onToggleExpanded,
  noPassage = false,
  documents,
  artifacts,
  onOpenSource,
}: CommentCardProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [draft, setDraft] = useState("");
  const { suggestion } = comment;
  const { label, hypothesis } = roleLabel(comment);
  const resolved = comment.status !== "open";
  const disabled = busy || disabledReason !== null;
  const title = disabledReason ?? undefined;
  const citations = sourceCitations(comment.sources);
  const roleStyle = ROLE_STYLE[comment.role];
  const RoleIcon = roleStyle.icon;

  const startEdit = (): void => {
    if (suggestion === null) return;
    setDraft(suggestion.kind === "text_change" ? suggestion.replace : suggestion.text);
    setMode("editing");
  };

  const applyEdit = (): void => {
    if (suggestion === null) return;
    onEdit(
      suggestion.kind === "text_change"
        ? { kind: "text_change", find: suggestion.find, replace: draft }
        : { kind: "workshop_question", text: draft.trim() },
    );
    setMode("idle");
  };

  const editingBlank = suggestion?.kind === "workshop_question" && draft.trim() === "";

  return (
    <article
      data-testid="comment-card"
      data-comment-card-id={comment.id}
      data-asked={asked ? "true" : "false"}
      data-active={active ? "true" : "false"}
      className={`flex flex-col gap-2 rounded-xl border border-l-[3px] px-3 py-3 ${
        asked || active ? "border-brand" : "border-panel"
      } ${roleStyle.border}`}
    >
      {/*
        The header selects the comment (mouse, Enter, Space). The chevron is its sibling, not a child,
        so there is no interactive element inside the role="button" and keys on the chevron never
        activate the card.
      */}
      <div className="flex items-start gap-2">
        <div
          data-testid="comment-card-header"
          {...(onActivate
            ? {
                role: "button",
                tabIndex: 0,
                onClick: onActivate,
                onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault(); // Space must not scroll the page
                  onActivate();
                },
              }
            : {})}
          className={`flex min-w-0 flex-1 flex-col gap-2 ${
            onActivate
              ? "cursor-pointer rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              : ""
          }`}
        >
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-placeholder">
            <span className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 ${roleStyle.badge}`}>
              <RoleIcon aria-hidden size={11} strokeWidth={2} />
              {label}
            </span>
            {hypothesis && (
              <span className="rounded-full bg-yellow-100 px-1.5 py-0.5 normal-case tracking-normal text-yellow-900">
                Hypothesis
              </span>
            )}
            {noPassage && (
              <span className="rounded-full bg-input-bg px-1.5 py-0.5 normal-case tracking-normal text-text-secondary">
                No text passage
              </span>
            )}
            {resolved && (
              <span className="ml-auto rounded-full bg-input-bg px-1.5 py-0.5 normal-case tracking-normal text-text-secondary">
                {resultLabel(comment)}
              </span>
            )}
          </div>
          <h3 className="text-sm font-semibold text-brand">{comment.title}</h3>
        </div>
        {onToggleExpanded && (
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse comment" : "Expand comment"}
            className="shrink-0 rounded p-0.5 text-muted-light hover:text-brand"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}
      </div>
      {expanded && (
        <>
          <p className="text-xs leading-relaxed text-text-secondary">
            <ReferenceText
              text={comment.description}
              documents={documents}
              artifacts={artifacts}
              onOpenSource={onOpenSource}
            />
          </p>
          {citations !== "" && (
            <div className="text-xs">
              <AgentMarkdown
                content={citations}
                documents={documents}
                artifacts={artifacts}
                onOpenSource={onOpenSource}
              />
            </div>
          )}
          {suggestion !== null && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-placeholder">Suggestion</span>
              {mode === "editing" && suggestion.kind === "text_change" ? (
                <>
                  <pre className="whitespace-pre-wrap rounded-md bg-red-50 px-2 py-1 text-xs text-red-900">
                    <ReferenceText
                      text={suggestion.find}
                      documents={documents}
                      artifacts={artifacts}
                      onOpenSource={onOpenSource}
                    />
                  </pre>
                  <textarea
                    aria-label="Edit suggestion"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={4}
                    className="w-full rounded-md border border-panel px-2 py-1 text-xs"
                  />
                </>
              ) : mode === "editing" ? (
                <textarea
                  aria-label="Edit suggestion"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-panel px-2 py-1 text-xs"
                />
              ) : (
                <SuggestionView
                  suggestion={suggestion}
                  documents={documents}
                  artifacts={artifacts}
                  onOpenSource={onOpenSource}
                />
              )}
            </div>
          )}

          {resolved ? null : notLocated ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-yellow-900">Couldn&apos;t locate the passage. Please edit it manually.</p>
              <div>
                <button type="button" disabled={busy} onClick={onMarkDone} className={PRIMARY}>
                  Mark as done
                </button>
              </div>
            </div>
          ) : mode === "editing" ? (
            <div className="flex gap-2">
              <button type="button" disabled={busy || editingBlank} onClick={applyEdit} className={PRIMARY}>
                Apply
              </button>
              <button type="button" onClick={() => setMode("idle")} className={BUTTON}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={disabled} title={title} onClick={onAccept} className={PRIMARY}>
                Accept
              </button>
              <button
                type="button"
                disabled={disabled || suggestion === null}
                title={title}
                onClick={startEdit}
                className={BUTTON}
              >
                Edit
              </button>
              <button
                type="button"
                disabled={disabled}
                title={title}
                onClick={() => onReject()}
                className={BUTTON}
              >
                Reject
              </button>
              <button type="button" disabled={disabled} title={title} onClick={onAsk} className={BUTTON}>
                Ask
              </button>
            </div>
          )}
        </>
      )}
    </article>
  );
}
