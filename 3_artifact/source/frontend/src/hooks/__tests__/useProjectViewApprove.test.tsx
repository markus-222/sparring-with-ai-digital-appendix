import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { describe, expect, it } from "vitest";
import { useProjectView } from "@/hooks/useProjectView";
import { makeArtifact, PROJECT_ID, SESSION_ID, server } from "@/test/msw-server";
import type { Message } from "@/types";

const BASE = "http://localhost:8000/api/v1";

function wrapper({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

const APPROVAL_MESSAGE: Message = {
  id: "msg-approval",
  role: "assistant",
  content: "01 Problem- and Scope-Definition ist freigegeben.",
  agent_name: "analyst",
  tool_calls: null,
  proposal: null,
  created_at: "2026-06-01T10:00:05Z",
};

async function openedView() {
  const hook = renderHook(() => useProjectView(PROJECT_ID), { wrapper });
  await waitFor(() => expect(hook.result.current.activeSession?.id).toBe(SESSION_ID));
  await waitFor(() => expect(hook.result.current.artifacts.length).toBeGreaterThan(0));
  act(() => hook.result.current.openArtifact("art-01"));
  return hook;
}

describe("useProjectView approve", () => {
  it("sends the active session id and returns the chat message", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/artifacts/art-01/approve`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          ...makeArtifact("01", { status: "approved" }),
          chat_message: APPROVAL_MESSAGE,
        });
      }),
    );
    const { result } = await openedView();

    let outcome: Awaited<ReturnType<typeof result.current.approve>> | null = null;
    await act(async () => {
      outcome = await result.current.approve(true);
    });

    expect(body).toEqual({ force: true, session_id: SESSION_ID });
    expect(outcome).toEqual({ ok: true, message: APPROVAL_MESSAGE });
  });

  it("returns no message when the backend sends none", async () => {
    server.use(
      http.post(`${BASE}/artifacts/art-01/approve`, () =>
        HttpResponse.json({ ...makeArtifact("01", { status: "approved" }), chat_message: null }),
      ),
    );
    const { result } = await openedView();

    let outcome: Awaited<ReturnType<typeof result.current.approve>> | null = null;
    await act(async () => {
      outcome = await result.current.approve(false);
    });

    expect(outcome).toEqual({ ok: true, message: null });
  });

  it("reports a rejected approval without a message", async () => {
    server.use(
      http.post(`${BASE}/artifacts/art-01/approve`, () =>
        HttpResponse.json({ detail: { code: "not_reviewed", message: "Not reviewed." } }, { status: 409 }),
      ),
    );
    const { result } = await openedView();

    let outcome: Awaited<ReturnType<typeof result.current.approve>> | null = null;
    await act(async () => {
      outcome = await result.current.approve(false);
    });

    expect(outcome).toEqual({ ok: false, message: null });
    expect(result.current.approveError).not.toBeNull();
  });
});
