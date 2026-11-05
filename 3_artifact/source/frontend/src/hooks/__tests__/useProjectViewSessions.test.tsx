import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { describe, expect, it } from "vitest";
import { useProjectView } from "@/hooks/useProjectView";
import { NEW_SESSION, PROJECT_ID, SESSION, SESSION_ID, server } from "@/test/msw-server";

const BASE = "http://localhost:8000/api/v1";

function wrapper({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

describe("useProjectView sessions", () => {
  it("lists sessions newest first and switches back to an older one", async () => {
    server.use(
      http.get(`${BASE}/sessions`, () => HttpResponse.json([SESSION, NEW_SESSION])),
    );
    const { result } = renderHook(() => useProjectView(PROJECT_ID), { wrapper });

    await waitFor(() => expect(result.current.sessions).toHaveLength(2));
    expect(result.current.sessions.map((s) => s.id)).toEqual([NEW_SESSION.id, SESSION_ID]);
    expect(result.current.activeSession?.id).toBe(NEW_SESSION.id);

    act(() => result.current.selectSession(SESSION_ID));
    expect(result.current.activeSession?.id).toBe(SESSION_ID);
  });

  it("New chat leaves an older selected session and activates the new one", async () => {
    server.use(
      http.get(`${BASE}/sessions`, () => HttpResponse.json([SESSION, NEW_SESSION])),
    );
    const { result } = renderHook(() => useProjectView(PROJECT_ID), { wrapper });
    await waitFor(() => expect(result.current.sessions).toHaveLength(2));

    act(() => result.current.selectSession(SESSION_ID));
    expect(result.current.activeSession?.id).toBe(SESSION_ID);

    await act(async () => {
      await result.current.newChat();
    });
    expect(result.current.activeSession?.id).toBe(NEW_SESSION.id);
  });
});
