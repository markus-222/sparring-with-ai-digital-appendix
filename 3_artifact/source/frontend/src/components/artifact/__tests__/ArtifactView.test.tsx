import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { SWRConfig } from "swr";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactView, type ChangeRange } from "@/components/artifact/ArtifactView";
import { useProjectView } from "@/hooks/useProjectView";
import { applyHighlight } from "@/lib/highlight";
import { PROJECT_ID, SESSION_ID, makeArtifact, server } from "@/test/msw-server";
import type { Artifact } from "@/types";

vi.mock("@/lib/highlight", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/highlight")>();
  return { ...original, applyHighlight: vi.fn(() => () => undefined) };
});

const BASE = "http://localhost:8000/api/v1";
/** The dialog's confirm button: the toolbar's [Approve] comes first in the DOM, the dialog's last. */
function dialogApprove(): HTMLElement {
  const buttons = screen.getAllByRole("button", { name: "Approve" });
  const last = buttons[buttons.length - 1];
  if (last === undefined) throw new Error("no Approve button");
  return last;
}

const REVOKE = "This will revoke the approval. Continue?";

interface Harness {
  artifactsRef: { current: Artifact[] };
  changeRef: { current: ((c: { artifactId: string; start: number; end: number }) => Promise<void>) | null };
}

function Page({ openId, harness }: { openId: string; harness: Harness }) {
  const view = useProjectView(PROJECT_ID);
  const { openArtifact, artifactChanged } = view;
  harness.changeRef.current = artifactChanged;
  useEffect(() => {
    openArtifact(openId);
  }, [openArtifact, openId]);
  const artifact = view.artifacts.find((a) => a.id === openId) ?? null;
  if (artifact === null) return <p>loading</p>;
  return (
    <ArtifactView
      artifact={artifact}
      documents={view.documents}
      artifacts={view.artifacts}
      locks={view.locks}
      onRequestReview={() => undefined}
      editing={view.editorOpen}
      saving={view.saving}
      editError={view.editError}
      onStartEdit={view.startEdit}
      onCancelEdit={view.cancelEdit}
      onSaveEdit={view.saveEdit}
      approveBusy={view.approveBusy}
      approveError={view.approveError}
      onApprove={async (force) => (await view.approve(force)).ok}
      onClearActionError={view.clearActionError}
      onDownload={() => void view.downloadArtifact()}
      onDelete={() => void view.deleteArtifact()}
      manageError={view.manageError}
      highlight={view.highlight?.artifactId === artifact.id ? view.highlight : null}
      onHighlightDone={view.clearHighlight}
      onBack={view.showOverview}
      onOpenSource={() => undefined}
      commentsOpen={view.commentsOpen}
      onToggleComments={() => view.setCommentsOpen(!view.commentsOpen)}
    />
  );
}

function mount(artifact: Artifact) {
  const harness: Harness = {
    artifactsRef: { current: [artifact] },
    changeRef: { current: null },
  };
  server.use(
    http.get(`${BASE}/artifacts`, () => HttpResponse.json(harness.artifactsRef.current)),
  );
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Page openId={artifact.id} harness={harness} />
    </SWRConfig>,
  );
  return harness;
}

