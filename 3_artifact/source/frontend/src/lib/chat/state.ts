import type { AgentName, ChatStreamEvent, QuestionProposal } from "@/types/chat";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  agent: AgentName | null;
  proposal?: QuestionProposal | null;
  /** "note": a local, non-markdown status message (e.g. "draft finished"); renders with an icon, not the avatar. */
  kind?: "note";
}
export interface ChatState {
  messages: ChatMessage[];
  streamText: string;
  status: string | null;
  busy: boolean;
  pending: boolean;
  error: string | null;
}
export type ChatAction =
  | { type: "seed"; messages: ChatMessage[] }
  | { type: "sent"; id: string; content: string }
  | { type: "event"; id: string; event: ChatStreamEvent }
  | { type: "appended"; message: ChatMessage }
  | { type: "proposal_settled"; messageId: string; proposal: QuestionProposal; reply: ChatMessage | null }
  | { type: "closed" }
  | { type: "aborted"; retract?: boolean }
  | { type: "failed"; message: string }
  | { type: "clear_error" };

export const initialChatState: ChatState = {
  messages: [], streamText: "", status: null, busy: false, pending: false, error: null,
};

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "seed":
      return { ...initialChatState, messages: action.messages };
    case "sent":
      return {
        ...state, busy: true, pending: false, error: null, streamText: "", status: null,
        messages: [...state.messages, { id: action.id, role: "user", content: action.content, agent: null }],
      };
    case "event":
      return applyEvent(state, action.event);
    case "appended":
      return state.messages.some((m) => m.id === action.message.id)
        ? state
        : { ...state, messages: [...state.messages, action.message] };
    case "proposal_settled":
      return settleProposal(state, action.messageId, action.proposal, action.reply);
    case "closed":
      return state.busy
        ? { ...state, busy: false, streamText: "", status: null, error: "The connection was interrupted. Please try again." }
        : state;
    case "aborted": {
      const base = { ...state, busy: false, streamText: "", status: null };
      const last = state.messages[state.messages.length - 1];
      return action.retract && last?.role === "user" ? { ...base, messages: state.messages.slice(0, -1) } : base;
    }
    case "failed":
      return { ...state, busy: false, streamText: "", status: null, error: action.message };
    case "clear_error":
      return { ...state, error: null };
  }
}

function applyEvent(state: ChatState, event: ChatStreamEvent): ChatState {
  switch (event.type) {
    case "token":
      return { ...state, streamText: state.streamText + event.text, status: null };
    case "status":
      return { ...state, status: event.message };
    case "done":
      return {
        ...state, busy: false, streamText: "", status: null, pending: event.pending,
        messages: [
          ...state.messages,
          { id: event.messageId, role: "assistant", content: event.content, agent: event.agent, proposal: event.proposal },
        ],
      };
    case "proposal_settled":
      return settleProposal(state, event.messageId, event.proposal, null);
    case "error":
      return { ...state, busy: false, streamText: "", status: null, error: event.message };
    default:
      return state; // chip_cleared, artifact_changed, open_artifact, run_started are side effects of the hook
  }
}

function settleProposal(
  state: ChatState,
  messageId: string,
  proposal: QuestionProposal,
  reply: ChatMessage | null,
): ChatState {
  const messages = state.messages.map((m) => (m.id === messageId ? { ...m, proposal } : m));
  return { ...state, pending: false, messages: reply ? [...messages, reply] : messages };
}
