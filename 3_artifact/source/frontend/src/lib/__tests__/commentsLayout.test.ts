import { describe, expect, it } from "vitest";
import {
  COMMENTS_COLUMN_WIDTH,
  DOCK_MIN_PANEL_WIDTH,
  MIN_TEXT_WIDTH,
  commentsPlacement,
} from "@/lib/commentsLayout";

describe("commentsPlacement", () => {
  it("derives the threshold from the column and the minimum text width", () => {
    expect(DOCK_MIN_PANEL_WIDTH).toBe(COMMENTS_COLUMN_WIDTH + MIN_TEXT_WIDTH);
  });

  it("docks at exactly the threshold and above", () => {
    expect(commentsPlacement(DOCK_MIN_PANEL_WIDTH)).toBe("docked");
    expect(commentsPlacement(DOCK_MIN_PANEL_WIDTH + 400)).toBe("docked");
  });

  it("falls back to the overlay one pixel below the threshold and for narrow panels", () => {
    expect(commentsPlacement(DOCK_MIN_PANEL_WIDTH - 1)).toBe("overlay");
    expect(commentsPlacement(280)).toBe("overlay");
  });
});
