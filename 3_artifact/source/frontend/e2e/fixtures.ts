import { test as base, type BrowserContext, type Locator, type Page, type Route } from "@playwright/test";
import type {
  ApprovedVersion,
  Artifact,
  Comment,
  CommentOutcome,
  Document,
  Message,
  Project,
  Run,
  RunState,
  RunType,
  Session,
  Slot,
  Suggestion,
} from "@/types";
import type { AgentName, ChatRequestBody, QuestionProposal } from "@/types/chat";

/**
 * Mock API for consistent testing without a running backend.
 *
 * Each test gets its own `MockState` (fixture `mock`). Mutate it BEFORE `page.goto`; the route
 * handlers read it at request time, so tests can also flip things later (e.g. finish a run).
 */

// === SSE helpers ===

export interface SseEvent {
  event: string;
  data: unknown;
}

/** Frame text of the backend contract: `event: <name>\ndata: <json>\n\n` (token data is a JSON string). */
export function sse(events: SseEvent[]): string {
  return events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join("");
}

export function token(text: string): SseEvent {
  return { event: "token", data: text };
}

const AGENT_LABELS: Record<AgentName, string> = { analyst: "Analyst" };

let doneCounter = 0;

export function done(
  content: string,
  opts: { agent?: AgentName; pending?: boolean; messageId?: string; proposal?: QuestionProposal } = {},
): SseEvent {
  const agent = opts.agent ?? "analyst";
  doneCounter += 1;
  return {
    event: "done",
    data: {
      message_id: opts.messageId ?? `done-msg-${doneCounter}`,
      content,
      agent,
      label: AGENT_LABELS[agent],
      pending: opts.pending ?? false,
      proposal: opts.proposal ?? null,
    },
  };
}

export function runStarted(runId: string): SseEvent {
  return { event: "run_started", data: { run_id: runId } };
}

// === Data builders ===

export const PROJECT_ID = "proj-1";
export const GREETING =
  "Hi! I'll help you prepare the customer workshop. Together we'll create three artifacts. " +
  "I suggest we start with the project description.";

export const SLOT_ORDER: readonly Slot[] = ["01", "02", "03"];

const SLOT_META: Record<Slot, { type: string; title: string }> = {
  "01": { type: "project_description", title: "Problem- and Scope-Definition" },
  "02": { type: "stakeholder_analysis", title: "Stakeholder Analysis" },
  "03": { type: "open_issues", title: "Open Issues & Workshop Questions" },
};

export function makeArtifact(slot: Slot, overrides: Partial<Artifact> = {}): Artifact {
  const meta = SLOT_META[slot];
  return {
    id: `art-${slot}`,
    project_id: PROJECT_ID,
    type: meta.type,
    title: meta.title,
    content: "",
    language: null,
    status: "not_started",
    reviewed_since_change: false,
    slot,
    created_at: "2026-06-01T10:00:00Z",
    updated_at: "2026-06-01T10:00:00Z",
    metadata: null,
    ...overrides,
  };
}

export function makeProposal(overrides: Partial<QuestionProposal> = {}): QuestionProposal {
  return {
    id: "prop-1",
    status: "open",
    origin_artifact_id: null,
    questions: [
      { id: "q1", title: "Budget", text: "Wie hoch ist das Budget?", state: "open" },
      { id: "q2", title: "Termin", text: "Bis wann soll das Projekt live gehen?", state: "open" },
    ],
    ...overrides,
  };
}

export function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "com-1",
    artifact_id: "art-01",
    number: 1,
    review_number: 1,
    title: "DPO missing",
    description: "The documents mention personal participant data, but no responsible role is listed.",
    role: "reviewer",
    hypothesis: false,
    sources: [],
    suggestion: {
      kind: "text_change",
      find: "## Stakeholders",
      replace: "## Stakeholders\n### Data Protection Officer",
    },
    status: "open",
    created_at: "2026-06-01T11:00:00Z",
    ...overrides,
  };
}

export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    project_id: PROJECT_ID,
    type: "draft",
    slot: "01",
    state: "running",
    step: "writing",
    error: null,
    created_at: "2026-06-01T12:00:00Z",
    finished_at: null,
    ...overrides,
  };
}

