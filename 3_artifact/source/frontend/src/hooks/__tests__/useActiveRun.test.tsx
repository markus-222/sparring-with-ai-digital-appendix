import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useActiveRun } from "@/hooks/useActiveRun";
import { ApiError } from "@/lib/api/errors";
import { runsApi } from "@/lib/api/runs";
import { PROJECT_ID, makeRun } from "@/test/msw-server";
import type { Run } from "@/types";

const POLL_MS = 1500;

/** Let pending promise continuations (mocked API calls) settle. */
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setup(onFinished: (run: Run) => void = vi.fn()) {
  const hook = renderHook(() => useActiveRun(PROJECT_ID, onFinished));
  return { ...hook, onFinished };
}

describe("useActiveRun", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(runsApi, "active").mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("has no run and no failure without an active run", async () => {
    const { result } = setup();
    await flush();
    expect(runsApi.active).toHaveBeenCalledWith(PROJECT_ID);
    expect(result.current.run).toBeNull();
    expect(result.current.failed).toBeNull();
    expect(result.current.startError).toBeNull();
  });

  it("resumes an active run on mount", async () => {
    const active = makeRun({ id: "run-9", step: "writing" });
    vi.spyOn(runsApi, "active").mockResolvedValue(active);
    const get = vi.spyOn(runsApi, "get").mockResolvedValue(active);
    const { result } = setup();
    await flush();
    expect(result.current.run?.id).toBe("run-9");
    expect(get).toHaveBeenCalledWith("run-9");
  });

  it("polls every 1500 ms until the run succeeded and calls onFinished once", async () => {
    const running = makeRun({ step: "reading" });
    const succeeded = makeRun({ state: "succeeded", step: null, finished_at: "2026-06-01T10:01:00Z" });
    const get = vi
      .spyOn(runsApi, "get")
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(running)
      .mockResolvedValue(succeeded);
    const { result, onFinished } = setup();

    await act(async () => {
      result.current.track("run-1");
    });
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
    expect(result.current.run?.state).toBe("running");

    await flush(POLL_MS - 1);
    expect(get).toHaveBeenCalledTimes(1);
    await flush(1);
    expect(get).toHaveBeenCalledTimes(2);
    expect(onFinished).not.toHaveBeenCalled();

    await flush(POLL_MS);
    expect(get).toHaveBeenCalledTimes(3);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenCalledWith(succeeded);
    expect(result.current.run).toBeNull();
    expect(result.current.failed).toBeNull();

    // Polling has stopped and onFinished is not repeated.
    await flush(POLL_MS * 5);
    expect(get).toHaveBeenCalledTimes(3);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed run until it is dismissed and does not call onFinished", async () => {
    const failedRun = makeRun({ state: "failed", step: "writing", error: "llm_timeout" });
    vi.spyOn(runsApi, "get").mockResolvedValue(failedRun);
    const { result, onFinished } = setup();

    await act(async () => {
      result.current.track("run-1");
    });
    await flush();
    expect(result.current.run).toBeNull();
    expect(result.current.failed).toEqual(failedRun);
    expect(onFinished).not.toHaveBeenCalled();

    await flush(POLL_MS * 3);
    expect(result.current.failed).toEqual(failedRun);

    act(() => result.current.dismissFailure());
    expect(result.current.failed).toBeNull();
  });

  it("startRun posts type and slot and tracks the new run", async () => {
    const started = makeRun({ id: "run-2", type: "review", slot: "02", step: "reading" });
    const start = vi.spyOn(runsApi, "start").mockResolvedValue(started);
    const get = vi.spyOn(runsApi, "get").mockResolvedValue(started);
    const { result } = setup();

    await act(async () => {
      await result.current.startRun("review", "02");
    });
    expect(start).toHaveBeenCalledWith(PROJECT_ID, { type: "review", slot: "02" });
    expect(result.current.run?.id).toBe("run-2");
    await flush();
    expect(get).toHaveBeenCalledWith("run-2");
  });

  it("startRun clears a previous failure", async () => {
    vi.spyOn(runsApi, "get").mockResolvedValueOnce(makeRun({ state: "failed", error: "x" }));
    const started = makeRun({ id: "run-3" });
    vi.spyOn(runsApi, "start").mockResolvedValue(started);
    const { result } = setup();

    await act(async () => {
      result.current.track("run-1");
    });
    await flush();
    expect(result.current.failed).not.toBeNull();

    vi.spyOn(runsApi, "get").mockResolvedValue(started);
    await act(async () => {
      await result.current.startRun("draft", "01");
    });
    expect(result.current.failed).toBeNull();
    expect(result.current.run?.id).toBe("run-3");
  });

  it("tracks the existing run when the backend answers 409 run_active", async () => {
    const existing = makeRun({ id: "run-7", type: "review", slot: "03" });
    vi.spyOn(runsApi, "start").mockRejectedValue(new ApiError(409, "A run is active.", "run_active"));
    const get = vi.spyOn(runsApi, "get").mockResolvedValue(existing);
    const { result } = setup();
    await flush();
    expect(result.current.run).toBeNull();
    // The run only shows up after mount (started elsewhere), as the 409 answers.
    vi.mocked(runsApi.active).mockClear();
    vi.mocked(runsApi.active).mockResolvedValue(existing);

    await act(async () => {
      await result.current.startRun("draft", "01");
    });
    await flush();
    expect(runsApi.active).toHaveBeenCalledWith(PROJECT_ID);
    expect(get).toHaveBeenCalledWith("run-7");
    expect(result.current.run?.id).toBe("run-7");
    expect(result.current.startError).toBeNull();
  });

  it("surfaces other API errors as startError", async () => {
    vi.spyOn(runsApi, "start").mockRejectedValue(
      new ApiError(409, "Resolve all open comments first.", "open_comments"),
    );
    const { result } = setup();

    await act(async () => {
      await result.current.startRun("review", "01");
    });
    expect(result.current.startError).toBe("Resolve all open comments first.");
    expect(result.current.run).toBeNull();

    act(() => result.current.dismissFailure());
    expect(result.current.startError).toBeNull();
  });

  it("track starts polling for a run id from the chat", async () => {
    const running = makeRun({ id: "run-5", step: "reviewing", type: "review" });
    const get = vi.spyOn(runsApi, "get").mockResolvedValue(running);
    const { result } = setup();

    await act(async () => {
      result.current.track("run-5");
    });
    await flush();
    expect(get).toHaveBeenCalledWith("run-5");
    expect(result.current.run?.step).toBe("reviewing");
  });

  it("stops polling on unmount", async () => {
    const get = vi.spyOn(runsApi, "get").mockResolvedValue(makeRun());
    const { result, unmount } = setup();

    await act(async () => {
      result.current.track("run-1");
    });
    await flush();
    unmount();
    await flush(POLL_MS * 3);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
