import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatPanel, type ChatPanelProps } from "@/components/chat/ChatPanel";
import type { ChatMessage } from "@/lib/chat/state";
import { makeProposal } from "@/test/proposals";

const GREETING: ChatMessage = { id: "m1", role: "assistant", content: "Hi! Welcome.", agent: "analyst" };
const USER: ChatMessage = { id: "m2", role: "user", content: "What is Scrum?", agent: null };
const ANALYST: ChatMessage = { id: "m3", role: "assistant", content: "The documents say X.", agent: "analyst" };
const GENERAL: ChatMessage = {
  id: "m4",
  role: "assistant",
  content: "General knowledge – not from the customer documents.\n\nScrum is a framework.",
  agent: "analyst",
};

function props(overrides: Partial<ChatPanelProps> = {}): ChatPanelProps {
  return {
    messages: [GREETING],
    streamText: "",
    status: null,
    busy: false,
    pending: false,
    error: null,
    onSend: vi.fn(),
    onNewChat: vi.fn(),
    sessions: [],
    activeSessionId: null,
    onSelectSession: vi.fn(),
    onClearError: vi.fn(),
    onQuickReply: vi.fn(),
    onResolveProposal: vi.fn().mockResolvedValue({ ok: true }),
    showStarters: false,
    documents: [],
    artifacts: [],
    onOpenSource: vi.fn(),
    chip: null,
    onClearChip: vi.fn(),
    ...overrides,
  };
}