export function makeMessage(
  id: string,
  role: "user" | "assistant",
  content: string,
  agent: AgentName | null = null,
): Message {
  return {
    id,
    role,
    content,
    agent_name: role === "assistant" ? (agent ?? "analyst") : null,
    tool_calls: null,
    proposal: null,
    created_at: "2026-06-01T10:05:00Z",
  };
}

/** A draft of slot 01 with a stakeholder heading that the default comment's text change targets. */
export const DRAFT_CONTENT =
  "## Problem\nManual light control wastes energy in the smart home.\n\n## Stakeholders\nSite operator";

// === Mock state ===

export interface MockState {
  projects: Project[];
  sessions: Session[];
  /** Persisted messages per session id (`GET /sessions/{id}`). */
  messages: Record<string, Message[]>;
  artifacts: Artifact[];
  comments: Comment[];
  documents: Document[];
  /** Last approved version per artifact id (`GET /artifacts/{id}/approved-version`); missing means 404. */
  approvedVersions: Record<string, ApprovedVersion>;
  runs: Run[];
  /** Answers of `POST /chat/stream`, consumed in order; falls back to a short Analyst answer. */
  chatQueue: SseEvent[][];
  chatDelayMs: number;
  /** Recorded request bodies, in order. */
  chatRequests: ChatRequestBody[];
  /** Called with every chat request before it is answered (e.g. to register the run a `run_started` names). */
  onChatRequest: ((body: ChatRequestBody) => void) | null;
  /** Proposal cards the mock has seen in `done` events, by message id. */
  proposals: Record<string, QuestionProposal>;
  /** Recorded bodies of `POST /sessions/{id}/proposals/{mid}/resolve`. */
  proposalResolves: { messageId: string; body: Record<string, unknown> }[];
  /** When set, the next resolve answers 409 with this code (then it resets). */
  proposalConflict: string | null;
  runStarts: { type: RunType; slot: Slot }[];
  approveRequests: { id: string; force: boolean }[];
  artifactUpdates: { id: string; content: string }[];
  commentActions: { id: string; action: string }[];
  /** Replace the artifact of a slot with overrides applied on top of the not-started default. */
  setArtifact(slot: Slot, overrides: Partial<Artifact>): Artifact;
  setRunState(runId: string, state: RunState): void;
}

export function createMockState(): MockState {
  const state: MockState = {
    projects: [
      {
        id: PROJECT_ID,
        name: "Smart Home System",
        description: "Requirements for a smart home IoT platform",
        created_at: "2026-06-01T10:00:00Z",
        updated_at: "2026-06-15T14:30:00Z",
      },
      {
        id: "proj-2",
        name: "E-Commerce Platform",
        description: null,
        created_at: "2026-06-10T08:00:00Z",
        updated_at: "2026-06-10T08:00:00Z",
      },
    ],
    sessions: [
      {
        id: "sess-1",
        project_id: PROJECT_ID,
        title: null,
        created_at: "2026-06-01T10:05:00Z",
        updated_at: "2026-06-01T10:05:00Z",
      },
    ],
    messages: { "sess-1": [makeMessage("msg-greeting-1", "assistant", GREETING, "analyst")] },
    artifacts: SLOT_ORDER.map((slot) => makeArtifact(slot)),
    comments: [],
    documents: [
      {
        id: "doc-1",
        project_id: PROJECT_ID,
        filename: "smart-home-spec.pdf",
        content_type: "application/pdf",
        size_bytes: 245_760,
        created_at: "2026-06-01T09:00:00Z",
      },
      {
        id: "doc-2",
        project_id: PROJECT_ID,
        filename: "iot-standards.md",
        content_type: "text/markdown",
        size_bytes: 8_432,
        created_at: "2026-06-05T11:00:00Z",
      },
    ],
    approvedVersions: {},
    runs: [],
    chatQueue: [],
    chatDelayMs: 0,
    chatRequests: [],
    onChatRequest: null,
    proposals: {},
    proposalResolves: [],
    proposalConflict: null,
    runStarts: [],
    approveRequests: [],
    artifactUpdates: [],
    commentActions: [],
    setArtifact(slot, overrides) {
      const next = makeArtifact(slot, overrides);
      state.artifacts = state.artifacts.filter((a) => a.slot !== slot).concat(next);
      return next;
    },
    setRunState(runId, runState) {
      state.runs = state.runs.map((r) =>
        r.id === runId
          ? {
              ...r,
              state: runState,
              error: runState === "failed" ? "llm_failed" : null,
              finished_at: runState === "running" ? null : "2026-06-01T12:05:00Z",
            }
          : r,
      );
    },
  };
  return state;
}

