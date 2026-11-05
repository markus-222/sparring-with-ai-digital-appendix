import { act, render, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import type { Editor as ReactEditor } from "@tiptap/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactView, type ChangeRange } from "@/components/artifact/ArtifactView";
import type { MarkdownRendererProps } from "@/components/documents/MarkdownRenderer";
import { applyHighlight } from "@/lib/highlight";
import { buildExtensions } from "@/lib/richtext/extensions";
import { makeArtifact } from "@/test/msw-server";

vi.mock("@/lib/highlight", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/highlight")>();
  return { ...original, applyHighlight: vi.fn(() => () => undefined) };
});

// The real renderer is loaded through next/dynamic and is ready too quickly to observe the "editor
// not ready yet" window, so a controllable stand-in hands out real editors on demand.
const renderer = vi.hoisted(() => ({ onEditorReady: null as ((editor: unknown) => void) | null }));
vi.mock("@/components/documents/MarkdownRenderer", () => ({
  MarkdownRenderer: (props: MarkdownRendererProps) => {
    renderer.onEditorReady = props.onEditorReady as (editor: unknown) => void;
    return <div data-testid="fake-renderer" />;
  },
}));

const CONTENT = "## Causes\n- Shortened cause\n- Old cause two";
const START = CONTENT.indexOf("- Shortened cause");
const CHANGE: ChangeRange = { start: START, end: START + "- Shortened cause".length };

const editors: Editor[] = [];
function makeEditor(content = CONTENT): Editor {
  const editor = new Editor({
    extensions: buildExtensions(),
    content,
    contentType: "markdown",
    editable: false,
  });
  editors.push(editor);
  return editor;
}

/** Hands an editor to the view like `MarkdownRenderer.onEditorReady` does (and `null` on teardown). */
function emit(editor: Editor | null): void {
  act(() => renderer.onEditorReady?.(editor as ReactEditor | null));
}

async function frame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  });
}

function view(highlight: ChangeRange | null, onHighlightDone?: () => void) {
  const artifact = makeArtifact("01", { status: "draft", content: CONTENT });
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ArtifactView
        artifact={artifact}
        documents={[]}
        artifacts={[artifact]}
        locks={{ runLocked: false, editorLocked: false }}
        onRequestReview={() => undefined}
        editing={false}
        saving={false}
        editError={null}
        onStartEdit={() => undefined}
        onCancelEdit={() => undefined}
        onSaveEdit={async () => undefined}
        approveBusy={false}
        approveError={null}
        onApprove={async () => true}
        onClearActionError={() => undefined}
        onDownload={() => undefined}
        onDelete={() => undefined}
        highlight={highlight}
        onHighlightDone={onHighlightDone}
        onBack={() => undefined}
        onOpenSource={() => undefined}
        commentsOpen={false}
        onToggleComments={() => undefined}
      />
    </SWRConfig>
  );
}

describe("ArtifactView highlight while the editor is not ready", () => {
  beforeEach(() => {
    vi.mocked(applyHighlight).mockClear();
    renderer.onEditorReady = null;
  });

  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
  });

  it("holds a pending highlight until the editor exists, then runs it once and reports done", async () => {
    const done = vi.fn();
    render(view(CHANGE, done));
    await frame();
    await frame();
    expect(applyHighlight).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();

    emit(makeEditor());
    await waitFor(() => expect(applyHighlight).toHaveBeenCalledTimes(1));
    expect(vi.mocked(applyHighlight).mock.calls[0][0]?.toString()).toBe("Shortened cause");
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("does not run again when onEditorReady re-fires for the same change", async () => {
    const done = vi.fn();
    const { rerender } = render(view(CHANGE, done));
    emit(makeEditor());
    await waitFor(() => expect(applyHighlight).toHaveBeenCalledTimes(1));

    // The parent has not cleared `highlight` yet; the view remounts and hands out a new editor.
    emit(null);
    emit(makeEditor());
    rerender(view(CHANGE, done));
    await frame();
    await frame();
    expect(applyHighlight).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("never runs against a torn-down editor (null) and waits for the next one", async () => {
    const done = vi.fn();
    render(view(CHANGE, done));
    const stale = makeEditor();
    emit(stale);
    emit(null); // before the frame fires
    stale.destroy();
    await frame();
    await frame();
    expect(applyHighlight).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();

    emit(makeEditor());
    await waitFor(() => expect(applyHighlight).toHaveBeenCalledTimes(1));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("treats a later, different change as a new request", async () => {
    const { rerender } = render(view(CHANGE));
    emit(makeEditor());
    await waitFor(() => expect(applyHighlight).toHaveBeenCalledTimes(1));
    rerender(view({ ...CHANGE }));
    await waitFor(() => expect(applyHighlight).toHaveBeenCalledTimes(2));
  });
});
