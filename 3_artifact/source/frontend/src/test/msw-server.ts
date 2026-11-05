import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import type { Artifact, Comment, Run, Session } from "@/types";

const BASE = "http://localhost:8000/api/v1";

// --- Shared fixtures ---

export const SESSION_ID = "sess-test-1";
export const PROJECT_ID = "proj-test-1";

export const SESSION: Session = {
  id: SESSION_ID,
  project_id: PROJECT_ID,
  title: null,
  created_at: "2026-06-01T10:00:00Z",
  updated_at: "2026-06-01T10:00:00Z",
};

export const SESSION_WITH_MESSAGES = {
  ...SESSION,
  messages: [
    {
      id: "msg-existing-1",
      role: "assistant",
      content: "Hi! I'll help you prepare the customer workshop.",
      agent_name: "analyst",
      tool_calls: null,
      created_at: "2026-06-01T10:00:00Z",
    },
    {
      id: "msg-existing-2",
      role: "user",
      content: "Existing user message",
      agent_name: null,
      tool_calls: null,
      created_at: "2026-06-01T10:00:01Z",
    },
    {
      id: "msg-existing-3",
      role: "assistant",
      content: "Existing analyst response",
      agent_name: "analyst",
      tool_calls: null,
      created_at: "2026-06-01T10:00:02Z",
    },
  ],
};

export const NEW_SESSION: Session = {
  id: "sess-test-new",
  project_id: PROJECT_ID,
  title: null,
  created_at: "2026-06-02T10:00:00Z",
  updated_at: "2026-06-02T10:00:00Z",
};

export function makeArtifact(slot: "01" | "02" | "03", overrides: Partial<Artifact> = {}): Artifact {
  const meta = {
    "01": { type: "project_description", title: "Problem- and Scope-Definition" },
    "02": { type: "stakeholder_analysis", title: "Stakeholder Analysis" },
    "03": { type: "open_issues", title: "Open Issues & Workshop Questions" },
  }[slot];
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

export const ARTIFACTS: Artifact[] = [makeArtifact("01"), makeArtifact("02"), makeArtifact("03")];

export function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "com-1",
    artifact_id: "art-01",
    number: 1,
    review_number: 1,
    title: "DPO missing",
    description: "DOC3 mentions personal participant data, but no responsible role is listed.",
    role: "reviewer",
    hypothesis: false,
    sources: [],
    suggestion: { kind: "text_change", find: "## Stakeholders", replace: "## Stakeholders\n### Data Protection Officer" },
    status: "open",
    created_at: "2026-06-01T10:00:00Z",
    ...overrides,
  };
}

export interface SseFrame {
  event: string;
  data: unknown;
}

/** Build an SSE ReadableStream from `{event, data}` frames (data is JSON-encoded). */
export function makeChatSse(frames: SseFrame[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const f of frames) {
        controller.enqueue(encoder.encode(`event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`));
      }
      controller.close();
    },
  });
}

export function sseResponse(frames: SseFrame[]): Response {
  return new HttpResponse(makeChatSse(frames), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    project_id: PROJECT_ID,
    type: "draft",
    slot: "01",
    state: "running",
    step: "reading",
    error: null,
    created_at: "2026-06-01T10:00:00Z",
    finished_at: null,
    ...overrides,
  };
}

// --- Default handlers ---

export const defaultHandlers = [
  // Projects
  http.get(`${BASE}/projects`, () =>
    HttpResponse.json([
      { id: PROJECT_ID, name: "Test Project", description: null, created_at: "2026-06-01T10:00:00Z", updated_at: "2026-06-01T10:00:00Z" },
    ])
  ),
  http.get(`${BASE}/projects/${PROJECT_ID}`, () =>
    HttpResponse.json({ id: PROJECT_ID, name: "Test Project", description: null, created_at: "2026-06-01T10:00:00Z", updated_at: "2026-06-01T10:00:00Z" })
  ),

  // Sessions list
  http.get(`${BASE}/sessions`, ({ request }) => {
    const url = new URL(request.url);
    if (url.searchParams.get("project_id") === PROJECT_ID) {
      return HttpResponse.json([SESSION]);
    }
    return HttpResponse.json([]);
  }),

  // Session detail
  http.get(`${BASE}/sessions/${SESSION_ID}`, () => HttpResponse.json(SESSION_WITH_MESSAGES)),
  http.get(`${BASE}/sessions/${NEW_SESSION.id}`, () =>
    HttpResponse.json({
      ...NEW_SESSION,
      messages: [
        {
          id: "msg-new-1",
          role: "assistant",
          content: "Hi! I'll help you prepare the customer workshop.",
          agent_name: "analyst",
          tool_calls: null,
          created_at: "2026-06-02T10:00:00Z",
        },
      ],
    })
  ),

  // Create session (the backend writes the greeting)
  http.post(`${BASE}/sessions`, () => HttpResponse.json(NEW_SESSION, { status: 201 })),

  // Chat stream
  http.post(`${BASE}/chat/stream`, () =>
    sseResponse([
      { event: "token", data: "Agent response " },
      { event: "token", data: "from MSW" },
      {
        event: "done",
        data: {
          message_id: "msw-msg-1",
          content: "Agent response from MSW",
          agent: "analyst",
          label: "Analyst",
          pending: false,
          proposal: null,
        },
      },
    ])
  ),

  // Runs
  http.get(`${BASE}/projects/${PROJECT_ID}/runs/active`, () => HttpResponse.json(null)),
  http.post(`${BASE}/projects/${PROJECT_ID}/runs`, () => HttpResponse.json(makeRun(), { status: 202 })),
  http.get(`${BASE}/runs/run-1`, () => HttpResponse.json(makeRun())),

  // Documents
  http.get(`${BASE}/documents`, () => HttpResponse.json([])),

  // Artifacts
  http.get(`${BASE}/artifacts`, ({ request }) => {
    const url = new URL(request.url);
    if (url.searchParams.get("project_id") === PROJECT_ID) {
      return HttpResponse.json(ARTIFACTS);
    }
    return HttpResponse.json([]);
  }),

  // Comments
  http.get(`${BASE}/comments`, () => HttpResponse.json([])),
];

export const server = setupServer(...defaultHandlers);