// === Auth helpers ===

export const FAKE_USER = {
  id: "test-user-id",
  username: "testuser",
  display_name: "Test User",
};

/**
 * Build a JWT-shaped (but unsigned/fake) token. middleware.ts decodes the
 * payload and checks `exp` locally — it never calls the backend — so the
 * cookie value must at least look like a JWT or every navigation gets
 * redirected to /login?reason=expired.
 */
function fakeJwt(): string {
  const base64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64url({ alg: "none", typ: "JWT" });
  const payload = base64url({ sub: FAKE_USER.id, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${header}.${payload}.fake-signature`;
}

export async function setAuthCookie(context: BrowserContext) {
  await context.addCookies([
    {
      name: "access_token",
      value: fakeJwt(),
      domain: "localhost",
      path: "/",
    },
  ]);
}

// === Request routing ===

interface Reply {
  status: number;
  json?: unknown;
  text?: string;
}

const ok = (json: unknown, status = 200): Reply => ({ status, json });
const noContent = (): Reply => ({ status: 204, text: "" });
const notFound = (detail = "Not found"): Reply => ({ status: 404, json: { detail } });
const conflict = (code: string, message: string): Reply => ({ status: 409, json: { detail: { code, message } } });

function asRecord(v: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    for (const [key, value] of Object.entries(v)) out[key] = value;
  }
  return out;
}

function readBody(route: Route): Record<string, unknown> {
  try {
    return asRecord(route.request().postDataJSON());
  } catch {
    return {};
  }
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function toChatBody(body: Record<string, unknown>): ChatRequestBody {
  return {
    session_id: str(body.session_id, ""),
    message: str(body.message, ""),
    open_artifact_id: typeof body.open_artifact_id === "string" ? body.open_artifact_id : null,
    editor_open: body.editor_open === true,
    comment_id: typeof body.comment_id === "string" ? body.comment_id : null,
  };
}

function isSuggestion(v: unknown): v is Suggestion {
  const r = asRecord(v);
  return (
    (r.kind === "text_change" && typeof r.find === "string" && typeof r.replace === "string") ||
    (r.kind === "workshop_question" && typeof r.text === "string")
  );
}

function isRunType(v: unknown): v is RunType {
  return v === "draft" || v === "review";
}

function isSlot(v: unknown): v is Slot {
  return v === "01" || v === "02" || v === "03";
}

/** Resolve a comment like the backend: a text change is applied to the artifact, a question is stored. */
function resolveComment(state: MockState, comment: Comment, status: "accepted" | "edited"): CommentOutcome {
  const { suggestion } = comment;
  if (suggestion?.kind === "text_change") {
    const artifact = state.artifacts.find((a) => a.id === comment.artifact_id);
    if (!artifact || !artifact.content.includes(suggestion.find)) return "not_located";
    artifact.content = artifact.content.replace(suggestion.find, suggestion.replace);
    comment.status = status;
    return "applied";
  }
  comment.status = status;
  return "question_added";
}

function handleProjects(state: MockState, method: string, id: string | undefined, route: Route): Reply | null {
  if (id === undefined) {
    if (method === "GET") return ok(state.projects);
    if (method === "POST") {
      const body = readBody(route);
      const now = new Date().toISOString();
      return ok({
        id: "proj-new",
        name: str(body.name, "New Project"),
        description: typeof body.description === "string" ? body.description : null,
        created_at: now,
        updated_at: now,
      });
    }
    return null;
  }
  const project = state.projects.find((p) => p.id === id);
  const fallback: Project = {
    id,
    name: "New Project",
    description: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (method === "GET") return ok(project ?? fallback);
  if (method === "DELETE") return noContent();
  if (method === "PUT" || method === "PATCH") return ok({ ...(project ?? fallback), ...readBody(route) });
  return null;
}

function handleRuns(state: MockState, method: string, segments: string[], route: Route): Reply | null {
  // GET /projects/{id}/runs/active
  if (segments[0] === "projects" && segments[2] === "runs" && segments[3] === "active" && method === "GET") {
    return ok(state.runs.find((r) => r.state === "running") ?? null);
  }
  // POST /projects/{id}/runs
  if (segments[0] === "projects" && segments[2] === "runs" && segments.length === 3 && method === "POST") {
    const body = readBody(route);
    if (!isRunType(body.type) || !isSlot(body.slot)) return { status: 422, json: { detail: "invalid run" } };
    if (state.runs.some((r) => r.state === "running")) {
      return conflict("run_active", "A run is already active.");
    }
    state.runStarts.push({ type: body.type, slot: body.slot });
    const run = makeRun({
      id: `run-${state.runs.length + 1}`,
      type: body.type,
      slot: body.slot,
      step: "reading",
    });
    state.runs.push(run);
    return ok(run, 202);
  }
  // GET /runs/{id}
  if (segments[0] === "runs" && segments[1] !== undefined && method === "GET") {
    const run = state.runs.find((r) => r.id === segments[1]);
    return run ? ok(run) : notFound("Run not found");
  }
  return null;
}

function handleSessions(
  state: MockState,
  method: string,
  id: string | undefined,
  sub: string | undefined,
  messageId: string | undefined,
  action: string | undefined,
  url: URL,
  route: Route,
): Reply | null {
  if (id === undefined) {
    if (method === "GET") {
      const projectId = url.searchParams.get("project_id");
      return ok(state.sessions.filter((s) => projectId === null || s.project_id === projectId));
    }
    if (method === "POST") {
      const body = readBody(route);
      const now = new Date().toISOString();
      const session: Session = {
        id: `sess-new-${state.sessions.length}`,
        project_id: str(body.project_id, PROJECT_ID),
        title: null,
        created_at: now,
        updated_at: now,
      };
      state.sessions.push(session);
      state.messages[session.id] = [makeMessage(`msg-greeting-${session.id}`, "assistant", GREETING, "analyst")];
      return ok(session, 201);
    }
    return null;
  }
  if (method === "POST" && sub === "proposals" && messageId !== undefined && action === "resolve") {
    return handleProposalResolve(state, messageId, route);
  }
  const session = state.sessions.find((s) => s.id === id);
  if (method === "GET") {
    return session ? ok({ ...session, messages: state.messages[id] ?? [] }) : notFound("Session not found");
  }
  return null;
}

function handleArtifacts(
  state: MockState,
  method: string,
  id: string | undefined,
  sub: string | undefined,
  url: URL,
  route: Route,
): Reply | null {
  if (id === undefined) {
    if (method !== "GET") return null;
    const projectId = url.searchParams.get("project_id");
    return ok(state.artifacts.filter((a) => projectId === null || a.project_id === projectId));
  }
  const artifact = state.artifacts.find((a) => a.id === id);
  if (!artifact) return notFound("Artifact not found");

  if (sub === undefined) {
    if (method === "GET") return ok(artifact);
    if (method === "PUT") {
      const body = readBody(route);
      if (typeof body.content === "string") {
        artifact.content = body.content;
        state.artifactUpdates.push({ id, content: body.content });
      }
      if (typeof body.title === "string") artifact.title = body.title;
      // Editing an approved artifact revokes the approval; any edit invalidates the review.
      artifact.status = "draft";
      artifact.reviewed_since_change = false;
      return ok(artifact);
    }
    return null;
  }
  if (sub === "approve" && method === "POST") {
    const force = readBody(route).force === true;
    state.approveRequests.push({ id, force });
    if (state.comments.some((c) => c.artifact_id === id && c.status === "open")) {
      return conflict("open_comments", "Resolve all open comments first.");
    }
    if (!artifact.reviewed_since_change && !force) {
      return conflict("not_reviewed", "This draft hasn't been reviewed yet.");
    }
    artifact.status = "approved";
    // Like the backend: with a known session the next-step message is stored and returned.
    const sessionId = readBody(route).session_id;
    const messages = typeof sessionId === "string" ? state.messages[sessionId] : undefined;
    let chatMessage: Message | null = null;
    if (messages !== undefined) {
      chatMessage = makeMessage(
        `msg-approval-${messages.length}`,
        "assistant",
        `${artifact.slot} ${artifact.title} ist freigegeben.`,
        "analyst",
      );
      messages.push(chatMessage);
    }
    return ok({ ...artifact, chat_message: chatMessage });
  }
  if (sub === "approved-version" && method === "GET") {
    const version = state.approvedVersions[id];
    return version ? ok(version) : notFound("No approved version");
  }
  return null;
}

function handleComments(state: MockState, method: string, id: string | undefined, sub: string | undefined, url: URL, route: Route): Reply | null {
  if (id === undefined) {
    if (method !== "GET") return null;
    const artifactId = url.searchParams.get("artifact_id");
    return ok(state.comments.filter((c) => artifactId === null || c.artifact_id === artifactId));
  }
  const comment = state.comments.find((c) => c.id === id);
  if (!comment || sub === undefined || method !== "POST") return null;
  state.commentActions.push({ id, action: sub });

  let outcome: CommentOutcome;
  switch (sub) {
    case "accept":
      outcome = resolveComment(state, comment, "accepted");
      break;
    case "edit": {
      const suggestion = readBody(route).suggestion;
      if (isSuggestion(suggestion)) comment.suggestion = suggestion;
      outcome = resolveComment(state, comment, "edited");
      break;
    }
    case "reject": {
      comment.status = "rejected";
      outcome = "rejected";
      break;
    }
    case "done-manually":
      comment.status = "done_manually";
      outcome = "done_manually";
      break;
    default:
      return null;
  }
  return ok({ outcome, comment });
}

function handleDocuments(state: MockState, method: string, id: string | undefined): Reply | null {
  if (id === undefined) {
    if (method === "GET") return ok(state.documents);
    return null;
  }
  if (id === "upload" && method === "POST") {
    const doc: Document = {
      id: "doc-new",
      project_id: PROJECT_ID,
      filename: "uploaded-file.txt",
      content_type: "text/plain",
      size_bytes: 1024,
      created_at: new Date().toISOString(),
    };
    state.documents = [...state.documents, doc];
    return ok(doc);
  }
  if (method === "DELETE") {
    state.documents = state.documents.filter((d) => d.id !== id);
    return noContent();
  }
  return null;
}

function rememberProposal(state: MockState, e: SseEvent): void {
  if (e.event !== "done") return;
  const data = asRecord(e.data);
  const messageId = data.message_id;
  const proposal = data.proposal;
  if (typeof messageId === "string" && proposal !== null && typeof proposal === "object") {
    state.proposals[messageId] = JSON.parse(JSON.stringify(proposal)) as QuestionProposal;
  }
}

function handleProposalResolve(state: MockState, messageId: string, route: Route): Reply {
  const body = readBody(route);
  state.proposalResolves.push({ messageId, body });
  if (state.proposalConflict !== null) {
    const code = state.proposalConflict;
    state.proposalConflict = null;
    return conflict(code, `Conflict: ${code}`);
  }
  const card = state.proposals[messageId];
  if (!card) return notFound("Proposal not found");
  const accepting = body.action === "accept";
  const ids = Array.isArray(body.question_ids) ? body.question_ids.filter((v): v is string => typeof v === "string") : [];
  const questions = card.questions.map((q) => ({
    ...q,
    state: accepting && ids.includes(q.id) ? ("accepted" as const) : ("rejected" as const),
  }));
  const settled: QuestionProposal = { ...card, status: accepting ? "accepted" : "rejected", questions };
  state.proposals[messageId] = settled;
  let artifactId: string | null = null;
  let start: number | null = null;
  let end: number | null = null;
  if (accepting) {
    const block = questions
      .filter((q) => q.state === "accepted")
      .map((q) => `### ${q.title}\n\n**Question:** ${q.text}`)
      .join("\n\n");
    const existing = state.artifacts.find((a) => a.slot === "03");
    const head = existing && existing.content.trim() !== "" ? `${existing.content.trimEnd()}\n\n` : "";
    const artifact = state.setArtifact("03", { status: "draft", content: `${head}${block}\n` });
    artifactId = artifact.id;
    start = head.length;
    end = head.length + block.length;
  }
  const reply = makeMessage(
    `reply-${messageId}`,
    "assistant",
    accepting ? `${ids.length} Fragen zu 03 hinzugefügt.` : "Okay, nicht übernommen.",
    "analyst",
  );
  return ok({ message_id: messageId, proposal: settled, reply, artifact_id: artifactId, start, end });
}

async function handleChat(state: MockState, route: Route): Promise<void> {
  const body = toChatBody(readBody(route));
  state.chatRequests.push(body);
  state.onChatRequest?.(body);
  const events = state.chatQueue.shift() ?? [token("Here is a response"), done("Here is a response")];
  for (const e of events) rememberProposal(state, e);
  if (state.chatDelayMs > 0) await new Promise((r) => setTimeout(r, state.chatDelayMs));
  await route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    body: sse(events),
  });
}

