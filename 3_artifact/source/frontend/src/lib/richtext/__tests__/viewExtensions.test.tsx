import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorContent, useEditor } from "@tiptap/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { ReferenceContext, type ReferenceContextValue } from "../referenceContext";
import { buildViewExtensions } from "../viewExtensions";
import type { Artifact, Document } from "@/types";

const documents: Document[] = [
  {
    id: "d1",
    project_id: "p",
    filename: "interview.md",
    content_type: "text/markdown",
    size_bytes: 1,
    created_at: "2026-06-01T10:00:00Z",
  },
];
const artifacts: Artifact[] = [
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

function Viewer({ markdown, value }: { markdown: string; value: ReferenceContextValue }) {
  const latest = useRef(value);
  latest.current = value;
  const editor = useEditor({
    extensions: buildViewExtensions(() => latest.current),
    content: markdown,
    contentType: "markdown",
    editable: false,
    immediatelyRender: false,
  });
  return (
    <ReferenceContext.Provider value={value}>
      <EditorContent editor={editor} />
    </ReferenceContext.Provider>
  );
}

describe("citation node view", () => {
  it("renders [[doc:...]] / [[artifact:...]] as reference badges resolved through the context", async () => {
    const onOpenSource = vi.fn();
    render(
      <Viewer
        value={{ documents, artifacts, onOpenSource }}
        markdown={"Fact [[doc:interview.md, 00:53]] and [[doc:gone.md]] and [[artifact:01]].\n"}
      />,
    );
    await waitFor(() => expect(screen.getAllByRole("button")).toHaveLength(3));
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "interview.md (00:53)",
      "Document not available",
      "01 · Project Description",
    ]);
    expect(buttons[1]).toBeDisabled();

    fireEvent.click(buttons[0] as HTMLElement);
    expect(onOpenSource).toHaveBeenLastCalledWith({ kind: "document", documentId: "d1" });
    fireEvent.click(buttons[2] as HTMLElement);
    expect(onOpenSource).toHaveBeenLastCalledWith({ kind: "artifact", slot: "01" });
    expect(onOpenSource).toHaveBeenCalledTimes(2);
  });

  it("re-resolves existing badges when the context changes, without recreating the editor", async () => {
    const markdown = "[[doc:interview.md]]\n";
    const { rerender } = render(<Viewer value={{ documents: [], artifacts: [] }} markdown={markdown} />);
    await waitFor(() => expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Document not available"));
    rerender(<Viewer value={{ documents, artifacts }} markdown={markdown} />);
    await waitFor(() => expect(screen.getByRole("button")).toHaveAttribute("aria-label", "interview.md"));
  });

  it("renders without a provider: every citation is a disabled 'not available' badge", async () => {
    function Bare() {
      const editor = useEditor({
        extensions: buildViewExtensions(() => ({ documents: [], artifacts: [] })),
        content: "[[artifact:01]]\n",
        contentType: "markdown",
        editable: false,
        immediatelyRender: false,
      });
      return <EditorContent editor={editor} />;
    }
    render(<Bare />);
    const button = await screen.findByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-label", "Artifact not available");
  });
});

describe("marker node view", () => {
  it("renders line-leading markers as the marker badges", async () => {
    const { container } = render(
      <Viewer
        value={{ documents, artifacts }}
        markdown={"- ⚠ CONFLICT: a vs. b\n- ? UNCLEAR: c\n- mid-line ⚠ CONFLICT stays text\n"}
      />,
    );
    await waitFor(() => expect(container.querySelectorAll("span[data-marker]")).toHaveLength(2));
    expect(screen.getByText("CONFLICT")).toHaveAttribute("data-marker", "conflict");
    expect(screen.getByText("UNCLEAR")).toHaveAttribute("data-marker", "unclear");
    expect(container).toHaveTextContent("mid-line ⚠ CONFLICT stays text");
  });
});

describe("plain-link click interception", () => {
  const markdown =
    "[the interview](interview.md) and [titled](Project%20Description) and [web](https://example.com/page).\n";

  it("opens the source for links naming a document filename or an artifact title, and prevents navigation", async () => {
    const onOpenSource = vi.fn();
    render(<Viewer value={{ documents, artifacts, onOpenSource }} markdown={markdown} />);
    const docLink = await screen.findByText("the interview");
    expect(fireEvent.click(docLink)).toBe(false); // false = preventDefault was called
    expect(onOpenSource).toHaveBeenLastCalledWith({ kind: "document", documentId: "d1" });

    expect(fireEvent.click(screen.getByText("titled"))).toBe(false);
    expect(onOpenSource).toHaveBeenLastCalledWith({ kind: "artifact", slot: "01" });
    expect(onOpenSource).toHaveBeenCalledTimes(2);
  });

  it("leaves real external links alone (new tab, no interception)", async () => {
    const onOpenSource = vi.fn();
    render(<Viewer value={{ documents, artifacts, onOpenSource }} markdown={markdown} />);
    const web = await screen.findByText("web");
    expect(web.closest("a")).toHaveAttribute("target", "_blank");
    expect(web.closest("a")).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    expect(fireEvent.click(web)).toBe(true);
    expect(onOpenSource).not.toHaveBeenCalled();
  });

  it("reads the latest documents on every click", async () => {
    const onOpenSource = vi.fn();
    const { rerender } = render(<Viewer value={{ documents: [], artifacts: [], onOpenSource }} markdown={markdown} />);
    const link = await screen.findByText("the interview");
    expect(fireEvent.click(link)).toBe(true);
    expect(onOpenSource).not.toHaveBeenCalled();
    rerender(<Viewer value={{ documents, artifacts, onOpenSource }} markdown={markdown} />);
    expect(fireEvent.click(link)).toBe(false);
    expect(onOpenSource).toHaveBeenCalledWith({ kind: "document", documentId: "d1" });
  });
});
