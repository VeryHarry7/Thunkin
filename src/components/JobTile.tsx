"use client";

import { useEffect, useState } from "react";
import type { ApiJobWithAssets } from "@/lib/contracts";
import { isTerminal } from "@/lib/contracts";
import { ratioToNumber } from "@/lib/models/registry";
import { RECOVERY } from "@/lib/jobs/recovery";
import { ErrorState, MediaTile } from "@/components/ui";
import s from "./jobtile.module.css";

/**
 * One job as a card: pending with an honest elapsed timer, failed with its
 * recovery copy, or ready with the media. Studio and Library used to each
 * carry their own copy of this shape; every future surface that shows a job
 * gets it from here instead.
 */

/** `ApiJob` timestamps are ISO strings — the wire truth. */
function elapsedLabel(from: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(from).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Ticks once a second only while something is worth timing. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

interface JobTileProps {
  job: ApiJobWithAssets;
  /** Rendered on failure — "run it again" repopulating the composer. */
  onRetry?: (job: ApiJobWithAssets) => void;
  /** When present, a ready tile gets download / open / delete actions. */
  onDelete?: (job: ApiJobWithAssets) => void;
  className?: string;
}

export function JobTile({ job, onRetry, onDelete, className }: JobTileProps) {
  const asset = job.assets[0];
  const pending = !isTerminal(job.status) || (job.status === "ready" && !asset);
  const now = useNow(pending);

  if (job.status === "failed" || job.status === "expired") {
    const recovery = RECOVERY[job.errorCode ?? "MODEL_ERROR"];
    return (
      <div className={className}>
        <ErrorState
          title={recovery.title}
          body={job.errorMessage ?? recovery.body}
          {...(onRetry
            ? { action: { label: recovery.action, onClick: () => onRetry(job) } }
            : {})}
        />
      </div>
    );
  }

  const stateLabel =
    job.status === "queued"
      ? job.queuePosition
        ? `Queued · ${job.queuePosition}`
        : "Queued"
      : job.status === "running"
        ? "Generating"
        : "Finishing";

  return (
    <div className={`${s.card} ${className ?? ""}`}>
      <MediaTile
        pending={pending}
        src={asset?.url ?? null}
        blur={asset?.blurPlaceholder ?? null}
        kind={job.kind}
        ratio={ratioToNumber(job.params.aspectRatio ?? "1:1")}
        alt={job.params.prompt}
        overlay={
          pending ? (
            <div className={s.pending}>
              <span className={s.pendingState}>{stateLabel}</span>
              <span className={`${s.elapsed} tabular`}>
                {elapsedLabel(job.submittedAt ?? job.createdAt, now)}
              </span>
            </div>
          ) : onDelete && asset ? (
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
                onClick={() => onDelete(job)}
              >
                ✕
              </button>
            </div>
          ) : (
            <div className={s.caption}>{job.params.prompt}</div>
          )
        }
      />
    </div>
  );
}
