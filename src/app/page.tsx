import { env } from "@/lib/env";

/**
 * Wave 0 placeholder. AGENT-06 replaces this with the real landing surface —
 * a live wall of generated output. Until then this page exists to prove the
 * app boots and the env contract resolved.
 */
export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <div style={{ display: "grid", gap: "0.75rem", maxWidth: "42ch" }}>
        <h1 style={{ margin: 0, fontSize: "2rem", letterSpacing: "-0.03em" }}>
          Thunkin
        </h1>
        <p style={{ margin: 0, color: "#9a9aa4" }}>
          Foundation is up. The studio surface lands with AGENT-06.
        </p>
        <p
          style={{
            margin: 0,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.8125rem",
            color: "#6f9bec",
          }}
        >
          provider: {env.FAL_MODE}
        </p>
      </div>
    </main>
  );
}
