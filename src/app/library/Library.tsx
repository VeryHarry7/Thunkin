"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ApiResult, JobWithAssets } from "@/lib/contracts";
import { isTerminal } from "@/lib/contracts";
import { ratioToNumber } from "@/lib/models/registry";
import { MediaTile } from "@/components/ui";
import s from "./library.module.css";

/**
 * Everything ever made, newest first.
 *
 * Not scoped to this browser: the server treats an unlocked caller as the
 * owner, so a generation started on a phone shows up on a laptop and the other
 * way round.
 */
export function Library() {
  const [jobs, setJobs] = useState<JobWithAssets[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/jobs?limit=100");
      const body = (await response.json()) as ApiResult<JobWithAssets[]>;
      if (body.ok) setJobs(body.data);
    } catch {
      // A dropped poll is not worth surfacing; the next one lands.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Anything still running keeps the page live; an idle library sits quiet.
  const pending = jobs.filter((job) => !isTerminal(job.status)).length;

  useEffect(() => {
    if (pending === 0) return;
    const timer = setInterval(() => void refresh(), 1500);
    return () => clearInterval(timer);
  }, [pending, refresh]);

  async function remove(jobId: string) {
    // Optimistic: the row is gone from view immediately, and a failure simply
    // restores it on the next refresh rather than blocking on a spinner.
    setJobs((current) => current.filter((job) => job.id !== jobId));
    await fetch(`/api/jobs/${jobId}`, { method: "DELETE" }).catch(() => {});
    void refresh();
  }

  const withAssets = jobs.filter(
    (job) => job.assets.length > 0 || !isTerminal(job.status),
  );

  return (
    <div className={s.shell}>
      <header className={s.bar}>
        <nav className={s.nav}>
          <span className={s.wordmark}>Thunkin</span>
          <Link className={s.link} href="/studio">
            Studio
          </Link>
          <span className={`${s.link} ${s.linkOn}`}>Library</span>
        </nav>
        <span className={s.count}>
          {pending > 0 ? `${pending} in flight` : `${withAssets.length} saved`}
        </span>
      </header>

      <main className={s.grid}>
        {loaded && withAssets.length === 0 && (
          <div className={s.empty}>
            <p className={s.emptyTitle}>Nothing saved yet</p>
            <Link className={s.link} href="/studio">
              Make something →
            </Link>
          </div>
        )}

        {withAssets.map((job) => {
          const asset = job.assets[0];
          const ratio = ratioToNumber(job.params.aspectRatio ?? "1:1");
          const settled = isTerminal(job.status);

          return (
            <div className={s.card} key={job.id}>
              <MediaTile
                pending={!settled || !asset}
                src={asset?.url ?? null}
                blur={asset?.blurPlaceholder ?? null}
                kind={job.kind}
                ratio={ratio}
                alt={job.params.prompt}
                overlay={
                  asset ? (
                    <div className={s.actions}>
                      <a
                        className={s.action}
                        href={`${asset.url}?download=1`}
                        title="Download"
                        aria-label={`Download: ${job.params.prompt}`}
                      >
                        ↓
                      </a>
                      <a
                        className={s.action}
                        href={asset.url}
                        target="_blank"
                        rel="noreferrer"
                        title="Open full size"
                        aria-label={`Open full size: ${job.params.prompt}`}
                      >
                        ⤢
                      </a>
                      <span className={s.spacer} />
                      <button
                        type="button"
                        className={`${s.action} ${s.danger}`}
                        title="Delete"
                        aria-label={`Delete: ${job.params.prompt}`}
                        onClick={() => void remove(job.id)}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className={s.pending}>
                      {job.status === "queued" ? "Queued" : "Generating"}
                    </div>
                  )
                }
              />
            </div>
          );
        })}
      </main>
    </div>
  );
}
