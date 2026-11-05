"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api/errors";
import { runsApi } from "@/lib/api/runs";
import type { Run, RunType, Slot } from "@/types";

const POLL_INTERVAL_MS = 1500;

export interface ActiveRun {
  /** The running run, or null. */
  run: Run | null;
  /** Follow a run started elsewhere (e.g. `run_started` from the chat). */
  track(runId: string): void;
  startRun(type: RunType, slot: Slot): Promise<void>;
  /** Clears the failed run and a start error. */
  dismissFailure(): void;
  /** The last run that failed; kept until dismissed or retried. */
  failed: Run | null;
  /** Message of a rejected start (other than `run_active`), or null. */
  startError: string | null;
}

/**
 * Tracks the project's background run: resumes an active run after a reload,
 * polls it every 1500 ms, calls `onFinished` once on success and keeps a
 * failed run until the user dismisses or retries it.
 */
export function useActiveRun(projectId: string, onFinished: (run: Run) => void): ActiveRun {
  const [run, setRun] = useState<Run | null>(null);
  const [failed, setFailed] = useState<Run | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [trackedId, setTrackedId] = useState<string | null>(null);

  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  const trackedRef = useRef<string | null>(null);
  const track = useCallback((runId: string) => {
    trackedRef.current = runId;
    setFailed(null);
    setStartError(null);
    setTrackedId(runId);
  }, []);

  // Resume an active run after a reload.
  useEffect(() => {
    let cancelled = false;
    runsApi
      .active(projectId)
      .then((active) => {
        if (cancelled || active === null || trackedRef.current !== null) return;
        setRun(active);
        track(active.id);
      })
      .catch(() => {
        // No active run known; nothing to resume.
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, track]);

  // Poll the tracked run until it is no longer running.
  useEffect(() => {
    if (trackedId === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      trackedRef.current = null;
      setTrackedId(null);
    };

    const tick = async (): Promise<void> => {
      try {
        const next = await runsApi.get(trackedId);
        if (cancelled) return;
        if (next.state === "running") {
          setRun(next);
          timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
        } else if (next.state === "succeeded") {
          setRun(null);
          finish();
          onFinishedRef.current(next);
        } else {
          setRun(null);
          setFailed(next);
          finish();
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setRun(null);
          finish();
          return;
        }
        // Transient error: keep polling.
        timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [trackedId]);

  const startRun = useCallback(
    async (type: RunType, slot: Slot): Promise<void> => {
      setFailed(null);
      setStartError(null);
      try {
        const started = await runsApi.start(projectId, { type, slot });
        setRun(started);
        track(started.id);
      } catch (err) {
        if (err instanceof ApiError && err.code === "run_active") {
          // Another run is already going: follow it instead of reporting an error.
          const active = await runsApi.active(projectId);
          if (active !== null) {
            setRun(active);
            track(active.id);
          }
          return;
        }
        setStartError(err instanceof Error ? err.message : "Could not start the run.");
      }
    },
    [projectId, track],
  );

  const dismissFailure = useCallback(() => {
    setFailed(null);
    setStartError(null);
  }, []);

  return { run, track, startRun, dismissFailure, failed, startError };
}