describe("ChatPanel", () => {
  it("labels every reply as Analyst, the fixed greeting included", () => {
    render(<ChatPanel {...props({ messages: [GREETING, USER, ANALYST] })} />);
    expect(screen.getAllByText("Analyst")).toHaveLength(2);
    expect(screen.queryByText("Assistant")).not.toBeInTheDocument();
  });

  it("keeps the general-knowledge note as part of the content", () => {
    render(<ChatPanel {...props({ messages: [USER, GENERAL] })} />);
    expect(screen.getByText(/General knowledge – not from the customer documents\./)).toBeInTheDocument();
    expect(screen.getAllByText("Analyst")).toHaveLength(1);
  });

  it("calls onNewChat from the New chat button", () => {
    const p = props();
    render(<ChatPanel {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(p.onNewChat).toHaveBeenCalledTimes(1);
  });

  it("disables the input while busy", () => {
    render(<ChatPanel {...props({ busy: true })} />);
    expect(screen.getByPlaceholderText("Ask the Analyst…")).toBeDisabled();
  });

  it("sends typed text", () => {
    const p = props();
    render(<ChatPanel {...p} />);
    const input = screen.getByPlaceholderText("Ask the Analyst…");
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(p.onSend).toHaveBeenCalledWith("Hello");
  });

  it("shows the error with a dismiss button", () => {
    const p = props({ error: "Something broke" });
    render(<ChatPanel {...p} />);
    expect(screen.getByText("Something broke")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(p.onClearError).toHaveBeenCalledTimes(1);
  });

  it("shows Yes/No only under the last assistant message when pending", () => {
    const p = props({ messages: [GREETING, USER, ANALYST], pending: true });
    render(<ChatPanel {...p} />);
    const yes = screen.getAllByRole("button", { name: "Yes" });
    expect(yes).toHaveLength(1);
    const lastMessage = screen.getByText("The documents say X.");
    const firstMessage = screen.getByText("Hi! Welcome.");
    // Yes follows the last assistant message and precedes nothing of the greeting.
    expect(lastMessage.compareDocumentPosition(yes[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(firstMessage.compareDocumentPosition(yes[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(yes[0]);
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(p.onQuickReply).toHaveBeenNthCalledWith(1, "Yes");
    expect(p.onQuickReply).toHaveBeenNthCalledWith(2, "No");
  });

  it("hides Yes/No when not pending, while busy, or when the last message is the user's", () => {
    const { rerender } = render(<ChatPanel {...props({ messages: [GREETING, ANALYST] })} />);
    expect(screen.queryByRole("button", { name: "Yes" })).not.toBeInTheDocument();
    rerender(<ChatPanel {...props({ messages: [GREETING, ANALYST], pending: true, busy: true })} />);
    expect(screen.queryByRole("button", { name: "Yes" })).not.toBeInTheDocument();
    rerender(<ChatPanel {...props({ messages: [GREETING, USER], pending: true })} />);
    expect(screen.queryByRole("button", { name: "Yes" })).not.toBeInTheDocument();
  });

  it("shows the three starter prompts when showStarters is set", () => {
    const p = props({ showStarters: true });
    render(<ChatPanel {...p} />);
    expect(screen.getByRole("button", { name: "Worum geht es in diesem Projekt?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Welche Artefakte erstellen wir?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Erstelle einen Entwurf der Projektbeschreibung" }));
    expect(p.onSend).toHaveBeenCalledWith("Erstelle einen Entwurf der Projektbeschreibung");
  });

  it("hides the starter prompts otherwise", () => {
    render(<ChatPanel {...props({ showStarters: false })} />);
    expect(screen.queryByRole("button", { name: "Worum geht es in diesem Projekt?" })).not.toBeInTheDocument();
  });

  it("shows the context hint only in a fresh chat", () => {
    const { rerender } = render(<ChatPanel {...props({ showStarters: true })} />);
    expect(screen.getByText(/Im Kontext: Dokumente, freigegebene Artefakte und geöffnete Entwürfe/)).toBeInTheDocument();
    rerender(<ChatPanel {...props({ showStarters: false })} />);
    expect(screen.queryByText(/Im Kontext:/)).not.toBeInTheDocument();
  });

  it("shows streamed text and the status line while busy", () => {
    render(<ChatPanel {...props({ busy: true, streamText: "Partial answer", status: null })} />);
    expect(screen.getByText("Partial answer")).toBeInTheDocument();
    render(<ChatPanel {...props({ busy: true, status: "Searching the documents…" })} />);
    expect(screen.getByText("Searching the documents…")).toBeInTheDocument();
  });

  it("shows the status line together with the streamed text", () => {
    render(<ChatPanel {...props({ busy: true, streamText: "Partial answer", status: "Reading 01…" })} />);
    expect(screen.getByText("Partial answer")).toBeInTheDocument();
    expect(screen.getByText("Reading 01…")).toBeInTheDocument();
  });

  it("shows no status line below the streamed text without a status", () => {
    render(<ChatPanel {...props({ busy: true, streamText: "Partial answer", status: null })} />);
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stream-status")).not.toBeInTheDocument();
  });

  it("shows no status line when nothing is streaming", () => {
    render(<ChatPanel {...props({ busy: false, streamText: "Partial answer", status: "Reading 01…" })} />);
    expect(screen.queryByText("Reading 01…")).not.toBeInTheDocument();
  });

  it("shows the chip and clears it", () => {
    const p = props({ chip: { id: "c1", title: "Unclear scope" } });
    render(<ChatPanel {...p} />);
    expect(screen.getByText(/Unclear scope/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove reference" }));
    expect(p.onClearChip).toHaveBeenCalledTimes(1);
  });

  it("shows the disabled reason as a tooltip on the input when given", () => {
    render(<ChatPanel {...props({ disabledReason: "No chat available" })} />);
    expect(screen.getByPlaceholderText("Ask the Analyst…")).toBeDisabled();
  });

  it("renders the proposal card under its message and hides Yes/No while it is open", () => {
    const card: ChatMessage = { ...ANALYST, proposal: makeProposal() };
    render(<ChatPanel {...props({ messages: [GREETING, USER, card], pending: true })} />);
    expect(screen.getByTestId("proposal-card")).toBeInTheDocument();
    expect(screen.getByText("Wie hoch ist das Budget?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yes" })).not.toBeInTheDocument();
  });

  it("keeps Yes/No for a settled card", () => {
    const card: ChatMessage = { ...ANALYST, proposal: makeProposal({ status: "rejected" }) };
    render(<ChatPanel {...props({ messages: [GREETING, USER, card], pending: true })} />);
    expect(screen.getAllByRole("button", { name: "Yes" })).toHaveLength(1);
  });

  it("passes the message id and selection to onResolveProposal", () => {
    const card: ChatMessage = { ...ANALYST, proposal: makeProposal() };
    const p = props({ messages: [GREETING, USER, card] });
    render(<ChatPanel {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen (2)" }));
    expect(p.onResolveProposal).toHaveBeenCalledWith("m3", "accept", ["q1", "q2"], false);
  });
});
