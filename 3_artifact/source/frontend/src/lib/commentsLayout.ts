/** Width of the comments column in px (docked or overlay). */
export const COMMENTS_COLUMN_WIDTH = 380;

/**
 * The reading text must keep at least this much width (~480px: about 60 characters per line at the
 * prose font size, plus the gutter margin) when the comments column is docked next to it.
 */
export const MIN_TEXT_WIDTH = 480;

/** Narrowest right panel (px) that still docks the column; below it the column overlays the text. */
export const DOCK_MIN_PANEL_WIDTH = COMMENTS_COLUMN_WIDTH + MIN_TEXT_WIDTH;

export type CommentsPlacement = "docked" | "overlay";

/** Docked beside the artifact text when the right panel is wide enough, else the old overlay. */
export function commentsPlacement(rightPanelWidth: number): CommentsPlacement {
  return rightPanelWidth >= DOCK_MIN_PANEL_WIDTH ? "docked" : "overlay";
}
