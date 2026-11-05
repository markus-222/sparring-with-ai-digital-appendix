import {
  DRAFT_CONTENT,
  GREETING,
  done,
  expect,
  makeMessage,
  makeProposal,
  makeRun,
  runStarted,
  test,
  token,
} from "./fixtures";

// All chat UI lives on /projects/[id]; there is no /chat sub-route.
const CHAT_INPUT = /ask the analyst/i;

test.describe("Chat – start view", () => {
  test("shows project name in header breadcrumb", async ({ mockPage: page }) => {
    await page.goto("/projects/proj-1");
    await expect(page.getByText("Smart Home System")).toBeVisible();
  });

  test("start view shows the greeting, the three starter prompts and three artifact rows with status", async ({
    mockPage: page,
  }) => {
    await page.goto("/projects/proj-1");

    await expect(page.getByText(/Hi! I'll help you prepare the customer workshop/)).toBeVisible();
    await expect(page.getByText("Analyst", { exact: true })).toBeVisible();

    await expect(page.getByRole("button", { name: "Worum geht es in diesem Projekt?", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Welche Artefakte erstellen wir?", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Erstelle einen Entwurf der Projektbeschreibung", exact: true }),
    ).toBeVisible();

    const rows = page.getByTestId("artifact-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("01 Problem- and Scope-Definition");
    await expect(rows.nth(0)).toContainText("Not started");
    await expect(rows.nth(1)).toContainText("02 Stakeholder Analysis");
    await expect(rows.nth(1)).toContainText("Not started");
    await expect(rows.nth(2)).toContainText("03 Open Issues & Workshop Questions");
    await expect(rows.nth(2)).toContainText("Not started");
  });

  test("artifact rows show the status of each artifact", async ({ mock, mockPage: page }) => {
    mock.setArtifact("01", { status: "approved", content: DRAFT_CONTENT });
    mock.setArtifact("02", { status: "draft", content: "## Stakeholders\nSite operator" });
    await page.goto("/projects/proj-1");

    const rows = page.getByTestId("artifact-row");
    await expect(rows.nth(0)).toContainText("Approved");
    await expect(rows.nth(1)).toContainText("Draft");
    await expect(rows.nth(2)).toContainText("Not started");
  });

  test("clicking a starter prompt sends it immediately and the streamed Analyst answer appears", async ({
    mock,
    mockPage: page,
  }) => {
    mock.chatQueue.push([
      token("The project is about "),
      token("smart lighting."),
      done("The project is about smart lighting.", { agent: "analyst" }),
    ]);
    await page.goto("/projects/proj-1");

    await page.getByRole("button", { name: "Worum geht es in diesem Projekt?", exact: true }).click();

    // The user message is shown right away and the starters are gone.
    await expect(page.getByText("Worum geht es in diesem Projekt?", { exact: true })).toBeVisible();
    await expect(page.getByText("The project is about smart lighting.")).toBeVisible();
    // The greeting and the answer both carry the Analyst label.
    await expect(page.getByText("Analyst", { exact: true })).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Welche Artefakte erstellen wir?", exact: true })).toHaveCount(0);

    expect(mock.chatRequests).toHaveLength(1);
    expect(mock.chatRequests[0]).toMatchObject({
      session_id: "sess-1",
      message: "Worum geht es in diesem Projekt?",
      open_artifact_id: null,
      editor_open: false,
      comment_id: null,
    });
  });

  test("[New chat] shows only the new greeting", async ({ mock, mockPage: page }) => {
    mock.messages["sess-1"] = [
      makeMessage("m1", "assistant", GREETING, "analyst"),
      makeMessage("m2", "user", "An old question about sensors"),
      makeMessage("m3", "assistant", "An old answer about sensors", "analyst"),
    ];
    await page.goto("/projects/proj-1");
    await expect(page.getByText("An old answer about sensors")).toBeVisible();

    await page.getByRole("button", { name: "New chat" }).click();

    await expect(page.getByText("An old question about sensors")).toHaveCount(0);
    await expect(page.getByText("An old answer about sensors")).toHaveCount(0);
    await expect(page.getByText(/Hi! I'll help you prepare the customer workshop/)).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Worum geht es in diesem Projekt?", exact: true })).toBeVisible();
    expect(mock.sessions).toHaveLength(2);
  });
});

test.describe("Chat – conversation", () => {
  test("loads and displays the persisted messages with the agent labels", async ({ mock, mockPage: page }) => {
    mock.messages["sess-1"] = [
      makeMessage("m1", "assistant", GREETING, "analyst"),
      makeMessage("m2", "user", "I need requirements for a smart lighting system"),
      makeMessage("m3", "assistant", "Lights shall be controllable from a mobile app.", "analyst"),
    ];
    await page.goto("/projects/proj-1");

    await expect(page.getByText("I need requirements for a smart lighting system")).toBeVisible();
    await expect(page.getByText("Lights shall be controllable from a mobile app.")).toBeVisible();
    await expect(page.getByText("Analyst", { exact: true })).toHaveCount(2);
    await expect(page.getByText("Assistant", { exact: true })).toHaveCount(0);
    // A conversation is under way: no starter prompts any more.
    await expect(page.getByRole("button", { name: "Worum geht es in diesem Projekt?", exact: true })).toHaveCount(0);
  });

  test("sends a typed message and the agent response is displayed", async ({ mockPage: page }) => {
    await page.goto("/projects/proj-1");

    const input = page.getByPlaceholder(CHAT_INPUT);
    await input.fill("What are the lighting requirements?");
    await input.press("Enter");

    // User message appears immediately (optimistic update).
    await expect(page.getByText("What are the lighting requirements?")).toBeVisible();
    await expect(page.getByText("Here is a response")).toBeVisible();
    await expect(input).toBeEnabled();
  });

  test("disables the input while streaming", async ({ mock, mockPage: page }) => {
    mock.chatDelayMs = 1500;
    await page.goto("/projects/proj-1");

    const input = page.getByPlaceholder(CHAT_INPUT);
    await input.fill("Test message");
    await input.press("Enter");

    await expect(input).toBeDisabled();
    await expect(input).toBeEnabled({ timeout: 8000 });
  });

  test("shows an error event of the stream and lets the user dismiss it", async ({ mock, mockPage: page }) => {
    mock.chatQueue.push([{ event: "error", data: { message: "The agent could not answer." } }]);
    await page.goto("/projects/proj-1");

    const input = page.getByPlaceholder(CHAT_INPUT);
    await input.fill("Hello");
    await input.press("Enter");

    await expect(page.getByText("The agent could not answer.")).toBeVisible();
    await page.getByRole("button", { name: "Dismiss error" }).click();
    await expect(page.getByText("The agent could not answer.")).toHaveCount(0);
  });

  test("a work order with a pending confirmation shows Yes/No; Yes sends 'Yes', the run shows progress and the finished draft opens", async ({
    mock,
    mockPage: page,
  }) => {
    mock.chatQueue.push(
      [
        token("Shall I create the draft "),
        token("of the project description now?"),
        done("Shall I create the draft of the project description now?", { agent: "analyst", pending: true }),
      ],
      [
        runStarted("run-1"),
        done("Started: draft of the project description.", { agent: "analyst", pending: false }),
      ],
    );
    // The backend creates the run while it handles the confirmation.
    mock.onChatRequest = (body) => {
      if (body.message === "Yes") mock.runs.push(makeRun({ id: "run-1", type: "draft", slot: "01", step: "writing" }));
    };
    await page.goto("/projects/proj-1");

    await page.getByRole("button", { name: "Erstelle einen Entwurf der Projektbeschreibung", exact: true }).click();

    const quickReplies = page.getByTestId("quick-replies");
    await expect(page.getByText("Shall I create the draft of the project description now?")).toBeVisible();
    await expect(quickReplies.getByRole("button", { name: "Yes", exact: true })).toBeVisible();
    await expect(quickReplies.getByRole("button", { name: "No", exact: true })).toBeVisible();

    await quickReplies.getByRole("button", { name: "Yes", exact: true }).click();

    await expect(page.getByText("Started: draft of the project description.")).toBeVisible();
    await expect(quickReplies).toHaveCount(0);
    expect(mock.chatRequests.map((r) => r.message)).toEqual(["Erstelle einen Entwurf der Projektbeschreibung", "Yes"]);

    // run_started: the progress indicator shows the pipeline state.
    await expect(page.getByText("Analyst is writing the draft", { exact: false })).toBeVisible();

    // The run finishes: the artifact is filled and opens automatically.
    mock.setArtifact("01", { status: "draft", content: DRAFT_CONTENT });
    mock.setRunState("run-1", "succeeded");

    await expect(page.getByRole("heading", { name: "01 Problem- and Scope-Definition" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Manual light control wastes energy in the smart home.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Request review", exact: true })).toBeVisible();
    await expect(page.getByText("Analyst is writing the draft", { exact: false })).toHaveCount(0);
  });
});

test.describe("Chat – question proposal card", () => {
  const offer = (): ReturnType<typeof done> =>
    done("Das ist noch offen.", { pending: true, messageId: "msg-card", proposal: makeProposal() });

  test("shows the card instead of Yes/No, accepting a selection appends it to 03 and confirms in the chat", async ({
    mock,
    mockPage: page,
  }) => {
    mock.setArtifact("03", { status: "draft", content: "### Vorhanden\n\n**Question:** Bestehende Frage?\n" });
    mock.chatQueue.push([token("Das ist noch offen."), offer()]);
    await page.goto("/projects/proj-1");

    const input = page.getByPlaceholder(CHAT_INPUT);
    await input.fill("Was ist noch offen?");
    await input.press("Enter");

    const card = page.getByTestId("proposal-card");
    await expect(card).toBeVisible();
    await expect(card.getByText("Wie hoch ist das Budget?")).toBeVisible();
    await expect(page.getByTestId("quick-replies")).toHaveCount(0);

    await card.getByLabel(/Termin/).uncheck();
    await card.getByRole("button", { name: "Übernehmen (1)" }).click();

    await expect(page.getByText("1 Fragen zu 03 hinzugefügt.")).toBeVisible();
    await expect(card.getByText("1 Frage zu 03 übernommen")).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(0);
    expect(mock.proposalResolves).toHaveLength(1);
    expect(mock.proposalResolves[0]?.body).toMatchObject({ action: "accept", question_ids: ["q1"], revoke: false });

    await expect(page.getByRole("heading", { name: "03 Open Issues & Workshop Questions" })).toBeVisible();
    await expect(page.getByText("Wie hoch ist das Budget?").first()).toBeVisible();
  });

  test("dismissing the card sends a reject and keeps 03 untouched", async ({ mock, mockPage: page }) => {
    mock.chatQueue.push([token("Das ist noch offen."), offer()]);
    await page.goto("/projects/proj-1");

    const input = page.getByPlaceholder(CHAT_INPUT);
    await input.fill("Was ist noch offen?");
    await input.press("Enter");

    const card = page.getByTestId("proposal-card");
    await card.getByRole("button", { name: "Verwerfen" }).click();

    await expect(card.getByText("Verworfen")).toBeVisible();
    expect(mock.proposalResolves[0]?.body).toMatchObject({ action: "reject", question_ids: [] });
    expect(mock.artifacts.find((a) => a.slot === "03")?.status).toBe("not_started");
  });

  test("an approved 03 asks for confirmation before the approval is revoked", async ({ mock, mockPage: page }) => {
    mock.chatQueue.push([token("Das ist noch offen."), offer()]);
    mock.proposalConflict = "needs_revoke";
    await page.goto("/projects/proj-1");

    const input = page.getByPlaceholder(CHAT_INPUT);
    await input.fill("Was ist noch offen?");
    await input.press("Enter");

    const card = page.getByTestId("proposal-card");
    await card.getByRole("button", { name: "Übernehmen (2)" }).click();
    await card.getByRole("button", { name: "Freigabe widerrufen und übernehmen" }).click();

    await expect(card.getByText("2 Fragen zu 03 übernommen")).toBeVisible();
    expect(mock.proposalResolves.map((r) => r.body.revoke)).toEqual([false, true]);
  });
});
