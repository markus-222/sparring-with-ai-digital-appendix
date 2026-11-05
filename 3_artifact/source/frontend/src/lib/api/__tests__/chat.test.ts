import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw-server";
import { ApiError } from "@/lib/api/errors";
import { API } from "@/lib/api/fetcher";
import { streamChat } from "@/lib/api/chat";
import type { ChatRequestBody, ChatStreamEvent } from "@/types/chat";

const BODY: ChatRequestBody = { session_id: "s1", message: "Hi", editor_open: false };

function streamOf(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });
}

describe("streamChat", () => {
  it("delivers events in order across mid-frame chunk splits and skips unknown frames", async () => {
    server.use(
      http.post(
        `${API}/chat/stream`,
        () =>
          new HttpResponse(
            streamOf([
              'event: token\ndata: "Hel',
              'lo\\nworld"\n\nevent: myst',
              'ery\ndata: {}\n\nevent: status\ndata: {"message":"Working"}\n\n',
              'event: done\ndata: {"message_id":"m1","content":"Hello","agent":"analyst","label":"Analyst","pending":false,"proposal":null}\n\n',
            ]),
            { headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    );
    const events: ChatStreamEvent[] = [];
    await streamChat(BODY, (e) => events.push(e));
    expect(events).toEqual([
      { type: "token", text: "Hello\nworld" },
      { type: "status", message: "Working" },
      {
        type: "done",
        messageId: "m1",
        content: "Hello",
        agent: "analyst",
        label: "Analyst",
        pending: false,
        proposal: null,
      },
    ]);
  });

  it("delivers a trailing frame without blank line via flush", async () => {
    server.use(
      http.post(
        `${API}/chat/stream`,
        () => new HttpResponse(streamOf(['event: error\ndata: {"message":"boom"}\n']), { headers: { "Content-Type": "text/event-stream" } }),
      ),
    );
    const events: ChatStreamEvent[] = [];
    await streamChat(BODY, (e) => events.push(e));
    expect(events).toEqual([{ type: "error", message: "boom" }]);
  });

  it("posts the JSON body", async () => {
    let received: unknown = null;
    server.use(
      http.post(`${API}/chat/stream`, async ({ request }) => {
        received = await request.json();
        return new HttpResponse(streamOf([]), { headers: { "Content-Type": "text/event-stream" } });
      }),
    );
    await streamChat({ ...BODY, open_artifact_id: "a1", comment_id: "c1", editor_open: true }, () => {});
    expect(received).toEqual({ session_id: "s1", message: "Hi", open_artifact_id: "a1", comment_id: "c1", editor_open: true });
  });

  it("throws ApiError on a non-2xx status", async () => {
    server.use(
      http.post(`${API}/chat/stream`, () =>
        HttpResponse.json({ detail: { code: "run_active", message: "A run is active." } }, { status: 409 }),
      ),
    );
    let err: unknown = null;
    try {
      await streamChat(BODY, () => {});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "run_active", message: "A run is active." });
  });

  it("throws ApiError with status 401 for unauthenticated requests", async () => {
    server.use(http.post(`${API}/chat/stream`, () => HttpResponse.json({ detail: "Not authenticated" }, { status: 401 })));
    let err: unknown = null;
    try {
      await streamChat(BODY, () => {});
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ status: 401 });
  });
});
