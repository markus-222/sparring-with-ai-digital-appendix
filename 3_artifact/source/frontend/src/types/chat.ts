import type { Message } from "@/types";

export type AgentName = "analyst";

export type ProposalState = "open" | "accepted" | "rejected";

export interface ProposedQuestion {
  id: string;
  title: string;
  text: string;
  state: ProposalState;
}

export interface QuestionProposal {
  id: string;
  status: ProposalState;
  questions: ProposedQuestion[];
  origin_artifact_id: string | null;
}

export type ChatStreamEvent =
  | { type: "token"; text: string }
  | { type: "status"; message: string }
  | { type: "chip_cleared" }
  | { type: "artifact_changed"; artifactId: string; start: number; end: number }
  | { type: "open_artifact"; artifactId: string }
  | { type: "run_started"; runId: string }
  | {
      type: "done";
      messageId: string;
      content: string;
      agent: AgentName;
      label: string;
      pending: boolean;
      proposal: QuestionProposal | null;
    }
  | { type: "proposal_settled"; messageId: string; proposal: QuestionProposal }
  | { type: "error"; message: string };

export interface ResolveProposalBody {
  action: "accept" | "reject";
  question_ids: string[];
  revoke: boolean;
  editor_open: boolean;
}

export interface ProposalResolution {
  message_id: string;
  proposal: QuestionProposal;
  reply: Message | null;
  artifact_id: string | null;
  start: number | null;
  end: number | null;
}

export interface ChatRequestBody {
  session_id: string;
  message: string;
  open_artifact_id?: string | null;
  editor_open: boolean;
  comment_id?: string | null;
}
