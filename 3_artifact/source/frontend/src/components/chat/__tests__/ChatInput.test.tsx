import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ChatInput } from "../ChatInput";

describe("ChatInput", () => {
  it("calls onSend with only the text, no agent id", () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/ask the analyst/i);
    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("Hello");
  });

  it("does not show an Agents section in the @-mention dropdown", () => {
    render(<ChatInput onSend={vi.fn()} documents={[{ id: "d1", filename: "spec.pdf" } as never]} />);
    const textarea = screen.getByPlaceholderText(/ask the analyst/i);
    fireEvent.change(textarea, { target: { value: "@" } });
    expect(screen.queryByText(/agents/i)).not.toBeInTheDocument();
  });

  it("shows a Stop button instead of Send while busy, and Stop calls onStop", () => {
    const onStop = vi.fn();
    render(<ChatInput onSend={vi.fn()} busy disabled onStop={onStop} />);
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("stops on Escape while busy", () => {
    const onStop = vi.fn();
    render(<ChatInput onSend={vi.fn()} busy disabled onStop={onStop} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape when not busy, inside a dialog, or inside a text field", () => {
    const onStop = vi.fn();
    const { rerender } = render(<ChatInput onSend={vi.fn()} onStop={onStop} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onStop).not.toHaveBeenCalled();

    rerender(
      <>
        <div role="dialog">
          <button type="button">inside</button>
        </div>
        <ChatInput onSend={vi.fn()} busy disabled onStop={onStop} />
      </>,
    );
    fireEvent.keyDown(screen.getByText("inside"), { key: "Escape" });
    fireEvent.keyDown(screen.getByPlaceholderText(/ask the analyst/i), { key: "Escape" });
    expect(onStop).not.toHaveBeenCalled();
  });

  it("stops listening for Escape once the reply is finished", () => {
    const onStop = vi.fn();
    const { rerender } = render(<ChatInput onSend={vi.fn()} busy disabled onStop={onStop} />);
    rerender(<ChatInput onSend={vi.fn()} onStop={onStop} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onStop).not.toHaveBeenCalled();
  });

  it("refills and focuses the input when text is restored, again for a new nonce", () => {
    const { rerender } = render(<ChatInput onSend={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/ask the analyst/i);
    rerender(<ChatInput onSend={vi.fn()} restored={{ text: "Back again", nonce: 1 }} />);
    expect(textarea).toHaveValue("Back again");
    expect(textarea).toHaveFocus();
    fireEvent.change(textarea, { target: { value: "" } });
    rerender(<ChatInput onSend={vi.fn()} restored={{ text: "Back again", nonce: 2 }} />);
    expect(textarea).toHaveValue("Back again");
  });
});
