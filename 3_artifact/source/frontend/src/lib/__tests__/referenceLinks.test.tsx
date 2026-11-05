import { fireEvent, render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import { describe, expect, it, vi } from "vitest";
import { createReferenceComponents, linkifyReferences, referenceUrlTransform } from "@/lib/referenceLinks";
import type { Artifact, Document } from "@/types";

const DOCUMENTS: Document[] = [
  {
    id: "d1",
    project_id: "p",
    filename: "interview.md",
    content_type: "text/markdown",
    size_bytes: 1,
    created_at: "2026-06-01T10:00:00Z",
  },
];
const ARTIFACTS: Artifact[] = [
  {
    id: "a1",
    project_id: "p",
    type: "t",
    title: "Project Description",
    content: "",
    language: null,
    status: "draft",
    reviewed_since_change: false,
    slot: "01",
    created_at: "2026-06-01T10:00:00Z",
    updated_at: "2026-06-01T10:00:00Z",
    metadata: null,
  },
];

/** The chat path (`AgentMarkdown`): react-markdown + `createReferenceComponents`, which stays on react-markdown. */
function renderChat(markdown: string, onOpenSource = vi.fn()) {
  render(
    <ReactMarkdown
      urlTransform={referenceUrlTransform}
      components={createReferenceComponents({ documents: DOCUMENTS, artifacts: ARTIFACTS, onOpenSource })}
    >
      {linkifyReferences(markdown)}
    </ReactMarkdown>,
  );
  return onOpenSource;
}

describe("createReferenceComponents (react-markdown chat path)", () => {
  it("renders a plain external link as a new-tab anchor, not as a badge", () => {
    renderChat("See [the docs](https://example.com/docs) for details.");
    const link = screen.getByRole("link", { name: "the docs" });
    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(link).toHaveClass("underline");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("turns a plain link that names a known document into a badge that opens the source", () => {
    const onOpenSource = renderChat("Read [interview.md](interview.md) first.");
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "interview.md" }));
    expect(onOpenSource).toHaveBeenCalledWith({ kind: "document", documentId: "d1" });
  });

  it("turns [[doc:...]] and [[artifact:...]] citations into badges, unknown ones into disabled badges", () => {
    const onOpenSource = renderChat("A [[doc:interview.md, 00:53]] B [[artifact:01]] C [[doc:gone.md]]");
    fireEvent.click(screen.getByRole("button", { name: "interview.md (00:53)" }));
    expect(onOpenSource).toHaveBeenCalledWith({ kind: "document", documentId: "d1" });
    expect(screen.getByRole("button", { name: /Project Description/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Document not available" })).toBeDisabled();
  });
});
