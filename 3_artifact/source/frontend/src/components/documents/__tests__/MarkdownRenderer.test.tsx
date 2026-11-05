import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownRenderer } from "@/components/documents/MarkdownRenderer";
import { setAnnotations } from "@/lib/richtext/annotations";
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
const ARTIFACTS: Artifact[] = [];

/** Collects every editor the renderer hands out (`null` on teardown). */
function editorSpy() {
  const calls: (Editor | null)[] = [];
  /** Whether each handed-out editor's schema had the marker node (a destroyed editor loses its schema). */
  const hadMarker: boolean[] = [];
  return {
    calls,
    hadMarker,
    onEditorReady: (editor: Editor | null) => {
      calls.push(editor);
      if (editor !== null) hadMarker.push(editor.schema.nodes.marker !== undefined);
    },
  };
}

describe("MarkdownRenderer (Tiptap read view)", () => {
  it("renders headings, lists and tables from Markdown inside a .prose ProseMirror root", async () => {
    const markdown = [
      "# Title",
      "",
      "## Sub",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "2. second",
      "",
      "| Name | Role |",
      "| --- | --- |",
      "| Ada | Dev |",
    ].join("\n");
    const { container } = render(<MarkdownRenderer content={markdown} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Sub" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["one", "two", "first", "second"]);
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Name", "Role"]);
    expect(screen.getByRole("cell", { name: "Ada" })).toBeInTheDocument();
    const root = container.querySelector(".ProseMirror");
    expect(root).toHaveClass("prose");
    expect(root).toHaveAttribute("contenteditable", "false");
  });

  it("leaves the content translatable (Tiptap defaults the root to translate=\"no\")", async () => {
    const { container } = render(<MarkdownRenderer content="Some English text." />);
    await screen.findByText("Some English text.");
    const root = container.querySelector(".ProseMirror");
    expect(root).not.toHaveAttribute("translate", "no");
    expect(root).toHaveAttribute("translate", "yes");
  });

  it("renders marker badges only with markers", async () => {
    const { container, rerender } = render(<MarkdownRenderer markers content="- ⚠ CONFLICT: users" />);
    expect(await screen.findByText("CONFLICT")).toHaveAttribute("data-marker", "conflict");

    rerender(<MarkdownRenderer content="- ⚠ CONFLICT: users" />);
    // Wait for the remounted editor's literal text: "no badge" alone is also true while the
    // editor is being recreated and nothing is rendered yet.
    await waitFor(() => expect(container).toHaveTextContent("⚠ CONFLICT: users"));
    expect(container.querySelector("[data-marker]")).toBeNull();
  });

  it("renders [[doc:...]] as a reference badge that opens the source", async () => {
    const onOpenSource = vi.fn();
    render(
      <MarkdownRenderer
        content="Said so [[doc:interview.md, 00:53]]."
        documents={DOCUMENTS}
        artifacts={ARTIFACTS}
        onOpenSource={onOpenSource}
      />,
    );
    const badge = await screen.findByRole("button", { name: "interview.md (00:53)" });
    fireEvent.click(badge);
    expect(onOpenSource).toHaveBeenCalledWith({ kind: "document", documentId: "d1" });
  });

  it("re-resolves citations and uses the latest onOpenSource when props change, without recreating the editor", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const spy = editorSpy();
    const { rerender } = render(
      <MarkdownRenderer
        content="[[doc:interview.md]]"
        documents={[]}
        onOpenSource={first}
        onEditorReady={spy.onEditorReady}
      />,
    );
    const disabled = await screen.findByRole("button", { name: "Document not available" });
    expect(disabled).toBeDisabled();

    rerender(
      <MarkdownRenderer
        content="[[doc:interview.md]]"
        documents={DOCUMENTS}
        onOpenSource={second}
        onEditorReady={spy.onEditorReady}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "interview.md" }));
    expect(second).toHaveBeenCalledWith({ kind: "document", documentId: "d1" });
    expect(first).not.toHaveBeenCalled();
    expect(spy.calls).toHaveLength(1);
  });

  it("calls onEditorReady with the editor once and with null on unmount", async () => {
    const spy = editorSpy();
    const { unmount } = render(<MarkdownRenderer content="# Title" onEditorReady={spy.onEditorReady} />);
    await screen.findByRole("heading", { name: "Title" });
    await waitFor(() => expect(spy.calls).toHaveLength(1));
    const editor = spy.calls[0];
    expect(editor).not.toBeNull();
    expect(editor?.isEditable).toBe(false);
    unmount();
    expect(spy.calls).toHaveLength(2);
    expect(spy.calls[1]).toBeNull();
  });

  it("exposes the content as a read-only document, not as a textbox", async () => {
    const { container } = render(<MarkdownRenderer content="# Title" />);
    await screen.findByRole("heading", { name: "Title" });
    const root = container.querySelector(".ProseMirror");
    expect(root).toHaveAttribute("role", "document");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("document")).toBe(root);
  });

  it("under React Strict Mode reports ready, null, ready (double effect) and ends with a live editor", async () => {
    const spy = editorSpy();
    const { unmount } = render(
      <StrictMode>
        <MarkdownRenderer content="# Title" onEditorReady={spy.onEditorReady} />
      </StrictMode>,
    );
    await screen.findByRole("heading", { name: "Title" });
    await waitFor(() => expect(spy.calls.at(-1)).not.toBeNull());
    const live = spy.calls.at(-1) as Editor;
    expect(live.isDestroyed).toBe(false);
    // Every non-null report is followed by a null before the next one, so a consumer never holds two editors.
    let open = 0;
    for (const call of spy.calls) {
      open += call === null ? -1 : 1;
      expect(open).toBeGreaterThanOrEqual(0);
      expect(open).toBeLessThanOrEqual(1);
    }
    expect(open).toBe(1);
    unmount();
    expect(spy.calls.at(-1)).toBeNull();
  });

  it("swaps changed content into the same editor without emitting an update", async () => {
    const spy = editorSpy();
    const { rerender } = render(<MarkdownRenderer content="# Old" onEditorReady={spy.onEditorReady} />);
    await screen.findByRole("heading", { name: "Old" });
    await waitFor(() => expect(spy.calls).toHaveLength(1));
    const editor = spy.calls[0] as Editor;
    const onUpdate = vi.fn();
    editor.on("update", onUpdate);

    rerender(<MarkdownRenderer content={"# New\n\nBody"} onEditorReady={spy.onEditorReady} />);
    expect(await screen.findByRole("heading", { name: "New" })).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Old" })).not.toBeInTheDocument();
    expect(spy.calls).toEqual([editor]);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("remounts the editor when markers changes (extensions are fixed at mount)", async () => {
    const spy = editorSpy();
    const { rerender } = render(<MarkdownRenderer markers content="x" onEditorReady={spy.onEditorReady} />);
    await waitFor(() => expect(spy.calls).toHaveLength(1));
    rerender(<MarkdownRenderer content="x" onEditorReady={spy.onEditorReady} />);
    await waitFor(() => expect(spy.calls).toHaveLength(3));
    const [first, torn, second] = spy.calls;
    expect(torn).toBeNull();
    expect(first).not.toBe(second);
    expect(spy.hadMarker).toEqual([true, false]);
  });

  it("reports clicks on an annotation through onAnnotationClick, always the latest callback", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const spy = editorSpy();
    const { rerender } = render(
      <MarkdownRenderer content="Alpha beta gamma." onAnnotationClick={first} onEditorReady={spy.onEditorReady} />,
    );
    await screen.findByText("Alpha beta gamma.");
    await waitFor(() => expect(spy.calls).toHaveLength(1));
    const editor = spy.calls[0] as Editor;
    setAnnotations(editor, [{ id: "c1", from: 7, to: 11, role: "reviewer", active: false }]);

    rerender(
      <MarkdownRenderer content="Alpha beta gamma." onAnnotationClick={second} onEditorReady={spy.onEditorReady} />,
    );
    const target = screen.getByText("beta");
    expect(target).toHaveAttribute("data-comment-id", "c1");
    fireEvent.click(target);
    expect(second).toHaveBeenCalledWith("c1");
    expect(first).not.toHaveBeenCalled();
    expect(spy.calls).toHaveLength(1); // a new callback never recreates the editor
  });
});
