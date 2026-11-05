import type { QuestionProposal } from "@/types/chat";

export function makeProposal(overrides: Partial<QuestionProposal> = {}): QuestionProposal {
  return {
    id: "prop-1",
    status: "open",
    origin_artifact_id: null,
    questions: [
      { id: "q1", title: "Budget", text: "Wie hoch ist das Budget?", state: "open" },
      { id: "q2", title: "Termin", text: "Bis wann soll das Projekt live gehen?", state: "open" },
    ],
    ...overrides,
  };
}
