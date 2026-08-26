"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isTerminal, type ApiJobWithAssets } from "@/lib/contracts";
import { getJobs } from "./api";

/**
 * The one poll loop.
 *
 * Studio and Library used to each hand-roll their own — with different
 * intervals, and one with a teardown race that scheduled a stray timer after
 * cleanup. This hook owns the pattern once: fast while something is in
 * flight (a person is watching a pending tile), slow when idle, and the
 * cancellation flag is checked *after* the awaited refresh, which is exactly
 * where the old version forgot to look.
 */

const POLL_FAST_MS = 900;
const POLL_IDLE_MS = 6_000;

export function useJobs(options: { limit?: number } = {}) {
  const limit = options.limit ?? 40;
  const [jobs, setJobs] = useState<ApiJobWithAssets[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setJobs(await getJobs({ limit }));
    } catch {
      // A dropped poll is not worth surfacing; the next one will land.
    } finally {
      setLoaded(true);
    }
  }, [limit]);

  const pendingCount = jobs.filter((job) => !isTerminal(job.status)).length;

  // Read by the loop at schedule time, so a change of pace never needs the
  // effect to tear down and restart — that churn was the source of the race.
  const pendingRef = useRef(0);
  pendingRef.current = pendingCount;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const loop = async () => {
      await refresh();
      if (cancelled) return;
      timer = setTimeout(
        () => void loop(),
        pendingRef.current > 0 ? POLL_FAST_MS : POLL_IDLE_MS,
      );
    };

    void loop();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refresh]);

  /** Optimistic prepend — a fresh submit shows before the next poll lands. */
  const addJob = useCallback((job: ApiJobWithAssets) => {
    setJobs((current) => [job, ...current.filter((j) => j.id !== job.id)]);
  }, []);

  /** Optimistic removal — a failure simply reappears on the next refresh. */
  const removeJob = useCallback((jobId: string) => {
    setJobs((current) => current.filter((job) => job.id !== jobId));
  }, []);

  return { jobs, loaded, pendingCount, refresh, addJob, removeJob };
}
