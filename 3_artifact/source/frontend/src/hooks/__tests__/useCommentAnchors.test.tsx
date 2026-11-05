import { act, renderHook, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import type { Editor as ReactEditor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCommentAnchors, toAnnotations, useCommentAnchors } from "@/hooks/useCommentAnchors";
import { getAnnotations } from "@/lib/richtext/annotations";
import { buildViewExtensions } from "@/lib/richtext/viewExtensions";
import { makeComment } from "@/test/msw-server";
import type { Comment } from "@/types";

const editors: Editor[] = [];

function makeEditor(content: string): Editor {
  const editor = new Editor({
    extensions: buildViewExtensions(() => ({ documents: [], artifacts: [] }), { markers: true, getOnAnnotationClick: () => undefined }),
    content,
    contentType: "markdown",
    editable: false,
  });
  editors.push(editor);
  return editor;
}

function change(id: string, find: string, overrides: Partial<Comment> = {}): Comment {
  return makeComment({ id, suggestion: { kind: "text_change", find, replace: "x" }, ...overrides });
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("resolveCommentAnchors", () => {
  it("returns {id, from, to} for open text changes that resolve exactly once", () => {
    const editor = makeEditor("Alpha beta.\n\nGamma delta.\n");
    const anchors = resolveCommentAnchors(editor, [
      change("a", "Alpha beta."),
      change("b", "nowhere"),
      change("c", "Gamma delta.", { status: "rejected" }),
      makeComment({ id: "q", suggestion: { kind: "workshop_question", text: "?" } }),
    ]);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({ id: "a" });
    expect(editor.state.doc.textBetween(anchors[0]?.from ?? 0, anchors[0]?.to ?? 0)).toBe("Alpha beta.");
  });
});

describe("toAnnotations", () => {
  it("takes role and hypothesis from the comment and active from the selection", () => {
    const comments = [change("a", "x", { role: "explorer", hypothesis: true }), change("b", "y")];
    const list = toAnnotations(
      [
        { id: "a", from: 1, to: 3 },
        { id: "b", from: 4, to: 6 },
        { id: "gone", from: 7, to: 8 },
      ],
      comments,
      "b",
    );
    expect(list).toEqual([
      { id: "a", from: 1, to: 3, role: "explorer", active: false, hypothesis: true },
      { id: "b", from: 4, to: 6, role: "reviewer", active: true, hypothesis: false },
    ]);
  });
});

describe("useCommentAnchors", () => {
  it("is null for a render whose content or document is newer than the last resolution", async () => {
    const editor = makeEditor("Alpha beta.\n\nGamma delta.\n");
    const comments = [change("a", "Gamma delta.")];
    const seen: (readonly unknown[] | null)[] = [];
    const { result, rerender } = renderHook(
      ({ content }) => {
        const value = useCommentAnchors(editor as ReactEditor, content, comments, null);
        seen.push(value);
        return value;
      },
      { initialProps: { content: "v1" } },
    );
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(getAnnotations(editor)).toHaveLength(1);

    // Content prop changed, document not swapped yet: the old anchors must not be handed out.
    seen.length = 0;
    rerender({ content: "v2" });
    expect(seen[0]).toBeNull();
    await waitFor(() => expect(result.current).toHaveLength(1));

    // Document swapped under unchanged props: stale until the next resolution.
    act(() => {
      editor.commands.setContent("New first.\n\nGamma delta.\n", { contentType: "markdown", emitUpdate: false });
    });
    rerender({ content: "v2" });
    expect(seen[seen.length - 1]).toBeNull();
  });

  it("is null while the editor or the comments are unknown", async () => {
    const editor = makeEditor("Alpha.\n");
    const noComments: Comment[] = [];
    const none = renderHook(() => useCommentAnchors(null, "x", noComments, null));
    expect(none.result.current).toBeNull();
    const loading = renderHook(() => useCommentAnchors(editor as ReactEditor, "x", undefined, null));
    expect(loading.result.current).toBeNull();
    const empty = renderHook(() => useCommentAnchors(editor as ReactEditor, "x", noComments, null));
    await waitFor(() => expect(empty.result.current).toEqual([]));
  });
});
