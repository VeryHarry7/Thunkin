"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ApiJobWithAssets, ApiResult, ModelDescriptor } from "@/lib/contracts";
import { isTerminal } from "@/lib/contracts";
import { ratioToNumber } from "@/lib/models/registry";
import { Button, Chip, ErrorState, Field, MediaTile } from "@/components/ui";
import s from "./studio.module.css";

/**
 * The create surface.
 *
 * Progress comes from polling `GET /api/jobs` — no push channel, on
 * purpose: on a LAN with one user the difference is imperceptible. That read
 * triggers the server's piggyback sweep, so polling is what actually advances
 * jobs today rather than merely observing them.
 */

/** Copy for every failure the taxonomy can produce, and its one way out. */
const RECOVERY: Record<string, { title: string; body: string; action: string }> = {
  INVALID_KEY: {
    title: "fal refused the API key",
    body: "The key this server runs on was rejected. Check FAL_KEY in the environment and restart.",
    action: "Run it again",
  },
  INSUFFICIENT_CREDIT: {
    title: "Out of credit",
    body: "The fal account behind this server ran out of credit. Top it up and run this again.",
    action: "Run it again",
  },
  RATE_LIMITED: {
    title: "Too many at once",
    body: "The model is rate-limiting us. Waiting a few seconds is usually enough.",
    action: "Run it again",
  },
  CONTENT_REJECTED: {
    title: "The model declined this prompt",
    body: "Try describing the same idea differently — often a single word is the sticking point.",
    action: "Edit the prompt",
  },
  MODEL_ERROR: {
    title: "The model failed",
    body: "Nothing was charged for this. Running it again usually works; a different look always does.",
    action: "Run it again",
  },
  TIMEOUT: {
    title: "This took too long",
    body: "We stopped waiting after the ceiling for this kind of generation.",
    action: "Run it again",
  },
  NETWORK: {
    title: "Couldn't reach the model",
    body: "A connection problem on the way out. Your prompt is still here.",
    action: "Run it again",
  },
  INGEST_FAILED: {
    title: "The result got away",
    body: "The model finished, but we couldn't save the file before its link expired.",
    action: "Run it again",
  },
};

const POLL_MIN_MS = 900;
const POLL_MAX_MS = 6_000;

