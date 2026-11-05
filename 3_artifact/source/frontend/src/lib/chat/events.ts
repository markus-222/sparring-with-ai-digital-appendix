import type { AgentName, ChatStreamEvent, ProposalState, QuestionProposal } from "@/types/chat";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isAgent(v: unknown): v is AgentName {
  return v === "analyst";
}

function isProposalState(v: unknown): v is ProposalState {
  return v === "open" || v === "accepted" || v === "rejected";
}

export function parseProposal(v: unknown): QuestionProposal | null {
  if (!isRecord(v) || typeof v.id !== "string" || !isProposalState(v.status) || !Array.isArray(v.questions)) {
    return null;
  }
  const questions: QuestionProposal["questions"] = [];
  for (const q of v.questions) {
    if (!isRecord(q) || typeof q.id !== "string" || typeof q.title !== "string" || typeof q.text !== "string" || !isProposalState(q.state)) {
      return null;
    }
    questions.push({ id: q.id, title: q.title, text: q.text, state: q.state });
  }
  const origin = typeof v.origin_artifact_id === "string" ? v.origin_artifact_id : null;
  return { id: v.id, status: v.status, questions, origin_artifact_id: origin };
}

export function parseChatEvent(name: string, data: string): ChatStreamEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  if (name === "token") return typeof json === "string" ? { type: "token", text: json } : null;
  if (!isRecord(json)) return null;
  switch (name) {
    case "status":
      return typeof json.message === "string" ? { type: "status", message: json.message } : null;
    case "chip_cleared":
      return { type: "chip_cleared" };
    case "artifact_changed":
      return typeof json.artifact_id === "string" && typeof json.start === "number" && typeof json.end === "number"
        ? { type: "artifact_changed", artifactId: json.artifact_id, start: json.start, end: json.end }
        : null;
    case "open_artifact":
      return typeof json.artifact_id === "string" ? { type: "open_artifact", artifactId: json.artifact_id } : null;
    case "run_started":
      return typeof json.run_id === "string" ? { type: "run_started", runId: json.run_id } : null;
    case "done": {
      if (
        typeof json.message_id !== "string" ||
        typeof json.content !== "string" ||
        !isAgent(json.agent) ||
        typeof json.label !== "string" ||
        typeof json.pending !== "boolean"
      ) {
        return null;
      }
      return {
        type: "done",
        messageId: json.message_id,
        content: json.content,
        agent: json.agent,
        label: json.label,
        pending: json.pending,
        proposal: parseProposal(json.proposal),
      };
    }
    case "proposal_settled": {
      const proposal = parseProposal(json.proposal);
      return typeof json.message_id === "string" && proposal !== null
        ? { type: "proposal_settled", messageId: json.message_id, proposal }
        : null;
    }
    case "error":
      return typeof json.message === "string" ? { type: "error", message: json.message } : null;
    default:
      return null;
  }
}
