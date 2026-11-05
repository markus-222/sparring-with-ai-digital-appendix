"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useChat, type ChatHandlers } from "@/hooks/useChat";
import type { CommentAnchor } from "@/hooks/useCommentAnchors";
import { usePresence } from "@/hooks/usePresence";
import { useProjectView } from "@/hooks/useProjectView";
import { useResize } from "@/hooks/useResize";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { OverviewPanel } from "@/components/overview/OverviewPanel";
import { ProgressIndicator } from "@/components/artifact/ProgressIndicator";
import { ApproveSuccess } from "@/components/artifact/ApproveSuccess";
import { RunAlert } from "@/components/artifact/RunAlert";
import { ArtifactView } from "@/components/artifact/ArtifactView";
import { CommentsColumn } from "@/components/comments/CommentsColumn";
import { invalidateArtifacts } from "@/lib/api/cache";
import { artifactForSlot } from "@/lib/artifacts";
import { COMMENTS_COLUMN_WIDTH, commentsPlacement } from "@/lib/commentsLayout";
import { SourcePanel } from "@/components/source/SourcePanel";
import { DocumentPane } from "@/components/documents/DocumentPane";
import type { Run } from "@/types";

const COMMENTS_EXIT_MS = 200;
const APPROVE_SUCCESS_MS = 1400;

