import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { describe, expect, it } from "vitest";
import { useProjectView } from "@/hooks/useProjectView";
import { PROJECT_ID } from "@/test/msw-server";

function wrapper({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

async function setup() {
  const hook = renderHook(() => useProjectView(PROJECT_ID), { wrapper });
  await waitFor(() => expect(hook.result.current.artifacts.length).toBe(3));
  act(() => hook.result.current.openArtifact("art-01"));
  return hook;
}

describe("useProjectView active comment", () => {
  it("starts without an active comment", async () => {
    const { result } = await setup();
    expect(result.current.activeCommentId).toBeNull();
  });

  it("opens the comments column when a comment becomes active", async () => {
    const { result } = await setup();
    expect(result.current.commentsOpen).toBe(false);
    act(() => result.current.setActiveCommentId("c1"));
    expect(result.current.activeCommentId).toBe("c1");
    expect(result.current.commentsOpen).toBe(true);
  });

  it("clearing the active comment leaves the column as it is", async () => {
    const { result } = await setup();
    act(() => result.current.setActiveCommentId("c1"));
    act(() => result.current.setCommentsOpen(false));
    act(() => result.current.setActiveCommentId(null));
    expect(result.current.activeCommentId).toBeNull();
    expect(result.current.commentsOpen).toBe(false);
  });

  it("resets the active comment when another artifact is opened", async () => {
    const { result } = await setup();
    act(() => result.current.setActiveCommentId("c1"));
    act(() => result.current.openArtifact("art-02"));
    expect(result.current.activeCommentId).toBeNull();
  });

  it("resets the active comment on the overview", async () => {
    const { result } = await setup();
    act(() => result.current.setActiveCommentId("c1"));
    act(() => result.current.showOverview());
    expect(result.current.activeCommentId).toBeNull();
  });

  describe("activation nonce", () => {
    it("starts at 0", async () => {
      const { result } = await setup();
      expect(result.current.activationNonce).toBe(0);
    });

    it("counts every selection, including a repeated one of the already active comment", async () => {
      const { result } = await setup();
      act(() => result.current.setActiveCommentId("c1"));
      expect(result.current.activationNonce).toBe(1);
      act(() => result.current.setActiveCommentId("c1"));
      expect(result.current.activeCommentId).toBe("c1");
      expect(result.current.activationNonce).toBe(2);
      act(() => result.current.setActiveCommentId("c2"));
      expect(result.current.activationNonce).toBe(3);
    });

    it("does not count a clear", async () => {
      const { result } = await setup();
      act(() => result.current.setActiveCommentId("c1"));
      act(() => result.current.setActiveCommentId(null));
      expect(result.current.activationNonce).toBe(1);
    });

    it("re-opens a column that was closed while the comment stayed active", async () => {
      const { result } = await setup();
      act(() => result.current.setActiveCommentId("c1"));
      act(() => result.current.setCommentsOpen(false));
      act(() => result.current.setActiveCommentId("c1"));
      expect(result.current.commentsOpen).toBe(true);
    });
  });
});
