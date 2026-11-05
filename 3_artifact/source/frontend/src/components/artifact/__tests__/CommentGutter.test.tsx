import { act, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import type { Editor as ReactEditor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommentGutter,
  GUTTER_ICON_SIZE,
  GUTTER_MIN_SPACING,
  type CommentGutterProps,
} from "@/components/artifact/CommentGutter";
import type { CommentAnchor } from "@/hooks/useCommentAnchors";
import { buildExtensions } from "@/lib/richtext/extensions";
import { makeComment } from "@/test/msw-server";

const editors: Editor[] = [];
function makeEditor(): Editor {
  const editor = new Editor({
    extensions: buildExtensions(),
    content: "## Goals\n\nShip the pilot.\n\nOwner is unclear.\n",
    contentType: "markdown",
    editable: false,
  });
  editors.push(editor);
  return editor;
}

/** Viewport coordinates of a position: a 16px line whose top is `from * 10`. */
function lineAt(from: number) {
  return { top: from * 10, bottom: from * 10 + 16, left: 0, right: 0 };
}

const REVIEWER = makeComment({ id: "c1", title: "Owner missing", role: "reviewer" });
const EXPLORER = makeComment({ id: "c2", title: "Budget unclear", role: "explorer", hypothesis: true });
const ANCHORS: CommentAnchor[] = [
  { id: "c1", from: 5, to: 9 },
  { id: "c2", from: 20, to: 25 },
];

function props(editor: Editor | null, overrides: Partial<CommentGutterProps> = {}): CommentGutterProps {
  return {
    editor: editor as ReactEditor | null,
    anchors: ANCHORS,
    comments: [REVIEWER, EXPLORER],
    activeCommentId: null,
    onActivate: vi.fn(),
    ...overrides,
  };
}

function tops(): Record<string, number> {
  return Object.fromEntries(
    screen
      .queryAllByRole("button")
      .map((b) => [b.getAttribute("data-gutter-comment-id") ?? "", Number.parseFloat((b as HTMLElement).style.top)]),
  );
}

/** Centers the icon on the first line of its passage: line middle minus half the icon. */
function expectedTop(from: number, layerTop = 0): number {
  const line = lineAt(from);
  return (line.top + line.bottom) / 2 - layerTop - GUTTER_ICON_SIZE / 2;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.unstubAllGlobals();
});