export default function ProjectView() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const router = useRouter();

  const view = useProjectView(projectId);

  const handlers: ChatHandlers = useMemo(
    () => ({
      onArtifactChanged: (change) => void view.artifactChanged(change),
      onOpenArtifact: view.openArtifact,
      onRunStarted: view.trackRun,
      onChipCleared: view.clearChip,
      onUnauthorized: () => router.push("/login?reason=expired"),
    }),
    [view.artifactChanged, view.openArtifact, view.trackRun, view.clearChip, router],
  );

  const chat = useChat({
    sessionId: view.activeSession?.id ?? null,
    openArtifactId: view.openArtifactId,
    editorOpen: view.editorOpen,
    chip: view.chip,
    handlers,
  });

  const { append, appendNote } = chat;
  const { approve, showOverview } = view;
  const openArtifact = view.artifacts.find((a) => a.id === view.openArtifactId) ?? null;
  const [approvedTitle, setApprovedTitle] = useState<string | null>(null);
  const approveAndAnnounce = useCallback(
    async (force: boolean): Promise<boolean> => {
      const title = openArtifact?.title ?? "";
      const { ok, message } = await approve(force);
      if (message !== null) append(message);
      if (ok) setApprovedTitle(title);
      return ok;
    },
    [approve, append, openArtifact?.title],
  );

  // Confirmation overlay stays up briefly, then the approved artifact closes.
  useEffect(() => {
    if (approvedTitle === null) return;
    const timer = setTimeout(() => {
      setApprovedTitle(null);
      showOverview();
    }, APPROVE_SUCCESS_MS);
    return () => clearTimeout(timer);
  }, [approvedTitle, showOverview]);

  // Draft creation runs in the background while the chat already told the user it started:
  // show its progress as a chat bubble instead of a page-level overlay, and post a
  // confirmation note once it succeeds (the artifact itself opens automatically, see useProjectView).
  const draftRun: Run | null = view.run?.type === "draft" ? view.run : null;
  const lastDraftRunRef = useRef<Run | null>(null);
  useEffect(() => {
    if (draftRun !== null) lastDraftRunRef.current = draftRun;
  }, [draftRun]);
  useEffect(() => {
    if (draftRun !== null || view.failedRun !== null || lastDraftRunRef.current === null) return;
    const finished = lastDraftRunRef.current;
    lastDraftRunRef.current = null;
    const artifact = artifactForSlot(view.artifacts, finished.slot);
    appendNote(`Der Entwurf „${artifact?.title ?? finished.slot}“ wurde erstellt.`);
  }, [draftRun, view.failedRun, view.artifacts, appendNote]);

  const openDocument = view.documents.find((d) => d.id === view.openDocumentId) ?? null;
  const hasUserMessage = chat.state.messages.some((m) => m.role === "user");
  const sessionReady = view.activeSession !== null && chat.state.messages.length > 0;

  // Passages of the open artifact's comments that were found in the text (reported by the artifact
  // view; null while unknown).
  const [anchors, setAnchors] = useState<readonly CommentAnchor[] | null>(null);
  const resolvedIds = useMemo(() => (anchors === null ? undefined : new Set(anchors.map((a) => a.id))), [anchors]);

  const { width: rightWidth, onResizeStart } = useResize({
    initialRatio: 0.6,
    min: 280,
    max: 1800,
  });

  // Docked beside the text while the panel is wide enough, else the column overlays it.
  const commentsDocked = commentsPlacement(rightWidth) === "docked";
  const comments = usePresence(view.commentsOpen, COMMENTS_EXIT_MS);
  // Drives the width/opacity transition: stays false for one frame after mount so the column
  // animates in from 0, and flips back to false immediately on close so it animates back out.
  const [commentsVisible, setCommentsVisible] = useState(false);
  useEffect(() => {
    if (!view.commentsOpen) {
      setCommentsVisible(false);
      return;
    }
    const id = requestAnimationFrame(() => setCommentsVisible(true));
    return () => cancelAnimationFrame(id);
  }, [view.commentsOpen]);

  // Stable handlers: the page re-renders on every streamed chat token, and the memoized panels on
  // the right only skip those renders when their props keep their identity.
  const { startRun, setCommentsOpen, downloadArtifact, deleteArtifact, openSource, deleteDocument } = view;
  const commentsOpen = view.commentsOpen;
  const requestReview = useCallback(() => {
    if (openArtifact !== null) void startRun(openArtifact, "review");
  }, [openArtifact, startRun]);
  const toggleComments = useCallback(() => setCommentsOpen(!commentsOpen), [setCommentsOpen, commentsOpen]);
  const closeComments = useCallback(() => setCommentsOpen(false), [setCommentsOpen]);
  const download = useCallback(() => void downloadArtifact(), [downloadArtifact]);
  const remove = useCallback(() => void deleteArtifact(), [deleteArtifact]);
  const closeSource = useCallback(() => openSource(null), [openSource]);
  const removeDocument = useCallback((id: string) => void deleteDocument(id), [deleteDocument]);

  return (
    <div className="relative flex flex-1 overflow-hidden w-full">
      {/* Left: chat */}
      <div className="flex flex-col flex-1 overflow-hidden my-3 ml-3 rounded-2xl bg-white shadow-sm border border-panel">
        <ChatPanel
          messages={chat.state.messages}
          streamText={chat.state.streamText}
          status={chat.state.status}
          busy={chat.state.busy}
          pending={chat.state.pending}
          error={chat.state.error}
          onSend={(text) => void chat.send(text)}
          onStop={chat.abort}
          restoredText={chat.restored}
          onNewChat={() => void view.newChat()}
          sessions={view.sessions}
          activeSessionId={view.activeSession?.id ?? null}
          onSelectSession={view.selectSession}
          onClearError={chat.clearError}
          onQuickReply={(text) => void chat.send(text)}
          onResolveProposal={chat.resolveProposal}
          showStarters={sessionReady && !hasUserMessage}
          documents={view.documents}
          artifacts={view.artifacts}
          onOpenSource={view.openSource}
          chip={view.chip}
          onClearChip={view.clearChip}
          disabledReason={view.activeSession === null ? "Starting the chat\u2026" : null}
          draftRun={draftRun}
          progress={
            view.run === null && (view.failedRun || view.runError) ? (
              <RunAlert failed={view.failedRun} error={view.runError} onRetry={() => void view.retryRun()} />
            ) : null
          }
        />
      </div>

      {/* Resize zone */}
      <div onMouseDown={onResizeStart} className="shrink-0 cursor-col-resize" style={{ width: 10 }} />

      {/* Right: artifact (comments docked or overlay, sources overlay), document or overview */}
      <div
        className="relative flex flex-col shrink-0 overflow-hidden my-3 mr-3 rounded-2xl bg-white shadow-sm border border-panel"
        style={{ width: rightWidth }}
      >
        {openArtifact ? (
          <>
            <div className="flex flex-1 min-h-0 min-w-0">
              <div className="flex flex-col flex-1 min-h-0 min-w-0">
                <ArtifactView
                  artifact={openArtifact}
                  documents={view.documents}
                  artifacts={view.artifacts}
                  locks={view.locks}
                  onRequestReview={requestReview}
                  editing={view.editorOpen}
                  saving={view.saving}
                  editError={view.editError}
                  onStartEdit={view.startEdit}
                  onCancelEdit={view.cancelEdit}
                  onSaveEdit={view.saveEdit}
                  approveBusy={view.approveBusy}
                  approveError={view.approveError}
                  onApprove={approveAndAnnounce}
                  onClearActionError={view.clearActionError}
                  onDownload={download}
                  onDelete={remove}
                  manageError={view.manageError}
                  highlight={view.highlight?.artifactId === openArtifact.id ? view.highlight : null}
                  onHighlightDone={view.clearHighlight}
                  onBack={view.showOverview}
                  onOpenSource={view.openSource}
                  commentsOpen={view.commentsOpen}
                  onToggleComments={toggleComments}
                  activeCommentId={view.activeCommentId}
                  onActivateComment={view.setActiveCommentId}
                  activationNonce={view.activationNonce}
                  onAnchorsChange={setAnchors}
                />
              </div>
              {comments.mounted && (
                // Docked: a shrink-0 column next to the text. Overlay (narrow panel): absolute over it.
                // The element keeps its place in the tree, so switching keeps the column's state.
                // Width (not just opacity) animates so the text column resizes smoothly alongside it.
                <div
                  data-comments-placement={commentsDocked ? "docked" : "overlay"}
                  style={{ width: commentsVisible ? COMMENTS_COLUMN_WIDTH : 0 }}
                  className={`overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none ${
                    commentsDocked
                      ? "flex max-w-full shrink-0 flex-col border-l border-panel bg-white"
                      : "absolute inset-y-0 right-0 z-10 flex max-w-full flex-col border-l border-panel bg-white shadow-lg"
                  }`}
                >
                  <div
                    style={{ width: COMMENTS_COLUMN_WIDTH }}
                    className={`flex h-full flex-col transition-opacity duration-150 ease-out motion-reduce:transition-none ${
                      commentsVisible ? "opacity-100" : "opacity-0"
                    }`}
                  >
                    <CommentsColumn
                      artifactId={openArtifact.id}
                      locks={view.locks}
                      reviewedEmpty={openArtifact.reviewed_since_change}
                      chipCommentId={view.chip?.id ?? null}
                      onAsk={view.askComment}
                      onChanged={invalidateArtifacts}
                      onClose={closeComments}
                      documents={view.documents}
                      artifacts={view.artifacts}
                      onOpenSource={view.openSource}
                      activeCommentId={view.activeCommentId}
                      onActivateComment={view.setActiveCommentId}
                      activationNonce={view.activationNonce}
                      collapsedByDefault
                      resolvedIds={resolvedIds}
                    />
                  </div>
                </div>
              )}

            </div>
            {view.source !== null && (
              <div className="absolute inset-y-0 right-0 z-20 w-[380px] max-w-full border-l border-panel bg-white shadow-lg">
                <SourcePanel
                  source={view.source}
                  documents={view.documents}
                  artifacts={view.artifacts}
                  onClose={closeSource}
                  onOpenSource={view.openSource}
                />
              </div>
            )}
          </>
        ) : openDocument ? (
          <DocumentPane
            document={openDocument}
            documents={view.documents}
            artifacts={view.artifacts}
            onBack={view.showOverview}
            onOpenSource={view.openSource}
          />
        ) : (
          <OverviewPanel
            documents={view.documents}
            artifacts={view.artifacts}
            onOpenArtifact={view.openArtifact}
            onOpenDocument={view.openDocument}
            onUpload={view.uploadDocuments}
            onDeleteDocument={removeDocument}
          />
        )}

        {/* Draft creation already shows progress in the chat bubble; only review needs this
            overlay, which blurs just the right panel so the chat remains usable. */}
        {view.run !== null && view.run.type === "review" && <ProgressIndicator run={view.run} />}
        {approvedTitle !== null && <ApproveSuccess title={approvedTitle} />}
      </div>
    </div>
  );
}
