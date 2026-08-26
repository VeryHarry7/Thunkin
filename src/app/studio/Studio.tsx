"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { GenerationParams, ModelDescriptor } from "@/lib/contracts";
import { ApiCallError, submitJob } from "@/lib/client/api";
import { useJobs } from "@/lib/client/useJobs";
import { JobTile } from "@/components/JobTile";
import { LookPicker } from "./LookPicker";
import { Composer } from "./Composer";
import s from "./studio.module.css";

/**
 * The create surface: pick a look, describe something, watch it arrive.
 *
 * Progress comes from polling `GET /api/jobs` — no push channel, on purpose:
 * on a LAN with one user the difference is imperceptible. That read triggers
 * the server's piggyback sweep, so polling is what actually advances jobs
 * rather than merely observing them. The poll loop itself lives in
 * `useJobs`; the per-job card in `JobTile`; the form in `Composer` — this
 * component is just the composition and the submit.
 */
export function Studio({ looks }: { looks: ModelDescriptor[] }) {
  const [lookId, setLookId] = useState(looks[0]?.lookId ?? "");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { jobs, pendingCount, addJob } = useJobs({ limit: 40 });

  const look = useMemo(
    () => looks.find((entry) => entry.lookId === lookId) ?? looks[0]!,
    [looks, lookId],
  );

  async function submit(params: GenerationParams) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const job = await submitJob({
        lookId: look.lookId,
        params,
        idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      // Show it immediately rather than waiting for the next poll.
      addJob(job);
    } catch (error) {
      setSubmitError(
        error instanceof ApiCallError
          ? error.message
          : "Couldn't reach the server. Your prompt is still here.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={s.shell}>
      <header className={s.bar}>
        <span className={s.wordmark}>Thunkin</span>
        <Link className={s.barLink} href="/library">
          Library
        </Link>
        <span className={s.barMeta}>
          {pendingCount > 0 ? `${pendingCount} in flight` : `${jobs.length} saved`}
        </span>
      </header>

      <LookPicker looks={looks} lookId={look.lookId} onPick={setLookId} />

      <main className={s.results}>
        {jobs.length === 0 && (
          <div className={s.empty}>
            <div>
              <p className={s.emptyTitle}>Nothing here yet</p>
              <p>Pick a look, describe something, and press Generate.</p>
            </div>
          </div>
        )}

        {jobs.map((job) => (
          <JobTile
            key={job.id}
            job={job}
            className={
              job.status === "failed" || job.status === "expired" ? s.failed : s.card
            }
            onRetry={(failed) => {
              setPrompt(failed.params.prompt);
              setLookId(failed.lookId);
            }}
          />
        ))}
      </main>

      <Composer
        look={look}
        prompt={prompt}
        onPromptChange={setPrompt}
        onSubmit={(params) => void submit(params)}
        submitting={submitting}
        submitError={submitError}
      />
    </div>
  );
}
