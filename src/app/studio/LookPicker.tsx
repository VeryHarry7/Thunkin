"use client";

import type { ModelDescriptor } from "@/lib/contracts";
import s from "./studio.module.css";

/** The horizontal rail of looks. A radiogroup, because it is one. */
export function LookPicker({
  looks,
  lookId,
  onPick,
}: {
  looks: ModelDescriptor[];
  lookId: string;
  onPick: (lookId: string) => void;
}) {
  return (
    <div className={s.looks} role="radiogroup" aria-label="Look">
      {looks.map((entry) => (
        <button
          key={entry.lookId}
          type="button"
          role="radio"
          aria-checked={entry.lookId === lookId}
          className={`${s.look} ${entry.lookId === lookId ? s.lookOn : ""}`}
          onClick={() => onPick(entry.lookId)}
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
  );
}
