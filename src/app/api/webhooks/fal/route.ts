import { NextResponse } from "next/server";
import { parseWebhookBody, verifyFalWebhook } from "@/lib/webhooks/fal-signature";
import { handleWebhook } from "@/lib/jobs/service";

export const dynamic = "force-dynamic";

/**
 * fal's completion callback.
 *
 * Three rules this handler must not break:
 *
 * 1. **Verify before parsing.** An unverified webhook is an anonymous POST from
 *    the internet. Nothing is read from the body until the signature passes.
 * 2. **Read raw bytes.** The signature covers the exact body; re-serializing
 *    parsed JSON changes whitespace and key order and the digest stops matching.
 * 3. **Return 2xx once verified.** fal retries on non-2xx up to ~31 times, and
 *    a 500 for a job we already handled buys an hour of pointless retries.
 *    Never redirect — fal treats a redirect as permanent failure.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = new Uint8Array(await request.arrayBuffer());

  let verification;
  try {
    verification = await verifyFalWebhook({ headers: request.headers, rawBody });
  } catch (error) {
    // JWKS unreachable with an empty cache — the one path that used to throw
    // straight out of the handler. 503 tells fal to retry a transient outage.
    console.warn(
      "[webhook] verification unavailable:",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  if (!verification.ok) {
    // 401 rather than 400: this is an authentication failure, and fal should
    // not retry a delivery we will never accept. The reason stays server-side —
    // this route is reachable without a cookie, and detailed rejections would
    // hand an unauthenticated prober a diagnostic oracle (clock skew, JWKS
    // health) one warn line at a time.
    console.warn("[webhook] rejected:", verification.reason);
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const payload = parseWebhookBody(rawBody);
  if (!payload) {
    // Verified but unreadable. Acknowledge — retrying will not fix a malformed
    // body, and we have already recorded that fal reached us.
    return NextResponse.json({ ok: true, ignored: "unparseable" });
  }

  try {
    const job = await handleWebhook(payload.request_id);

    // An unknown request id is acknowledged, not retried: it usually means the
    // job was deleted, or the delivery belongs to another deployment.
    if (!job) return NextResponse.json({ ok: true, ignored: "unknown-request" });

    return NextResponse.json({ ok: true, status: job.status });
  } catch {
    /*
     * Something genuinely broke on our side. This is the one case worth a 500,
     * because fal's retry is then a real second chance — and the sweeper will
     * pick the job up regardless.
     */
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
