"use client";

import type { Editor } from "@tiptap/react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { ApproveDialog } from "@/components/artifact/ApproveDialog";
import { ArtifactEditor } from "@/components/artifact/ArtifactEditor";
import { CommentGutter } from "@/components/artifact/CommentGutter";
import { MarkdownRenderer } from "@/components/documents/MarkdownRenderer";
import { StatusBadge } from "@/components/documents/StatusBadge";
import { ArtifactToolbar } from "@/components/artifact/ArtifactToolbar";
import { useCommentAnchors, type CommentAnchor } from "@/hooks/useCommentAnchors";
import { useComments } from "@/lib/api/hooks";
import { SLOT_DESCRIPTIONS, type LockState } from "@/lib/artifacts";
import { applyHighlight } from "@/lib/highlight";
import { PANEL_HEADER_CLASS } from "@/lib/panelHeader";
import { changeRangeFor } from "@/lib/richtext/changeRange";
import { scrollAnchorIntoView } from "@/lib/richtext/scrollToAnchor";
import type { Artifact, Comment, Document, Source } from "@/types";

/** Offsets into the artifact's current content that an AI change touched (`artifact_changed`). */
export interface ChangeRange {
  start: number;
  end: number;
}

const NO_COMMENTS: Comment[] = [];

const REVOKE_QUESTION = "This will revoke the approval. Continue?";
const DELETE_QUESTION =
  "Delete this artifact? Its text, comments and approved versions will be removed.";

export interface ArtifactViewProps {
  artifact: Artifact;
  documents: Document[];
  artifacts: Artifact[];
  locks: LockState;
  onRequestReview: () => void;
  editing: boolean;
  saving: boolean;
  editError: string | null;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (content: string) => Promise<void>;
  approveBusy: boolean;
  approveError: string | null;
  /** Resolves true when the artifact was approved. */
  onApprove: (force: boolean) => Promise<boolean>;
  /** Clears stale editor/approve error messages. */
  onClearActionError: () => void;
  onDownload: () => void;
  /** Resets the artifact to not started (the confirmation is asked here). */
  onDelete: () => void;
  /** Message of a failed download or delete, or null. */
  manageError?: string | null;
  /** Passage to highlight once (set after an AI change); null when there is none. */
  highlight?: ChangeRange | null;
  onHighlightDone?: () => void;
  onBack: () => void;
  onOpenSource: (source: Source) => void;
  commentsOpen: boolean;
  onToggleComments: () => void;
  /** The selected comment: its passage is drawn in the strong highlight. */
  activeCommentId?: string | null;
  /** A highlight in the text was clicked: select that comment. */
  onActivateComment?: (id: string) => void;
  /**
   * Counts selections (`useProjectView`), including repeated ones of the already active comment:
   * a change scrolls the active passage into view again.
   */
  activationNonce?: number;
  /**
   * The resolved comment anchors (`{id, from, to}` in the reading view's document) whenever they
   * change; `null` while unknown (no editor, comments loading, editing) and on unmount.
   */
  onAnchorsChange?: (anchors: readonly CommentAnchor[] | null) => void;
}

