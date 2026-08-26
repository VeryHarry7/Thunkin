import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { db, type Db } from "@/lib/db";
import { assets } from "@/lib/db/tables/assets";
import { env } from "@/lib/env";
import type { IngestPort } from "@/lib/ports";
import type { Job } from "@/lib/contracts";
import type { ProviderOutput } from "@/lib/provider";
import { getStorage } from "@/lib/storage";

/**
 * The asset pipeline.
 *
 * Provider URLs expire, so a result we have not copied is a result we are going
 * to lose. Everything here exists to make "it's in the library" mean the bytes
 * are ours.
 *
 * Throwing fails the job with `INGEST_FAILED` (wired in
 * `src/lib/jobs/service.ts`), which is deliberate: a result we could not keep
 * must not be shown as ready, because the link would 404 within the hour.
 */

/** Bounded so a hostile or broken response cannot exhaust memory or disk. */
const MAX_BYTES = { image: 25 * 1024 * 1024, video: 200 * 1024 * 1024 } as const;

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
]);

/** Small enough that inlining it costs less than the request it saves. */
const BLUR_WIDTH = 20;

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Resolves a provider URL to something fetchable.
 *
 * The mock returns app-relative paths (`/fixtures/...`), which are real URLs
 * only once joined to our own origin. A live provider returns absolute URLs and
 * this is a no-op.
 */
function absolute(url: string): string {
  return url.startsWith("http://") || url.startsWith("https://")
    ? url
    : new URL(url, env.PUBLIC_URL).toString();
}

async function download(
  url: string,
  kind: "image" | "video",
  fetchImpl: FetchLike,
): Promise<{ body: Uint8Array; mime: string }> {
  let response: Response;
  try {
    response = await fetchImpl(absolute(url));
  } catch {
    throw new IngestError(`Could not reach the result at ${url}`);
  }

  if (!response.ok) {
    throw new IngestError(`Result fetch returned HTTP ${response.status}`);
  }

  const mime = (response.headers.get("content-type") ?? "")
    .split(";")[0]!
    .trim()
    .toLowerCase();

  if (!ALLOWED_MIME.has(mime)) {
    throw new IngestError(
      `Refusing to ingest disallowed content type: ${mime || "none"}`,
    );
  }

  // Check the advertised length first — cheaper than downloading to find out.
  const declared = Number(response.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_BYTES[kind]) {
    throw new IngestError(`Result is larger than the ${kind} ceiling`);
  }

  const body = new Uint8Array(await response.arrayBuffer());

  // And again on the real size, since content-length can lie or be absent.
  if (body.byteLength > MAX_BYTES[kind]) {
    throw new IngestError(`Result is larger than the ${kind} ceiling`);
  }
  if (body.byteLength === 0) {
    throw new IngestError("Result was empty");
  }

  return { body, mime };
}

/**
 * A tiny blurred data URI for instant paint.
 *
 * Best-effort: a placeholder is a nicety, and failing the whole ingest because
 * one could not be produced would trade a real result for a cosmetic one.
 */
async function blurPlaceholder(body: Uint8Array): Promise<string | null> {
  try {
    const buffer = await sharp(body)
      .resize(BLUR_WIDTH, null, { fit: "inside" })
      .webp({ quality: 45 })
      .toBuffer();
    return `data:image/webp;base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

async function dimensions(
  body: Uint8Array,
  fallback: { width: number; height: number },
): Promise<{ width: number; height: number }> {
  try {
    const meta = await sharp(body).metadata();
    return meta.width && meta.height
      ? { width: meta.width, height: meta.height }
      : fallback;
  } catch {
    // Video is not readable by sharp; the provider's reported size is all we have.
    return fallback;
  }
}

export interface IngestOptions {
  fetchImpl?: FetchLike;
  client?: Db;
}

/**
 * Copies every output of a finished job into our storage and records it.
 *
 * Idempotent by construction: asset ids are derived fresh each call, but the
 * caller only reaches here once per job because the state machine absorbs a
 * repeat `PROVIDER_COMPLETED`.
 */
export async function ingestOutputs(
  job: Job,
  outputs: ProviderOutput[],
  options: IngestOptions = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const client = options.client ?? db;
  const storage = getStorage();

  if (outputs.length === 0) {
    throw new IngestError("The job completed with no outputs to ingest");
  }

  for (const output of outputs) {
    const { body, mime } = await download(output.url, job.kind, fetchImpl);

    const id = `ast_${randomUUID()}`;
    // Session-scoped prefix so a future lifecycle purge is one prefix delete.
    const storageKey = `${job.sessionId}/${job.id}/${id}`;

    await storage.put(storageKey, body, mime);

    const size = await dimensions(body, {
      width: output.width,
      height: output.height,
    });

    await client.insert(assets).values({
      id,
      jobId: job.id,
      sessionId: job.sessionId,
      kind: job.kind,
      storageKey,
      blurPlaceholder: await blurPlaceholder(body),
      mime,
      width: size.width,
      height: size.height,
      durationMs: output.durationMs ?? null,
      bytes: body.byteLength,
      checksum: createHash("sha256").update(body).digest("hex"),
      sourceUrl: output.url,
    });
  }
}

/** The port implementation wired in `src/lib/ports/index.ts`. */
export const assetIngest: IngestPort = {
  async ingest(job, outputs) {
    await ingestOutputs(job, outputs);
  },
};
