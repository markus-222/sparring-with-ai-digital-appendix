"use client";

import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useEffect, useState } from "react";
import { indexDoc, resolveAnchor } from "@/lib/richtext/anchors";
import { setAnnotations, type Annotation } from "@/lib/richtext/annotations";
import type { Comment } from "@/types";

/** A comment whose text passage was found in the rendered document (ProseMirror positions). */
export interface CommentAnchor {
  id: string;
  from: number;
  to: number;
}

/**
 * Resolves the passage of every open `text_change` comment (`suggestion.find`) against the
 * document of `editor`. `indexDoc` runs once; a find that is missing or ambiguous yields no entry
 * (that comment is "unresolved": sidebar only). Comments of another kind or status are skipped.
 */
export function resolveCommentAnchors(editor: Editor, comments: readonly Comment[]): CommentAnchor[] {
  const index = indexDoc(editor);
  const anchors: CommentAnchor[] = [];
  for (const comment of comments) {
    const { suggestion } = comment;
    if (comment.status !== "open" || suggestion === null || suggestion.kind !== "text_change") continue;
    try {
      const resolution = resolveAnchor(editor, index, suggestion.find);
      if (resolution.status === "resolved") anchors.push({ id: comment.id, from: resolution.from, to: resolution.to });
    } catch {
      // A find the Markdown parser rejects is simply unresolved.
    }
  }
  return anchors;
}

/** The annotation list for the resolved anchors: role and hypothesis from the comment, `active` from the selection. */
export function toAnnotations(
  anchors: readonly CommentAnchor[],
  comments: readonly Comment[],
  activeCommentId: string | null,
): Annotation[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const annotations: Annotation[] = [];
  for (const anchor of anchors) {
    const comment = byId.get(anchor.id);
    if (comment === undefined) continue;
    annotations.push({
      id: anchor.id,
      from: anchor.from,
      to: anchor.to,
      role: comment.role,
      active: anchor.id === activeCommentId,
      hypothesis: comment.hypothesis,
    });
  }
  return annotations;
}

interface Resolved {
  /** The inputs the anchors were resolved for; anchors of other inputs are stale. */
  doc: PMNode;
  content: string;
  comments: readonly Comment[];
  anchors: CommentAnchor[];
}

/**
 * Anchors of the open comments in the mounted reading view, and the comment highlights derived
 * from them. Returns the resolved `{id, from, to}` list (the gutter and the comments column
 * consume it), or `null` while it is unknown (no editor yet, comments not loaded, editor
 * unmounted for editing, or a render whose content/comments are newer than the last resolution),
 * which is not the same as "nothing resolved".
 *
 * Side effect: keeps the editor's annotations (`setAnnotations`) in sync with the anchors, the
 * comments and `activeCommentId`.
 *
 * `comments` must be referentially stable between renders while unchanged (SWR `data` is); it is
 * an effect dependency, so a fresh array on every render would re-resolve in a loop.
 *
 * Ordering: the view swaps new `content` into the editor in its own effect, and a child's effects
 * run before its parent's, so the resolving effect here sees the new document. A content swap
 * drops the annotations, so they are set again whenever the anchors are re-resolved. Anchors of
 * another document, content or comment list are never applied or returned, so a render that
 * changes several inputs at once never paints positions of the old text onto the new one.
 */
export function useCommentAnchors(
  editor: Editor | null,
  content: string,
  comments: readonly Comment[] | undefined,
  activeCommentId: string | null,
): readonly CommentAnchor[] | null {
  const [resolved, setResolved] = useState<Resolved | null>(null);

  useEffect(() => {
    if (editor === null || editor.isDestroyed || comments === undefined) {
      setResolved(null);
      return;
    }
    setResolved({ doc: editor.state.doc, content, comments, anchors: resolveCommentAnchors(editor, comments) });
  }, [editor, content, comments]);

  const current =
    editor !== null &&
    !editor.isDestroyed &&
    resolved !== null &&
    resolved.doc === editor.state.doc &&
    resolved.content === content &&
    resolved.comments === comments
      ? resolved
      : null;

  useEffect(() => {
    if (editor === null || current === null || comments === undefined) return;
    setAnnotations(editor, toAnnotations(current.anchors, comments, activeCommentId));
  }, [editor, current, comments, activeCommentId]);

  return current?.anchors ?? null;
}
