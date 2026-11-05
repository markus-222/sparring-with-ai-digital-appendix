import { toApiError } from "@/lib/api/errors";
import { API } from "@/lib/api/fetcher";
import { parseChatEvent } from "@/lib/chat/events";
import { createSseParser } from "@/lib/chat/sse";
import type { ChatRequestBody, ChatStreamEvent } from "@/types/chat";

export async function streamChat(
  body: ChatRequestBody,
  onEvent: (e: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) throw await toApiError(res);

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder("utf-8");
  const parser = createSseParser((name, data) => {
    const event = parseChatEvent(name, data);
    if (event) onEvent(event);
  });

  // Cancelling the reader unblocks a pending read() even if the body stream is not tied to the signal.
  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw abortError();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.flush();
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

function abortError(): Error {
  const err = new Error("The request was aborted.");
  err.name = "AbortError";
  return err;
}
