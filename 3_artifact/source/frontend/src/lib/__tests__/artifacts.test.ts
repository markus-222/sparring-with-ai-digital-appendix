import { describe, expect, it } from "vitest";
import {
  SLOT_DESCRIPTIONS,
  SLOT_ORDER,
  approveReason,
  commentActionReason,
  deleteReason,
  artifactForSlot,
  editReason,
  lockState,
  pickActiveSession,
  reviewReason,
  statusLabel,
  type LockState,
  type ReasonContext,
} from "@/lib/artifacts";
import { makeArtifact, makeRun } from "@/test/msw-server";
import type { Artifact, Session } from "@/types";

function session(id: string, createdAt: string): Session {
  return { id, project_id: "p1", title: null, created_at: createdAt, updated_at: createdAt };
}

describe("pickActiveSession", () => {
  it("returns the session with the newest created_at", () => {
    const sessions = [
      session("a", "2026-06-01T10:00:00Z"),
      session("c", "2026-06-03T10:00:00Z"),
      session("b", "2026-06-02T10:00:00Z"),
    ];
    expect(pickActiveSession(sessions)?.id).toBe("c");
  });

  it("returns null for an empty list", () => {
    expect(pickActiveSession([])).toBeNull();
  });

  it("does not mutate the input order", () => {
    const sessions = [session("a", "2026-06-01T10:00:00Z"), session("b", "2026-06-02T10:00:00Z")];
    pickActiveSession(sessions);
    expect(sessions.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("artifactForSlot", () => {
  const artifacts = [makeArtifact("03"), makeArtifact("01"), makeArtifact("02")];

  it("finds the artifact by slot", () => {
    expect(artifactForSlot(artifacts, "02")?.id).toBe("art-02");
    expect(artifactForSlot(artifacts, "01")?.id).toBe("art-01");
  });

  it("returns null when the slot is missing", () => {
    expect(artifactForSlot([makeArtifact("01")], "03")).toBeNull();
  });
});

describe("statusLabel", () => {
  it("maps every status to its UI label", () => {
    expect(statusLabel("not_started")).toBe("Not started");
    expect(statusLabel("draft")).toBe("Draft");
    expect(statusLabel("approved")).toBe("Approved");
  });
});

describe("SLOT_ORDER", () => {
  it("lists the slots in order", () => {
    expect(SLOT_ORDER).toEqual(["01", "02", "03"]);
  });
});

describe("SLOT_DESCRIPTIONS", () => {
  it("has one non-empty sentence per slot", () => {
    for (const slot of SLOT_ORDER) {
      expect(SLOT_DESCRIPTIONS[slot].trim().length).toBeGreaterThan(10);
    }
  });
});

describe("lockState", () => {
  it("locks the run while a run is running", () => {
    expect(lockState({ run: makeRun({ state: "running" }), editorOpen: false })).toEqual({
      runLocked: true,
      editorLocked: false,
    });
  });

  it("does not lock for no run or a finished run", () => {
    expect(lockState({ run: null, editorOpen: false }).runLocked).toBe(false);
    expect(lockState({ run: makeRun({ state: "succeeded" }), editorOpen: false }).runLocked).toBe(false);
    expect(lockState({ run: makeRun({ state: "failed" }), editorOpen: false }).runLocked).toBe(false);
  });

  it("locks the editor while it is open", () => {
    expect(lockState({ run: null, editorOpen: true })).toEqual({ runLocked: false, editorLocked: true });
  });
});

const FREE: LockState = { runLocked: false, editorLocked: false };
const RUN_REASON = "A run is active. Please wait until it has finished.";
const EDITOR_REASON = "Please save or cancel your edits first.";

function ctx(artifact: Artifact, overrides: Partial<ReasonContext> = {}): ReasonContext {
  return { artifact, openComments: 0, locks: FREE, ...overrides };
}

const DRAFT = makeArtifact("01", { status: "draft", content: "# Project\nText" });

describe("reviewReason", () => {
  it("is enabled for a non-empty draft without open comments", () => {
    expect(reviewReason(ctx(DRAFT))).toBeNull();
  });

  it("explains an active run and an open editor", () => {
    expect(reviewReason(ctx(DRAFT, { locks: { runLocked: true, editorLocked: false } }))).toBe(RUN_REASON);
    expect(reviewReason(ctx(DRAFT, { locks: { runLocked: false, editorLocked: true } }))).toBe(EDITOR_REASON);
  });

  it("prefers the run reason when both locks are set", () => {
    expect(reviewReason(ctx(DRAFT, { locks: { runLocked: true, editorLocked: true } }))).toBe(RUN_REASON);
  });

  it("requires a draft", () => {
    expect(reviewReason(ctx(makeArtifact("01")))).toBe("Create a draft first.");
  });

  it("requires content", () => {
    expect(reviewReason(ctx(makeArtifact("01", { status: "draft", content: "  \n" })))).toBe("The draft is empty.");
  });

  it("requires all comments to be resolved", () => {
    expect(reviewReason(ctx(DRAFT, { openComments: 2 }))).toBe("Resolve all open comments first.");
  });
});

describe("approveReason", () => {
  it("is enabled for a non-empty draft without open comments", () => {
    expect(approveReason(ctx(DRAFT))).toBeNull();
  });

  it("explains an active run and an open editor", () => {
    expect(approveReason(ctx(DRAFT, { locks: { runLocked: true, editorLocked: false } }))).toBe(RUN_REASON);
    expect(approveReason(ctx(DRAFT, { locks: { runLocked: false, editorLocked: true } }))).toBe(EDITOR_REASON);
  });

  it("requires all comments to be resolved", () => {
    expect(approveReason(ctx(DRAFT, { openComments: 1 }))).toBe("Resolve all open comments first.");
  });

  it("requires a draft with content", () => {
    expect(approveReason(ctx(makeArtifact("01")))).toBe("Create a draft first.");
    expect(approveReason(ctx(makeArtifact("01", { status: "draft", content: "" })))).toBe("The draft is empty.");
  });
});

describe("editReason", () => {
  it("is enabled for a draft and an approved artifact", () => {
    expect(editReason(ctx(DRAFT))).toBeNull();
    expect(editReason(ctx(makeArtifact("01", { status: "approved", content: "x" })))).toBeNull();
  });

  it("explains an active run and an open editor", () => {
    expect(editReason(ctx(DRAFT, { locks: { runLocked: true, editorLocked: false } }))).toBe(RUN_REASON);
    expect(editReason(ctx(DRAFT, { locks: { runLocked: false, editorLocked: true } }))).toBe(EDITOR_REASON);
  });

  it("needs a draft first for a not started artifact", () => {
    expect(editReason(ctx(makeArtifact("01")))).toBe("Create a draft first.");
  });

  it("does not require resolved comments", () => {
    expect(editReason(ctx(DRAFT, { openComments: 3 }))).toBeNull();
  });
});

describe("commentActionReason", () => {
  it("is null when nothing is locked", () => {
    expect(commentActionReason({ runLocked: false, editorLocked: false })).toBeNull();
  });

  it("explains an active run and an open editor, run first", () => {
    expect(commentActionReason({ runLocked: true, editorLocked: false })).toBe(RUN_REASON);
    expect(commentActionReason({ runLocked: false, editorLocked: true })).toBe(EDITOR_REASON);
    expect(commentActionReason({ runLocked: true, editorLocked: true })).toBe(RUN_REASON);
  });
});

describe("deleteReason", () => {
  const artifact = makeArtifact("01", { status: "approved", content: "# Text" });

  it("is enabled for any started artifact, even with open comments", () => {
    const ctx: ReasonContext = { artifact, openComments: 3, locks: { runLocked: false, editorLocked: false } };
    expect(deleteReason(ctx)).toBeNull();
  });

  it("is blocked by a run and by an open editor", () => {
    expect(deleteReason({ artifact, openComments: 0, locks: { runLocked: true, editorLocked: false } })).toBe(
      "A run is active. Please wait until it has finished.",
    );
    expect(deleteReason({ artifact, openComments: 0, locks: { runLocked: false, editorLocked: true } })).toBe(
      "Please save or cancel your edits first.",
    );
  });
});
