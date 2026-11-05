import type { Comment } from "@/types";

export interface SplitComments {
  /** Open Reviewer comments, in the model's importance order (`number`). */
  reviewer: Comment[];
  /** Open Explorer comments, in the model's importance order (`number`). */
  explorer: Comment[];
  /** Everything that is not open, newest first. */
  resolved: Comment[];
}

function byNumber(a: Comment, b: Comment): number {
  return a.number - b.number;
}

function newestFirst(a: Comment, b: Comment): number {
  const delta = Date.parse(b.created_at) - Date.parse(a.created_at);
  return delta !== 0 ? delta : b.number - a.number;
}

/** Groups the comments of one artifact for the comments column. */
export function splitComments(comments: Comment[]): SplitComments {
  const open = comments.filter((c) => c.status === "open");
  return {
    reviewer: open.filter((c) => c.role === "reviewer").sort(byNumber),
    explorer: open.filter((c) => c.role === "explorer").sort(byNumber),
    resolved: comments.filter((c) => c.status !== "open").sort(newestFirst),
  };
}

export type ResultLabel = "Applied" | "Added to workshop questions" | "Rejected" | "Marked as done";

/** Result shown on a resolved comment. */
export function resultLabel(comment: Comment): ResultLabel {
  switch (comment.status) {
    case "rejected":
      return "Rejected";
    case "done_manually":
      return "Marked as done";
    case "accepted":
    case "edited":
    case "open":
      return comment.suggestion?.kind === "workshop_question" ? "Added to workshop questions" : "Applied";
  }
}

export function roleLabel(comment: Comment): { label: "Reviewer" | "Explorer"; hypothesis: boolean } {
  return { label: comment.role === "reviewer" ? "Reviewer" : "Explorer", hypothesis: comment.hypothesis };
}

/**
 * Comment `sources` come as `[[doc:file]]`, `[[artifact:01]]` or bare (`01`, `file.md`).
 * Normalises them to citation syntax so the shared reference renderer can show buttons.
 */
export function sourceCitations(sources: string[]): string {
  return sources
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map((s) => {
      if (s.startsWith("[[")) return s;
      return /^\d{2}$/.test(s) ? `[[artifact:${s}]]` : `[[doc:${s}]]`;
    })
    .join(" ");
}