/** Artifact view with toolbar, Markdown reading view with marker badges, editor and approve dialog. */
export const ArtifactView = memo(function ArtifactView({
  artifact,
  documents,
  artifacts,
  locks,
  onRequestReview,
  editing,
  saving,
  editError,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  approveBusy,
  approveError,
  onApprove,
  onClearActionError,
  onDownload,
  onDelete,
  manageError = null,
  highlight = null,
  onHighlightDone,
  onBack,
  onOpenSource,
  commentsOpen,
  onToggleComments,
  activeCommentId = null,
  onActivateComment,
  activationNonce = 0,
  onAnchorsChange,
}: ArtifactViewProps) {
  const { data: comments } = useComments(artifact.id);
  const openComments = (comments ?? NO_COMMENTS).filter((c) => c.status === "open").length;
  const [confirmingEdit, setConfirmingEdit] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  // Only one of the two confirmations is shown at a time, so they share the ref.
  const confirmRef = useRef<HTMLDivElement>(null);
  const confirmOpen = (confirmingEdit && !editing) || confirmingDelete;
  const contentRef = useRef<HTMLDivElement>(null);
  const contentTextRef = useRef(artifact.content);
  contentTextRef.current = artifact.content;
  const doneRef = useRef(onHighlightDone);
  doneRef.current = onHighlightDone;

  // The reading view's editor: null while the dynamic import still shows its placeholder, while
  // editing (the view is unmounted) and during a remount.
  const [editor, setEditor] = useState<Editor | null>(null);
  const handleEditorReady = useCallback((next: Editor | null) => setEditor(next), []);
  // The highlight request that was already shown (or skipped), so a re-fired editor never repeats it.
  const handledHighlight = useRef<ChangeRange | null>(null);
  const viewMounted = artifact.status !== "not_started";

  // Comment highlights in the text. `comments` only holds this artifact's current comments.
  const anchors = useCommentAnchors(editor, artifact.content, comments, activeCommentId);
  const anchorsChange = useRef(onAnchorsChange);
  anchorsChange.current = onAnchorsChange;
  useEffect(() => {
    anchorsChange.current?.(anchors);
  }, [anchors]);
  useEffect(() => () => anchorsChange.current?.(null), []);

  // Scroll the active comment's passage into view, once per selection (`activeCommentId` or
  // `activationNonce` changed). Waits for the anchors; anchors that change later (content swap) do
  // not scroll again. A pending AI-change highlight owns the scroll: a selection that arrives
  // meanwhile is consumed without scrolling, so the two never fight.
  const scrolledFor = useRef<{ id: string; nonce: number } | null>(null);
  const highlightPending = highlight !== null && !editing;
  useEffect(() => {
    if (activeCommentId === null) {
      scrolledFor.current = null;
      return;
    }
    const done = scrolledFor.current;
    if (editor === null || anchors === null || (done?.id === activeCommentId && done.nonce === activationNonce)) return;
    scrolledFor.current = { id: activeCommentId, nonce: activationNonce };
    const anchor = anchors.find((a) => a.id === activeCommentId);
    if (anchor !== undefined && !highlightPending) scrollAnchorIntoView(editor, anchor.from, contentRef.current);
  }, [activeCommentId, activationNonce, anchors, editor, highlightPending]);

  // Highlight the changed passage on the next frame. A pending request waits for the
  // editor (it is created from the content of the render that mounts it, and a later content change
  // is applied by the view's own effect, which runs before this frame), so it is neither lost nor
  // run against a missing editor. `highlight` stays set, and `onHighlightDone` is not called, until
  // it has run.
  useEffect(() => {
    if (highlight === null || editing || handledHighlight.current === highlight) return;
    if (viewMounted && editor === null) return;
    const frame = requestAnimationFrame(() => {
      if (editor !== null && editor.isDestroyed) return;
      handledHighlight.current = highlight;
      try {
        const slice = contentTextRef.current.slice(highlight.start, highlight.end);
        const range = editor === null ? null : changeRangeFor(editor, slice);
        if (range !== null) applyHighlight(range);
        else contentRef.current?.scrollTo({ top: 0 }); // F5: passage not found, show the top of the artifact
      } finally {
        doneRef.current?.();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [highlight, editing, editor, viewMounted]);

  // A press outside an open confirmation dismisses it.
  useEffect(() => {
    if (!confirmOpen) return;
    const dismiss = (event: MouseEvent): void => {
      if (confirmRef.current?.contains(event.target as Node)) return;
      setConfirmingEdit(false);
      setConfirmingDelete(false);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [confirmOpen]);

  const handleEdit = (): void => {
    onClearActionError();
    setConfirmingDelete(false);
    if (artifact.status === "approved") setConfirmingEdit(true);
    else onStartEdit();
  };

  const handleApprove = async (force: boolean): Promise<void> => {
    if (await onApprove(force)) setApproveOpen(false);
  };

  const closeApprove = (): void => {
    setApproveOpen(false);
    onClearActionError();
  };

  const heading = artifact.slot ? `${artifact.slot} ${artifact.title}` : artifact.title;

  return (
    <div className="flex flex-col h-full">
      <div className={PANEL_HEADER_CLASS}>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to overview"
          className="flex items-center gap-1 text-xs text-muted-light transition-colors hover:text-brand"
        >
          <ArrowLeft size={12} strokeWidth={1.75} />
          Overview
        </button>
        {artifact.status !== "not_started" && !commentsOpen && (
          <button
            type="button"
            onClick={onToggleComments}
            aria-expanded={false}
            className={`ml-auto flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
              openComments > 0
                ? "border-accent-grape-border bg-brand-light text-brand hover:bg-accent-grape-border/40"
                : "border-panel text-text-secondary hover:bg-input-bg hover:text-brand"
            }`}
          >
            <MessageSquare size={12} strokeWidth={1.75} />
            {openComments > 0 ? `Comments (${openComments})` : "Comments"}
            {openComments > 0 && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent-berry" />}
          </button>
        )}
      </div>

      <div className="px-6 pt-5 pb-3 shrink-0 flex items-center gap-2">
        <h2 className="min-w-0 truncate text-base font-semibold text-brand" title={heading}>{heading}</h2>
        <StatusBadge status={artifact.status} />
        <div className="ml-auto shrink-0">
          <ArtifactToolbar
            compact={commentsOpen}
            artifact={artifact}
            openComments={openComments}
            locks={locks}
            onRequestReview={onRequestReview}
            onApprove={() => {
              onClearActionError();
              setApproveOpen(true);
            }}
            onEdit={handleEdit}
            onDownload={onDownload}
            onDelete={() => {
              onClearActionError();
              setConfirmingEdit(false);
              setConfirmingDelete(true);
            }}
          />
        </div>
      </div>

      {confirmingEdit && !editing && (
        <div ref={confirmRef} role="alertdialog" aria-label={REVOKE_QUESTION} className="mx-6 mb-3 flex items-center gap-3 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 shrink-0">
          <p className="flex-1 text-xs text-yellow-900">{REVOKE_QUESTION}</p>
          <button
            type="button"
            onClick={() => {
              setConfirmingEdit(false);
              onStartEdit();
            }}
            className="px-3 py-1 rounded-lg text-xs font-medium text-white bg-brand hover:opacity-90"
          >
            Continue
          </button>
          <button
            type="button"
            onClick={() => setConfirmingEdit(false)}
            className="px-3 py-1 rounded-lg text-xs font-medium border border-panel text-text-secondary hover:bg-input-bg"
          >
            Cancel
          </button>
        </div>
      )}

      {confirmingDelete && (
        <div ref={confirmRef} role="alertdialog" aria-label={DELETE_QUESTION} className="mx-6 mb-3 flex items-center gap-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 shrink-0">
          <p className="flex-1 text-xs text-red-900">{DELETE_QUESTION}</p>
          <button
            type="button"
            onClick={() => {
              setConfirmingDelete(false);
              onDelete();
            }}
            className="px-3 py-1 rounded-lg text-xs font-medium text-white bg-red-600 hover:opacity-90"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="px-3 py-1 rounded-lg text-xs font-medium border border-panel text-text-secondary hover:bg-input-bg"
          >
            Cancel
          </button>
        </div>
      )}

      {manageError !== null && (
        <p role="alert" className="mx-6 mb-3 shrink-0 text-xs text-red-700">
          {manageError}
        </p>
      )}

      <div ref={contentRef} className="flex-1 overflow-y-auto px-6 pb-4 min-h-0">
        {editing ? (
          <ArtifactEditor
            initial={artifact.content}
            onSave={onSaveEdit}
            onCancel={onCancelEdit}
            saving={saving}
            error={editError}
          />
        ) : artifact.status === "not_started" ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-xs text-muted-light">
              {artifact.slot ? SLOT_DESCRIPTIONS[artifact.slot] : "This artifact has not been started yet."}
            </p>
          </div>
        ) : (
          // The gutter layer sits in the left margin of this wrapper (it pulls itself into the
          // scroller's px-6 padding), so it scrolls with the text and the text keeps its alignment.
          <div className="relative -ml-6 pl-6">
            {onActivateComment && (
              <CommentGutter
                editor={editor}
                anchors={anchors}
                comments={comments}
                activeCommentId={activeCommentId}
                onActivate={onActivateComment}
              />
            )}
            <MarkdownRenderer
              markers
              content={artifact.content}
              documents={documents}
              artifacts={artifacts}
              onOpenSource={onOpenSource}
              onEditorReady={handleEditorReady}
              onAnnotationClick={onActivateComment}
            />
          </div>
        )}
      </div>

      <ApproveDialog
        open={approveOpen}
        reviewed={artifact.reviewed_since_change}
        onReviewFirst={() => {
          closeApprove();
          onRequestReview();
        }}
        onApprove={(force) => void handleApprove(force)}
        onClose={closeApprove}
        busy={approveBusy}
        error={approveError}
      />
    </div>
  );
});
