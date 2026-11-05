"use client";

import { useState, useCallback, useEffect, useRef } from "react";

interface UseResizeOptions {
  /** Fraction of viewport width to use as the initial panel width, e.g. 0.38 */
  initialRatio?: number;
  min?: number;
  max?: number;
}

/**
 * Deterministic fallback width used for the server-rendered markup and the
 * first client paint. `window.innerWidth` is not available during SSR, so it
 * must never be read while computing render output (that would make the
 * server and client disagree and trigger a hydration mismatch). The real,
 * viewport-based width is applied afterwards, client-only, inside an effect.
 */
const DEFAULT_WIDTH = 560;

/** Clamps a pixel width to the given bounds. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Computes a sensible width based on the current viewport. Client-only. */
function getViewportWidth(ratio: number, min: number, max: number): number {
  return clamp(Math.round(window.innerWidth * ratio), min, max);
}

export function useResize({ initialRatio = 0.38, min = 280, max = 1200 }: UseResizeOptions = {}) {
  // Always start from the same fixed width on the server and the first
  // client render so hydration never sees mismatched `style` attributes.
  const [width, setWidth] = useState(() => clamp(DEFAULT_WIDTH, min, max));

  // Re-compute the viewport-based width when the browser window is resized,
  // but only if the user hasn't manually dragged (we track that below).
  const [userResized, setUserResized] = useState(false);
  // Ensures the deterministic default is swapped for a real viewport-based
  // width exactly once after mount, without re-running on every resize.
  const didSyncOnMount = useRef(false);
  // Read by `onResizeStart` so the callback stays stable while the width changes during a drag.
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    if (userResized) return;

    if (!didSyncOnMount.current) {
      didSyncOnMount.current = true;
      setWidth(getViewportWidth(initialRatio, min, max));
    }

    function handleResize() {
      setWidth(getViewportWidth(initialRatio, min, max));
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [userResized, initialRatio, min, max]);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      const startX = e.clientX;
      const startWidth = widthRef.current;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      setUserResized(true);

      function onMouseMove(ev: MouseEvent) {
        setWidth(clamp(startWidth - (ev.clientX - startX), min, max));
      }
      function onMouseUp() {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      }
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [min, max],
  );

  return { width, setWidth, onResizeStart };
}
