"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActiveRun } from "@/hooks/useActiveRun";
import { useArtifacts, useComments, useDocuments, useSessions } from "@/lib/api/hooks";
import {
  invalidateArtifacts,
  invalidateComments,
  invalidateDocuments,
  invalidateSessions,
} from "@/lib/api/cache";
import { artifactsApi } from "@/lib/api/artifacts";
import { documentsApi } from "@/lib/api/documents";
import { ApiError } from "@/lib/api/errors";
import { sessionsApi } from "@/lib/api/sessions";
import { artifactForSlot, lockState, pickActiveSession, type LockState } from "@/lib/artifacts";
import type { Artifact, Comment, Document, Message, Run, RunType, Session, Source } from "@/types";

/** Passage of an artifact that an AI change touched (offsets into the new content). */
export interface ChangeHighlight {
  artifactId: string;
  start: number;
  end: number;
}

// Stable fallbacks while SWR data is loading, so consumers' memoization is not defeated by a fresh `[]`.
const NO_DOCUMENTS: Document[] = [];
const NO_ARTIFACTS: Artifact[] = [];
const NO_SESSIONS: Session[] = [];

function errorMessage(err: unknown): string {
  return err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

/** Outcome of an approval: `message` is the next-step message the backend wrote into the active chat. */
export interface ApproveResult {
  ok: boolean;
  message: Message | null;
}

export interface ProjectView {
  documents: Document[];
  artifacts: Artifact[];
  activeSession: Session | null;
  /** All sessions of the project, newest first. */
  sessions: Session[];
  openArtifactId: string | null;
  openDocumentId: string | null;
  /** Source panel over the comments column (only while an artifact is open), or null. */
  source: Source | null;
  /** The comments overlay over the open artifact. */
  commentsOpen: boolean;
  editorOpen: boolean;
  chip: { id: string; title: string } | null;
  /** The comment whose passage and card are selected (highlight click, card header click), or null. */
  activeCommentId: string | null;
  /**
   * Counts selections of a comment, including repeated ones of the already active comment (whose id
   * does not change). Consumers react to a change to expand/scroll the active comment again.
   */
  activationNonce: number;
  /** Set by an AI change (`artifact_changed`) until the artifact view has highlighted it. */
  highlight: ChangeHighlight | null;
  saving: boolean;
  editError: string | null;
  approveBusy: boolean;
  approveError: string | null;
  /** Message of a failed download or delete of the open artifact, or null. */
  manageError: string | null;
  /** The running run (progress indicator), or null. */
  run: Run | null;
  /** The last failed run, kept until dismissed or retried. */
  failedRun: Run | null;
  /** Message of a rejected run start, or null. */
  runError: string | null;
  locks: LockState;
  /** Follow a run started by the chat (`run_started`). */
  trackRun(runId: string): void;
  /** Starts a draft or review run for the artifact's slot (no-op for an artifact without a slot). */
  startRun(artifact: Artifact, type: RunType): Promise<void>;
  /** Restarts the failed run with the same type and slot. */
  retryRun(): Promise<void>;
  dismissRunFailure(): void;
  startEdit(): void;
  /** Closes the editor without saving. */
  cancelEdit(): void;
  /** `PUT /artifacts/{id}`, then closes the editor and refreshes the artifacts. A failure keeps the editor open. */
  saveEdit(content: string): Promise<void>;
  /** Approves the open artifact in the active chat session. On a 409 `ok` is false and the backend message is in `approveError`. */
  approve(force: boolean): Promise<ApproveResult>;
  /** Downloads the open artifact as a Markdown file; a failure is in `manageError`. */
  downloadArtifact(): Promise<void>;
  /** Deletes the open artifact (a slot artifact goes back to "not started") and returns to the overview. */
  deleteArtifact(): Promise<void>;
  clearActionError(): void;
  /** `artifact_changed` from the chat: open the artifact if needed, refetch it, then request the highlight. */
  artifactChanged(change: { artifactId: string; start: number; end: number }): Promise<void>;
  clearHighlight(): void;
  openArtifact(id: string): void;
  openDocument(id: string): void;
  /**
   * A citation was clicked. With an artifact open it shows the source panel over the comments column
   * (`null` closes it). Without one, a document opens in the right column and an artifact opens normally.
   */
  openSource(source: Source | null): void;
  setCommentsOpen(open: boolean): void;
  /** Selects a comment (`null` clears). Activating one opens the comments column and bumps `activationNonce`. */
  setActiveCommentId(id: string | null): void;
  /** Back to the overview: closes the open artifact and document. */
  showOverview(): void;
  clearChip(): void;
  /** `Ask` on a comment: sets the chip, replacing the chip of another comment. */
  askComment(comment: Comment): void;
  newChat(): Promise<void>;
  /** Switches the chat back to an earlier session of this project. */
  selectSession(id: string): void;
  uploadDocuments(files: FileList): Promise<void>;
  deleteDocument(id: string): Promise<void>;
}

/** Owns the page's UI state: active chat session, what is open on the right, editor flag, chip. */
export function useProjectView(projectId: string): ProjectView {
  const { data: sessions, mutate: mutateSessions } = useSessions(projectId);
  const { data: documents, mutate: mutateDocuments } = useDocuments(projectId);
  const { data: artifacts, mutate: mutateArtifacts } = useArtifacts(projectId);

  const [createdSession, setCreatedSession] = useState<Session | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);
  const [openDocumentId, setOpenDocumentId] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [activeCommentId, setActiveComment] = useState<string | null>(null);
  const [activationNonce, setActivationNonce] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [approveBusy, setApproveBusy] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<ChangeHighlight | null>(null);
  const [chip, setChip] = useState<{ id: string; title: string } | null>(null);
  const { data: openComments } = useComments(openArtifactId);
  const creating = useRef(false);

  const listed = pickActiveSession(sessions ?? NO_SESSIONS);
  // A session created locally wins until the list contains something at least as new.
  const newestSession =
    createdSession && (!listed || Date.parse(createdSession.created_at) >= Date.parse(listed.created_at))
      ? createdSession
      : listed;

  // Newest first; a locally created session is included until the list catches up.
  const allSessions = useMemo(() => {
    const all = [...(sessions ?? NO_SESSIONS)];
    if (createdSession && !all.some((s) => s.id === createdSession.id)) all.push(createdSession);
    return all.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }, [sessions, createdSession]);

  // An explicitly selected (older) session wins over the newest one.
  const activeSession = allSessions.find((s) => s.id === selectedSessionId) ?? newestSession;

  const activeSessionIdRef = useRef<string | null>(null);
  activeSessionIdRef.current = activeSession?.id ?? null;

  const createSession = useCallback(async (): Promise<void> => {
    if (creating.current) return;
    creating.current = true;
    try {
      const session = await sessionsApi.create({ project_id: projectId });
      setCreatedSession(session);
      invalidateSessions(projectId);
      await mutateSessions();
    } finally {
      creating.current = false;
    }
  }, [projectId, mutateSessions]);

  // No session yet: create one on load (the backend writes the greeting).
  const loaded = sessions !== undefined;
  const empty = loaded && sessions.length === 0;
  useEffect(() => {
    if (empty && createdSession === null) {
      void createSession();
    }
  }, [empty, createdSession, createSession]);

  const openArtifact = useCallback((id: string) => {
    setOpenDocumentId(null);
    setSource(null);
    setCommentsOpen(false);
    setOpenArtifactId(id);
    setEditorOpen(false);
    setEditError(null);
    setApproveError(null);
    setManageError(null);
    setChip(null);
    setActiveComment(null);
  }, []);

  const setActiveCommentId = useCallback((id: string | null) => {
    setActiveComment(id);
    if (id !== null) {
      setCommentsOpen(true);
      setActivationNonce((n) => n + 1);
    }
  }, []);

  const openArtifactIdRef = useRef<string | null>(null);
  openArtifactIdRef.current = openArtifactId;

  // A finished draft or review opens its artifact and refreshes the data.
  const activeRun = useActiveRun(projectId, (finished) => {
    invalidateArtifacts();
    if (finished.type === "review") invalidateComments();
    const target = artifactForSlot(artifacts ?? NO_ARTIFACTS, finished.slot);
    if (target !== null) {
      openArtifact(target.id);
      if (finished.type === "review") setCommentsOpen(true);
    }
  });
  const { run, failed: failedRun, startError, track, startRun: startActiveRun, dismissFailure } = activeRun;
  const locks = useMemo(() => lockState({ run, editorOpen }), [run, editorOpen]);

  const openDocument = useCallback((id: string) => {
    setOpenArtifactId(null);
    setSource(null);
    setCommentsOpen(false);
    setOpenDocumentId(id);
    setEditorOpen(false);
  }, []);

  const artifactsRef = useRef<Artifact[]>([]);
  artifactsRef.current = artifacts ?? NO_ARTIFACTS;

  const openSource = useCallback(
    (next: Source | null) => {
      if (next === null || openArtifactIdRef.current !== null) {
        setSource(next);
        return;
      }
      if (next.kind === "document") {
        openDocument(next.documentId);
        return;
      }
      const target = artifactForSlot(artifactsRef.current, next.slot);
      if (target !== null) openArtifact(target.id);
    },
    [openDocument, openArtifact],
  );

  const showOverview = useCallback(() => {
    setSource(null);
    setCommentsOpen(false);
    setOpenArtifactId(null);
    setOpenDocumentId(null);
    setEditorOpen(false);
    setActiveComment(null);
  }, []);

  const startEdit = useCallback(() => {
    setEditError(null);
    setEditorOpen(true);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditError(null);
    setEditorOpen(false);
  }, []);

  const saveEdit = useCallback(
    async (content: string): Promise<void> => {
      const id = openArtifactIdRef.current;
      if (id === null) return;
      setSaving(true);
      setEditError(null);
      try {
        await artifactsApi.update(id, { content });
        setEditorOpen(false);
        invalidateArtifacts();
        await mutateArtifacts();
      } catch (err: unknown) {
        setEditError(errorMessage(err));
      } finally {
        setSaving(false);
      }
    },
    [mutateArtifacts],
  );

  const approve = useCallback(
    async (force: boolean): Promise<ApproveResult> => {
      const id = openArtifactIdRef.current;
      if (id === null) return { ok: false, message: null };
      setApproveBusy(true);
      setApproveError(null);
      try {
        const approved = await artifactsApi.approve(id, force, activeSessionIdRef.current);
        invalidateArtifacts();
        await mutateArtifacts();
        return { ok: true, message: approved.chat_message };
      } catch (err: unknown) {
        setApproveError(errorMessage(err));
        return { ok: false, message: null };
      } finally {
        setApproveBusy(false);
      }
    },
    [mutateArtifacts],
  );

  const downloadArtifact = useCallback(async (): Promise<void> => {
    const id = openArtifactIdRef.current;
    if (id === null) return;
    setManageError(null);
    try {
      await artifactsApi.download(id);
    } catch (err: unknown) {
      setManageError(errorMessage(err));
    }
  }, []);

  const deleteArtifact = useCallback(async (): Promise<void> => {
    const id = openArtifactIdRef.current;
    if (id === null) return;
    setManageError(null);
    try {
      await artifactsApi.delete(id);
    } catch (err: unknown) {
      setManageError(errorMessage(err));
      return;
    }
    showOverview();
    invalidateArtifacts();
    invalidateComments();
    await mutateArtifacts();
  }, [showOverview, mutateArtifacts]);

  const clearActionError = useCallback(() => {
    setEditError(null);
    setApproveError(null);
    setManageError(null);
  }, []);

  const artifactChanged = useCallback(
    async (change: { artifactId: string; start: number; end: number }): Promise<void> => {
      if (openArtifactIdRef.current !== change.artifactId) openArtifact(change.artifactId);
      try {
        await mutateArtifacts();
      } catch {
        // The highlight is best-effort; a failed refetch must not break the chat stream.
      }
      setHighlight({ artifactId: change.artifactId, start: change.start, end: change.end });
    },
    [openArtifact, mutateArtifacts],
  );

  const clearHighlight = useCallback(() => setHighlight(null), []);

  const clearChip = useCallback(() => setChip(null), []);

  const askComment = useCallback((comment: Comment) => {
    setChip({ id: comment.id, title: comment.title });
  }, []);

  // The chip disappears when its comment is resolved (derived from the comments list).
  const chipId = chip?.id ?? null;
  const chipStale =
    chipId !== null && openComments !== undefined && !openComments.some((c) => c.id === chipId && c.status === "open");
  useEffect(() => {
    if (chipStale) setChip(null);
  }, [chipStale]);

  const startRun = useCallback(
    async (artifact: Artifact, type: RunType): Promise<void> => {
      if (artifact.slot === null) return;
      await startActiveRun(type, artifact.slot);
    },
    [startActiveRun],
  );

  const retryRun = useCallback(async (): Promise<void> => {
    if (failedRun === null) return;
    await startActiveRun(failedRun.type, failedRun.slot);
  }, [failedRun, startActiveRun]);

  const newChat = useCallback(async () => {
    setChip(null);
    setSelectedSessionId(null);
    await createSession();
  }, [createSession]);

  const selectSession = useCallback((id: string) => {
    setChip(null);
    setSelectedSessionId(id);
  }, []);

  const uploadDocuments = useCallback(
    async (files: FileList): Promise<void> => {
      for (const file of Array.from(files)) {
        await documentsApi.upload(projectId, file);
      }
      invalidateDocuments(projectId);
      await mutateDocuments();
    },
    [projectId, mutateDocuments],
  );

  const deleteDocument = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm("Delete this document?")) return;
      await documentsApi.delete(id);
      invalidateDocuments(projectId);
      await mutateDocuments();
    },
    [projectId, mutateDocuments],
  );

  return {
    documents: documents ?? NO_DOCUMENTS,
    artifacts: artifacts ?? NO_ARTIFACTS,
    activeSession,
    sessions: allSessions,
    openArtifactId,
    openDocumentId,
    source,
    commentsOpen,
    editorOpen,
    chip: chipStale ? null : chip,
    activeCommentId,
    activationNonce,
    highlight,
    saving,
    editError,
    approveBusy,
    approveError,
    manageError,
    run,
    failedRun,
    runError: startError,
    locks,
    trackRun: track,
    startRun,
    retryRun,
    dismissRunFailure: dismissFailure,
    startEdit,
    cancelEdit,
    saveEdit,
    approve,
    downloadArtifact,
    deleteArtifact,
    clearActionError,
    artifactChanged,
    clearHighlight,
    openArtifact,
    openDocument,
    openSource,
    setCommentsOpen,
    setActiveCommentId,
    showOverview,
    clearChip,
    askComment,
    newChat,
    selectSession,
    uploadDocuments,
    deleteDocument,
  };
}