describe("ArtifactView", () => {
  beforeEach(() => {
    vi.mocked(applyHighlight).mockClear();
  });

  it("opens the comments with the Comments button, which disappears while they are open", async () => {
    mount(makeArtifact("01", { status: "draft", content: "# Text" }));
    const button = await screen.findByRole("button", { name: /^Comments/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Comments/ })).not.toBeInTheDocument());
  });

  it("offers no Comments button for a not-started artifact", async () => {
    mount(makeArtifact("01", { status: "not_started", content: "" }));
    await screen.findByRole("heading", { name: /01/ });
    expect(screen.queryByRole("button", { name: /^Comments/ })).not.toBeInTheDocument();
  });

  it("shows the status badge for draft and approved", async () => {
    mount(makeArtifact("01", { status: "draft", content: "# Text" }));
    expect(await screen.findByText("Draft")).toBeInTheDocument();
  });

  it("shows Approved for an approved artifact", async () => {
    mount(makeArtifact("01", { status: "approved", content: "# Text" }));
    expect(await screen.findByText("Approved")).toBeInTheDocument();
  });

  it("Delete asks first, Cancel keeps the artifact and no request is sent", async () => {
    let deleted = false;
    server.use(
      http.delete(`${BASE}/artifacts/art-01`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    mount(makeArtifact("01", { status: "draft", content: "# Text" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(deleted).toBe(false);
  });

  it("Edit closes an open Delete confirmation, and Delete closes an open revoke confirmation", async () => {
    mount(makeArtifact("01", { status: "approved", content: "# Text" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog", { name: /^Delete this artifact/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByRole("alertdialog", { name: /^Delete this artifact/ })).not.toBeInTheDocument();
    expect(screen.getByRole("alertdialog", { name: REVOKE })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("alertdialog", { name: REVOKE })).not.toBeInTheDocument();
    expect(screen.getByRole("alertdialog", { name: /^Delete this artifact/ })).toBeInTheDocument();
  });

  it("a press outside an open confirmation closes it, a press inside does not", async () => {
    mount(makeArtifact("01", { status: "approved", content: "# Text" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.mouseDown(screen.getByText(/^Delete this artifact/));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("heading", { name: /01/ }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("alertdialog", { name: REVOKE })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("confirming Delete sends the request and refetches the artifacts", async () => {
    let deleted = false;
    server.use(
      http.delete(`${BASE}/artifacts/art-01`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    mount(makeArtifact("01", { status: "draft", content: "# Text" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleted).toBe(true));
  });

  it("shows the backend message when Delete fails", async () => {
    server.use(
      http.delete(`${BASE}/artifacts/art-01`, () =>
        HttpResponse.json(
          { detail: { code: "run_active", message: "A run is active. Please wait until it has finished." } },
          { status: 409 },
        ),
      ),
    );
    mount(makeArtifact("01", { status: "draft", content: "# Text" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A run is active");
  });

  it("Edit on a draft opens the editor directly", async () => {
    mount(makeArtifact("01", { status: "draft", content: "# Draft text" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.queryByText(REVOKE)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("# Draft text");
  });

  it("Edit on an approved artifact asks first and only Continue opens the editor", async () => {
    mount(makeArtifact("01", { status: "approved", content: "# Approved text" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.getByText(REVOKE)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("textbox")).toHaveValue("# Approved text");
    expect(screen.queryByText(REVOKE)).not.toBeInTheDocument();
  });

  it("cancelling the revoke question does not open the editor", async () => {
    mount(makeArtifact("01", { status: "approved", content: "# Approved text" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(REVOKE)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("disables the other toolbar actions while the editor is open, with the reason", async () => {
    mount(makeArtifact("01", { status: "draft", content: "# Draft text" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    for (const name of ["Request review", "Approve", "Edit"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "Please save or cancel your edits first.");
    }
  });

  it("Save sends PUT /artifacts/{id}, closes the editor and shows the new text", async () => {
    const artifact = makeArtifact("01", { status: "draft", content: "# Old" });
    const harness = mount(artifact);
    const bodies: unknown[] = [];
    server.use(
      http.put(`${BASE}/artifacts/${artifact.id}`, async ({ request }) => {
        bodies.push(await request.json());
        harness.artifactsRef.current = [{ ...artifact, content: "# New text" }];
        return HttpResponse.json({ ...harness.artifactsRef.current[0], chat_message: null });
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "# New text" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    expect(bodies).toEqual([{ content: "# New text" }]);
    expect(await screen.findByRole("heading", { name: "New text" })).toBeInTheDocument();
  });

  it("keeps the editor open and shows the message when saving fails", async () => {
    const artifact = makeArtifact("01", { status: "draft", content: "# Old" });
    mount(artifact);
    server.use(
      http.put(`${BASE}/artifacts/${artifact.id}`, () =>
        HttpResponse.json(
          { detail: { code: "run_active", message: "A run is active. Please wait." } },
          { status: 409 },
        ),
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A run is active. Please wait.");
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("Approve opens the dialog for a reviewed draft and approves with force=false", async () => {
    const artifact = makeArtifact("01", { status: "draft", content: "# Text", reviewed_since_change: true });
    const harness = mount(artifact);
    const bodies: unknown[] = [];
    server.use(
      http.post(`${BASE}/artifacts/${artifact.id}/approve`, async ({ request }) => {
        bodies.push(await request.json());
        harness.artifactsRef.current = [{ ...artifact, status: "approved" }];
        return HttpResponse.json({ ...harness.artifactsRef.current[0], chat_message: null });
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(screen.getByText("It becomes the confirmed basis for the next artifacts.")).toBeInTheDocument();
    fireEvent.click(dialogApprove());
    await waitFor(() => expect(screen.getByText("Approved")).toBeInTheDocument());
    expect(bodies).toEqual([{ force: false, session_id: SESSION_ID }]);
    expect(screen.queryByText("It becomes the confirmed basis for the next artifacts.")).not.toBeInTheDocument();
  });

  it("shows the not-reviewed dialog and Approve anyway sends force=true", async () => {
    const artifact = makeArtifact("01", { status: "draft", content: "# Text", reviewed_since_change: false });
    mount(artifact);
    const bodies: unknown[] = [];
    server.use(
      http.post(`${BASE}/artifacts/${artifact.id}/approve`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ...artifact, status: "approved", chat_message: null });
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(screen.getByText("Not reviewed yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve anyway" }));
    await waitFor(() => expect(bodies).toEqual([{ force: true, session_id: SESSION_ID }]));
  });

  it("shows a 409 open_comments from approve as the backend message and keeps the dialog", async () => {
    const artifact = makeArtifact("01", { status: "draft", content: "# Text", reviewed_since_change: true });
    mount(artifact);
    server.use(
      http.post(`${BASE}/artifacts/${artifact.id}/approve`, () =>
        HttpResponse.json(
          { detail: { code: "open_comments", message: "There are 2 open comments." } },
          { status: 409 },
        ),
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    fireEvent.click(dialogApprove());
    expect(await screen.findByRole("alert")).toHaveTextContent("There are 2 open comments.");
    expect(screen.getByText("It becomes the confirmed basis for the next artifacts.")).toBeInTheDocument();
  });

  it("renders marker badges in the reading view", async () => {
    mount(makeArtifact("01", { status: "draft", content: "- ⚠ CONFLICT: Number of users" }));
    const badge = await screen.findByText("CONFLICT");
    expect(badge).toHaveAttribute("data-marker", "conflict");
  });

  it("highlights the changed passage after an AI change, using the refetched content", async () => {
    const artifact = makeArtifact("01", {
      status: "draft",
      content: "## Causes\n- Old cause one\n- Old cause two",
    });
    const harness = mount(artifact);
    await screen.findByText("Old cause one");

    const newContent = "## Causes\n- Shortened cause\n- Old cause two";
    harness.artifactsRef.current = [{ ...artifact, content: newContent }];
    const start = newContent.indexOf("- Shortened cause");
    const end = start + "- Shortened cause".length;
    await act(async () => {
      await harness.changeRef.current?.({ artifactId: artifact.id, start, end });
    });

    await waitFor(() => expect(applyHighlight).toHaveBeenCalledTimes(1));
    const range = vi.mocked(applyHighlight).mock.calls[0][0];
    expect(range).not.toBeNull();
    expect(range?.toString()).toBe("Shortened cause");
    expect(screen.getByText("Shortened cause")).toBeInTheDocument();
  });

  it("falls back to the top of the artifact when the passage cannot be found (F5)", async () => {
    const artifact = makeArtifact("01", { status: "draft", content: "# Title\n\nSome body text" });
    const harness = mount(artifact);
    await screen.findByText("Some body text");
    const scrollTo = vi.mocked(window.HTMLElement.prototype.scrollTo);
    scrollTo.mockClear();
    await act(async () => {
      await harness.changeRef.current?.({ artifactId: artifact.id, start: 500, end: 600 });
    });
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0 }));
    expect(applyHighlight).not.toHaveBeenCalled();
  });

  it("falls back to the top when the changed passage occurs twice (ambiguous)", async () => {
    const content = "- Same line\n- Same line\n- Other";
    const artifact = makeArtifact("01", { status: "draft", content });
    const harness = mount(artifact);
    await screen.findByText("Other");
    const scrollTo = vi.mocked(window.HTMLElement.prototype.scrollTo);
    scrollTo.mockClear();
    await act(async () => {
      await harness.changeRef.current?.({ artifactId: artifact.id, start: 0, end: "- Same line".length });
    });
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0 }));
    expect(applyHighlight).not.toHaveBeenCalled();
  });
});
