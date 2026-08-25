import Link from "next/link";
import { LOOK_LIST } from "@/lib/models/registry";
import s from "./home.module.css";

export const metadata = {
  title: "Thunkin — AI photo and video",
  description: "Pick a look, type a line, tap once. Watch it arrive.",
};

/**
 * The landing page.
 *
 * The hero is the output. One line of type, one way in, and no value
 * proposition to read — if the pictures do not convince, prose will not.
 *
 * The wall currently shows registry samples; once a session has real
 * generations, AGENT-08's showcase replaces them.
 */
export default function HomePage() {
  // Doubled so the grid fills at every breakpoint without a gap at the edge.
  const wall = [...LOOK_LIST, ...LOOK_LIST];

  return (
    <main className={s.page}>
      <div className={s.wall} aria-hidden="true">
        {wall.map((look, index) => (
          <div
            key={`${look.lookId}-${index}`}
            className={`${s.wallItem} ${index % 2 === 0 ? s.drift : s.driftSlow}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- committed sample, decorative */}
            <img src={look.sampleAssetKey} alt="" />
          </div>
        ))}
      </div>

      <div className={s.veil} aria-hidden="true" />

      <div className={s.content}>
        <span className={s.wordmark}>Thunkin</span>
        <h1 className={s.title}>Press the shutter.</h1>
        <p className={s.sub}>
          Pick a look, type a line, tap once. Images and video from the models worth
          using.
        </p>
        <Link className={s.cta} href="/studio">
          Open the studio
        </Link>
        <p className={s.footnote}>
          Runs on your own fal key. Nothing is stored on our account.
        </p>
      </div>
    </main>
  );
}
