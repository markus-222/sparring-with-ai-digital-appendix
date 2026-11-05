import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { SWRConfig } from "swr";
import { describe, expect, it, vi } from "vitest";
import { CommentsColumn, type CommentsColumnProps } from "@/components/comments/CommentsColumn";
import { useArtifacts } from "@/lib/api/hooks";
import { PROJECT_ID, makeComment, server } from "@/test/msw-server";
import { mockReducedMotion, removeMatchMedia } from "@/test/reducedMotion";
import type { Comment, CommentOutcome } from "@/types";

const BASE = "http://localhost:8000/api/v1";
const ARTIFACT_ID = "art-01";
const RUN_REASON = "A run is active. Please wait until it has finished.";
const EDITOR_REASON = "Please save or cancel your edits first.";

const REVIEWER_A = makeComment({ id: "r-a", number: 1, title: "Reviewer first" });
const EXPLORER = makeComment({
  id: "e-1",
  number: 2,
  role: "explorer",
  hypothesis: true,
  title: "Explorer hypothesis",
  suggestion: { kind: "workshop_question", text: "Who decides?" },
});
const REVIEWER_B = makeComment({ id: "r-b", number: 3, title: "Reviewer second" });
const RESOLVED = makeComment({ id: "done-1", number: 4, title: "Already resolved", status: "accepted" });

function serveComments(getComments: () => Comment[]) {
  server.use(
    http.get(`${BASE}/comments`, ({ request }) => {
      const id = new URL(request.url).searchParams.get("artifact_id");
      return HttpResponse.json(id === ARTIFACT_ID ? getComments() : []);
    }),
  );
}

function props(overrides: Partial<CommentsColumnProps> = {}): CommentsColumnProps {
  return {
    artifactId: ARTIFACT_ID,
    locks: { runLocked: false, editorLocked: false },
    reviewedEmpty: false,
    chipCommentId: null,
    onAsk: vi.fn(),
    onChanged: vi.fn(),
    ...overrides,
  };
}

function mount(p: CommentsColumnProps) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CommentsColumn {...p} />
    </SWRConfig>,
  );
}

function card(title: string): HTMLElement {
  const el = screen.getByText(title).closest("[data-testid='comment-card']");
  if (!(el instanceof HTMLElement)) throw new Error(`no card for ${title}`);
  return el;
}

