import { useEffect, useState } from "react";

/** Keeps an element mounted for `exitMs` after `open` turns false, so its exit animation can play. */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open || !mounted) return;
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [open, mounted, exitMs]);

  return { mounted, closing: mounted && !open };
}
