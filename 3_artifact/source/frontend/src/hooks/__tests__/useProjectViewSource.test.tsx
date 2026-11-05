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
  return hook;
}

describe("useProjectView source panel", () => {
  it("opens a source while an artifact is open and closes it with null", async () => {
    const { result } = await setup();
    act(() => result.current.openArtifact("art-02"));
    act(() => result.current.openSource({ kind: "artifact", slot: "01" }));
    expect(result.current.source).toEqual({ kind: "artifact", slot: "01" });
    expect(result.current.openArtifactId).toBe("art-02");
    act(() => result.current.openSource({ kind: "document", documentId: "doc-1" }));
    expect(result.current.source).toEqual({ kind: "document", documentId: "doc-1" });
    act(() => result.current.openSource(null));
    expect(result.current.source).toBeNull();
  });

  it("closes the source when another artifact is opened", async () => {
    const { result } = await setup();
    act(() => result.current.openArtifact("art-02"));
    act(() => result.current.openSource({ kind: "artifact", slot: "01" }));
    act(() => result.current.openArtifact("art-03"));
    expect(result.current.source).toBeNull();
  });

  it("closes the source when going back to the overview", async () => {
    const { result } = await setup();
    act(() => result.current.openArtifact("art-02"));
    act(() => result.current.openSource({ kind: "artifact", slot: "01" }));
    act(() => result.current.showOverview());
    expect(result.current.source).toBeNull();
    expect(result.current.openArtifactId).toBeNull();
  });

  it("opens a cited document in the right column when no artifact is open", async () => {
    const { result } = await setup();
    act(() => result.current.openSource({ kind: "document", documentId: "doc-1" }));
    expect(result.current.source).toBeNull();
    expect(result.current.openDocumentId).toBe("doc-1");
  });

  it("opens a cited artifact as the artifact when none is open", async () => {
    const { result } = await setup();
    act(() => result.current.openSource({ kind: "artifact", slot: "02" }));
    expect(result.current.source).toBeNull();
    expect(result.current.openArtifactId).toBe("art-02");
  });

  it("keeps the comments overlay closed by default and resets it when leaving the artifact", async () => {
    const { result } = await setup();
    act(() => result.current.openArtifact("art-02"));
    expect(result.current.commentsOpen).toBe(false);
    act(() => result.current.setCommentsOpen(true));
    expect(result.current.commentsOpen).toBe(true);
    act(() => result.current.openArtifact("art-03"));
    expect(result.current.commentsOpen).toBe(false);
    act(() => result.current.setCommentsOpen(true));
    act(() => result.current.showOverview());
    expect(result.current.commentsOpen).toBe(false);
  });
});
