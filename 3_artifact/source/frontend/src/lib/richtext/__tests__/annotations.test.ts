import { Editor } from "@tiptap/core";
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { indexDoc, resolveAnchor } from "../anchors";
import {
  createAnnotationExtension,
  getAnnotations,
  setAnnotations,
  type Annotation,
} from "../annotations";
import { buildExtensions } from "../extensions";

const editors: Editor[] = [];

function makeEditor(markdown: string, onClick?: (id: string) => void): Editor {
  const editor = new Editor({
    extensions: buildExtensions({ extra: [createAnnotationExtension(() => onClick)] }),
    content: markdown,
    contentType: "markdown",
    editable: false,
  });
  editors.push(editor);
  return editor;
}

function annotation(editor: Editor, find: string, extra: Partial<Annotation> & { id: string }): Annotation {
  const resolution = resolveAnchor(editor, indexDoc(editor), find);
  if (resolution.status !== "resolved") throw new Error(`could not resolve ${find}`);
  return { from: resolution.from, to: resolution.to, role: "reviewer", active: false, ...extra };
}

function spans(editor: Editor): HTMLElement[] {
  return Array.from(editor.view.dom.querySelectorAll<HTMLElement>("[data-comment-id]"));
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("annotation decorations", () => {
  it("wraps each resolved range in a span with the comment id and a role class", () => {
    const editor = makeEditor("Alpha beta gamma.\n\nDelta epsilon.\n");
    setAnnotations(editor, [
      annotation(editor, "beta gamma", { id: "c1", role: "reviewer" }),
      annotation(editor, "Delta epsilon.", { id: "c2", role: "explorer" }),
    ]);
    const found = spans(editor);
    expect(found.map((s) => [s.dataset.commentId, s.textContent])).toEqual([
      ["c1", "beta gamma"],
      ["c2", "Delta epsilon."],
    ]);
    expect(found[0]).toHaveClass("annotation", "annotation--reviewer");
    expect(found[1]).toHaveClass("annotation", "annotation--explorer");
    expect(found[0]).not.toHaveClass("annotation--active", "annotation--hypothesis");
  });

  it("adds the active and hypothesis modifier classes", () => {
    const editor = makeEditor("Alpha beta gamma.\n");
    setAnnotations(editor, [annotation(editor, "beta", { id: "c1", role: "explorer", active: true, hypothesis: true })]);
    expect(spans(editor)[0]).toHaveClass("annotation--explorer", "annotation--active", "annotation--hypothesis");
  });

  it("replaces the previous list on each call and clears with an empty list", () => {
    const editor = makeEditor("Alpha beta gamma.\n");
    setAnnotations(editor, [annotation(editor, "Alpha", { id: "c1" })]);
    setAnnotations(editor, [annotation(editor, "gamma", { id: "c2" })]);
    expect(spans(editor).map((s) => s.dataset.commentId)).toEqual(["c2"]);
    setAnnotations(editor, []);
    expect(spans(editor)).toHaveLength(0);
    expect(getAnnotations(editor)).toEqual([]);
  });

  it("splits one annotation over inline marks into several spans that share the id", () => {
    const editor = makeEditor("One **bold** two.\n");
    setAnnotations(editor, [annotation(editor, "One bold two.", { id: "c1" })]);
    const found = spans(editor);
    expect(found.length).toBeGreaterThan(1);
    expect(new Set(found.map((s) => s.dataset.commentId))).toEqual(new Set(["c1"]));
    expect(found.map((s) => s.textContent).join("")).toBe("One bold two.");
  });

  it("ignores empty and out-of-document ranges instead of throwing", () => {
    const editor = makeEditor("Alpha.\n");
    const size = editor.state.doc.content.size;
    setAnnotations(editor, [
      { id: "empty", from: 2, to: 2, role: "reviewer", active: false },
      { id: "far", from: 1, to: size + 50, role: "reviewer", active: false },
      annotation(editor, "Alpha", { id: "ok" }),
    ]);
    expect(spans(editor).map((s) => s.dataset.commentId)).toEqual(["ok"]);
  });

  it("is a no-op on a destroyed editor", () => {
    const editor = makeEditor("Alpha.\n");
    editor.destroy();
    expect(() => setAnnotations(editor, [])).not.toThrow();
  });
});

describe("annotation click", () => {
  it("reports the comment id when a highlighted range is clicked", () => {
    const onClick = vi.fn();
    const editor = makeEditor("Alpha beta gamma.\n\nDelta.\n", onClick);
    setAnnotations(editor, [annotation(editor, "beta", { id: "c7" })]);
    const target = spans(editor)[0];
    if (target === undefined) throw new Error("no annotated span");
    fireEvent.click(target);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith("c7");
  });

  it("does not report clicks outside highlights, and tolerates a missing callback", () => {
    const onClick = vi.fn();
    const editor = makeEditor("Alpha beta gamma.\n\nDelta.\n", onClick);
    setAnnotations(editor, [annotation(editor, "beta", { id: "c7" })]);
    const paragraphs = editor.view.dom.querySelectorAll("p");
    fireEvent.click(paragraphs[1] as HTMLElement);
    expect(onClick).not.toHaveBeenCalled();

    const silent = makeEditor("Alpha beta.\n");
    setAnnotations(silent, [annotation(silent, "beta", { id: "c1" })]);
    const target = spans(silent)[0];
    if (target === undefined) throw new Error("no annotated span");
    expect(() => fireEvent.click(target)).not.toThrow();
  });

  it("reads the latest callback at click time", () => {
    const first = vi.fn();
    const second = vi.fn();
    let current: ((id: string) => void) | undefined = first;
    const editor = new Editor({
      extensions: buildExtensions({ extra: [createAnnotationExtension(() => current)] }),
      content: "Alpha beta.\n",
      contentType: "markdown",
      editable: false,
    });
    editors.push(editor);
    setAnnotations(editor, [annotation(editor, "beta", { id: "c1" })]);
    current = second;
    const target = spans(editor)[0];
    if (target === undefined) throw new Error("no annotated span");
    fireEvent.click(target);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("c1");
  });
});

describe("annotation click on overlapping ranges", () => {
  const TEXT = "Alpha beta gamma delta.\n";

  function overlapping(onClick: (id: string) => void, order: "wide-first" | "narrow-first", extra: Partial<Annotation> = {}) {
    const editor = makeEditor(TEXT, onClick);
    const wide = annotation(editor, "Alpha beta gamma delta.", { id: "wide", ...extra });
    const narrow = annotation(editor, "beta", { id: "narrow" });
    setAnnotations(editor, order === "wide-first" ? [wide, narrow] : [narrow, wide]);
    return editor;
  }

  function spanWithText(editor: Editor, text: string): HTMLElement {
    const found = spans(editor).find((s) => s.textContent === text);
    if (found === undefined) throw new Error(`no span "${text}"`);
    return found;
  }

  it.each(["wide-first", "narrow-first"] as const)(
    "reports the narrowest annotation inside the overlap, whatever the list order (%s)",
    (order) => {
      const onClick = vi.fn();
      const editor = overlapping(onClick, order);
      fireEvent.click(spanWithText(editor, "beta"));
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onClick).toHaveBeenCalledWith("narrow");
    },
  );

  it.each(["wide-first", "narrow-first"] as const)(
    "reports the wide annotation outside the overlap (%s)",
    (order) => {
      const onClick = vi.fn();
      const editor = overlapping(onClick, order);
      fireEvent.click(spanWithText(editor, "Alpha "));
      fireEvent.click(spanWithText(editor, " gamma delta."));
      expect(onClick.mock.calls).toEqual([["wide"], ["wide"]]);
    },
  );

  it("prefers the active annotation over the first one when two ranges are equally narrow", () => {
    const onClick = vi.fn();
    const editor = makeEditor(TEXT, onClick);
    setAnnotations(editor, [
      annotation(editor, "beta", { id: "first" }),
      annotation(editor, "beta", { id: "second", active: true }),
    ]);
    fireEvent.click(spans(editor)[0] as HTMLElement);
    expect(onClick).toHaveBeenCalledWith("second");
  });

  it("falls back to the first annotation when equally narrow ranges are all inactive", () => {
    const onClick = vi.fn();
    const editor = makeEditor(TEXT, onClick);
    setAnnotations(editor, [
      annotation(editor, "beta", { id: "first" }),
      annotation(editor, "beta", { id: "second" }),
    ]);
    fireEvent.click(spans(editor)[0] as HTMLElement);
    expect(onClick).toHaveBeenCalledWith("first");
  });
});

describe("annotations when the document changes", () => {
  it("maps ranges through an edit before them", () => {
    const editor = makeEditor("Alpha beta gamma.\n");
    setAnnotations(editor, [annotation(editor, "beta", { id: "c1" })]);
    editor.view.dispatch(editor.state.tr.insertText("XYZ ", 1));
    expect(spans(editor).map((s) => s.textContent)).toEqual(["beta"]);
    expect(getAnnotations(editor)[0]?.from).toBe(1 + 4 + 6);
  });

  it("drops annotations whose text was replaced by a content swap; setting them again works", () => {
    const editor = makeEditor("Alpha beta gamma.\n");
    setAnnotations(editor, [annotation(editor, "beta", { id: "c1" })]);
    editor.commands.setContent("Completely new beta text.\n", { contentType: "markdown", emitUpdate: false });
    expect(spans(editor)).toHaveLength(0);
    expect(getAnnotations(editor)).toEqual([]);

    setAnnotations(editor, [annotation(editor, "new beta", { id: "c1" })]);
    expect(spans(editor).map((s) => s.textContent)).toEqual(["new beta"]);
  });
});
