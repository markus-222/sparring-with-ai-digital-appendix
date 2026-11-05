/**
 * Annotation plugin for the read-only Tiptap view: marks ranges of the current document (comment
 * anchors, resolved through `anchors.ts`) with inline decorations and reports clicks on them.
 *
 * The plugin state is the annotation list `{id, from, to, role, active}` (ProseMirror positions of
 * the CURRENT document) plus the decorations derived from it. It is replaced wholesale through
 * transaction meta (`setAnnotations`), never mutated.
 *
 * Document changes: positions are mapped through every transaction that changes the document, so
 * an annotation follows edits around it, and one whose text is replaced entirely (e.g. the view's
 * `setContent` after the artifact changed) is dropped. After such a content swap the caller must
 * resolve its anchors against the new document and call `setAnnotations` again.
 */
import { Extension, type AnyExtension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

export type AnnotationRole = "reviewer" | "explorer";

export interface Annotation {
  /** Comment id; written to `data-comment-id` on the highlighted spans. */
  id: string;
  /** ProseMirror positions in the current document, `from < to`. */
  from: number;
  to: number;
  role: AnnotationRole;
  /** The annotation of the currently selected/expanded comment (stronger highlight). */
  active: boolean;
  /** Hypothesis comments are drawn with a dashed underline. */
  hypothesis?: boolean;
}

interface AnnotationState {
  annotations: readonly Annotation[];
  decorations: DecorationSet;
}

export const annotationsKey = new PluginKey<AnnotationState>("annotations");

/** Attribute read by the click handler. */
export const COMMENT_ID_ATTRIBUTE = "data-comment-id";

function classNames(annotation: Annotation): string {
  const names = ["annotation", `annotation--${annotation.role}`];
  if (annotation.hypothesis === true) names.push("annotation--hypothesis");
  if (annotation.active) names.push("annotation--active");
  return names.join(" ");
}

/** Drops ranges that are empty or outside the document, so a stale list never throws. */
function build(annotations: readonly Annotation[], doc: PMNode): AnnotationState {
  const valid = annotations.filter((a) => a.from < a.to && a.from >= 0 && a.to <= doc.content.size);
  const decorations = DecorationSet.create(
    doc,
    valid.map((a) =>
      Decoration.inline(a.from, a.to, {
        class: classNames(a),
        [COMMENT_ID_ATTRIBUTE]: a.id,
        "data-annotation-role": a.role,
      }),
    ),
  );
  return { annotations: valid, decorations };
}

/**
 * The id a click on `target` reports. ProseMirror merges the `class` of overlapping inline
 * decorations but overwrites other attributes, so `data-comment-id` of an overlap shows only the
 * LAST decoration's id. The id is therefore decided from the annotation list: the DOM is split at
 * every annotation boundary, so the start of the clicked span lies in a segment that is covered by
 * a fixed set of annotations; of those, the narrowest range wins, then the active one, then the
 * first in list order. Without a position or a covering annotation the DOM attribute is used.
 */
function clickedId(view: EditorView, target: Element): string | null {
  const element = target.closest(`[${COMMENT_ID_ATTRIBUTE}]`);
  if (element === null) return null;
  const attribute = element.getAttribute(COMMENT_ID_ATTRIBUTE);
  let pos: number;
  try {
    pos = view.posAtDOM(element, 0);
  } catch {
    return attribute;
  }
  const covering = (annotationsKey.getState(view.state)?.annotations ?? []).filter((a) => a.from <= pos && pos < a.to);
  let best: Annotation | undefined;
  for (const a of covering) {
    if (best === undefined) best = a;
    else if (a.to - a.from < best.to - best.from) best = a;
    else if (a.to - a.from === best.to - best.from && a.active && !best.active) best = a;
  }
  return best?.id ?? attribute;
}

function createPlugin(getOnClick: () => ((id: string) => void) | undefined): Plugin<AnnotationState> {
  return new Plugin<AnnotationState>({
    key: annotationsKey,
    state: {
      init: (_config, state) => build([], state.doc),
      apply: (tr, value, _oldState, newState) => {
        const meta: unknown = tr.getMeta(annotationsKey);
        if (Array.isArray(meta)) return build(meta as readonly Annotation[], newState.doc);
        if (!tr.docChanged) return value;
        const mapped = value.annotations.map((a) => ({
          ...a,
          from: tr.mapping.map(a.from, 1),
          to: tr.mapping.map(a.to, -1),
        }));
        return build(mapped, newState.doc);
      },
    },
    props: {
      decorations: (state) => annotationsKey.getState(state)?.decorations ?? DecorationSet.empty,
      handleDOMEvents: {
        click: (view, event) => {
          const target = event.target;
          if (!(target instanceof Element)) return false;
          const id = clickedId(view, target);
          if (id === null) return false;
          getOnClick()?.(id);
          // Not handled: link clicks and citation badges inside a highlight keep working.
          return false;
        },
      },
    },
  });
}

/**
 * Extension carrying the annotation plugin. `getOnClick` is read on every click (keep the latest
 * callback in a ref), so a new callback never recreates the editor. Adds no schema nodes or marks.
 */
export function createAnnotationExtension(getOnClick: () => ((id: string) => void) | undefined): AnyExtension {
  return Extension.create({
    name: "annotations",
    addProseMirrorPlugins: () => [createPlugin(getOnClick)],
  });
}

/** Replaces all annotations (an empty list clears them). No-op on a destroyed editor. */
export function setAnnotations(editor: Editor, annotations: readonly Annotation[]): void {
  if (editor.isDestroyed) return;
  const { state, view } = editor;
  view.dispatch(state.tr.setMeta(annotationsKey, annotations).setMeta("addToHistory", false));
}

/** The annotations currently in effect (after mapping and validation). */
export function getAnnotations(editor: Editor): readonly Annotation[] {
  return annotationsKey.getState(editor.state)?.annotations ?? [];
}
