import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProposalCard } from "@/components/chat/ProposalCard";
import type { ProposalResult } from "@/hooks/useChat";
import { makeProposal } from "@/test/proposals";

function setup(
  result: ProposalResult = { ok: true },
  proposal = makeProposal(),
  disabled = false,
) {
  const onResolve = vi.fn<(a: "accept" | "reject", ids: string[], revoke: boolean) => Promise<ProposalResult>>(
    () => Promise.resolve(result),
  );
  render(<ProposalCard proposal={proposal} disabled={disabled} onResolve={onResolve} />);
  return onResolve;
}

describe("ProposalCard", () => {
  it("preselects all questions and accepts them", async () => {
    const onResolve = setup();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen (2)" }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith("accept", ["q1", "q2"], false));
  });

  it("accepts only the checked questions", async () => {
    const onResolve = setup();
    fireEvent.click(screen.getByLabelText(/Budget/));
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen (1)" }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith("accept", ["q2"], false));
  });

  it("disables accept when nothing is selected", () => {
    setup();
    fireEvent.click(screen.getByLabelText(/Budget/));
    fireEvent.click(screen.getByLabelText(/Termin/));
    expect(screen.getByRole("button", { name: "Übernehmen (0)" })).toBeDisabled();
  });

  it("rejects with an empty selection", async () => {
    const onResolve = setup();
    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith("reject", [], false));
  });

  it("asks before revoking an approval and retries with revoke", async () => {
    const onResolve = setup({ ok: false, code: "needs_revoke", message: "approved" });
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen (2)" }));
    const confirm = await screen.findByRole("button", { name: "Freigabe widerrufen und übernehmen" });
    expect(screen.queryByRole("button", { name: "Verwerfen" })).not.toBeInTheDocument();
    fireEvent.click(confirm);
    await waitFor(() => expect(onResolve).toHaveBeenLastCalledWith("accept", ["q1", "q2"], true));
  });

  it("returns to the choice when the revoke prompt is cancelled", async () => {
    setup({ ok: false, code: "needs_revoke", message: "approved" });
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen (2)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Abbrechen" }));
    expect(screen.getByRole("button", { name: "Übernehmen (2)" })).toBeInTheDocument();
  });

  it("shows a hint while a run is active", async () => {
    setup({ ok: false, code: "run_active", message: "run" });
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen (2)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ein Schritt läuft gerade");
  });

  it("shows the server message for other errors", async () => {
    setup({ ok: false, code: "editor_open", message: "Close the editor first." });
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen (2)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Close the editor first.");
  });

  it("disables the buttons while the chat is busy", () => {
    setup({ ok: true }, makeProposal(), true);
    expect(screen.getByRole("button", { name: "Übernehmen (2)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Verwerfen" })).toBeDisabled();
  });

  it("shows an accepted card without buttons", () => {
    const proposal = makeProposal({
      status: "accepted",
      questions: [
        { id: "q1", title: "Budget", text: "Wie hoch ist das Budget?", state: "accepted" },
        { id: "q2", title: "Termin", text: "Bis wann?", state: "rejected" },
      ],
    });
    setup({ ok: true }, proposal);
    expect(screen.getByText("1 Frage zu 03 übernommen")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows a rejected card as dismissed", () => {
    setup({ ok: true }, makeProposal({ status: "rejected" }));
    expect(screen.getByText("Verworfen")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
