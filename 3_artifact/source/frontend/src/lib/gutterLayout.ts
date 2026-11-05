export interface GutterItem {
  id: string;
  /** Vertical position in px, relative to the gutter layer. */
  top: number;
}

/**
 * Collision handling for the comment gutter: sorts the icons by `top` (stable, so equal tops keep
 * their input order) and pushes each one down until it is at least `minSpacing` below the previous
 * one. Never moves an icon up, so every icon stays at or below the line of its passage. Pure.
 */
export function spreadGutterIcons<T extends GutterItem>(items: readonly T[], minSpacing: number): T[] {
  const sorted = [...items].sort((a, b) => a.top - b.top);
  const result: T[] = [];
  let previousTop = Number.NEGATIVE_INFINITY;
  for (const item of sorted) {
    const top = Math.max(item.top, previousTop + minSpacing);
    result.push(top === item.top ? item : { ...item, top });
    previousTop = top;
  }
  return result;
}
