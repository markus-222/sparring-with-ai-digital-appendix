"use client";

import { memo, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { CommentCard } from "@/components/comments/CommentCard";
import { ROLE_STYLE } from "@/components/comments/roleStyle";
import { commentsApi } from "@/lib/api/comments";
import { ApiError } from "@/lib/api/errors";
import { useComments } from "@/lib/api/hooks";
import { commentActionReason, type LockState } from "@/lib/artifacts";
import { splitComments } from "@/lib/commentView";
import { PANEL_HEADER_CLASS } from "@/lib/panelHeader";
import { scrollBehavior } from "@/lib/scrollBehavior";
import type { Artifact, Comment, CommentAction, Document, Source } from "@/types";

export interface CommentsColumnProps {
  artifactId: string;
  locks: LockState;
  /** The artifact was reviewed since its last change (empty state). */
  reviewedEmpty: boolean;
  /** The comment the chat chip refers to, if any. */
  chipCommentId: string | null;
  onAsk(comment: Comment): void;
  /** The artifact's text changed (an `applied` outcome): refresh it. */
  onChanged(): void;
  onClose?: () => void;
  documents?: Document[];
  artifacts?: Artifact[];
  onOpenSource?: (source: Source) => void;
  /** The selected comment (highlight or card header click): its card expands and scrolls into view. */
  activeCommentId?: string | null;
  /** A card header was clicked: select that comment (the text scrolls to its passage). */
  onActivateComment?: (id: string) => void;
  /**
   * Counts selections, including repeated ones of the already active comment (`useProjectView`).
   * A change re-expands the active card (even if it was collapsed meanwhile) and scrolls it into
   * view again.
   */
  activationNonce?: number;
  /**
   * Ids of the comments whose passage was found in the text (computed on the artifact side). An
   * open comment missing here gets the "No text passage" hint; omitted while the anchors are not
   * known, then no hint is shown.
   */
  resolvedIds?: ReadonlySet<string>;
  /** Cards start collapsed to their header (default: expanded). */
  collapsedByDefault?: boolean;
}

const EMPTY_TEXT = "No comments – the draft looks ready to approve.";
const NO_COMMENTS: Comment[] = [];

/** Visible heading of an open-comments section: role colour dot, role, count. */
function RoleHeading({ role, label, count }: { role: Comment["role"]; label: string; count: number }) {
  return (
    <h2 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-secondary">
      <span aria-hidden className={`h-2 w-2 rounded-full ${ROLE_STYLE[role].dot}`} />
      {label}
      <span className="font-normal text-placeholder">· {count}</span>
    </h2>
  );
}

function messageOf(err: unknown): string {
  return err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

/**
 * Right column of the work view: Reviewer, then Explorer, then collapsed Resolved. Open
 * cards can be collapsed to their header; resolved ones are read-only and always shown in full.
 */
export const CommentsColumn = memo(function CommentsColumn({
  artifactId,
  locks,
  reviewedEmpty,
  chipCommentId,
  onAsk,
  onChanged,
  onClose,
  documents,
  artifacts,
  onOpenSource,
  activeCommentId = null,
  onActivateComment,
  activationNonce = 0,
  resolvedIds,
  collapsedByDefault = false,
}: CommentsColumnProps) {
  const { data, mutate } = useComments(artifactId);
  const [notLocated, setNotLocated] = useState<ReadonlySet<string>>(() => new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  // Ids whose expansion differs from the default (`collapsedByDefault`); a Set of "expanded" cards
  // when collapsed by default, of "collapsed" ones otherwise.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const [seenActive, setSeenActive] = useState<{ id: string | null; nonce: number }>({ id: null, nonce: 0 });
  const listRef = useRef<HTMLDivElement>(null);

  const isExpanded = (id: string): boolean => toggled.has(id) === collapsedByDefault;
  const setExpanded = (current: ReadonlySet<string>, id: string, expanded: boolean): ReadonlySet<string> => {
    if (isExpanded(id) === expanded) return current;
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  // A newly active comment, or a repeated activation of the active one, expands its card. Done while rendering (not in an effect) so the card
  // already has its final height when the scroll effect below runs.
  if (activeCommentId !== seenActive.id || activationNonce !== seenActive.nonce) {
    setSeenActive({ id: activeCommentId, nonce: activationNonce });
    if (activeCommentId !== null) setToggled(setExpanded(toggled, activeCommentId, true));
  }

  const comments = data ?? NO_COMMENTS;
  const { reviewer, explorer, resolved } = splitComments(comments);
  const openCount = reviewer.length + explorer.length;
  const disabledReason = commentActionReason(locks);

  const activePresent =
    activeCommentId !== null && comments.some((c) => c.id === activeCommentId && c.status === "open");
  useEffect(() => {
    if (activeCommentId === null || !activePresent) return;
    const cards = listRef.current?.querySelectorAll<HTMLElement>("[data-comment-card-id]") ?? [];
    const card = Array.from(cards).find((el) => el.dataset.commentCardId === activeCommentId);
    // jsdom has no scrollIntoView.
    if (card !== undefined && typeof card.scrollIntoView === "function") {
      card.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
    }
  }, [activeCommentId, activationNonce, activePresent]);

  const run = async (comment: Comment, action: () => Promise<CommentAction>): Promise<void> => {
    setBusyId(comment.id);
    setError(null);
    try {
      const result = await action();
      if (result.outcome === "not_located") {
        setNotLocated((prev) => new Set(prev).add(comment.id));
      } else {
        setNotLocated((prev) => {
          const next = new Set(prev);
          next.delete(comment.id);
          return next;
        });
      }
      if (result.outcome === "applied") onChanged();
    } catch (err: unknown) {
      setError(messageOf(err));
    } finally {
      setBusyId(null);
      await mutate();
    }
  };

  const renderCard = (comment: Comment) => (
    <CommentCard
      key={comment.id}
      comment={comment}
      disabledReason={disabledReason}
      notLocated={notLocated.has(comment.id)}
      busy={busyId === comment.id}
      asked={chipCommentId === comment.id}
      active={activeCommentId === comment.id}
      expanded={comment.status !== "open" || isExpanded(comment.id)}
      noPassage={resolvedIds !== undefined && comment.status === "open" && !resolvedIds.has(comment.id)}
      {...(comment.status === "open"
        ? {
            onActivate: () => {
              setToggled((prev) => setExpanded(prev, comment.id, true));
              onActivateComment?.(comment.id);
            },
            onToggleExpanded: () =>
              setToggled((prev) => setExpanded(prev, comment.id, !isExpanded(comment.id))),
          }
        : {})}
      onAccept={() => void run(comment, () => commentsApi.accept(comment.id))}
      onEdit={(suggestion) => void run(comment, () => commentsApi.edit(comment.id, suggestion))}
      onReject={() => void run(comment, () => commentsApi.reject(comment.id))}
      onAsk={() => onAsk(comment)}
      onMarkDone={() => void run(comment, () => commentsApi.doneManually(comment.id))}
      documents={documents}
      artifacts={artifacts}
      onOpenSource={onOpenSource}
    />
  );

  return (
    <div className="flex flex-col h-full">
      <div className={PANEL_HEADER_CLASS}>
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-widest text-placeholder">
          {`COMMENTS (${openCount} open)`}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comments"
            className="flex shrink-0 items-center gap-1 text-xs text-muted-light transition-colors hover:text-brand"
          >
            <ArrowLeft size={12} strokeWidth={1.75} />
          </button>
        )}
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 min-h-0 flex flex-col gap-4">
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
        {openCount === 0 && reviewedEmpty && data !== undefined && (
          <p className="text-xs text-text-secondary">{EMPTY_TEXT}</p>
        )}
        {reviewer.length > 0 && (
          <section aria-label="Reviewer comments" className="flex flex-col gap-3">
            <RoleHeading role="reviewer" label="Reviewer" count={reviewer.length} />
            {reviewer.map(renderCard)}
          </section>
        )}
        {explorer.length > 0 && (
          <section aria-label="Explorer comments" className="flex flex-col gap-3">
            <RoleHeading role="explorer" label="Explorer" count={explorer.length} />
            {explorer.map(renderCard)}
          </section>
        )}
        {resolved.length > 0 && (
          <section className="flex flex-col gap-3">
            <button
              type="button"
              aria-expanded={showResolved}
              onClick={() => setShowResolved((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-brand"
            >
              {showResolved ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {`Resolved (${resolved.length})`}
            </button>
            {showResolved && resolved.map(renderCard)}
          </section>
        )}
      </div>
    </div>
  );
});
