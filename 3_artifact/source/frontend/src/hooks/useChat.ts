"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { streamChat } from "@/lib/api/chat";
import { invalidateArtifacts, invalidateComments } from "@/lib/api/cache";
import { ApiError } from "@/lib/api/errors";
import { proposalsApi } from "@/lib/api/proposals";
import { useSession } from "@/lib/api/hooks";
import {
  chatReducer,
  initialChatState,
  type ChatMessage,
  type ChatState,
} from "@/lib/chat/state";
import type { Message } from "@/types";
import type { ChatRequestBody, ChatStreamEvent } from "@/types/chat";

export interface ChatChip {
  id: string;
  title: string;
}

export interface ChatHandlers {
  onArtifactChanged(e: { artifactId: string; start: number; end: number }): void;
  onOpenArtifact(id: string): void;
  onRunStarted(runId: string): void;
  onChipCleared(): void;
  onUnauthorized(): void;
}

export interface UseChatOptions {
  sessionId: string | null;
  openArtifactId: string | null;
  editorOpen: boolean;
  chip: ChatChip | null;
  handlers: ChatHandlers;
}

export type ProposalResult =
  | { ok: true }
  | { ok: false; code: string | null; message: string };

/** Text of a message taken back by Stop; `nonce` makes the same text restorable twice. */
export interface RestoredText {
  text: string;
  nonce: number;
}

export interface UseChat {
  state: ChatState;
  /** Set when Stop took the user message back, so the input can show it again. */
  restored: RestoredText | null;
  send(text: string): Promise<void>;
  /** Accept the chosen questions of a card (or reject it with an empty selection). */
  resolveProposal(
    messageId: string,
    action: "accept" | "reject",
    questionIds: string[],
    revoke?: boolean,
  ): Promise<ProposalResult>;
  /** Adds a message written outside the stream (e.g. the approval message); a known id is ignored. */
  append(message: Message): void;
  /** Adds a local assistant bubble not backed by a server message (e.g. "draft finished"). */
  appendNote(text: string): void;
  /** Stops the running reply; the user message returns to the input unless the turn already changed something. */
  abort(): void;
  clearError(): void;
}

function toChatMessages(messages: Message[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ id: m.id, role: "user", content: m.content, agent: null });
    } else if (m.role === "assistant") {
      out.push({
        id: m.id,
        role: "assistant",
        content: m.content,
        agent: "analyst",
        proposal: m.proposal,
      });
    }
  }
  return out;
}

