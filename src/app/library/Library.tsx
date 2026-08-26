"use client";

import Link from "next/link";
import { isTerminal } from "@/lib/contracts";
import { deleteJob } from "@/lib/client/api";
import { useJobs } from "@/lib/client/useJobs";
import { JobTile } from "@/components/JobTile";
import s from "./library.module.css";

/**
 * Everything ever made, newest first.
 *
 * Not scoped to this browser: the server treats an unlocked caller as the
 * owner, so a generation started on a phone shows up on a laptop and the
 * other way round.
 */
export function Library() {
  const { jobs, loaded, pendingCount, refresh, removeJob } = useJobs({ limit: 100 });

  async function remove(jobId: string, prompt: string) {
    // Deleting removes the bytes, not just the row, and there is no second
    // copy anywhere. On a phone this button is a thumb's width from the one
    // that opens the image, so a confirmation earns its interruption.
    if (!window.confirm(`Delete "${prompt}"? This cannot be undone.`)) return;

    // Optimistic past that point: the tile goes immediately, and a failure
    // simply restores it on the next refresh rather than blocking on a spinner.
    removeJob(jobId);
    await deleteJob(jobId).catch(() => {});
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
          {pendingCount > 0
            ? `${pendingCount} in flight`
            : `${withAssets.length} saved`}
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

        {withAssets.map((job) => (
          <JobTile
            key={job.id}
            job={job}
            className={s.card}
            onDelete={(target) => void remove(target.id, target.params.prompt)}
          />
        ))}
      </main>
    </div>
  );
}
