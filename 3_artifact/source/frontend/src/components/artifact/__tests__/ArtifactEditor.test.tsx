import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArtifactEditor, type ArtifactEditorProps } from "@/components/artifact/ArtifactEditor";

function props(overrides: Partial<ArtifactEditorProps> = {}): ArtifactEditorProps {
  return {
    initial: "# Title\n\n- ⚠ CONFLICT: users",
    onSave: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
    saving: false,
    error: null,
    ...overrides,
  };
}

describe("ArtifactEditor", () => {
  it("shows the initial Markdown as plain text, markers included", () => {
    render(<ArtifactEditor {...props()} />);
    const field = screen.getByRole("textbox");
    expect(field).toHaveValue("# Title\n\n- ⚠ CONFLICT: users");
  });

  it("Save calls onSave with the edited text", () => {
    const p = props();
    render(<ArtifactEditor {...p} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "# New text" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(p.onSave).toHaveBeenCalledTimes(1);
    expect(p.onSave).toHaveBeenCalledWith("# New text");
  });

  it("Cancel calls onCancel and does not save", () => {
    const p = props();
    render(<ArtifactEditor {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    expect(p.onSave).not.toHaveBeenCalled();
  });

  it("disables Save while saving", () => {
    const p = props({ saving: true });
    render(<ArtifactEditor {...p} />);
    const save = screen.getByRole("button", { name: /Save/ });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(p.onSave).not.toHaveBeenCalled();
  });

  it("shows an error message", () => {
    render(<ArtifactEditor {...props({ error: "A run is active." })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("A run is active.");
  });
});
