"use client";

import { Extension, type AnyExtension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { resolveReference } from "@/lib/resolveReference";
import { createAnnotationExtension } from "./annotations";
import { buildExtensions, MarkerNode, SourceReferenceNode } from "./extensions";
import { MarkerView, SourceReferenceView } from "./nodeViews";
import type { ReferenceContextValue } from "./referenceContext";

/**
 * Plain Markdown links (`[interview.md](interview.md)`) that name a known document filename or a
 * slotted artifact's title open that source in place instead of navigating, exactly like
 * `createReferenceComponents` does for the chat. Real external links are left alone (they open in
 * a new tab). Visual parity with the icon badge is not a goal here.
 *
 * `getReferenceContext` is read on every click, so the editor does not have to be recreated when
 * documents/artifacts change (keep the latest value in a ref).
 */
export function createReferenceLinkClickExtension(getReferenceContext: () => ReferenceContextValue): AnyExtension {
  return Extension.create({
    name: "referenceLinkClick",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey("referenceLinkClick"),
          props: {
            handleDOMEvents: {
              click: (_view, event) => {
                const target = event.target;
                if (!(target instanceof Element)) return false;
                const anchor = target.closest("a[href]");
                if (anchor === null) return false;
                const { documents, artifacts, onOpenSource } = getReferenceContext();
                const resolved = resolveReference({
                  href: anchor.getAttribute("href"),
                  text: anchor.textContent ?? "",
                  documents,
                  artifacts,
                });
                if (resolved === null) return false;
                event.preventDefault();
                if (resolved.source !== null) onOpenSource?.(resolved.source);
                return true;
              },
            },
          },
        }),
      ];
    },
  });
}

/**
 * The extension list for the mounted read view: `buildExtensions()` (same schema as the anchor
 * resolver) with React node views for citations and markers plus the plain-link click handler.
 * The node views read documents/artifacts/`onOpenSource` from `ReferenceContext`; the click handler
 * reads them through `getReferenceContext`. `markers: false` omits the marker node (see
 * `BuildExtensionsOptions.markers`). The annotation plugin is always registered (it adds no schema
 * nodes); `getOnAnnotationClick` is read on every click on an annotated range.
 */
export function buildViewExtensions(
  getReferenceContext: () => ReferenceContextValue,
  {
    markers = true,
    getOnAnnotationClick = () => undefined,
  }: { markers?: boolean; getOnAnnotationClick?: () => ((id: string) => void) | undefined } = {},
): AnyExtension[] {
  return buildExtensions({
    markers,
    sourceReference: SourceReferenceNode.extend({
      addNodeView() {
        return ReactNodeViewRenderer(SourceReferenceView, { as: "span" });
      },
    }),
    marker: MarkerNode.extend({
      addNodeView() {
        return ReactNodeViewRenderer(MarkerView, { as: "span" });
      },
    }),
    extra: [createReferenceLinkClickExtension(getReferenceContext), createAnnotationExtension(getOnAnnotationClick)],
  });
}
