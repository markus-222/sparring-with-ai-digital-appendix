import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import React from "react";
import { SWRConfig } from "swr";
import { describe, expect, it, vi } from "vitest";
import { useChat, type ChatHandlers, type UseChatOptions } from "@/hooks/useChat";
import { API } from "@/lib/api/fetcher";
import { useArtifacts } from "@/lib/api/hooks";
import { PROJECT_ID, SESSION_ID, server, sseResponse, type SseFrame } from "@/test/msw-server";
import { makeProposal } from "@/test/proposals";
import type { Message } from "@/types";

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    SWRConfig,
    { value: { provider: () => new Map(), dedupingInterval: 0 } },
    children,
  );
}

const DONE: SseFrame = {
  event: "done",
  data: {
    message_id: "m-final",
    content: "Final answer",
    agent: "analyst",
    label: "Analyst",
    pending: false,
    proposal: null,
  },
};

function makeHandlers(): ChatHandlers {
  return {
    onArtifactChanged: vi.fn(),
    onOpenArtifact: vi.fn(),
    onRunStarted: vi.fn(),
    onChipCleared: vi.fn(),
    onUnauthorized: vi.fn(),
  };
}

function setup(overrides: Partial<UseChatOptions> = {}) {
  const handlers = makeHandlers();
  const props: UseChatOptions = {
    sessionId: SESSION_ID,
    openArtifactId: null,
    editorOpen: false,
    chip: null,
    handlers,
    ...overrides,
  };
  const hook = renderHook((p: UseChatOptions) => useChat(p), { wrapper, initialProps: props });
  return { ...hook, handlers, props };
}

async function seeded(result: { current: ReturnType<typeof useChat> }) {
  await waitFor(() => expect(result.current.state.messages).toHaveLength(3));
}

/** An SSE response whose stream stays open until the test closes it. */
function openSse() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: () => new HttpResponse(stream, { headers: { "Content-Type": "text/event-stream" } }),
    push(event: string, data: unknown) {
      controller?.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    },
    close() {
      controller?.close();
    },
  };
}

describe("useChat seeding", () => {
  it("maps persisted messages; every reply is the Analyst's", async () => {
    const { result } = setup();
    await seeded(result);
    const [greeting, user, analyst] = result.current.state.messages;
    expect(greeting).toMatchObject({ role: "assistant", agent: "analyst" });
    expect(user).toMatchObject({ role: "user", content: "Existing user message", agent: null });
    expect(analyst).toMatchObject({ role: "assistant", agent: "analyst", content: "Existing analyst response" });
  });

  it("does not re-seed on a re-render of the same session", async () => {
    server.use(http.post(`${API}/chat/stream`, () => sseResponse([DONE])));
    const { result, rerender, props } = setup();
    await seeded(result);
    await act(async () => {
      await result.current.send("Hello");
    });
    expect(result.current.state.messages).toHaveLength(5);
    rerender({ ...props });
    expect(result.current.state.messages).toHaveLength(5);
  });

  it("replaces the messages when the session changes", async () => {
    const { result, rerender, props } = setup();
    await seeded(result);
    rerender({ ...props, sessionId: "sess-test-new" });
    await waitFor(() => expect(result.current.state.messages).toHaveLength(1));
    expect(result.current.state.messages[0].content).toBe("Hi! I'll help you prepare the customer workshop.");
  });

  it("shows no messages without a session", () => {
    const { result } = setup({ sessionId: null });
    expect(result.current.state.messages).toEqual([]);
  });
});

