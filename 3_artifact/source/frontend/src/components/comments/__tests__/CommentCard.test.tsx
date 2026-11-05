import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommentCard, type CommentCardProps } from "@/components/comments/CommentCard";
import { makeComment } from "@/test/msw-server";

function props(overrides: Partial<CommentCardProps> = {}): CommentCardProps {
  return {
    comment: makeComment({
      suggestion: { kind: "text_change", find: "old text", replace: "new text" },
    }),
    disabledReason: null,
    notLocated: false,
    onAccept: vi.fn(),
    onEdit: vi.fn(),
    onReject: vi.fn(),
    onAsk: vi.fn(),
    onMarkDone: vi.fn(),
    ...overrides,
  };
}

const QUESTION_COMMENT = makeComment({
  role: "explorer",
  hypothesis: true,
  suggestion: { kind: "workshop_question", text: "Who owns the course catalogue?" },
});

describe("CommentCard", () => {
  it("shows label, title, description and the text change as find to replace", () => {
    render(<CommentCard {...props()} />);
    expect(screen.getByText("Reviewer")).toBeInTheDocument();
    expect(screen.getByText("DPO missing")).toBeInTheDocument();
    expect(screen.getByText(/no responsible role is listed/)).toBeInTheDocument();
    const diff = screen.getByTestId("inline-diff");
    expect(diff).toHaveTextContent("oldnew text");
    expect(diff.querySelector("del")).toHaveTextContent("old");
    expect(diff.querySelector("ins")).toHaveTextContent("new");
  });

  it("shows a mostly rewritten text change as old block and new block", () => {
    const comment = makeComment({
      suggestion: { kind: "text_change", find: "Students enrol online.", replace: "Admins import every course." },
    });
    render(<CommentCard {...props({ comment })} />);
    expect(screen.queryByTestId("inline-diff")).not.toBeInTheDocument();
    expect(screen.getByText("Students enrol online.")).toBeInTheDocument();
    expect(screen.getByText("Admins import every course.")).toBeInTheDocument();
  });

  it("shows a workshop question suggestion as text", () => {
    render(<CommentCard {...props({ comment: QUESTION_COMMENT })} />);
    expect(screen.getByText("Who owns the course catalogue?")).toBeInTheDocument();
  });

  it("shows the Hypothesis tag only for hypotheses", () => {
    const { unmount } = render(<CommentCard {...props({ comment: QUESTION_COMMENT })} />);
    expect(screen.getByText("Explorer")).toBeInTheDocument();
    expect(screen.getByText("Hypothesis")).toBeInTheDocument();
    unmount();
    render(<CommentCard {...props()} />);
    expect(screen.queryByText("Hypothesis")).not.toBeInTheDocument();
  });

  it("calls onAccept and onAsk", () => {
    const p = props();
    render(<CommentCard {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(p.onAccept).toHaveBeenCalledTimes(1);
    expect(p.onAsk).toHaveBeenCalledTimes(1);
  });

  it("edits a text change: find stays read-only, Apply sends the edited replace", () => {
    const p = props();
    render(<CommentCard {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveValue("new text");
    expect(screen.getByText("old text")).toBeInTheDocument();
    fireEvent.change(textarea, { target: { value: "edited text" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(p.onEdit).toHaveBeenCalledWith({ kind: "text_change", find: "old text", replace: "edited text" });
  });

  it("edits a workshop question and keeps its kind", () => {
    const p = props({ comment: QUESTION_COMMENT });
    render(<CommentCard {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveValue("Who owns the course catalogue?");
    fireEvent.change(textarea, { target: { value: "Who owns the catalogue today?" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(p.onEdit).toHaveBeenCalledWith({ kind: "workshop_question", text: "Who owns the catalogue today?" });
  });

  it("cancels an edit without calling onEdit", () => {
    const p = props();
    render(<CommentCard {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(p.onEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
  });

  it("rejects with one click", () => {
    const p = props();
    render(<CommentCard {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(p.onReject).toHaveBeenCalledTimes(1);
  });

  it("disables all four actions with the reason as tooltip", () => {
    const reason = "A run is active. Please wait until it has finished.";
    render(<CommentCard {...props({ disabledReason: reason })} />);
    for (const name of ["Accept", "Edit", "Reject", "Ask"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", reason);
    }
  });

  it("shows the not-located text and Mark as done instead of the actions", () => {
    const p = props({ notLocated: true });
    render(<CommentCard {...p} />);
    expect(screen.getByText("Couldn't locate the passage. Please edit it manually.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(p.onMarkDone).toHaveBeenCalledTimes(1);
  });

  it("renders sources as reference buttons", () => {
    const doc = {
      id: "doc-1",
      project_id: "proj-test-1",
      filename: "a.md",
      content_type: "text/markdown",
      size_bytes: 1,
      created_at: "2026-06-01T10:00:00Z",
    };
    const onOpenSource = vi.fn();
    render(
      <CommentCard
        {...props({
          comment: makeComment({ sources: ["[[doc:a.md]]"] }),
          documents: [doc],
          onOpenSource,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "a.md" }));
    expect(onOpenSource).toHaveBeenCalledWith({ kind: "document", documentId: "doc-1" });
  });
  it("shows [[doc:...]] citations inside the diff as reference badges, not raw text", () => {
    const doc = {
      id: "doc-1",
      project_id: "proj-test-1",
      filename: "a.md",
      content_type: "text/markdown",
      size_bytes: 1,
      created_at: "2026-06-01T10:00:00Z",
    };
    const onOpenSource = vi.fn();
    render(
      <CommentCard
        {...props({
          comment: makeComment({
            suggestion: {
              kind: "text_change",
              find: "Hamburg only. [[doc:a.md]]",
              replace: "Hamburg only, LH wants more. [[doc:a.md]]",
            },
          }),
          documents: [doc],
          onOpenSource,
        })}
      />,
    );
    expect(screen.queryByText(/\[\[doc:/)).not.toBeInTheDocument();
    // The citation is unchanged, so the inline diff shows it once.
    const badges = screen.getAllByRole("button", { name: "a.md" });
    expect(badges).toHaveLength(1);
    fireEvent.click(badges[0]);
    expect(onOpenSource).toHaveBeenCalledWith({ kind: "document", documentId: "doc-1" });
  });

  describe("collapsing", () => {
    it("is expanded by default", () => {
      render(<CommentCard {...props()} />);
      expect(screen.getByText(/no responsible role is listed/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    });

    it("collapsed shows label and title only, no details, diff or actions", () => {
      render(<CommentCard {...props({ expanded: false })} />);
      expect(screen.getByText("Reviewer")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "DPO missing" })).toBeInTheDocument();
      expect(screen.queryByText(/no responsible role is listed/)).not.toBeInTheDocument();
      expect(screen.queryByTestId("inline-diff")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Ask" })).not.toBeInTheDocument();
    });

    it("keeps the Hypothesis tag and the result label visible while collapsed", () => {
      const resolved = makeComment({ hypothesis: true, status: "rejected" });
      render(<CommentCard {...props({ comment: resolved, expanded: false })} />);
      expect(screen.getByText("Hypothesis")).toBeInTheDocument();
      expect(screen.getByText("Rejected")).toBeInTheDocument();
    });

    it("a click on the header calls onActivate", () => {
      const onActivate = vi.fn();
      render(<CommentCard {...props({ onActivate })} />);
      fireEvent.click(screen.getByRole("heading", { name: "DPO missing" }));
      expect(onActivate).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByText("Reviewer"));
      expect(onActivate).toHaveBeenCalledTimes(2);
    });

    it("the chevron toggles the expansion without activating the card and reflects the state", () => {
      const onActivate = vi.fn();
      const onToggleExpanded = vi.fn();
      const { rerender } = render(<CommentCard {...props({ onActivate, onToggleExpanded, expanded: false })} />);
      const toggle = screen.getByRole("button", { name: "Expand comment" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(toggle);
      expect(onToggleExpanded).toHaveBeenCalledTimes(1);
      expect(onActivate).not.toHaveBeenCalled();
      rerender(<CommentCard {...props({ onActivate, onToggleExpanded, expanded: true })} />);
      expect(screen.getByRole("button", { name: "Collapse comment" })).toHaveAttribute("aria-expanded", "true");
    });

    it("offers no chevron without onToggleExpanded", () => {
      render(<CommentCard {...props({ onActivate: vi.fn() })} />);
      expect(screen.queryByRole("button", { name: /(Expand|Collapse) comment/ })).not.toBeInTheDocument();
    });

    it("clicks on the actions do not activate the card", () => {
      const onActivate = vi.fn();
      render(<CommentCard {...props({ onActivate })} />);
      fireEvent.click(screen.getByRole("button", { name: "Ask" }));
      expect(onActivate).not.toHaveBeenCalled();
    });
  });

  describe("passage hint and active state", () => {
    it("shows the hint in the header when the comment has no text passage", () => {
      render(<CommentCard {...props({ noPassage: true, expanded: false })} />);
      expect(screen.getByText("No text passage")).toBeInTheDocument();
    });

    it("shows no hint by default", () => {
      render(<CommentCard {...props()} />);
      expect(screen.queryByText("No text passage")).not.toBeInTheDocument();
    });

    it("marks the active card", () => {
      render(<CommentCard {...props({ active: true })} />);
      expect(screen.getByTestId("comment-card")).toHaveAttribute("data-active", "true");
    });
  });

  describe("keyboard operation of the header", () => {
    it("is a focusable button named after label and title when it can be activated", () => {
      render(<CommentCard {...props({ onActivate: vi.fn() })} />);
      const header = screen.getByRole("button", { name: /Reviewer.*DPO missing/ });
      expect(header).toBe(screen.getByTestId("comment-card-header"));
      expect(header).toHaveAttribute("tabindex", "0");
    });

    it("is not a button without onActivate", () => {
      render(<CommentCard {...props()} />);
      expect(screen.getByTestId("comment-card-header")).not.toHaveAttribute("role");
      expect(screen.getByTestId("comment-card-header")).not.toHaveAttribute("tabindex");
    });

    it("Enter and Space activate, other keys do not", () => {
      const onActivate = vi.fn();
      render(<CommentCard {...props({ onActivate })} />);
      const header = screen.getByTestId("comment-card-header");
      fireEvent.keyDown(header, { key: "Enter" });
      expect(onActivate).toHaveBeenCalledTimes(1);
      fireEvent.keyDown(header, { key: " " });
      expect(onActivate).toHaveBeenCalledTimes(2);
      fireEvent.keyDown(header, { key: "a" });
      fireEvent.keyDown(header, { key: "Tab" });
      expect(onActivate).toHaveBeenCalledTimes(2);
    });

    it("Space does not scroll the page", () => {
      render(<CommentCard {...props({ onActivate: vi.fn() })} />);
      const notPrevented = fireEvent.keyDown(screen.getByTestId("comment-card-header"), { key: " " });
      expect(notPrevented).toBe(false);
    });

    it("keys on the chevron toggle without activating the card (no nested interactive element)", () => {
      const onActivate = vi.fn();
      const onToggleExpanded = vi.fn();
      render(<CommentCard {...props({ onActivate, onToggleExpanded })} />);
      const chevron = screen.getByRole("button", { name: "Collapse comment" });
      expect(screen.getByTestId("comment-card-header")).not.toContainElement(chevron);
      fireEvent.keyDown(chevron, { key: "Enter" });
      fireEvent.keyDown(chevron, { key: " " });
      fireEvent.click(chevron);
      expect(onActivate).not.toHaveBeenCalled();
      expect(onToggleExpanded).toHaveBeenCalledTimes(1);
    });
  });
});
