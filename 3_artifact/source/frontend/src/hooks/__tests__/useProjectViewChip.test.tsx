import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { SWRConfig, useSWRConfig } from "swr";
import { describe, expect, it } from "vitest";
import { useProjectView } from "@/hooks/useProjectView";
import { PROJECT_ID, makeComment, server } from "@/test/msw-server";
import type { Comment } from "@/types";

const BASE = "http://localhost:8000/api/v1";

const FIRST = makeComment({ id: "c1", number: 1, title: "First comment" });
const SECOND = makeComment({ id: "c2", number: 2, title: "Second comment" });

function wrapper({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

function serveComments(getComments: () => Comment[]) {
  server.use(
    http.get(`${BASE}/comments`, ({ request }) => {
      const id = new URL(request.url).searchParams.get("artifact_id");
      return HttpResponse.json(id === "art-01" ? getComments() : []);
    }),
  );
}

async function setup(getComments: () => Comment[] = () => [FIRST, SECOND]) {
  serveComments(getComments);
  const hook = renderHook(
    () => {
      const view = useProjectView(PROJECT_ID);
      const { mutate } = useSWRConfig();
      return { ...view, refetchComments: () => mutate((key: unknown) => typeof key === "string" && key.includes("/comments?artifact_id=")) };
    },
    { wrapper },
  );
  await waitFor(() => expect(hook.result.current.artifacts.length).toBe(3));
  act(() => hook.result.current.openArtifact("art-01"));
  // Let the comments of the open artifact load before asking.
  await waitFor(() => expect(hook.result.current.openArtifactId).toBe("art-01"));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  return hook;
}

describe("useProjectView chip", () => {
  it("sets the chip on Ask and replaces it when asking another comment", async () => {
    const { result } = await setup();
    act(() => result.current.askComment(FIRST));
    expect(result.current.chip).toEqual({ id: "c1", title: "First comment" });
    act(() => result.current.askComment(SECOND));
    expect(result.current.chip).toEqual({ id: "c2", title: "Second comment" });
  });

  it("clears the chip explicitly", async () => {
    const { result } = await setup();
    act(() => result.current.askComment(FIRST));
    act(() => result.current.clearChip());
    expect(result.current.chip).toBeNull();
  });

  it("clears the chip when another artifact is opened", async () => {
    const { result } = await setup();
    act(() => result.current.askComment(FIRST));
    act(() => result.current.openArtifact("art-02"));
    expect(result.current.chip).toBeNull();
  });

  it("clears the chip on a new chat", async () => {
    const { result } = await setup();
    act(() => result.current.askComment(FIRST));
    await act(async () => {
      await result.current.newChat();
    });
    expect(result.current.chip).toBeNull();
  });

  it("drops the chip once its comment is no longer open", async () => {
    let comments: Comment[] = [FIRST, SECOND];
    const { result } = await setup(() => comments);
    act(() => result.current.askComment(FIRST));
    expect(result.current.chip?.id).toBe("c1");
    comments = [{ ...FIRST, status: "accepted" }, SECOND];
    await act(async () => {
      await result.current.refetchComments();
    });
    await waitFor(() => expect(result.current.chip).toBeNull());
  });

  it("keeps the chip of a comment that is still open after a refetch", async () => {
    const { result } = await setup();
    act(() => result.current.askComment(SECOND));
    await act(async () => {
      await result.current.refetchComments();
    });
    expect(result.current.chip?.id).toBe("c2");
  });
});
