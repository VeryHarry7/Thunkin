"use client";

import { useEffect, useState } from "react";
import type { GenerationParams, ModelDescriptor } from "@/lib/contracts";
import { ratioToNumber } from "@/lib/models/registry";
import { Button, Chip, ErrorState, Field } from "@/components/ui";
import s from "./studio.module.css";

function RatioGlyph({ ratio }: { ratio: string }) {
  const n = ratioToNumber(ratio);
  const w = n >= 1 ? 20 : Math.round(20 * n);
  const h = n >= 1 ? Math.round(20 / n) : 20;
  return <span className={s.ratioGlyph} style={{ width: w, height: h }} />;
}

/**
 * The form: starters, prompt, ratio, the Advanced disclosure, and Generate.
 *
 * The prompt is controlled from above because "run it again" on a failed tile
 * repopulates it; everything else is this component's own business. Which
 * controls render at all is driven by the look's `supports` flags — the UI
 * never has model knowledge of its own.
 */
export function Composer({
  look,
  prompt,
  onPromptChange,
  onSubmit,
  submitting,
  submitError,
}: {
  look: ModelDescriptor;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onSubmit: (params: GenerationParams) => void;
  submitting: boolean;
  submitError: string | null;
}) {
  const [ratio, setRatio] = useState(look.aspectRatios[0] ?? "1:1");
  const [seed, setSeed] = useState("");
  const [negative, setNegative] = useState("");

  // Switching look may invalidate the chosen ratio — fall back to that look's default.
  useEffect(() => {
    if (!look.aspectRatios.includes(ratio)) setRatio(look.aspectRatios[0]!);
  }, [look, ratio]);

  const canSubmit = prompt.trim().length > 0 && !submitting;

  function submit() {
    if (!canSubmit) return;

    const params: GenerationParams = { prompt: prompt.trim(), aspectRatio: ratio };
    if (look.supports.seed && seed.trim() !== "" && Number.isFinite(Number(seed))) {
      params.seed = Number(seed);
    }
    if (look.supports.negativePrompt && negative.trim() !== "") {
      params.negativePrompt = negative.trim();
    }
    onSubmit(params);
  }

  return (
    <form
      className={s.composer}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className={s.starters}>
        {look.promptStarters.slice(0, 6).map((starter) => (
          <Chip key={starter} onClick={() => onPromptChange(starter)}>
            {starter.length > 42 ? `${starter.slice(0, 40)}…` : starter}
          </Chip>
        ))}
      </div>

      <Field
        id="prompt"
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            submit();
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

      {submitError && <ErrorState title="That didn't go through" body={submitError} />}
    </form>
  );
}