describe("useChat send", () => {
  it("sends editor state and comment id with every request", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${API}/chat/stream`, async ({ request }) => {
        body = await request.json();
        return sseResponse([DONE]);
      }),
    );
    const { result } = setup({
      openArtifactId: "art-01",
      editorOpen: true,
      chip: { id: "c1", title: "Unclear scope" },
    });
    await seeded(result);
    await act(async () => {
      await result.current.send("Hello");
    });
    expect(body).toEqual({
      session_id: SESSION_ID,
      message: "Hello",
      open_artifact_id: "art-01",
      editor_open: true,
      comment_id: "c1",
    });
  });

  it("sends null ids when nothing is open or chipped", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${API}/chat/stream`, async ({ request }) => {
        body = await request.json();
        return sseResponse([DONE]);
      }),
    );
    const { result } = setup();
    await seeded(result);
    await act(async () => {
      await result.current.send("Hello");
    });
    expect(body).toEqual({
      session_id: SESSION_ID,
      message: "Hello",
      open_artifact_id: null,
      editor_open: false,
      comment_id: null,
    });
  });

  it("builds streamText from tokens and appends one analyst message on done", async () => {
    const sse = openSse();
    server.use(http.post(`${API}/chat/stream`, () => sse.response()));
    const { result } = setup();
    await seeded(result);

    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.send("Hi");
    });
    await waitFor(() => expect(result.current.state.busy).toBe(true));
    sse.push("token", "Hel");
    sse.push("token", "lo");
    await waitFor(() => expect(result.current.state.streamText).toBe("Hello"));

    sse.push("done", DONE.data);
    sse.close();
    await act(async () => {
      await pending;
    });

    const { messages, streamText, busy } = result.current.state;
    expect(busy).toBe(false);
    expect(streamText).toBe("");
    expect(messages).toHaveLength(5);
    expect(messages[4]).toMatchObject({ role: "assistant", agent: "analyst", content: "Final answer" });
  });

  it("Stop retracts the unanswered user message and hands its text back", async () => {
    const sse = openSse();
    server.use(http.post(`${API}/chat/stream`, () => sse.response()));
    const { result } = setup();
    await seeded(result);

    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.send("  Hi there ");
    });
    await waitFor(() => expect(result.current.state.busy).toBe(true));
    sse.push("token", "Par");
    await waitFor(() => expect(result.current.state.streamText).toBe("Par"));

    act(() => result.current.abort());
    await act(async () => {
      await pending;
    });

    expect(result.current.state.busy).toBe(false);
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.messages).toHaveLength(3);
    expect(result.current.restored?.text).toBe("Hi there");
  });

  it("Stop keeps the user message once the turn changed something", async () => {
    const sse = openSse();
    server.use(http.post(`${API}/chat/stream`, () => sse.response()));
    const { result, handlers } = setup();
    await seeded(result);

    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.send("Make a draft");
    });
    await waitFor(() => expect(result.current.state.busy).toBe(true));
    sse.push("artifact_changed", { artifact_id: "art-01", start: 0, end: 1 });
    await waitFor(() => expect(handlers.onArtifactChanged).toHaveBeenCalled());

    act(() => result.current.abort());
    await act(async () => {
      await pending;
    });

    expect(result.current.state.messages).toHaveLength(4);
    expect(result.current.restored).toBeNull();
  });

  it("prefixes the optimistic user message with the chip", async () => {
    const sse = openSse();
    server.use(http.post(`${API}/chat/stream`, () => sse.response()));
    const { result } = setup({ chip: { id: "c1", title: "Unclear scope" } });
    await seeded(result);

    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.send("What do you mean?");
    });
    await waitFor(() => expect(result.current.state.messages).toHaveLength(4));
    expect(result.current.state.messages[3]).toMatchObject({
      role: "user",
      content: "📎 re: Unclear scope\nWhat do you mean?",
    });

    sse.push("done", DONE.data);
    sse.close();
    await act(async () => {
      await pending;
    });
  });

  it("calls the side-effect handlers with camelCase fields", async () => {
    server.use(
      http.post(`${API}/chat/stream`, () =>
        sseResponse([
          { event: "run_started", data: { run_id: "run-1" } },
          { event: "artifact_changed", data: { artifact_id: "art-01", start: 3, end: 17 } },
          { event: "open_artifact", data: { artifact_id: "art-02" } },
          { event: "chip_cleared", data: {} },
          DONE,
        ]),
      ),
    );
    const { result, handlers } = setup();
    await seeded(result);
    await act(async () => {
      await result.current.send("Go");
    });
    expect(handlers.onRunStarted).toHaveBeenCalledWith("run-1");
    expect(handlers.onArtifactChanged).toHaveBeenCalledWith({ artifactId: "art-01", start: 3, end: 17 });
    expect(handlers.onOpenArtifact).toHaveBeenCalledWith("art-02");
    expect(handlers.onChipCleared).toHaveBeenCalledTimes(1);
  });

  it("append adds a message once; a legacy agent_name is shown as Analyst", async () => {
    const { result } = setup();
    await seeded(result);
    const message: Message = {
      id: "m-approval",
      role: "assistant",
      content: "01 Problem- and Scope-Definition ist freigegeben.",
      agent_name: "assistant",
      tool_calls: null,
      proposal: null,
      created_at: "2026-06-01T10:00:03Z",
    };
    act(() => result.current.append(message));
    act(() => result.current.append(message));
    const messages = result.current.state.messages;
    expect(messages).toHaveLength(4);
    expect(messages[3]).toMatchObject({
      id: "m-approval",
      role: "assistant",
      content: message.content,
      agent: "analyst",
    });
  });

  it("calls onUnauthorized on a 401 and shows no error", async () => {
    server.use(
      http.post(`${API}/chat/stream`, () => HttpResponse.json({ detail: "Not authenticated" }, { status: 401 })),
    );
    const { result, handlers } = setup();
    await seeded(result);
    await act(async () => {
      await result.current.send("Hi");
    });
    expect(handlers.onUnauthorized).toHaveBeenCalledTimes(1);
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.busy).toBe(false);
  });

  it("shows the backend message for other API errors", async () => {
    server.use(http.post(`${API}/chat/stream`, () => HttpResponse.json({ detail: "boom" }, { status: 500 })));
    const { result, handlers } = setup();
    await seeded(result);
    await act(async () => {
      await result.current.send("Hi");
    });
    expect(result.current.state.error).toBe("boom");
    expect(handlers.onUnauthorized).not.toHaveBeenCalled();
  });

  it("reports an interruption when the stream ends without done", async () => {
    server.use(http.post(`${API}/chat/stream`, () => sseResponse([{ event: "token", data: "Partial" }])));
    const { result } = setup();
    await seeded(result);
    await act(async () => {
      await result.current.send("Hi");
    });
    expect(result.current.state.error).toBe("The connection was interrupted. Please try again.");
    expect(result.current.state.busy).toBe(false);
    expect(result.current.state.streamText).toBe("");
  });

  it("does nothing without a session or for blank text", async () => {
    let calls = 0;
    server.use(
      http.post(`${API}/chat/stream`, () => {
        calls += 1;
        return sseResponse([DONE]);
      }),
    );
    const noSession = setup({ sessionId: null });
    await act(async () => {
      await noSession.result.current.send("Hi");
    });
    const blank = setup();
    await seeded(blank.result);
    await act(async () => {
      await blank.result.current.send("   ");
    });
    expect(calls).toBe(0);
  });

  it("clears the error on clearError", async () => {
    server.use(http.post(`${API}/chat/stream`, () => HttpResponse.json({ detail: "boom" }, { status: 500 })));
    const { result } = setup();
    await seeded(result);
    await act(async () => {
      await result.current.send("Hi");
    });
    act(() => result.current.clearError());
    expect(result.current.state.error).toBeNull();
  });

  it("refetches artifacts after done", async () => {
    let artifactFetches = 0;
    server.use(
      http.get(`${API}/artifacts`, () => {
        artifactFetches += 1;
        return HttpResponse.json([]);
      }),
      http.post(`${API}/chat/stream`, () => sseResponse([DONE])),
    );
    // Cache helpers use the global SWR cache, so this test uses the default provider.
    const handlers = makeHandlers();
    const { result } = renderHook(
      () => ({
        chat: useChat({ sessionId: SESSION_ID, openArtifactId: null, editorOpen: false, chip: null, handlers }),
        artifacts: useArtifacts(PROJECT_ID),
      }),
      { wrapper: ({ children }) => React.createElement(SWRConfig, { value: { dedupingInterval: 0 } }, children) },
    );
    await waitFor(() => expect(artifactFetches).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(result.current.chat.state.messages).toHaveLength(3));
    const before = artifactFetches;
    await act(async () => {
      await result.current.chat.send("Hi");
    });
    await waitFor(() => expect(artifactFetches).toBeGreaterThan(before));
  });
});

