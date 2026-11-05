import type { Artifact, ArtifactStatus, Run, Session, Slot } from "@/types";

export const SLOT_ORDER: readonly Slot[] = ["01", "02", "03"];

export function artifactForSlot(artifacts: Artifact[], slot: Slot): Artifact | null {
  return artifacts.find((a) => a.slot === slot) ?? null;
}

const STATUS_LABELS: Record<ArtifactStatus, string> = {
  not_started: "Not started",
  draft: "Draft",
  approved: "Approved",
};

export function statusLabel(status: ArtifactStatus): string {
  return STATUS_LABELS[status];
}

/** The project's single chat is its newest session. Messages do not bump `updated_at`. */
export function pickActiveSession(sessions: Session[]): Session | null {
  let newest: Session | null = null;
  for (const s of sessions) {
    if (newest === null || Date.parse(s.created_at) > Date.parse(newest.created_at)) {
      newest = s;
    }
  }
  return newest;
}

/** Shown for an artifact that has not been started yet. */
export const SLOT_DESCRIPTIONS: Record<Slot, string> = {
  "01": "Problem, causes, impact and scope of the project, based on the customer documents.",
  "02": "One section per stakeholder with interest, influence and source, plus gaps.",
  "03": "Collected and new open points, each with a workshop question, grouped by topic.",
};

export interface LockState {
  /** A background run is active: comment actions, review and approve are disabled. */
  runLocked: boolean;
  /** The editor is open: the same actions are disabled. */
  editorLocked: boolean;
}

export function lockState(opts: { run: Run | null; editorOpen: boolean }): LockState {
  return { runLocked: opts.run?.state === "running", editorLocked: opts.editorOpen };
}

export interface ReasonContext {
  artifact: Artifact;
  openComments: number;
  locks: LockState;
}

const RUN_ACTIVE_REASON = "A run is active. Please wait until it has finished.";
const EDITOR_OPEN_REASON = "Please save or cancel your edits first.";
const OPEN_COMMENTS_REASON = "Resolve all open comments first.";
const NO_DRAFT_REASON = "Create a draft first.";
const EMPTY_DRAFT_REASON = "The draft is empty.";

function lockReason(locks: LockState): string | null {
  if (locks.runLocked) return RUN_ACTIVE_REASON;
  if (locks.editorLocked) return EDITOR_OPEN_REASON;
  return null;
}

/** Why comment actions (Accept, Edit, Reject, Ask) are disabled, or null when they are enabled. */
export function commentActionReason(locks: LockState): string | null {
  return lockReason(locks);
}

/** Shared by review and approve: both need a non-empty draft and no open comments. */
function draftActionReason(ctx: ReasonContext): string | null {
  const locked = lockReason(ctx.locks);
  if (locked) return locked;
  if (ctx.artifact.status !== "draft") return NO_DRAFT_REASON;
  if (ctx.artifact.content.trim() === "") return EMPTY_DRAFT_REASON;
  if (ctx.openComments > 0) return OPEN_COMMENTS_REASON;
  return null;
}

/** Why `[Request review]` is disabled, or null when it is enabled. */
export function reviewReason(ctx: ReasonContext): string | null {
  return draftActionReason(ctx);
}

/** Why `[Approve]` is disabled, or null when it is enabled. */
export function approveReason(ctx: ReasonContext): string | null {
  return draftActionReason(ctx);
}

/** Why `[Delete]` is disabled, or null when it is enabled. */
export function deleteReason(ctx: ReasonContext): string | null {
  return lockReason(ctx.locks);
}

/** Why `[Edit]` is disabled, or null when it is enabled. */
export function editReason(ctx: ReasonContext): string | null {
  const locked = lockReason(ctx.locks);
  if (locked) return locked;
  if (ctx.artifact.status === "not_started") return NO_DRAFT_REASON;
  return null;
}