/** `ApiJob` timestamps are ISO strings — the wire truth, not an optimistic Date. */
function elapsedLabel(from: string): string {
  const started = new Date(from).getTime();
  const seconds = Math.max(0, Math.round((Date.now() - started) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function RatioGlyph({ ratio }: { ratio: string }) {
  const n = ratioToNumber(ratio);
  const w = n >= 1 ? 20 : Math.round(20 * n);
  const h = n >= 1 ? Math.round(20 / n) : 20;
  return <span className={s.ratioGlyph} style={{ width: w, height: h }} />;
}

export function Studio({ looks }: { looks: ModelDescriptor[] }) {
  const [lookId, setLookId] = useState(looks[0]?.lookId ?? "");
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState(looks[0]?.aspectRatios[0] ?? "1:1");
  const [seed, setSeed] = useState("");
  const [negative, setNegative] = useState("");
  const [jobs, setJobs] = useState<ApiJobWithAssets[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Re-renders pending tiles once a second so the elapsed timer actually ticks.
  const [, setTick] = useState(0);

  const look = useMemo(
    () => looks.find((entry) => entry.lookId === lookId) ?? looks[0]!,
    [looks, lookId],
  );

  const pendingCount = jobs.filter((job) => !isTerminal(job.status)).length;
  const pollRef = useRef(POLL_MIN_MS);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/jobs?limit=40");
      const body = (await response.json()) as ApiResult<ApiJobWithAssets[]>;
      if (body.ok) setJobs(body.data);
    } catch {
      // A dropped poll is not worth surfacing; the next one will land.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /*
   * Poll fast while something is in flight, and back off to a slow heartbeat
   * when nothing is. A fixed fast interval would hammer the server for every
   * idle tab; a fixed slow one would make a finished image feel late.
   */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const loop = async () => {
      if (cancelled) return;
      await refresh();
      pollRef.current = pendingCount > 0 ? POLL_MIN_MS : POLL_MAX_MS;
      timer = setTimeout(loop, pollRef.current);
    };

    timer = setTimeout(loop, pendingCount > 0 ? POLL_MIN_MS : POLL_MAX_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pendingCount, refresh]);

  useEffect(() => {
    if (pendingCount === 0) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [pendingCount]);

  // Switching look may invalidate the chosen ratio — fall back to that look's own default.
  useEffect(() => {
    if (!look.aspectRatios.includes(ratio)) setRatio(look.aspectRatios[0]!);
  }, [look, ratio]);

  const canSubmit = prompt.trim().length > 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);

    const params: Record<string, unknown> = {
      prompt: prompt.trim(),
      aspectRatio: ratio,
    };
    if (look.supports.seed && seed.trim() !== "" && Number.isFinite(Number(seed))) {
      params.seed = Number(seed);
    }
    if (look.supports.negativePrompt && negative.trim() !== "") {
      params.negativePrompt = negative.trim();
    }

    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lookId: look.lookId,
          params,
          idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        }),
      });

      const body = (await response.json()) as ApiResult<ApiJobWithAssets>;

      if (!body.ok) {
        setSubmitError(body.error.message);
        return;
      }

      // Show it immediately rather than waiting for the next poll.
      setJobs((current) => [body.data, ...current]);
    } catch {
      setSubmitError("Couldn't reach the server. Your prompt is still here.");
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

      <div className={s.looks} role="radiogroup" aria-label="Look">
        {looks.map((entry) => (
          <button
            key={entry.lookId}
            type="button"
            role="radio"
            aria-checked={entry.lookId === lookId}
            className={`${s.look} ${entry.lookId === lookId ? s.lookOn : ""}`}
            onClick={() => setLookId(entry.lookId)}
          >
            <span className={s.lookArt}>
              {/* eslint-disable-next-line @next/next/no-img-element -- committed sample, fixed size */}
              <img src={entry.sampleAssetKey} alt="" />
              <span className={s.lookKind}>{entry.kind}</span>
            </span>
            <span className={s.lookName}>{entry.look}</span>
            <span className={s.lookMeta}>
              ~{entry.estSeconds}s · ${entry.estCostUsd.toFixed(3)}
            </span>
          </button>
        ))}
      </div>

      <main className={s.results}>
        {jobs.length === 0 && (
          <div className={s.empty}>
            <div>
              <p className={s.emptyTitle}>Nothing here yet</p>
              <p>Pick a look, describe something, and press Generate.</p>
            </div>
          </div>
        )}

        {jobs.map((job) => {
          const asset = job.assets[0];
          const ratioNumber = ratioToNumber(job.params.aspectRatio ?? "1:1");

          if (job.status === "failed" || job.status === "expired") {
            const recovery = RECOVERY[job.errorCode ?? "MODEL_ERROR"]!;
            return (
              <div className={s.failed} key={job.id}>
                <ErrorState
                  title={recovery.title}
                  body={job.errorMessage ?? recovery.body}
                  action={{
                    label: recovery.action,
                    onClick: () => {
                      setPrompt(job.params.prompt);
                      setLookId(job.lookId);
                    },
                  }}
                />
              </div>
            );
          }

          const pending = !isTerminal(job.status);

          return (
            <div className={s.card} key={job.id}>
              <MediaTile
                pending={pending || !asset}
                src={asset?.url ?? null}
                blur={asset?.blurPlaceholder ?? null}
                kind={job.kind}
                ratio={ratioNumber}
                alt={job.params.prompt}
                overlay={
                  pending ? (
                    <div className={s.pending}>
                      <span className={s.pendingState}>
                        {job.status === "queued"
                          ? job.queuePosition
                            ? `Queued · ${job.queuePosition}`
                            : "Queued"
                          : job.status === "running"
                            ? "Generating"
                            : "Finishing"}
                      </span>
                      <span className={`${s.elapsed} tabular`}>
                        {elapsedLabel(job.submittedAt ?? job.createdAt)}
                      </span>
                    </div>
                  ) : (
                    <div className={s.caption}>{job.params.prompt}</div>
                  )
                }
              />
            </div>
          );
        })}
      </main>

      <form
        className={s.composer}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className={s.starters}>
          {look.promptStarters.slice(0, 6).map((starter) => (
            <Chip key={starter} onClick={() => setPrompt(starter)}>
              {starter.length > 42 ? `${starter.slice(0, 40)}…` : starter}
            </Chip>
          ))}
        </div>

        <Field
          id="prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={`Describe something for ${look.look.toLowerCase()}…`}
          rows={2}
          aria-label="Prompt"
        />

        <div className={s.row}>
          <div className={s.ratios} role="radiogroup" aria-label="Aspect ratio">
            {look.aspectRatios.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={option === ratio}
                aria-label={option}
                title={option}
                className={`${s.ratio} ${option === ratio ? s.ratioOn : ""}`}
                onClick={() => setRatio(option)}
              >
                <RatioGlyph ratio={option} />
              </button>
            ))}
          </div>

          <span className={s.grow} />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            {...(prompt.trim().length === 0 && !submitting
              ? { disabledReason: "Describe something first" }
              : {})}
          >
            Generate
          </Button>
        </div>

        <details className={s.advanced}>
          <summary className={s.advancedSummary}>Advanced</summary>
          <div className={s.advancedBody}>
            {look.supports.seed && (
              <Field
                id="seed"
                value={seed}
                onChange={(event) => setSeed(event.target.value)}
                placeholder="Seed — leave blank for a new one"
                rows={1}
                label="Seed"
              />
            )}
            {look.supports.negativePrompt && (
              <Field
                id="negative"
                value={negative}
                onChange={(event) => setNegative(event.target.value)}
                placeholder="What to avoid"
                rows={1}
                label="Negative prompt"
              />
            )}
            <p className={s.endpoint}>{look.endpoint}</p>
          </div>
        </details>

        {submitError && (
          <ErrorState
            title="That didn't go through"
            body={submitError}
            action={{ label: "Try again", onClick: () => void submit() }}
          />
        )}
      </form>
    </div>
  );
}
