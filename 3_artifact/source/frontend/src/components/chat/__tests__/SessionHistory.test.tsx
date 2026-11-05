import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionHistory } from "@/components/chat/SessionHistory";
import type { Session } from "@/types";

function session(id: string, createdAt: string, title: string | null = null): Session {
  return { id, project_id: "p1", title, created_at: createdAt, updated_at: createdAt };
}

const NEWEST = session("s3", "2026-06-03T10:00:00Z");
const MIDDLE = session("s2", "2026-06-02T10:00:00Z", "Scope questions");
const OLDEST = session("s1", "2026-06-01T10:00:00Z");

describe("SessionHistory", () => {
  it("renders nothing with fewer than two sessions", () => {
    const { container } = render(<SessionHistory sessions={[NEWEST]} activeSessionId="s3" onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the sessions and selects an older one", () => {
    const onSelect = vi.fn();
    render(<SessionHistory sessions={[NEWEST, MIDDLE, OLDEST]} activeSessionId="s3" onSelect={onSelect} />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveTextContent("(latest)");

    fireEvent.click(screen.getByRole("button", { name: /Scope questions/ }));
    expect(onSelect).toHaveBeenCalledWith("s2");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("does not select the already active session", () => {
    const onSelect = vi.fn();
    render(<SessionHistory sessions={[NEWEST, OLDEST]} activeSessionId="s3" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(screen.getAllByRole("option")[0].querySelector("button") as HTMLButtonElement);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    render(<SessionHistory sessions={[NEWEST, OLDEST]} activeSessionId="s3" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