describe("CommentsColumn", () => {
  it("shows the open count, Reviewer before Explorer, each by number", async () => {
    serveComments(() => [REVIEWER_B, EXPLORER, REVIEWER_A, RESOLVED]);
    mount(props());
    expect(await screen.findByText("COMMENTS (3 open)")).toBeInTheDocument();
    const titles = screen
      .getAllByTestId("comment-card")
      .map((c) => within(c).getByRole("heading").textContent);
    expect(titles).toEqual(["Reviewer first", "Reviewer second", "Explorer hypothesis"]);
    expect(screen.getByText("Hypothesis")).toBeInTheDocument();
  });

  it("heads each open section with its role and count", async () => {
    serveComments(() => [REVIEWER_B, EXPLORER, REVIEWER_A, RESOLVED]);
    mount(props());
    const reviewer = await screen.findByRole("region", { name: "Reviewer comments" });
    expect(within(reviewer).getByRole("heading", { level: 2 })).toHaveTextContent("Reviewer· 2");
    const explorer = screen.getByRole("region", { name: "Explorer comments" });
    expect(within(explorer).getByRole("heading", { level: 2 })).toHaveTextContent("Explorer· 1");
  });

  it("keeps resolved comments collapsed, read-only and labelled with the result", async () => {
    serveComments(() => [REVIEWER_A, RESOLVED]);
    mount(props());
    const toggle = await screen.findByRole("button", { name: /Resolved \(1\)/ });
    expect(screen.queryByText("Already resolved")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    const resolved = card("Already resolved");
    expect(within(resolved).getByText("Applied")).toBeInTheDocument();
    expect(within(resolved).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the empty state only when the draft was reviewed and nothing is left", async () => {
    serveComments(() => []);
    const { unmount } = mount(props({ reviewedEmpty: true }));
    expect(await screen.findByText("No comments – the draft looks ready to approve.")).toBeInTheDocument();
    unmount();
    mount(props({ reviewedEmpty: false }));
    await screen.findByText("COMMENTS (0 open)");
    expect(screen.queryByText("No comments – the draft looks ready to approve.")).not.toBeInTheDocument();
  });

  it("does not show the empty state while open comments exist", async () => {
    serveComments(() => [REVIEWER_A]);
    mount(props({ reviewedEmpty: true }));
    await screen.findByText("Reviewer first");
    expect(screen.queryByText("No comments – the draft looks ready to approve.")).not.toBeInTheDocument();
  });

  it("posts accept and moves the comment to Resolved", async () => {
    let comments: Comment[] = [REVIEWER_A];
    serveComments(() => comments);
    const posted = vi.fn();
    server.use(
      http.post(`${BASE}/comments/r-a/accept`, () => {
        posted();
        comments = [{ ...REVIEWER_A, status: "accepted" }];
        return HttpResponse.json({ outcome: "question_added" satisfies CommentOutcome, comment: comments[0] });
      }),
    );
    const p = props();
    mount(p);
    await screen.findByText("Reviewer first");
    fireEvent.click(within(card("Reviewer first")).getByRole("button", { name: "Accept" }));
    expect(await screen.findByRole("button", { name: /Resolved \(1\)/ })).toBeInTheDocument();
    expect(posted).toHaveBeenCalledTimes(1);
    expect(screen.getByText("COMMENTS (0 open)")).toBeInTheDocument();
    expect(p.onChanged).not.toHaveBeenCalled();
  });

  it("refetches the artifact after an applied text change", async () => {
    let comments: Comment[] = [REVIEWER_A];
    serveComments(() => comments);
    let artifactFetches = 0;
    server.use(
      http.get(`${BASE}/artifacts`, () => {
        artifactFetches += 1;
        return HttpResponse.json([]);
      }),
      http.post(`${BASE}/comments/r-a/accept`, () => {
        comments = [{ ...REVIEWER_A, status: "accepted" }];
        return HttpResponse.json({ outcome: "applied" satisfies CommentOutcome, comment: comments[0] });
      }),
    );

    function Harness() {
      const { mutate } = useArtifacts(PROJECT_ID);
      return <CommentsColumn {...props({ onChanged: () => void mutate() })} />;
    }
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <Harness />
      </SWRConfig>,
    );
    await screen.findByText("Reviewer first");
    await waitFor(() => expect(artifactFetches).toBe(1));
    fireEvent.click(within(card("Reviewer first")).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(artifactFetches).toBe(2));
  });

  it("sends the edited suggestion", async () => {
    serveComments(() => [REVIEWER_A]);
    const body = vi.fn();
    server.use(
      http.post(`${BASE}/comments/r-a/edit`, async ({ request }) => {
        body(await request.json());
        return HttpResponse.json({ outcome: "applied", comment: { ...REVIEWER_A, status: "edited" } });
      }),
    );
    mount(props());
    await screen.findByText("Reviewer first");
    const c = card("Reviewer first");
    fireEvent.click(within(c).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(c).getByRole("textbox"), { target: { value: "my text" } });
    fireEvent.click(within(c).getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(body).toHaveBeenCalledWith({
        suggestion: { kind: "text_change", find: "## Stakeholders", replace: "my text" },
      }),
    );
  });

  it("rejects without a body", async () => {
    serveComments(() => [REVIEWER_A]);
    const body = vi.fn();
    server.use(
      http.post(`${BASE}/comments/r-a/reject`, async ({ request }) => {
        body(await request.text());
        return HttpResponse.json({ outcome: "rejected", comment: { ...REVIEWER_A, status: "rejected" } });
      }),
    );
    mount(props());
    await screen.findByText("Reviewer first");
    const c = card("Reviewer first");
    fireEvent.click(within(c).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(body).toHaveBeenCalledWith(""));
  });

  it("keeps a not located comment open and lets the user mark it as done", async () => {
    let comments: Comment[] = [REVIEWER_A];
    serveComments(() => comments);
    server.use(
      http.post(`${BASE}/comments/r-a/accept`, () =>
        HttpResponse.json({ outcome: "not_located" satisfies CommentOutcome, comment: REVIEWER_A }),
      ),
      http.post(`${BASE}/comments/r-a/done-manually`, () => {
        comments = [{ ...REVIEWER_A, status: "done_manually" }];
        return HttpResponse.json({ outcome: "done_manually", comment: comments[0] });
      }),
    );
    mount(props());
    await screen.findByText("Reviewer first");
    fireEvent.click(within(card("Reviewer first")).getByRole("button", { name: "Accept" }));
    expect(await screen.findByText("Couldn't locate the passage. Please edit it manually.")).toBeInTheDocument();
    expect(screen.getByText("COMMENTS (1 open)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(await screen.findByRole("button", { name: /Resolved \(1\)/ })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't locate the passage. Please edit it manually.")).not.toBeInTheDocument();
  });

  it("calls onAsk with the comment", async () => {
    serveComments(() => [REVIEWER_A, EXPLORER]);
    const p = props();
    mount(p);
    await screen.findByText("Explorer hypothesis");
    fireEvent.click(within(card("Explorer hypothesis")).getByRole("button", { name: "Ask" }));
    expect(p.onAsk).toHaveBeenCalledWith(EXPLORER);
  });

  it("disables every action with a tooltip during a run", async () => {
    serveComments(() => [REVIEWER_A]);
    mount(props({ locks: { runLocked: true, editorLocked: false } }));
    await screen.findByText("Reviewer first");
    for (const name of ["Accept", "Edit", "Reject", "Ask"]) {
      const button = within(card("Reviewer first")).getByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", RUN_REASON);
    }
  });

  it("disables every action while the editor is open", async () => {
    serveComments(() => [REVIEWER_A]);
    mount(props({ locks: { runLocked: false, editorLocked: true } }));
    await screen.findByText("Reviewer first");
    const accept = within(card("Reviewer first")).getByRole("button", { name: "Accept" });
    expect(accept).toBeDisabled();
    expect(accept).toHaveAttribute("title", EDITOR_REASON);
  });

  it("shows the backend message for a 409 run_active", async () => {
    serveComments(() => [REVIEWER_A]);
    server.use(
      http.post(`${BASE}/comments/r-a/accept`, () =>
        HttpResponse.json(
          { detail: { code: "run_active", message: "A run is active for this project." } },
          { status: 409 },
        ),
      ),
    );
    mount(props());
    await screen.findByText("Reviewer first");
    fireEvent.click(within(card("Reviewer first")).getByRole("button", { name: "Accept" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A run is active for this project.");
    expect(screen.getByText("COMMENTS (1 open)")).toBeInTheDocument();
  });

  it("marks the card of the chip comment", async () => {
    serveComments(() => [REVIEWER_A, REVIEWER_B]);
    mount(props({ chipCommentId: "r-b" }));
    await screen.findByText("Reviewer first");
    expect(card("Reviewer second")).toHaveAttribute("data-asked", "true");
    expect(card("Reviewer first")).toHaveAttribute("data-asked", "false");
  });
  describe("collapsing and the active comment", () => {
    const scroll = vi.mocked(window.HTMLElement.prototype.scrollIntoView);

    function expanded(title: string): boolean {
      return within(card(title)).queryByRole("button", { name: "Accept" }) !== null;
    }

    it("keeps every card expanded by default", async () => {
      serveComments(() => [REVIEWER_A, REVIEWER_B]);
      mount(props());
      await screen.findByText("Reviewer first");
      expect(expanded("Reviewer first")).toBe(true);
      expect(expanded("Reviewer second")).toBe(true);
    });

    it("shows only the headers when collapsed by default; the chevron expands one card", async () => {
      serveComments(() => [REVIEWER_A, REVIEWER_B]);
      mount(props({ collapsedByDefault: true, onActivateComment: vi.fn() }));
      await screen.findByText("Reviewer first");
      expect(expanded("Reviewer first")).toBe(false);
      expect(expanded("Reviewer second")).toBe(false);
      fireEvent.click(within(card("Reviewer first")).getByRole("button", { name: "Expand comment" }));
      expect(expanded("Reviewer first")).toBe(true);
      expect(expanded("Reviewer second")).toBe(false);
      fireEvent.click(within(card("Reviewer first")).getByRole("button", { name: "Collapse comment" }));
      expect(expanded("Reviewer first")).toBe(false);
    });

    it("a header click expands the card and reports its id", async () => {
      serveComments(() => [REVIEWER_A, REVIEWER_B]);
      const onActivateComment = vi.fn();
      mount(props({ collapsedByDefault: true, onActivateComment }));
      await screen.findByText("Reviewer first");
      fireEvent.click(screen.getByRole("heading", { name: "Reviewer second" }));
      expect(onActivateComment).toHaveBeenCalledWith("r-b");
      expect(expanded("Reviewer second")).toBe(true);
      expect(expanded("Reviewer first")).toBe(false);
    });

    it("expands the active card, marks it and scrolls it into view", async () => {
      serveComments(() => [REVIEWER_A, REVIEWER_B]);
      scroll.mockClear();
      mount(props({ collapsedByDefault: true, activeCommentId: "r-b" }));
      await screen.findByText("Reviewer first");
      expect(expanded("Reviewer second")).toBe(true);
      expect(expanded("Reviewer first")).toBe(false);
      expect(card("Reviewer second")).toHaveAttribute("data-active", "true");
      expect(card("Reviewer first")).toHaveAttribute("data-active", "false");
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.contexts[0]).toBe(card("Reviewer second"));
    });

    it("scrolls smoothly, or instantly with prefers-reduced-motion: reduce", async () => {
      serveComments(() => [REVIEWER_A, REVIEWER_B]);
      scroll.mockClear();
      const first = mount(props({ activeCommentId: "r-b" }));
      await screen.findByText("Reviewer first");
      expect(scroll).toHaveBeenLastCalledWith({ block: "nearest", behavior: "smooth" });
      first.unmount();

      mockReducedMotion(true);
      try {
        mount(props({ activeCommentId: "r-b" }));
        await screen.findByText("Reviewer first");
        expect(scroll).toHaveBeenLastCalledWith({ block: "nearest", behavior: "auto" });
      } finally {
        removeMatchMedia();
      }
    });

    it("expands and scrolls to a card that becomes active later, even after it was collapsed", async () => {
      serveComments(() => [REVIEWER_A, REVIEWER_B]);
      const view = mount(props({ collapsedByDefault: true, onActivateComment: vi.fn() }));
      await screen.findByText("Reviewer first");
      scroll.mockClear();
      const rerender = (activeCommentId: string | null) =>
        view.rerender(
          <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
            <CommentsColumn {...props({ collapsedByDefault: true, activeCommentId, onActivateComment: vi.fn() })} />
          </SWRConfig>,
        );
      rerender("r-a");
      expect(expanded("Reviewer first")).toBe(true);
      expect(scroll).toHaveBeenCalledTimes(1);
      fireEvent.click(within(card("Reviewer first")).getByRole("button", { name: "Collapse comment" }));
      expect(expanded("Reviewer first")).toBe(false);
      rerender("r-b");
      rerender("r-a");
      expect(expanded("Reviewer first")).toBe(true);
      expect(scroll).toHaveBeenCalledTimes(3);
    });

    it("a repeated activation of the active comment re-expands its card and scrolls it again", async () => {
      serveComments(() => [REVIEWER_A, REVIEWER_B]);
      const view = mount(props({ collapsedByDefault: true, activeCommentId: "r-a", activationNonce: 1 }));
      await screen.findByText("Reviewer first");
      expect(expanded("Reviewer first")).toBe(true);
      fireEvent.click(within(card("Reviewer first")).getByRole("button", { name: "Collapse comment" }));
      expect(expanded("Reviewer first")).toBe(false);
      scroll.mockClear();
      view.rerender(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <CommentsColumn {...props({ collapsedByDefault: true, activeCommentId: "r-a", activationNonce: 2 })} />
        </SWRConfig>,
      );
      expect(expanded("Reviewer first")).toBe(true);
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.contexts[0]).toBe(card("Reviewer first"));
    });

    it("does not re-expand a collapsed active card on an unrelated re-render", async () => {
      serveComments(() => [REVIEWER_A]);
      const view = mount(props({ collapsedByDefault: true, activeCommentId: "r-a", activationNonce: 1 }));
      await screen.findByText("Reviewer first");
      fireEvent.click(within(card("Reviewer first")).getByRole("button", { name: "Collapse comment" }));
      view.rerender(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <CommentsColumn {...props({ collapsedByDefault: true, activeCommentId: "r-a", activationNonce: 1, reviewedEmpty: true })} />
        </SWRConfig>,
      );
      expect(expanded("Reviewer first")).toBe(false);
    });

    it("does not throw where scrollIntoView is missing", async () => {
      serveComments(() => [REVIEWER_A]);
      const original = window.HTMLElement.prototype.scrollIntoView;
      // @ts-expect-error jsdom has no scrollIntoView; the column must cope with that.
      delete window.HTMLElement.prototype.scrollIntoView;
      try {
        mount(props({ activeCommentId: "r-a" }));
        expect(await screen.findByText("Reviewer first")).toBeInTheDocument();
      } finally {
        window.HTMLElement.prototype.scrollIntoView = original;
      }
    });
  });

  describe("comments without a text passage", () => {
    const HINT = "No text passage";

    it("hints open comments that are not in resolvedIds, workshop questions included", async () => {
      serveComments(() => [REVIEWER_A, EXPLORER, REVIEWER_B]);
      mount(props({ resolvedIds: new Set(["r-a"]) }));
      await screen.findByText("Reviewer first");
      expect(within(card("Reviewer first")).queryByText(HINT)).not.toBeInTheDocument();
      expect(within(card("Reviewer second")).getByText(HINT)).toBeInTheDocument();
      expect(within(card("Explorer hypothesis")).getByText(HINT)).toBeInTheDocument();
    });

    it("keeps the hint visible on a collapsed card", async () => {
      serveComments(() => [EXPLORER]);
      mount(props({ resolvedIds: new Set(), collapsedByDefault: true }));
      await screen.findByText("Explorer hypothesis");
      expect(screen.getByText(HINT)).toBeInTheDocument();
    });

    it("shows no hint while the anchors are unknown (resolvedIds omitted) or for resolved comments", async () => {
      serveComments(() => [REVIEWER_A, RESOLVED]);
      mount(props());
      await screen.findByText("Reviewer first");
      expect(screen.queryByText(HINT)).not.toBeInTheDocument();
      fireEvent.click(await screen.findByRole("button", { name: /Resolved \(1\)/ }));
      expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    });

    it("shows no hint on a resolved-status comment even when resolvedIds is given", async () => {
      serveComments(() => [RESOLVED]);
      mount(props({ resolvedIds: new Set() }));
      fireEvent.click(await screen.findByRole("button", { name: /Resolved \(1\)/ }));
      expect(within(card("Already resolved")).queryByText(HINT)).not.toBeInTheDocument();
    });
  });
});