export function useChat(opts: UseChatOptions): UseChat {
  const { sessionId, openArtifactId, editorOpen, chip, handlers } = opts;
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const { data: session } = useSession(sessionId);

  // Seed from the server once per session id; afterwards the reducer owns the messages,
  // so a refetch of the session detail can never wipe local state.
  const seededFor = useRef<string | null>(null);
  const resetFor = useRef<string | null>(null);
  useEffect(() => {
    if (sessionId === null) {
      seededFor.current = null;
      resetFor.current = null;
      dispatch({ type: "seed", messages: [] });
      return;
    }
    if (session && session.id === sessionId) {
      if (seededFor.current !== sessionId) {
        seededFor.current = sessionId;
        resetFor.current = sessionId;
        dispatch({ type: "seed", messages: toChatMessages(session.messages) });
      }
    } else if (resetFor.current !== sessionId) {
      // New session still loading: do not show the previous chat meanwhile.
      resetFor.current = sessionId;
      dispatch({ type: "seed", messages: [] });
    }
  }, [sessionId, session]);

  const abortRef = useRef<AbortController | null>(null);
  const stoppedByUserRef = useRef(false);
  const committedRef = useRef(false);
  const [restored, setRestored] = useState<RestoredText | null>(null);
  const busyRef = useRef(false);
  const counterRef = useRef(0);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // A different session (or unmount) cancels the running request.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, [sessionId]);

  const send = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (sessionId === null || trimmed === "" || busyRef.current) return;
      busyRef.current = true;
      stoppedByUserRef.current = false;
      committedRef.current = false;

      const nextId = (prefix: string): string => {
        counterRef.current += 1;
        return `${prefix}-${Date.now()}-${counterRef.current}`;
      };
      const shown = chip ? `📎 re: ${chip.title}\n${trimmed}` : trimmed;
      dispatch({ type: "sent", id: nextId("user"), content: shown });

      const body: ChatRequestBody = {
        session_id: sessionId,
        message: trimmed,
        open_artifact_id: openArtifactId,
        editor_open: editorOpen,
        comment_id: chip?.id ?? null,
      };
      const controller = new AbortController();
      abortRef.current = controller;

      const onEvent = (event: ChatStreamEvent): void => {
        dispatch({ type: "event", id: nextId("msg"), event });
        // The server commits before these events, so the turn (and the user message) is persisted.
        if (
          event.type === "artifact_changed" ||
          event.type === "open_artifact" ||
          event.type === "run_started" ||
          event.type === "proposal_settled"
        ) {
          committedRef.current = true;
        }
        const h = handlersRef.current;
        switch (event.type) {
          case "artifact_changed":
            h.onArtifactChanged({ artifactId: event.artifactId, start: event.start, end: event.end });
            break;
          case "open_artifact":
            h.onOpenArtifact(event.artifactId);
            break;
          case "run_started":
            h.onRunStarted(event.runId);
            break;
          case "chip_cleared":
            h.onChipCleared();
            break;
          case "proposal_settled":
          case "done":
            // Covers AI changes and resolved comments; cheap compared to tracking which changed.
            invalidateArtifacts();
            invalidateComments();
            break;
          default:
            break;
        }
      };

      try {
        await streamChat(body, onEvent, controller.signal);
        dispatch({ type: "closed" });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          const retract = stoppedByUserRef.current && !committedRef.current;
          dispatch({ type: "aborted", retract });
          if (retract) setRestored({ text: trimmed, nonce: counterRef.current });
        } else if (err instanceof ApiError && err.status === 401) {
          dispatch({ type: "aborted" });
          handlersRef.current.onUnauthorized();
        } else {
          dispatch({
            type: "failed",
            message: err instanceof Error ? err.message : "Something went wrong. Please try again.",
          });
        }
      } finally {
        busyRef.current = false;
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [sessionId, openArtifactId, editorOpen, chip],
  );

  const resolveProposal = useCallback(
    async (
      messageId: string,
      action: "accept" | "reject",
      questionIds: string[],
      revoke = false,
    ): Promise<ProposalResult> => {
      if (sessionId === null) return { ok: false, code: null, message: "No active chat." };
      try {
        const result = await proposalsApi.resolve(sessionId, messageId, {
          action,
          question_ids: questionIds,
          revoke,
          editor_open: editorOpen,
        });
        const reply: ChatMessage | null = result.reply
          ? { id: result.reply.id, role: "assistant", content: result.reply.content, agent: "analyst" }
          : null;
        dispatch({ type: "proposal_settled", messageId: result.message_id, proposal: result.proposal, reply });
        if (result.artifact_id !== null && result.start !== null && result.end !== null) {
          const h = handlersRef.current;
          if (result.artifact_id !== openArtifactId) h.onOpenArtifact(result.artifact_id);
          h.onArtifactChanged({ artifactId: result.artifact_id, start: result.start, end: result.end });
        }
        invalidateArtifacts();
        return { ok: true };
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 401) {
          handlersRef.current.onUnauthorized();
        }
        if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message };
        return { ok: false, code: null, message: "Something went wrong. Please try again." };
      }
    },
    [sessionId, openArtifactId, editorOpen],
  );

  const append = useCallback((message: Message): void => {
    for (const chatMessage of toChatMessages([message])) {
      dispatch({ type: "appended", message: chatMessage });
    }
  }, []);

  const appendNote = useCallback((text: string): void => {
    counterRef.current += 1;
    const id = `note-${Date.now()}-${counterRef.current}`;
    dispatch({
      type: "appended",
      message: { id, role: "assistant", content: text, agent: null, kind: "note" },
    });
  }, []);

  const abort = useCallback((): void => {
    stoppedByUserRef.current = true;
    abortRef.current?.abort();
  }, []);

  const clearError = useCallback((): void => {
    dispatch({ type: "clear_error" });
  }, []);

  return { state, restored, send, resolveProposal, append, appendNote, abort, clearError };
}
