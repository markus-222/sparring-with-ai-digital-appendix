import { describe, expect, it } from "vitest";
import { parseChatEvent } from "@/lib/chat/events";
import { makeProposal } from "@/test/proposals";

const PROPOSAL = makeProposal();

describe("parseChatEvent", () => {
  it("parses a token (JSON-encoded string)", () => {
    expect(parseChatEvent("token", '"Hello"')).toEqual({ type: "token", text: "Hello" });
  });

  it("decodes escaped newlines in a token", () => {
    expect(parseChatEvent("token", '"a\\nb"')).toEqual({ type: "token", text: "a\nb" });
  });

  it("parses status", () => {
    expect(parseChatEvent("status", '{"message":"Reading"}')).toEqual({
      type: "status",
      message: "Reading",
    });
  });

  it("parses chip_cleared", () => {
    expect(parseChatEvent("chip_cleared", "{}")).toEqual({ type: "chip_cleared" });
  });

  it("parses artifact_changed into camelCase", () => {
    expect(
      parseChatEvent("artifact_changed", '{"artifact_id":"a1","start":3,"end":9}'),
    ).toEqual({ type: "artifact_changed", artifactId: "a1", start: 3, end: 9 });
  });

  it("parses open_artifact", () => {
    expect(parseChatEvent("open_artifact", '{"artifact_id":"a1"}')).toEqual({
      type: "open_artifact",
      artifactId: "a1",
    });
  });

  it("parses run_started", () => {
    expect(parseChatEvent("run_started", '{"run_id":"r1"}')).toEqual({
      type: "run_started",
      runId: "r1",
    });
  });

  it("parses done", () => {
    expect(
      parseChatEvent(
        "done",
        '{"message_id":"m1","content":"Answer","agent":"analyst","label":"Analyst","pending":true}',
      ),
    ).toEqual({
      type: "done",
      messageId: "m1",
      content: "Answer",
      agent: "analyst",
      label: "Analyst",
      pending: true,
      proposal: null,
    });
  });

  it("parses done with a proposal", () => {
    const event = parseChatEvent(
      "done",
      JSON.stringify({ message_id: "m1", content: "A", agent: "analyst", label: "Analyst", pending: true, proposal: PROPOSAL }),
    );
    expect(event).toMatchObject({ type: "done", proposal: PROPOSAL });
  });

  it("drops a malformed proposal on done but keeps the event", () => {
    const event = parseChatEvent(
      "done",
      JSON.stringify({ message_id: "m1", content: "A", agent: "analyst", label: "A", pending: false, proposal: { id: 1 } }),
    );
    expect(event).toMatchObject({ type: "done", proposal: null });
  });

  it("parses proposal_settled", () => {
    expect(
      parseChatEvent("proposal_settled", JSON.stringify({ message_id: "m1", proposal: PROPOSAL })),
    ).toEqual({ type: "proposal_settled", messageId: "m1", proposal: PROPOSAL });
  });

  it("returns null for proposal_settled without a valid proposal", () => {
    expect(parseChatEvent("proposal_settled", '{"message_id":"m1"}')).toBeNull();
    expect(parseChatEvent("proposal_settled", JSON.stringify({ proposal: PROPOSAL }))).toBeNull();
  });

  it("parses error", () => {
    expect(parseChatEvent("error", '{"message":"boom"}')).toEqual({
      type: "error",
      message: "boom",
    });
  });

  it("returns null for an unknown event", () => {
    expect(parseChatEvent("mystery", "{}")).toBeNull();
    // The backend no longer sends `message`.
    expect(parseChatEvent("message", '{"content":"Hi","agent":"assistant","label":"Assistant"}')).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseChatEvent("status", "{not json")).toBeNull();
  });

  it("returns null for a missing field", () => {
    expect(parseChatEvent("artifact_changed", '{"artifact_id":"a1","start":1}')).toBeNull();
    expect(parseChatEvent("done", '{"message_id":"m1","content":"x","agent":"analyst","label":"A"}')).toBeNull();
    expect(parseChatEvent("done", '{"content":"x","agent":"analyst","label":"A","pending":true}')).toBeNull();
  });

  it("returns null for wrong types", () => {
    expect(parseChatEvent("token", "42")).toBeNull();
    expect(parseChatEvent("status", '{"message":5}')).toBeNull();
    expect(parseChatEvent("artifact_changed", '{"artifact_id":"a","start":"1","end":2}')).toBeNull();
    expect(
      parseChatEvent("done", '{"message_id":"m1","content":"x","agent":"analyst","label":"A","pending":"yes"}'),
    ).toBeNull();
  });

  it("returns null when an object event carries a non-object payload", () => {
    expect(parseChatEvent("status", '"text"')).toBeNull();
    expect(parseChatEvent("status", "[1]")).toBeNull();
    expect(parseChatEvent("chip_cleared", "null")).toBeNull();
  });
});