describe("CommentGutter", () => {
  it("renders one named button per resolved comment, with its role", () => {
    const editor = makeEditor();
    vi.spyOn(editor.view, "coordsAtPos").mockImplementation(lineAt);
    render(<CommentGutter {...props(editor)} />);
    const reviewer = screen.getByRole("button", { name: "Comment: Owner missing" });
    const explorer = screen.getByRole("button", { name: "Comment: Budget unclear" });
    expect(reviewer).toHaveAttribute("data-gutter-comment-id", "c1");
    expect(reviewer).toHaveClass("comment-gutter-icon--reviewer");
    expect(explorer).toHaveClass("comment-gutter-icon--explorer");
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("gives comments without an anchor no icon", () => {
    const editor = makeEditor();
    vi.spyOn(editor.view, "coordsAtPos").mockImplementation(lineAt);
    render(<CommentGutter {...props(editor, { anchors: [ANCHORS[0] as CommentAnchor] })} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Comment: Budget unclear" })).toBeNull();
  });

  it("renders no icon while the editor or the anchors are unknown", () => {
    const editor = makeEditor();
    vi.spyOn(editor.view, "coordsAtPos").mockImplementation(lineAt);
    const { rerender } = render(<CommentGutter {...props(null)} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    rerender(<CommentGutter {...props(editor, { anchors: null })} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    rerender(<CommentGutter {...props(editor, { comments: undefined })} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("positions icons relative to the layer, which scrolls with the content", () => {
    const editor = makeEditor();
    vi.spyOn(editor.view, "coordsAtPos").mockImplementation(lineAt);
    // The content is scrolled by 300px: the layer's top edge is 300px above the viewport.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const top = this.getAttribute("data-testid") === "comment-gutter" ? -300 : 0;
      return new DOMRect(0, top, 0, 0);
    });
    render(<CommentGutter {...props(editor)} />);
    expect(tops()).toEqual({ c1: expectedTop(5, -300), c2: expectedTop(20, -300) });
  });

  it("keeps a minimum spacing between icons of the same line", () => {
    const editor = makeEditor();
    vi.spyOn(editor.view, "coordsAtPos").mockImplementation(() => lineAt(5));
    render(<CommentGutter {...props(editor)} />);
    const { c1, c2 } = tops();
    expect(c1).toBe(expectedTop(5));
    expect(c2).toBe(expectedTop(5) + GUTTER_MIN_SPACING);
  });

  it("skips an icon whose position cannot be determined and keeps the others", () => {
    const editor = makeEditor();
    vi.spyOn(editor.view, "coordsAtPos").mockImplementation((pos: number) => {
      if (pos === 5) throw new RangeError("Position out of range");
      return lineAt(pos);
    });
    render(<CommentGutter {...props(editor)} />);
    expect(Object.keys(tops())).toEqual(["c2"]);
  });

  it("renders nothing (and does not throw) where coordsAtPos throws (no layout)", () => {
    const editor = makeEditor();
    vi.spyOn(editor.view, "coordsAtPos").mockImplementation(() => {
      throw new RangeError("no layout");
    });
    render(<CommentGutter {...props(editor)} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("selects the comment on click and marks the active one", () => {
    const editor = makeEditor();
    vi.spyOn(editor.view, "coordsAtPos").mockImplementation(lineAt);
    const onActivate = vi.fn();
    render(<CommentGutter {...props(editor, { activeCommentId: "c2", onActivate })} />);
    const active = screen.getByRole("button", { name: "Comment: Budget unclear" });
    const other = screen.getByRole("button", { name: "Comment: Owner missing" });
    expect(active).toHaveAttribute("aria-pressed", "true");
    expect(active).toHaveClass("comment-gutter-icon--active");
    expect(other).toHaveAttribute("aria-pressed", "false");
    expect(other).not.toHaveClass("comment-gutter-icon--active");
    fireEvent.click(other);
    expect(onActivate).toHaveBeenCalledWith("c1");
    fireEvent.click(active);
    expect(onActivate).toHaveBeenLastCalledWith("c2");
  });

  it("measures again when the anchors change", () => {
    const editor = makeEditor();
    vi.spyOn(editor.view, "coordsAtPos").mockImplementation(lineAt);
    const { rerender } = render(<CommentGutter {...props(editor)} />);
    rerender(<CommentGutter {...props(editor, { anchors: [{ id: "c1", from: 8, to: 9 }] })} />);
    expect(tops()).toEqual({ c1: expectedTop(8) });
  });

  describe("size changes", () => {
    it("measures again when the observed elements resize, and stops observing on unmount", () => {
      const callbacks: (() => void)[] = [];
      const observe = vi.fn();
      const disconnect = vi.fn();
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(callback: () => void) {
            callbacks.push(callback);
          }
          observe = observe;
          disconnect = disconnect;
          unobserve = vi.fn();
        },
      );
      const editor = makeEditor();
      let shift = 0;
      vi.spyOn(editor.view, "coordsAtPos").mockImplementation((pos: number) => lineAt(pos + shift));
      const { unmount } = render(<CommentGutter {...props(editor)} />);
      expect(tops().c1).toBe(expectedTop(5));
      // The layer's container and the editor's content element are watched.
      expect(observe).toHaveBeenCalledWith(editor.view.dom);
      expect(observe.mock.calls.length).toBeGreaterThanOrEqual(2);

      shift = 3;
      act(() => callbacks.forEach((callback) => callback()));
      expect(tops().c1).toBe(expectedTop(8));

      unmount();
      expect(disconnect).toHaveBeenCalled();
    });
  });
});
