import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkerBadge } from "@/components/artifact/MarkerBadges";
import { MarkdownRenderer } from "@/components/documents/MarkdownRenderer";
import type { Document } from "@/types";

function doc(id: string, filename: string): Document {
  return {
    id,
    project_id: "p",
    filename,
    content_type: "text/markdown",
    size_bytes: 1,
    created_at: "2026-06-01T10:00:00Z",
  };
}

describe("MarkerBadge", () => {
  it("renders the conflict and unclear badges", () => {
    const { rerender } = render(<MarkerBadge kind="conflict" />);
    expect(screen.getByText("CONFLICT")).toHaveAttribute("data-marker", "conflict");
    rerender(<MarkerBadge kind="unclear" />);
    expect(screen.getByText("UNCLEAR")).toHaveAttribute("data-marker", "unclear");
  });

  it("renders no icon next to the label", () => {
    const { container, rerender } = render(<MarkerBadge kind="conflict" />);
    expect(container.querySelector("svg")).toBeNull();
    rerender(<MarkerBadge kind="unclear" />);
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("MarkdownRenderer markers", () => {
  const documents = [doc("d1", "a.md"), doc("d2", "b.md")];

  it("renders a CONFLICT badge and keeps the citations as buttons", async () => {
    const onOpenSource = vi.fn();
    render(
      <MarkdownRenderer
        markers
        documents={documents}
        onOpenSource={onOpenSource}
        content="- ⚠ CONFLICT: Number of users: 200 [[doc:a.md]] vs. 2,000 [[doc:b.md]]"
      />,
    );
    const badge = await screen.findByText("CONFLICT");
    expect(badge).toHaveAttribute("data-marker", "conflict");
    expect(badge.tagName).toBe("SPAN");
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["a.md", "b.md"]);
    fireEvent.click(buttons[1]);
    expect(onOpenSource).toHaveBeenCalledWith({ kind: "document", documentId: "d2" });
    expect(screen.getByText(/Number of users: 200/)).toBeInTheDocument();
  });

  it("renders an UNCLEAR badge", async () => {
    render(<MarkdownRenderer markers content={'- ? UNCLEAR: Sales says offers take "far too long".'} />);
    expect(await screen.findByText("UNCLEAR")).toHaveAttribute("data-marker", "unclear");
    expect(screen.queryByText("CONFLICT")).not.toBeInTheDocument();
  });

  it("leaves non-marker text unchanged", async () => {
    const { container } = render(<MarkdownRenderer markers content={"- Plain item\n- Another item"} />);
    expect(await screen.findByText("Plain item")).toBeInTheDocument();
    expect(container.querySelector("[data-marker]")).toBeNull();
    expect(screen.getByText("Another item")).toBeInTheDocument();
  });

  it("does not render badges unless markers is set (customer documents)", async () => {
    const { container } = render(<MarkdownRenderer content="- ⚠ CONFLICT: users" />);
    await waitFor(() => expect(container).toHaveTextContent("⚠ CONFLICT: users"));
    expect(container.querySelector("[data-marker]")).toBeNull();
  });
});
