import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { SWRConfig } from "swr";
import { describe, expect, it, vi } from "vitest";
import { ArtifactView, type ArtifactViewProps } from "@/components/artifact/ArtifactView";
import type { CommentAnchor } from "@/hooks/useCommentAnchors";
import { makeArtifact, makeComment, server } from "@/test/msw-server";
import type { Artifact, Comment } from "@/types";

const BASE = "http://localhost:8000/api/v1";

const CONTENT = "## Goals\n\nShip the pilot.\n\nOwner is unclear.\n\nBudget is open.\n";

function textChange(id: string, find: string, overrides: Partial<Comment> = {}): Comment {
  return makeComment({
    id,
    suggestion: { kind: "text_change", find, replace: `${find} (fixed)` },
    ...overrides,
  });
}

function serveComments(comments: Comment[]): void {
  server.use(http.get(`${BASE}/comments`, () => HttpResponse.json(comments)));
}

function viewProps(artifact: Artifact, overrides: Partial<ArtifactViewProps> = {}): ArtifactViewProps {
  return {
    artifact,
    documents: [],
    artifacts: [artifact],
    locks: { runLocked: false, editorLocked: false },
    onRequestReview: () => undefined,
    editing: false,
    saving: false,
    editError: null,
    onStartEdit: () => undefined,
    onCancelEdit: () => undefined,
    onSaveEdit: async () => undefined,
    approveBusy: false,
    approveError: null,
    onApprove: async () => true,
    onClearActionError: () => undefined,
    onDownload: () => undefined,
    onDelete: () => undefined,
    onBack: () => undefined,
    onOpenSource: () => undefined,
    commentsOpen: false,
    onToggleComments: () => undefined,
    ...overrides,
  };
}

function tree(props: ArtifactViewProps) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ArtifactView {...props} />
    </SWRConfig>
  );
}

function artifactWith(content: string): Artifact {
  return makeArtifact("01", { status: "draft", content });
}

function marked(container: HTMLElement): [string | undefined, string | null][] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-comment-id]")).map((el) => [
    el.dataset.commentId,
    el.textContent,
  ]);
}