export async function mockAPI(page: Page, state: MockState = createMockState()): Promise<MockState> {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const segments = url.pathname.replace(/^\/api\/v1\/?/, "").split("/").filter(Boolean);
    const [resource, id, sub, messageId, action] = segments;

    if (resource === "chat" && id === "stream" && method === "POST") {
      await handleChat(state, route);
      return;
    }

    // Auth: login and register hand out the (fake) session cookie like the real backend.
    if (resource === "auth") {
      if (id === "me") return route.fulfill({ json: FAKE_USER });
      if (id === "login" || id === "register") {
        await page.context().addCookies([{ name: "access_token", value: fakeJwt(), domain: "localhost", path: "/" }]);
        return route.fulfill({ status: id === "login" ? 200 : 201, json: FAKE_USER });
      }
      if (id === "logout") return route.fulfill({ status: 204, body: "" });
    }

    let reply: Reply | null = null;
    switch (resource) {
      case "projects":
        reply = sub === "runs" ? handleRuns(state, method, segments, route) : handleProjects(state, method, id, route);
        break;
      case "runs":
        reply = handleRuns(state, method, segments, route);
        break;
      case "sessions":
        reply = handleSessions(state, method, id, sub, messageId, action, url, route);
        break;
      case "artifacts":
        reply = handleArtifacts(state, method, id, sub, url, route);
        break;
      case "comments":
        reply = handleComments(state, method, id, sub, url, route);
        break;
      case "documents":
        reply = handleDocuments(state, method, id);
        break;
      default:
        break;
    }

    // Anything not mocked is a test bug: fail loudly instead of hitting a real backend.
    if (reply === null) return route.fulfill({ status: 404, json: { detail: `Unmocked: ${method} ${url.pathname}` } });
    if (reply.text !== undefined) {
      return route.fulfill({ status: reply.status, body: reply.text });
    }
    return route.fulfill({ status: reply.status, json: reply.json });
  });
  return state;
}

