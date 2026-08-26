import { NextResponse } from "next/server";
import { ownerSessionId } from "@/lib/session";
import { getAsset } from "@/lib/assets/repo";
import { getStorage } from "@/lib/storage";
import { requireUnlocked } from "@/lib/auth/unlock";

export const dynamic = "force-dynamic";

/** A filename someone would recognise in their downloads folder. */
function filename(asset: { id: string; mime: string; ingestedAt: Date }): string {
  const extension = asset.mime.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
  const date = asset.ingestedAt.toISOString().slice(0, 10);
  return `thunkin-${date}-${asset.id.slice(4, 12)}.${extension}`;
}

/**
 * Serves an asset's bytes.
 *
 * Going through a route rather than exposing storage URLs keeps the bucket
 * layout private and keeps access session-scoped — `PublicAsset` deliberately
 * omits `storageKey`, and this is what makes that omission meaningful rather
 * than cosmetic.
 *
 * A missing asset and someone else's asset both return 404, for the same reason
 * jobs do: a 403 would confirm the id exists.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  const locked = await requireUnlocked();
  if (locked) return locked;

  const { id } = await context.params;
  const sessionId = await ownerSessionId();

  const asset = await getAsset(id, sessionId);
  if (!asset) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const wantsPoster = params.get("poster") === "1";
  const wantsDownload = params.get("download") === "1";
  const key = wantsPoster && asset.posterKey ? asset.posterKey : asset.storageKey;

  const stored = await getStorage().get(key);
  if (!stored) {
    // The row says it exists but the bytes are gone — a real inconsistency,
    // worth a distinct status so it shows up in logs as ours, not a bad id.
    return NextResponse.json({ ok: false, reason: "missing-bytes" }, { status: 502 });
  }

  // Uint8Array is not a BodyInit under the DOM lib's typing; its buffer is.
  return new Response(stored.body.buffer as ArrayBuffer, {
    headers: {
      "Content-Type": stored.mime,
      "Content-Length": String(stored.body.byteLength),
      // Immutable: an asset's bytes never change, so a long cache is safe and
      // the session scoping above is what keeps it private.
      "Cache-Control": "private, max-age=31536000, immutable",
      // `attachment` is what makes a browser save rather than navigate, and
      // an extension is what makes the saved file openable.
      "Content-Disposition": `${wantsDownload ? "attachment" : "inline"}; filename="${filename(asset)}"`,
    },
  });
}