describe("ArtifactView comment annotations", () => {
  it("highlights the passage of a text_change comment with role, hypothesis and active flag", async () => {
    serveComments([
      textChange("c1", "Owner is unclear.", { role: "explorer", hypothesis: true }),
      textChange("c2", "Budget is open."),
    ]);
    const { container } = render(tree(viewProps(artifactWith(CONTENT), { activeCommentId: "c2" })));
    await waitFor(() => expect(marked(container)).toEqual([["c1", "Owner is unclear."], ["c2", "Budget is open."]]));
    const [first, second] = Array.from(container.querySelectorAll<HTMLElement>("[data-comment-id]"));
    expect(first).toHaveClass("annotation--explorer", "annotation--hypothesis");
    expect(first).not.toHaveClass("annotation--active");
    expect(second).toHaveClass("annotation--reviewer", "annotation--active");
    expect(second).not.toHaveClass("annotation--hypothesis");
  });

  it("moves the active flag when activeCommentId changes", async () => {
    serveComments([textChange("c1", "Owner is unclear."), textChange("c2", "Budget is open.")]);
    const artifact = artifactWith(CONTENT);
    const { container, rerender } = render(tree(viewProps(artifact, { activeCommentId: "c1" })));
    await waitFor(() => expect(container.querySelector(".annotation--active")?.textContent).toBe("Owner is unclear."));
    rerender(tree(viewProps(artifact, { activeCommentId: "c2" })));
    await waitFor(() => expect(container.querySelector(".annotation--active")?.textContent).toBe("Budget is open."));
    expect(container.querySelectorAll(".annotation--active")).toHaveLength(1);
  });

  it("does not annotate unresolved, ambiguous, workshop_question and non-open comments", async () => {
    serveComments([
      textChange("ok", "Ship the pilot."),
      textChange("missing", "Text that is not in the artifact."),
      textChange("twice", "Same line."),
      makeComment({ id: "ask", suggestion: { kind: "workshop_question", text: "Who owns it?" } }),
      makeComment({ id: "none", suggestion: null }),
      textChange("done", "Budget is open.", { status: "accepted" }),
    ]);
    const content = `${CONTENT}\nSame line.\n\nSame line.\n`;
    const onAnchorsChange = vi.fn();
    const { container } = render(tree(viewProps(artifactWith(content), { onAnchorsChange })));
    await waitFor(() => expect(marked(container)).toEqual([["ok", "Ship the pilot."]]));
    const last = onAnchorsChange.mock.calls[onAnchorsChange.mock.calls.length - 1]?.[0] as CommentAnchor[] | null;
    expect(last?.map((a) => a.id)).toEqual(["ok"]);
  });

  it("reports anchors as {id, from, to}, null while comments are loading and on unmount", async () => {
    serveComments([textChange("c1", "Ship the pilot.")]);
    const onAnchorsChange = vi.fn();
    const { container, unmount } = render(tree(viewProps(artifactWith(CONTENT), { onAnchorsChange })));
    await waitFor(() => expect(marked(container)).toHaveLength(1));
    const reported = onAnchorsChange.mock.calls.map((c) => c[0] as CommentAnchor[] | null);
    expect(reported[0]).toBeNull();
    const last = reported[reported.length - 1];
    expect(last).toEqual([{ id: "c1", from: expect.any(Number), to: expect.any(Number) }]);
    expect((last?.[0]?.to ?? 0) - (last?.[0]?.from ?? 0)).toBe("Ship the pilot.".length);
    unmount();
    expect(onAnchorsChange).toHaveBeenLastCalledWith(null);
  });

  it("re-applies the annotations after the content changed (they survive a content swap)", async () => {
    serveComments([textChange("c1", "Ship the pilot."), textChange("c2", "Budget is open.")]);
    const { container, rerender } = render(tree(viewProps(artifactWith(CONTENT))));
    await waitFor(() => expect(marked(container)).toHaveLength(2));

    const edited = "## Goals\n\nA new intro paragraph.\n\nShip the pilot.\n\nBudget is open.\n";
    rerender(tree(viewProps(artifactWith(edited))));
    await screen.findByText("A new intro paragraph.");
    await waitFor(() => expect(marked(container)).toEqual([["c1", "Ship the pilot."], ["c2", "Budget is open."]]));
  });

  it("drops the highlight of a comment whose passage vanished with the content swap", async () => {
    serveComments([textChange("c1", "Ship the pilot."), textChange("c2", "Budget is open.")]);
    const onAnchorsChange = vi.fn();
    const { container, rerender } = render(tree(viewProps(artifactWith(CONTENT), { onAnchorsChange })));
    await waitFor(() => expect(marked(container)).toHaveLength(2));

    rerender(tree(viewProps(artifactWith("## Goals\n\nBudget is open.\n"), { onAnchorsChange })));
    await waitFor(() => expect(marked(container)).toEqual([["c2", "Budget is open."]]));
    const last = onAnchorsChange.mock.calls[onAnchorsChange.mock.calls.length - 1]?.[0] as CommentAnchor[] | null;
    expect(last?.map((a) => a.id)).toEqual(["c2"]);
  });

  it("never reports anchors of the old document for new content", async () => {
    serveComments([textChange("c1", "Ship the pilot.")]);
    const onAnchorsChange = vi.fn();
    const { container, rerender } = render(tree(viewProps(artifactWith(CONTENT), { onAnchorsChange })));
    await waitFor(() => expect(marked(container)).toHaveLength(1));
    const before = onAnchorsChange.mock.calls[onAnchorsChange.mock.calls.length - 1]?.[0] as CommentAnchor[];
    const shifted = "## Goals\n\nPrefix paragraph with some length.\n\nShip the pilot.\n";
    onAnchorsChange.mockClear();
    rerender(tree(viewProps(artifactWith(shifted), { onAnchorsChange })));
    await waitFor(() => expect(marked(container)).toEqual([["c1", "Ship the pilot."]]));
    const reported = onAnchorsChange.mock.calls.map((c) => c[0] as CommentAnchor[] | null);
    expect(reported.filter((a) => a !== null && a[0]?.from === before[0]?.from)).toEqual([]);
  });

  it("reports a click on a highlight through onActivateComment", async () => {
    serveComments([textChange("c1", "Ship the pilot.")]);
    const onActivateComment = vi.fn();
    const { container } = render(tree(viewProps(artifactWith(CONTENT), { onActivateComment })));
    await waitFor(() => expect(marked(container)).toHaveLength(1));
    fireEvent.click(container.querySelector("[data-comment-id]") as HTMLElement);
    expect(onActivateComment).toHaveBeenCalledWith("c1");
  });

  it("annotates nothing while editing (the reading view is unmounted) and reports unknown anchors", async () => {
    serveComments([textChange("c1", "Ship the pilot.")]);
    const onAnchorsChange = vi.fn();
    const artifact = artifactWith(CONTENT);
    const { container, rerender } = render(tree(viewProps(artifact, { onAnchorsChange })));
    await waitFor(() => expect(marked(container)).toHaveLength(1));
    rerender(tree(viewProps(artifact, { onAnchorsChange, editing: true })));
    await waitFor(() => expect(onAnchorsChange).toHaveBeenLastCalledWith(null));
    expect(marked(container)).toEqual([]);
    await act(async () => undefined);
  });
});
