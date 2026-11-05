"use client";

import type { Editor } from "@tiptap/react";
import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CommentAnchor } from "@/hooks/useCommentAnchors";
import { spreadGutterIcons, type GutterItem } from "@/lib/gutterLayout";
import type { Comment } from "@/types";

/** Edge length of an icon in px (matches `.comment-gutter-icon` in globals.css). */
export const GUTTER_ICON_SIZE = 16;
/** Minimum vertical distance between two icons' tops (icon plus a 2px gap). */
export const GUTTER_MIN_SPACING = GUTTER_ICON_SIZE + 2;

export interface CommentGutterProps {
  /** The reading view's editor; `null` while it is not mounted. */
  editor: Editor | null;
  /** Resolved passages (`useCommentAnchors`); `null` while unknown. Comments without an entry get no icon. */
  anchors: readonly CommentAnchor[] | null;
  comments: readonly Comment[] | undefined;
  activeCommentId: string | null;
  /** An icon was clicked: select that comment. */
  onActivate: (id: string) => void;
}

function sameItems(a: readonly GutterItem[], b: readonly GutterItem[]): boolean {
  return a.length === b.length && a.every((item, i) => item.id === b[i]?.id && item.top === b[i]?.top);
}

/**
 * Top of each anchored passage relative to `layer`, as icon positions. `coordsAtPos` returns
 * viewport coordinates, and the layer lives inside the scrolling content (it moves with the text),
 * so `layer.getBoundingClientRect().top` already contains the scroll offset: the difference is the
 * offset inside the layer, whatever the scroll position. An anchor whose position cannot be
 * measured (out of range after a content swap, no layout in jsdom) is skipped.
 */
function measureIcons(editor: Editor, anchors: readonly CommentAnchor[], layer: HTMLElement): GutterItem[] {
  if (editor.isDestroyed) return [];
  const layerTop = layer.getBoundingClientRect().top;
  const items: GutterItem[] = [];
  for (const anchor of anchors) {
    try {
      const { top, bottom } = editor.view.coordsAtPos(anchor.from);
      const middle = (top + bottom) / 2 - layerTop;
      if (Number.isFinite(middle)) items.push({ id: anchor.id, top: middle - GUTTER_ICON_SIZE / 2 });
    } catch {
      // Skipped: that comment keeps its card but gets no icon.
    }
  }
  return spreadGutterIcons(items, GUTTER_MIN_SPACING);
}

/**
 * Left-margin gutter of the reading view: one icon per resolved comment, level with the first line
 * of its passage. Must be rendered inside a `relative` container that scrolls with the text; the
 * layer covers that container's left edge and lets clicks through everywhere but on the icons.
 * Positions are measured again when the anchors change (which they do with every document change)
 * and when the container or the editor content is resized.
 */
export function CommentGutter({ editor, anchors, comments, activeCommentId, onActivate }: CommentGutterProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<readonly GutterItem[]>([]);

  const measure = useCallback((): void => {
    const layer = layerRef.current;
    const next = editor === null || anchors === null || layer === null ? [] : measureIcons(editor, anchors, layer);
    setItems((previous) => (sameItems(previous, next) ? previous : next));
  }, [editor, anchors]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    // jsdom (unit tests) has no ResizeObserver.
    if (editor === null || editor.isDestroyed || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    const container = layerRef.current?.parentElement;
    if (container) observer.observe(container);
    observer.observe(editor.view.dom);
    return () => observer.disconnect();
  }, [editor, measure]);

  const byId = useMemo(() => new Map((comments ?? []).map((c) => [c.id, c])), [comments]);

  return (
    <div ref={layerRef} data-testid="comment-gutter" className="pointer-events-none absolute inset-y-0 left-0 w-6">
      {items.map((item) => {
        const comment = byId.get(item.id);
        if (comment === undefined) return null;
        const active = item.id === activeCommentId;
        return (
          <button
            key={item.id}
            type="button"
            data-gutter-comment-id={item.id}
            aria-label={`Comment: ${comment.title}`}
            aria-pressed={active}
            onClick={() => onActivate(item.id)}
            style={{ top: item.top }}
            className={`comment-gutter-icon comment-gutter-icon--${comment.role}${
              active ? " comment-gutter-icon--active" : ""
            }`}
          >
            <MessageSquare size={10} strokeWidth={2} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
