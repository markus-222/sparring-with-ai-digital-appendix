import { describe, expect, it } from "vitest";
import {
  chatReducer,
  initialChatState,
  type ChatAction,
  type ChatMessage,
  type ChatState,
} from "@/lib/chat/state";
import { makeProposal } from "@/test/proposals";

function run(actions: ChatAction[], start: ChatState = initialChatState): ChatState {
  return actions.reduce(chatReducer, start);
}

describe("chatReducer", () => {
  it("seed replaces the state with the given messages", () => {
    const state = run([
      { type: "seed", messages: [{ id: "m1", role: "assistant", content: "Hi", agent: "analyst" }] },
    ]);
    expect(state.messages).toHaveLength(1);
    expect(state.busy).toBe(false);
  });

  it("sent appends the user message and sets busy", () => {
    const state = run([{ type: "sent", id: "u1", content: "Hello" }]);
    expect(state.busy).toBe(true);
    expect(state.messages).toEqual([{ id: "u1", role: "user", content: "Hello", agent: null }]);
  });

  it("accumulates tokens and clears status when the next token arrives", () => {
    const state = run([
      { type: "sent", id: "u1", content: "Hello" },
      { type: "event", id: "e", event: { type: "status", message: "Reading" } },
    ]);
    expect(state.status).toBe("Reading");
    const after = run(
      [
        { type: "event", id: "e", event: { type: "token", text: "Hel" } },
        { type: "event", id: "e", event: { type: "token", text: "lo" } },
      ],
      state,
    );
    expect(after.streamText).toBe("Hello");
    expect(after.status).toBeNull();
  });

  it("done appends exactly one assistant message with the done content", () => {
    const state = run([
      { type: "sent", id: "u1", content: "Q" },
      { type: "event", id: "e1", event: { type: "token", text: "streamed" } },
      {
        type: "event",
        id: "a1",
        event: { type: "done", messageId: "srv-1", content: "final", agent: "analyst", label: "Analyst", pending: true, proposal: null },
      },
    ]);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]).toEqual({ id: "srv-1", role: "assistant", content: "final", agent: "analyst", proposal: null });
    expect(state.streamText).toBe("");
    expect(state.pending).toBe(true);
    expect(state.busy).toBe(false);
  });

  it("appended adds a message and ignores one with a known id", () => {
    const message: ChatMessage = { id: "srv-9", role: "assistant", content: "Freigegeben.", agent: "analyst" };
    const once = run([{ type: "appended", message }]);
    expect(once.messages).toEqual([message]);
    const twice = run([{ type: "appended", message: { ...message, content: "other" } }], once);
    expect(twice).toBe(once);
  });

  it("appended does not touch a running turn", () => {
    const message: ChatMessage = { id: "srv-9", role: "assistant", content: "Freigegeben.", agent: "analyst" };
    const state = run([
      { type: "sent", id: "u1", content: "Q" },
      { type: "event", id: "t", event: { type: "token", text: "partial" } },
      { type: "appended", message },
    ]);
    expect(state.busy).toBe(true);
    expect(state.streamText).toBe("partial");
    expect(state.messages.map((m) => m.id)).toEqual(["u1", "srv-9"]);
  });

  it("error clears partial text and sets error without adding a message", () => {
    const state = run([
      { type: "sent", id: "u1", content: "Q" },
      { type: "event", id: "e", event: { type: "token", text: "partial" } },
      { type: "event", id: "e", event: { type: "error", message: "boom" } },
    ]);
    expect(state.error).toBe("boom");
    expect(state.streamText).toBe("");
    expect(state.busy).toBe(false);
    expect(state.messages).toHaveLength(1);
  });

  it("closed while busy sets the interruption error", () => {
    const state = run([
      { type: "sent", id: "u1", content: "Q" },
      { type: "event", id: "e", event: { type: "token", text: "partial" } },
      { type: "closed" },
    ]);
    expect(state.busy).toBe(false);
    expect(state.streamText).toBe("");
    expect(state.error).toBe("The connection was interrupted. Please try again.");
  });

  it("closed when idle changes nothing", () => {
    const idle = run([{ type: "sent", id: "u1", content: "Q" }, { type: "failed", message: "x" }]);
    expect(chatReducer(idle, { type: "closed" })).toBe(idle);
  });

  it("failed sets the error and ends busy", () => {
    const state = run([
      { type: "sent", id: "u1", content: "Q" },
      { type: "failed", message: "Network down" },
    ]);
    expect(state.busy).toBe(false);
    expect(state.error).toBe("Network down");
  });

  it("clear_error removes the error", () => {
    const state = run([{ type: "failed", message: "x" }, { type: "clear_error" }]);
    expect(state.error).toBeNull();
  });

  it("done stores the proposal on the assistant message", () => {
    const proposal = makeProposal();
    const state = run([
      { type: "sent", id: "u1", content: "Q" },
      {
        type: "event",
        id: "a1",
        event: { type: "done", messageId: "srv-9", content: "Offer", agent: "analyst", label: "Analyst", pending: true, proposal },
      },
    ]);
    expect(state.messages[1]).toMatchObject({ id: "srv-9", proposal });
  });

  it("proposal_settled event updates the card and clears pending", () => {
    const open = makeProposal();
    const settled = makeProposal({ status: "rejected" });
    const start = run([
      { type: "sent", id: "u1", content: "Q" },
      {
        type: "event",
        id: "a1",
        event: { type: "done", messageId: "srv-9", content: "Offer", agent: "analyst", label: "Analyst", pending: true, proposal: open },
      },
    ]);
    const state = run(
      [{ type: "event", id: "x", event: { type: "proposal_settled", messageId: "srv-9", proposal: settled } }],
      start,
    );
    expect(state.pending).toBe(false);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]?.proposal).toEqual(settled);
  });

  it("proposal_settled action appends the reply and leaves other messages alone", () => {
    const settled = makeProposal({ status: "accepted" });
    const start = run([
      { type: "seed", messages: [
        { id: "m1", role: "assistant", content: "Offer", agent: "analyst", proposal: makeProposal() },
        { id: "m2", role: "assistant", content: "Other", agent: "analyst" },
      ] },
    ]);
    const state = run(
      [{
        type: "proposal_settled",
        messageId: "m1",
        proposal: settled,
        reply: { id: "r1", role: "assistant", content: "Done", agent: "analyst" },
      }],
      start,
    );
    expect(state.messages.map((m) => m.id)).toEqual(["m1", "m2", "r1"]);
    expect(state.messages[0]?.proposal).toEqual(settled);
    expect(state.messages[1]?.proposal).toBeUndefined();
  });

  it("a second sent resets pending", () => {
    const state = run([
      { type: "sent", id: "u1", content: "Q" },
      {
        type: "event",
        id: "a1",
        event: { type: "done", messageId: "srv-1", content: "Create it?", agent: "analyst", label: "Analyst", pending: true, proposal: null },
      },
      { type: "sent", id: "u2", content: "Yes" },
    ]);
    expect(state.pending).toBe(false);
    expect(state.busy).toBe(true);
  });

  it("side-effect events return the same state object", () => {
    const base = run([{ type: "sent", id: "u1", content: "Q" }]);
    const events = [
      { type: "chip_cleared" },
      { type: "artifact_changed", artifactId: "a", start: 0, end: 1 },
      { type: "open_artifact", artifactId: "a" },
      { type: "run_started", runId: "r" },
    ] as const;
    for (const event of events) {
      expect(chatReducer(base, { type: "event", id: "e", event })).toBe(base);
    }
  });

  it("aborted ends busy and drops partial text without an error", () => {
    const state = run([
      { type: "sent", id: "u1", content: "Q" },
      { type: "event", id: "e1", event: { type: "token", text: "Par" } },
      { type: "aborted" },
    ]);
    expect(state.busy).toBe(false);
    expect(state.streamText).toBe("");
    expect(state.error).toBeNull();
    expect(state.messages).toHaveLength(1);
  });

  it("aborted with retract removes the unanswered user message", () => {
    const state = run([
      { type: "sent", id: "u1", content: "Q" },
      { type: "event", id: "e1", event: { type: "token", text: "Par" } },
      { type: "aborted", retract: true },
    ]);
    expect(state.busy).toBe(false);
    expect(state.messages).toHaveLength(0);
  });
});
