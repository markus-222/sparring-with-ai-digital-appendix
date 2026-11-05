import type { Page } from "@playwright/test";
import {
  DRAFT_CONTENT,
  expandComment,
  expect,
  makeComment,
  makeMessage,
  makeRun,
  openArtifactFromOverview,
  openComments,
  test,
  GREETING,
} from "./fixtures";

const RUN_ACTIVE_REASON = "A run is active. Please wait until it has finished.";

test.describe("Artifact view – not started", () => {
  test("a not-started artifact is greyed out in the overview and cannot be opened", async ({ mockPage: page }) => {
    await page.goto("/projects/proj-1");

    const row = page.getByTestId("artifact-row").filter({ hasText: "01 Problem- and Scope-Definition" });
    await expect(row).toBeDisabled();
    await row.click({ force: true });

    await expect(page.getByRole("heading", { name: "01 Problem- and Scope-Definition" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create draft", exact: true })).toHaveCount(0);
  });
});

test.describe("Artifact view – draft with comments", () => {
  test.beforeEach(({ mock }) => {
    mock.setArtifact("01", { status: "draft", reviewed_since_change: true, content: DRAFT_CONTENT });
    mock.comments = [
      makeComment({ id: "com-explorer", number: 1, role: "explorer", hypothesis: true, title: "Maybe a second site" }),
      makeComment({ id: "com-reviewer-2", number: 2, role: "reviewer", title: "Scope is vague" }),
      makeComment({ id: "com-reviewer-1", number: 1, role: "reviewer", title: "DPO missing" }),
    ];
  });

  test("shows [Request review] and [Approve] and the comments grouped Reviewer then Explorer with the Hypothesis tag", async ({
    mockPage: page,
  }) => {
    await page.goto("/projects/proj-1");
    await openArtifactFromOverview(page, "01");

    await expect(page.getByRole("heading", { name: "01 Problem- and Scope-Definition" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Request review", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
    // The comments are an overlay: hidden until opened, closable again.
    await expect(page.getByText("COMMENTS (3 open)")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Comments (3)" })).toBeVisible();
    await openComments(page);
    await expect(page.getByText("COMMENTS (3 open)")).toBeVisible();

    const cards = page.getByTestId("comment-card");
    await expect(cards).toHaveCount(3);
    // Reviewer first (by number), then Explorer.
    await expect(cards.nth(0)).toContainText("Reviewer");
    await expect(cards.nth(0)).toContainText("DPO missing");
    await expect(cards.nth(1)).toContainText("Reviewer");
    await expect(cards.nth(1)).toContainText("Scope is vague");
    await expect(cards.nth(2)).toContainText("Explorer");
    await expect(cards.nth(2)).toContainText("Maybe a second site");
    // Only the Explorer comment is a hypothesis.
    await expect(cards.nth(2)).toContainText("Hypothesis");
    await expect(cards.nth(0)).not.toContainText("Hypothesis");
    await expect(page.getByText("Hypothesis", { exact: true })).toHaveCount(1);

    // Open comments block review and approval.
    await expect(page.getByRole("button", { name: "Request review", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();

    await page.getByRole("button", { name: "Close comments" }).click();
    await expect(page.getByText("COMMENTS (3 open)")).toHaveCount(0);
  });

  test("Accept applies the change and moves the comment to Resolved (1)", async ({ mock, mockPage: page }) => {
    await page.goto("/projects/proj-1");
    await openArtifactFromOverview(page, "01");
    await openComments(page);

    const first = await expandComment(page, "DPO missing");
    await first.getByRole("button", { name: "Accept", exact: true }).click();

    await expect(page.getByText("COMMENTS (2 open)")).toBeVisible();
    await expect(page.getByTestId("comment-card")).toHaveCount(2);
    const resolved = page.getByRole("button", { name: /Resolved \(1\)/ });
    await expect(resolved).toBeVisible();
    expect(mock.commentActions).toEqual([{ id: "com-reviewer-1", action: "accept" }]);

    await resolved.click();
    await expect(page.getByTestId("comment-card")).toHaveCount(3);
    await expect(page.getByTestId("comment-card").filter({ hasText: "DPO missing" })).toContainText("Applied");
    // The text change reached the artifact.
    await expect(page.getByRole("heading", { name: "Data Protection Officer", exact: true })).toBeVisible();
  });

  test("Reject moves the comment to Resolved", async ({ mock, mockPage: page }) => {
    await page.goto("/projects/proj-1");
    await openArtifactFromOverview(page, "01");
    await openComments(page);

    const card = await expandComment(page, "Scope is vague");
    await card.getByRole("button", { name: "Reject", exact: true }).click();

    await expect(page.getByRole("button", { name: /Resolved \(1\)/ })).toBeVisible();
    expect(mock.commentActions).toEqual([{ id: "com-reviewer-2", action: "reject" }]);
  });

  test("Ask sets the chip and the next chat request carries the comment id", async ({ mock, mockPage: page }) => {
    await page.goto("/projects/proj-1");
    await openArtifactFromOverview(page, "01");
    await openComments(page);

    const card = await expandComment(page, "DPO missing");
    await card.getByRole("button", { name: "Ask", exact: true }).click();

    await expect(page.getByText('Re: "DPO missing"', { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove reference" })).toBeVisible();

    const input = page.getByPlaceholder(/ask the analyst/i);
    await input.fill("Why is a DPO needed?");
    await input.press("Enter");

    await expect(page.getByText("Here is a response")).toBeVisible();
    expect(mock.chatRequests).toHaveLength(1);
    expect(mock.chatRequests[0]).toMatchObject({
      message: "Why is a DPO needed?",
      comment_id: "com-reviewer-1",
      open_artifact_id: "art-01",
      editor_open: false,
    });
    // The user message carries the chip prefix as persisted by the backend; the chip stays.
    await expect(page.getByText(/📎 re: DPO missing/)).toBeVisible();
    await expect(page.getByText('Re: "DPO missing"', { exact: true })).toBeVisible();
  });

  test("the chip can be removed, then the next chat request carries no comment id", async ({
    mock,
    mockPage: page,
  }) => {
    await page.goto("/projects/proj-1");
    await openArtifactFromOverview(page, "01");
    await openComments(page);

    const card = await expandComment(page, "DPO missing");
    await card.getByRole("button", { name: "Ask", exact: true }).click();
    await page.getByRole("button", { name: "Remove reference" }).click();
    await expect(page.getByText('Re: "DPO missing"', { exact: true })).toHaveCount(0);

    const input = page.getByPlaceholder(/ask the analyst/i);
    await input.fill("A general question");
    await input.press("Enter");

    await expect(page.getByText("Here is a response")).toBeVisible();
    expect(mock.chatRequests[0].comment_id).toBeNull();
  });

  test("during an active run the toolbar and comment buttons are disabled with tooltips", async ({
    mock,
    mockPage: page,
  }) => {
    // A draft run: its progress shows in the chat, so the artifact panel stays reachable. (A review
    // run covers the panel with a blocking overlay instead.)
    mock.runs = [makeRun({ id: "run-active", type: "draft", slot: "02", step: "writing" })];
    await page.goto("/projects/proj-1");
    // The run is resumed after load: progress is visible and nothing can be changed.
    await expect(page.getByText("Analyst is writing the draft …")).toBeVisible();
    await openArtifactFromOverview(page, "01");
    await openComments(page);

    for (const name of ["Request review", "Approve", "Edit"]) {
      const button = page.getByRole("button", { name, exact: true }).first();
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute("title", RUN_ACTIVE_REASON);
    }

    const card = await expandComment(page, "DPO missing");
    for (const name of ["Accept", "Edit", "Reject", "Ask"]) {
      const button = card.getByRole("button", { name, exact: true });
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute("title", RUN_ACTIVE_REASON);
    }
  });
});

/**
 * A draft long enough that the second passage lies below the fold of the artifact panel, with one
 * unique block per comment. The finds are whole blocks of this content, so each resolves exactly
 * once in the Tiptap view (the default `find` of `makeComment` would give every comment the same
 * passage).
 */
const TOP_PASSAGE = "Manual light control wastes energy in the smart home.";
const BOTTOM_PASSAGE = "The retention period is undefined.";
const LONG_CONTENT = [
  "## Problem",
  TOP_PASSAGE,
  ...Array.from({ length: 60 }, (_, i) => `Background note ${i + 1}: the pilot covers a single site only.`),
  "## Open points",
  BOTTOM_PASSAGE,
].join("\n\n");

test.describe("Artifact view – comment passages", () => {
  test.beforeEach(({ mock }) => {
    mock.setArtifact("01", { status: "draft", reviewed_since_change: true, content: LONG_CONTENT });
    mock.comments = [
      makeComment({
        id: "com-top",
        number: 1,
        title: "Scope is vague",
        suggestion: { kind: "text_change", find: TOP_PASSAGE, replace: `${TOP_PASSAGE} Quantify it.` },
      }),
      makeComment({
        id: "com-bottom",
        number: 2,
        title: "Retention open",
        suggestion: { kind: "text_change", find: BOTTOM_PASSAGE, replace: `${BOTTOM_PASSAGE} Decide it.` },
      }),
    ];
  });

  const highlight = (page: Page, id: string) => page.locator(`.annotation[data-comment-id="${id}"]`).first();

  test("a click on a highlight in the text opens the comments and expands and marks the matching card", async ({
    mockPage: page,
  }) => {
    await page.goto("/projects/proj-1");
    await openArtifactFromOverview(page, "01");
    // The Tiptap view loads through a dynamic import; the highlights appear once comments and editor exist.
    await expect(highlight(page, "com-bottom")).toBeVisible();
    await expect(page.getByText("COMMENTS (2 open)")).toHaveCount(0);

    await highlight(page, "com-bottom").click();

    await expect(page.getByText("COMMENTS (2 open)")).toBeVisible();
    const card = page.locator('[data-comment-card-id="com-bottom"]');
    await expect(card).toHaveAttribute("data-active", "true");
    await expect(card.getByRole("button", { name: "Collapse comment" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Accept", exact: true })).toBeVisible();
    // Only the clicked comment is selected and expanded.
    const other = page.locator('[data-comment-card-id="com-top"]');
    await expect(other).toHaveAttribute("data-active", "false");
    await expect(other.getByRole("button", { name: "Expand comment" })).toBeVisible();
  });

  test("a click on a card header scrolls the text to the comment's passage", async ({ mockPage: page }) => {
    await page.goto("/projects/proj-1");
    await openArtifactFromOverview(page, "01");
    await openComments(page);
    await expect(highlight(page, "com-top")).toBeInViewport();
    await expect(highlight(page, "com-bottom")).not.toBeInViewport();

    await page
      .getByTestId("comment-card")
      .filter({ hasText: "Retention open" })
      .getByTestId("comment-card-header")
      .click();

    await expect(highlight(page, "com-bottom")).toBeInViewport();
    await expect(highlight(page, "com-top")).not.toBeInViewport();
    await expect(page.locator('[data-comment-card-id="com-bottom"]')).toHaveAttribute("data-active", "true");

    await page
      .getByTestId("comment-card")
      .filter({ hasText: "Scope is vague" })
      .getByTestId("comment-card-header")
      .click();

    await expect(highlight(page, "com-top")).toBeInViewport();
  });
});

test.describe("Artifact view – approve and edit", () => {
  test("[Request review] on a draft without comments starts a review run", async ({ mock, mockPage: page }) => {
    mock.setArtifact("01", { status: "draft", content: DRAFT_CONTENT });
    await page.goto("/projects/proj-1");
    await openArtifactFromOverview(page, "01");

    await page.getByRole("button", { name: "Request review", exact: true }).click();

    await expect(page.getByText("Analyzing draft and exploring perspectives")).toBeVisible();
    expect(mock.runStarts).toEqual([{ type: "review", slot: "01" }]);
  });

  test("approving a draft that was not reviewed shows the not-reviewed dialog; [Approve anyway] approves", async ({
    mock,
    mockPage: page,
  }) => {
    mock.setArtifact("01", { status: "draft", reviewed_since_change: false, content: DRAFT_CONTENT });
    await page.goto("/projects/proj-1");
    await openArtifactFromOverview(page, "01");

    await page.getByRole("button", { name: "Approve", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Approve artifact" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Not reviewed yet")).toBeVisible();
    await expect(
      dialog.getByText("Approving now skips review. Approved drafts become the confirmed basis for the next artifacts."),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Review first" })).toBeVisible();

    await dialog.getByRole("button", { name: "Approve anyway" }).click();

    await expect(dialog).toBeHidden();
    expect(mock.approveRequests).toEqual([{ id: "art-01", force: true }]);
    // The status badge in the heading row and the toolbar reflect the approval.
    await expect(page.getByRole("button", { name: "Request review", exact: true })).toHaveCount(0);
    await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  });

  test("[Review first] closes the dialog and starts a review run", async ({ mock, mockPage: page }) => {
    mock.setArtifact("01", { status: "draft", reviewed_since_change: false, content: DRAFT_CONTENT });
    await page.goto("/projects/proj-1");
    await openArtifactFromOverview(page, "01");

    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await page.getByRole("dialog", { name: "Approve artifact" }).getByRole("button", { name: "Review first" }).click();

    await expect(page.getByRole("dialog", { name: "Approve artifact" })).toBeHidden();
    await expect.poll(() => mock.runStarts).toEqual([{ type: "review", slot: "01" }]);
    expect(mock.approveRequests).toEqual([]);
  });

  test("approving a reviewed draft shows only [Approve] and the confirmation sentence", async ({
    mock,
    mockPage: page,
  }) => {
    mock.setArtifact("01", { status: "draft", reviewed_since_change: true, content: DRAFT_CONTENT });
    await page.goto("/projects/proj-1");
    await openArtifactFromOverview(page, "01");

    await page.getByRole("button", { name: "Approve", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Approve artifact" });
    await expect(dialog.getByText("It becomes the confirmed basis for the next artifacts.")).toBeVisible();
    await expect(dialog.getByText("Not reviewed yet")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Approve anyway" })).toHaveCount(0);

    await dialog.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(mock.approveRequests).toEqual([{ id: "art-01", force: false }]);
  });

  test("approving writes the next-step message into the chat right away", async ({ mock, mockPage: page }) => {
    mock.setArtifact("01", { status: "draft", reviewed_since_change: true, content: DRAFT_CONTENT });
    await page.goto("/projects/proj-1");
    await openArtifactFromOverview(page, "01");

    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Approve artifact" })
      .getByRole("button", { name: "Approve", exact: true })
      .click();

    await expect(page.getByText("01 Problem- and Scope-Definition ist freigegeben.")).toBeVisible();
  });

  test("Edit on an approved artifact asks the revoke question; Continue opens the editor and Save revokes the approval", async ({
    mock,
    mockPage: page,
  }) => {
    mock.setArtifact("01", { status: "approved", reviewed_since_change: true, content: DRAFT_CONTENT });
    await page.goto("/projects/proj-1");
    await openArtifactFromOverview(page, "01");

    await page.getByRole("button", { name: "Edit", exact: true }).click();

    await expect(page.getByText("This will revoke the approval. Continue?")).toBeVisible();
    // The editor is not open yet.
    await expect(page.getByRole("textbox", { name: "Markdown" })).toHaveCount(0);

    await page.getByRole("button", { name: "Continue", exact: true }).click();

    const editor = page.getByRole("textbox", { name: "Markdown" });
    await expect(editor).toBeVisible();
    await editor.fill("## Problem\nEdited by hand.");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(editor).toHaveCount(0);
    expect(mock.artifactUpdates).toEqual([{ id: "art-01", content: "## Problem\nEdited by hand." }]);
    await expect(page.getByText("Edited by hand.")).toBeVisible();
    // The artifact is a draft again.
    await expect(page.getByRole("button", { name: "Request review", exact: true })).toBeVisible();
  });

  test("Edit on a draft opens the editor directly and sends editor_open with chat requests", async ({
    mock,
    mockPage: page,
  }) => {
    mock.setArtifact("01", { status: "draft", content: DRAFT_CONTENT });
    await page.goto("/projects/proj-1");
    await openArtifactFromOverview(page, "01");

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Markdown" })).toBeVisible();
    await expect(page.getByText("This will revoke the approval. Continue?")).toHaveCount(0);

    const input = page.getByPlaceholder(/ask the analyst/i);
    await input.fill("Can you shorten this?");
    await input.press("Enter");
    await expect(page.getByText("Here is a response")).toBeVisible();
    expect(mock.chatRequests[0]).toMatchObject({ open_artifact_id: "art-01", editor_open: true });

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Markdown" })).toHaveCount(0);
  });
});

test.describe("Source panel", () => {
  test("clicking an [[artifact:01]] citation opens the approved version in the source panel", async ({
    mock,
    mockPage: page,
  }) => {
    mock.setArtifact("01", { status: "approved", reviewed_since_change: true, content: DRAFT_CONTENT });
    mock.setArtifact("02", { status: "draft", content: "## Stakeholders\nSite operator" });
    mock.approvedVersions["art-01"] = {
      artifact_id: "art-01",
      version_no: 1,
      content: "## Problem\nApproved scope text.",
      created_at: "2026-06-02T11:00:00Z",
    };
    mock.messages["sess-1"] = [
      makeMessage("m1", "assistant", GREETING, "analyst"),
      makeMessage("m2", "user", "Where is the scope defined?"),
      makeMessage("m3", "assistant", "The scope is described in [[artifact:01]].", "analyst"),
    ];
    await page.goto("/projects/proj-1");
    await openArtifactFromOverview(page, "02");
    await expect(page.getByRole("heading", { name: "02 Stakeholder Analysis" })).toBeVisible();

    await page.getByRole("button", { name: "01 · Problem- and Scope-Definition", exact: true }).click();

    await expect(page.getByRole("heading", { name: "01 · Problem- and Scope-Definition · v1" })).toBeVisible();
    await expect(page.getByText("Approved scope text.")).toBeVisible();
    // The artifact stays visible next to the panel.
    await expect(page.getByRole("heading", { name: "02 Stakeholder Analysis" })).toBeVisible();

    await page.getByRole("button", { name: "Close source" }).click();
    await expect(page.getByRole("heading", { name: "01 · Problem- and Scope-Definition · v1" })).toHaveCount(0);
  });

  test("a citation of an artifact without an approved version says so", async ({ mock, mockPage: page }) => {
    mock.setArtifact("02", { status: "draft", content: "## Stakeholders\nSite operator" });
    mock.messages["sess-1"] = [
      makeMessage("m1", "assistant", GREETING, "analyst"),
      makeMessage("m2", "assistant", "See [[artifact:01]] for details.", "analyst"),
    ];
    await page.goto("/projects/proj-1");
    await openArtifactFromOverview(page, "02");

    await page.getByRole("button", { name: "01 · Problem- and Scope-Definition", exact: true }).click();

    await expect(page.getByText("No approved version yet.")).toBeVisible();
  });
});
