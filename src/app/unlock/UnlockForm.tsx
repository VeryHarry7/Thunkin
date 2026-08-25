"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui";
import s from "./unlock.module.css";

/**
 * The gate.
 *
 * Deliberately plain: one field, one button. It is the first thing seen on a
 * phone, and anything clever here is friction on the way to the actual product.
 */
export function UnlockForm() {
  const params = useSearchParams();
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (passphrase.length === 0 || busy) return;

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });

      if (response.ok) {
        // A full navigation rather than a client push: the cookie was just set
        // and every subsequent request needs to carry it through middleware.
        window.location.href = params.get("next") || "/studio";
        return;
      }

      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "That didn't work.");
      setPassphrase("");
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={s.page}>
      <div className={s.card}>
        <span className={s.wordmark}>Thunkin</span>
        <h1 className={s.title}>Locked</h1>

        <form className={s.form} onSubmit={submit}>
          <input
            className={s.input}
            type="password"
            autoComplete="current-password"
            // The whole point of this screen is to type here.
            autoFocus
            placeholder="Passphrase"
            aria-label="Passphrase"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={busy}
            {...(passphrase.length === 0 && !busy
              ? { disabledReason: "Enter the passphrase" }
              : {})}
          >
            Unlock
          </Button>

          <p className={s.error} role="alert">
            {error}
          </p>
        </form>

        <p className={s.note}>
          A private service. Generations run on one shared API key, so this passphrase
          is the only thing standing between the internet and your bill.
        </p>
      </div>
    </main>
  );
}
