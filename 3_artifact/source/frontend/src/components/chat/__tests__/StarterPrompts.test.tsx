import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StarterPrompts } from "@/components/chat/StarterPrompts";
import { ARTIFACTS, makeArtifact } from "@/test/msw-server";

describe("StarterPrompts", () => {
  it("shows the three initial prompts for a fresh project", () => {
    render(<StarterPrompts artifacts={ARTIFACTS} onSend={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Worum geht es in diesem Projekt?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Welche Artefakte erstellen wir?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erstelle einen Entwurf der Projektbeschreibung" })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("follows the artifact state", () => {
    const artifacts = [
      makeArtifact("01", { status: "approved" }),
      makeArtifact("02"),
      makeArtifact("03"),
    ];
    render(<StarterPrompts artifacts={artifacts} onSend={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Erstelle einen Entwurf der Stakeholder-Analyse" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Erstelle einen Entwurf der Projektbeschreibung" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("sends the exact prompt text immediately on click", () => {
    const onSend = vi.fn();
    render(<StarterPrompts artifacts={ARTIFACTS} onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "Welche Artefakte erstellen wir?" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("Welche Artefakte erstellen wir?");
  });

  it("disables the prompts when disabled", () => {
    const onSend = vi.fn();
    render(<StarterPrompts artifacts={ARTIFACTS} onSend={onSend} disabled />);
    const button = screen.getByRole("button", { name: "Worum geht es in diesem Projekt?" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onSend).not.toHaveBeenCalled();
  });
});