/** Click the overview row of an artifact slot (right column of the start view). */
export async function openArtifactFromOverview(page: Page, slot: Slot): Promise<void> {
  const title = SLOT_META[slot].title;
  await page.getByTestId("artifact-row").filter({ hasText: `${slot} ${title}` }).click();
}

/** Open the comments overlay of the open artifact. */
export async function openComments(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Comments/ }).click();
}

/**
 * Comment cards start collapsed to their header (`collapsedByDefault`): the actions (Accept, Edit,
 * Reject, Ask) only exist once a card is expanded. Expands the card of the comment with this title
 * through its chevron (which does not select the comment) and returns the card.
 */
export async function expandComment(page: Page, title: string): Promise<Locator> {
  const card = page.getByTestId("comment-card").filter({ hasText: title });
  await card.getByRole("button", { name: "Expand comment" }).click();
  return card;
}

/** Extended test fixtures: a fresh mock state plus a page with API mocking and the auth cookie applied. */
export const test = base.extend<{ mock: MockState; mockPage: Page }>({
  mock: async ({}, use) => {
    await use(createMockState());
  },
  mockPage: async ({ page, context, mock }, use) => {
    await setAuthCookie(context);
    await mockAPI(page, mock);
    await use(page);
  },
});

export { expect } from "@playwright/test";
