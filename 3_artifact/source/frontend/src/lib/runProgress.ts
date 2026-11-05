import type { Run } from "@/types";

export interface ProgressLine {
  id: string;
  label: string;
  state: "done" | "active" | "pending";
}

interface LineDef {
  id: string;
  label: string;
  steps: readonly string[];
}

const DRAFT_LINES: readonly LineDef[] = [
  { id: "reading", label: "Analyst is reading the documents", steps: ["reading"] },
  { id: "writing", label: "Analyst is writing the draft …", steps: ["writing"] },
  { id: "checking_format", label: "Checking format", steps: ["checking_format", "saving"] },
  { id: "done", label: "Done", steps: [] },
];

const REVIEW_LINES: readonly LineDef[] = [
  {
    id: "analyzing",
    label: "Analyzing draft and exploring perspectives",
    steps: ["reading", "checking_format", "reviewing"],
  },
  { id: "preparing_comments", label: "Preparing the comments", steps: ["preparing_comments"] },
];

export function progressLines(run: Pick<Run, "type" | "step" | "state">): ProgressLine[] {
  const defs = run.type === "draft" ? DRAFT_LINES : REVIEW_LINES;

  if (run.state === "succeeded") {
    return defs.map((d) => ({ id: d.id, label: d.label, state: "done" }));
  }

  // Index of the first line matching the current step.
  let firstActive = defs.findIndex((d) => run.step !== null && d.steps.includes(run.step));
  if (firstActive === -1) firstActive = 0;

  return defs.map((d, i) => {
    let state: ProgressLine["state"];
    if (run.step !== null && d.steps.includes(run.step)) state = "active";
    else if (i < firstActive) state = "done";
    else if (run.step === null && i === 0) state = "active";
    else state = "pending";
    return { id: d.id, label: d.label, state };
  });
}
