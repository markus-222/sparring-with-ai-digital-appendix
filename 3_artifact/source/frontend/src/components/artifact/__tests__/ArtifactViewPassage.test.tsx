import { act, render, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import type { Editor as ReactEditor } from "@tiptap/react";
import { http, HttpResponse } from "msw";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactView, type ArtifactViewProps, type ChangeRange } from "@/components/artifact/ArtifactView";
import type { MarkdownRendererProps } from "@/components/documents/MarkdownRenderer";
import { applyHighlight } from "@/lib/highlight";
import { buildExtensions } from "@/lib/richtext/extensions";
import { makeArtifact, makeComment, server } from "@/test/msw-server";

vi.mock("@/lib/highlight", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/highlight")>();
  return { ...original, applyHighlight: vi.fn(() => () => undefined) };
});

// A controllable stand-in for the dynamically loaded renderer hands out real editors on demand
// (same approach as ArtifactViewHighlightTiming.test.tsx).
const renderer = vi.hoisted(() => ({ onEditorReady: null as ((editor: unknown) => void) | null }));
vi.mock("@/components/documents/MarkdownRenderer", () => ({
  MarkdownRenderer: (props: MarkdownRendererProps) => {
    renderer.onEditorReady = props.onEditorReady as (editor: unknown) => void;
    return <div data-testid="fake-renderer" />;
  },
}));

const BASE = "http://localhost:8000/api/v1";
const CONTENT = "## Goals\n\nShip the pilot.\n\nOwner is unclear.\n\nBudget is open.\n";

const editors: Editor[] = [];
function makeEditor(): Editor {
  const editor = new Editor({ extensions: buildExtensions(), content: CONTENT, contentType: "markdown", editable: false });
  // jsdom has no layout; setup.ts stubs the Range rects, so make "position cannot be measured"
  // explicit: the scroll helper then scrolls the passage into view unconditionally.
  vi.spyOn(editor.view, "coordsAtPos").mockImplementation(() => {
    throw new RangeError("no layout");
  });
  editors.push(editor);
  return editor;
}

function emit(editor: Editor | null): void {
  act(() => renderer.onEditorReady?.(editor as ReactEditor | null));
}

function serveComments(): void {
  const textChange = (id: string, find: string) =>
    makeComment({ id, title: `Title ${id}`, suggestion: { kind: "text_change", find, replace: `${find}!` } });
  server.use(
    http.get(`${BASE}/comments`, () =>
      HttpResponse.json([textChange("c1", "Ship the pilot."), textChange("c2", "Owner is unclear.")]),
    ),
  );
}

function viewProps(overrides: Partial<ArtifactViewProps> = {}): ArtifactViewProps {
  const artifact = makeArtifact("01", { status: "draft", content: CONTENT });
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

const scroll = vi.mocked(window.HTMLElement.prototype.scrollIntoView);

beforeEach(() => {
  serveComments();
  scroll.mockClear();
  vi.mocked(applyHighlight).mockClear();
});

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});

describe("ArtifactView comment gutter", () => {
  it("shows one icon per resolved comment next to the text", async () => {
    const editor = makeEditor();
    vi.spyOn(editor.view, "coordsAtPos").mockImplementation((pos) => ({ top: pos * 10, bottom: pos * 10 + 16, left: 0, right: 0 }));
    const onActivateComment = vi.fn();
    render(tree(viewProps({ onActivateComment })));
    emit(editor);
    expect(await screen.findByRole("button", { name: "Comment: Title c1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Comment: Title c2" })).toBeInTheDocument();
    expect(screen.getByTestId("comment-gutter").parentElement).toContainElement(screen.getByTestId("fake-renderer"));
  });

  it("has no gutter without a way to select a comment", async () => {
    render(tree(viewProps()));
    emit(makeEditor());
    await waitFor(() => expect(screen.getByTestId("fake-renderer")).toBeInTheDocument());
    expect(screen.queryByTestId("comment-gutter")).toBeNull();
  });
});


/** The text of the element the n-th scroll was called on. */
function scrolledText(call: number): string | null {
  return (scroll.mock.contexts[call] as HTMLElement | undefined)?.textContent ?? null;
}

async function mountWithAnchors(overrides: Partial<ArtifactViewProps> = {}) {
  const anchors = vi.fn();
  const editor = makeEditor();
  const view = render(tree(viewProps({ onActivateComment: vi.fn(), onAnchorsChange: anchors, ...overrides })));
  emit(editor);
  await waitFor(() => expect((anchors.mock.calls.at(-1)?.[0] as unknown[] | null)?.length).toBe(2));
  const rerender = (next: Partial<ArtifactViewProps>) =>
    view.rerender(tree(viewProps({ onActivateComment: vi.fn(), onAnchorsChange: anchors, ...overrides, ...next })));
  return { rerender, editor };
}

describe("ArtifactView scroll to the active comment's passage", () => {
  it("scrolls the passage of a newly active comment into view", async () => {
    const { rerender } = await mountWithAnchors();
    expect(scroll).not.toHaveBeenCalled();
    rerender({ activeCommentId: "c2" });
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scrolledText(0)).toBe("Owner is unclear.");
    rerender({ activeCommentId: "c1" });
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(scrolledText(1)).toBe("Ship the pilot.");
  });

  it("waits for the anchors when the comment was already active before they were resolved", async () => {
    await mountWithAnchors({ activeCommentId: "c1" });
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scrolledText(0)).toBe("Ship the pilot.");
  });

  it("does not scroll again for unrelated re-renders of the same active comment", async () => {
    const { rerender } = await mountWithAnchors({ activeCommentId: "c1" });
    rerender({ activeCommentId: "c1", commentsOpen: true });
    rerender({ activeCommentId: "c1", commentsOpen: false });
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("scrolls again when the already active comment is activated again (activation nonce)", async () => {
    const { rerender } = await mountWithAnchors({ activeCommentId: "c1", activationNonce: 1 });
    expect(scroll).toHaveBeenCalledTimes(1);
    rerender({ activeCommentId: "c1", activationNonce: 2 });
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it("scrolls again after the selection was cleared and the same comment is selected anew", async () => {
    const { rerender } = await mountWithAnchors({ activeCommentId: "c1" });
    rerender({ activeCommentId: null });
    rerender({ activeCommentId: "c1" });
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it("does not scroll for a comment without a resolved passage", async () => {
    const { rerender } = await mountWithAnchors();
    rerender({ activeCommentId: "unknown" });
    expect(scroll).not.toHaveBeenCalled();
  });

  it("leaves the scroll to a pending AI-change highlight, also once it is done", async () => {
    const change: ChangeRange = { start: CONTENT.indexOf("Budget"), end: CONTENT.indexOf("Budget") + "Budget is open.".length };
    const { rerender } = await mountWithAnchors({ highlight: change });
    rerender({ highlight: change, activeCommentId: "c1" });
    await waitFor(() => expect(applyHighlight).toHaveBeenCalledTimes(1));
    rerender({ highlight: null, activeCommentId: "c1" });
    expect(scroll).not.toHaveBeenCalled();
    // A later, deliberate selection scrolls as usual.
    rerender({ highlight: null, activeCommentId: "c2" });
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scrolledText(0)).toBe("Owner is unclear.");
  });
});