describe("useChat resolveProposal", () => {
  const CARD_DONE: SseFrame = {
    event: "done",
    data: {
      message_id: "m-card",
      content: "Soll ich diese 2 Fragen zu 03 hinzufügen?",
      agent: "analyst",
      label: "Analyst",
      pending: true,
      proposal: makeProposal(),
    },
  };

  async function withCard() {
    server.use(http.post(`${API}/chat/stream`, () => sseResponse([CARD_DONE])));
    const ctx = setup();
    await seeded(ctx.result);
    await act(async () => {
      await ctx.result.current.send("Was ist offen?");
    });
    return ctx;
  }

  it("keeps the proposal of a done event on the message", async () => {
    const { result } = await withCard();
    const last = result.current.state.messages.at(-1);
    expect(last).toMatchObject({ id: "m-card", proposal: { id: "prop-1", status: "open" } });
    expect(result.current.state.pending).toBe(true);
  });

  it("settles the card, appends the reply and opens the changed artifact", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${API}/sessions/${SESSION_ID}/proposals/m-card/resolve`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          message_id: "m-card",
          proposal: makeProposal({ status: "accepted" }),
          reply: {
            id: "m-reply",
            role: "assistant",
            content: "2 Fragen hinzugefügt.",
            agent_name: "assistant",
            tool_calls: null,
            proposal: null,
            created_at: "2026-06-01T10:06:00Z",
          },
          artifact_id: "a3",
          start: 5,
          end: 50,
        });
      }),
    );
    const { result, handlers } = await withCard();
    let outcome: Awaited<ReturnType<typeof result.current.resolveProposal>> | undefined;
    await act(async () => {
      outcome = await result.current.resolveProposal("m-card", "accept", ["q1", "q2"]);
    });
    expect(outcome).toEqual({ ok: true });
    expect(body).toEqual({ action: "accept", question_ids: ["q1", "q2"], revoke: false, editor_open: false });
    const { messages, pending } = result.current.state;
    expect(pending).toBe(false);
    expect(messages.at(-2)?.proposal?.status).toBe("accepted");
    expect(messages.at(-1)).toMatchObject({ id: "m-reply", content: "2 Fragen hinzugefügt." });
    expect(handlers.onOpenArtifact).toHaveBeenCalledWith("a3");
    expect(handlers.onArtifactChanged).toHaveBeenCalledWith({ artifactId: "a3", start: 5, end: 50 });
  });

  it("returns the error code and leaves the card open on a 409", async () => {
    server.use(
      http.post(`${API}/sessions/${SESSION_ID}/proposals/m-card/resolve`, () =>
        HttpResponse.json({ detail: { code: "needs_revoke", message: "03 is approved" } }, { status: 409 }),
      ),
    );
    const { result, handlers } = await withCard();
    let outcome: Awaited<ReturnType<typeof result.current.resolveProposal>> | undefined;
    await act(async () => {
      outcome = await result.current.resolveProposal("m-card", "accept", ["q1"]);
    });
    expect(outcome).toEqual({ ok: false, code: "needs_revoke", message: "03 is approved" });
    expect(result.current.state.messages.at(-1)?.proposal?.status).toBe("open");
    expect(handlers.onArtifactChanged).not.toHaveBeenCalled();
  });
});
