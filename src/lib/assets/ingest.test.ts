import { describe, it, expect, beforeEach, afterEach } from "vitest";
import sharp from "sharp";
import { IngestError, ingestOutputs, type FetchLike } from "./ingest";
import { resetStorage, setStorageForTesting, type StoragePort } from "@/lib/storage";
import type { Job } from "@/lib/contracts";
import type { ProviderOutput } from "@/lib/provider";

/**
 * Ingest is the difference between "the job says ready" and "the bytes are
 * ours". These cases are about refusing to record the first without the second.
 */

/** An in-memory storage backend, so tests touch no disk. */
function memoryStorage() {
  const files = new Map<string, { body: Uint8Array; mime: string }>();
  const port: StoragePort = {
    name: "local",
    async put(key, body, mime) {
      files.set(key, { body, mime });
    },
    async get(key) {
      return files.get(key) ?? null;
    },
    async delete(key) {
      files.delete(key);
    },
  };
  return { port, files };
}

/** Records what would have been inserted, without a database. */
function fakeDb() {
  const rows: Record<string, unknown>[] = [];
  const client = {
    insert() {
      return {
        async values(row: Record<string, unknown>) {
          rows.push(row);
        },
      };
    },
  } as any;
  return { client, rows };
}

async function pngBytes(width = 64, height = 64): Promise<Uint8Array> {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 30, g: 40, b: 70 },
    },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

function respondWith(
  body: Uint8Array,
  mime = "image/png",
  extraHeaders: Record<string, string> = {},
): FetchLike {
  return async () =>
    new Response(body.buffer as ArrayBuffer, {
      status: 200,
      headers: { "Content-Type": mime, ...extraHeaders },
    });
}

const JOB = {
  id: "job_1",
  sessionId: "sess_1",
  kind: "image",
} as unknown as Job;

const OUTPUT: ProviderOutput = {
  url: "https://provider.example/result.png",
  mime: "image/png",
  width: 64,
  height: 64,
};

let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  storage = memoryStorage();
  setStorageForTesting(storage.port);
});

afterEach(() => {
  resetStorage();
});

describe("the happy path", () => {
  it("stores the bytes and records a row", async () => {
    const bytes = await pngBytes();
    const { client, rows } = fakeDb();

    await ingestOutputs(JOB, [OUTPUT], {
      fetchImpl: respondWith(bytes),
      client,
    });

    expect(storage.files.size).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      jobId: "job_1",
      sessionId: "sess_1",
      mime: "image/png",
      bytes: bytes.byteLength,
    });
  });

  it("keys storage by session and job, so a purge is one prefix", async () => {
    const { client } = fakeDb();
    await ingestOutputs(JOB, [OUTPUT], {
      fetchImpl: respondWith(await pngBytes()),
      client,
    });

    const [key] = [...storage.files.keys()];
    expect(key).toMatch(/^sess_1\/job_1\/ast_/);
  });

  it("reads real dimensions rather than trusting the provider", async () => {
    // Providers report the size they intended, which is not always what arrived.
    const { client, rows } = fakeDb();
    await ingestOutputs(JOB, [{ ...OUTPUT, width: 9999, height: 1 }], {
      fetchImpl: respondWith(await pngBytes(120, 80)),
      client,
    });

    expect(rows[0]).toMatchObject({ width: 120, height: 80 });
  });

  it("produces a blur placeholder small enough to inline", async () => {
    const { client, rows } = fakeDb();
    await ingestOutputs(JOB, [OUTPUT], {
      fetchImpl: respondWith(await pngBytes(512, 512)),
      client,
    });

    const blur = rows[0]!.blurPlaceholder as string;
    expect(blur).toMatch(/^data:image\/webp;base64,/);
    expect(blur.length).toBeLessThan(2000);
  });

  it("records a checksum so a truncated ingest is detectable", async () => {
    const { client, rows } = fakeDb();
    await ingestOutputs(JOB, [OUTPUT], {
      fetchImpl: respondWith(await pngBytes()),
      client,
    });

    expect(rows[0]!.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ingests every output of a multi-image result", async () => {
    const { client, rows } = fakeDb();
    await ingestOutputs(JOB, [OUTPUT, { ...OUTPUT, url: "https://x/2.png" }], {
      fetchImpl: respondWith(await pngBytes()),
      client,
    });

    expect(rows).toHaveLength(2);
    expect(storage.files.size).toBe(2);
  });
});

describe("refusals", () => {
  it("rejects a disallowed content type", async () => {
    const { client } = fakeDb();
    await expect(
      ingestOutputs(JOB, [OUTPUT], {
        fetchImpl: respondWith(await pngBytes(), "text/html"),
        client,
      }),
    ).rejects.toThrow(IngestError);

    expect(storage.files.size).toBe(0);
  });

  it("rejects a result over the size ceiling", async () => {
    const { client } = fakeDb();
    const oversize = new Uint8Array(26 * 1024 * 1024);

    await expect(
      ingestOutputs(JOB, [OUTPUT], {
        fetchImpl: respondWith(oversize, "image/png"),
        client,
      }),
    ).rejects.toThrow(/larger than/);
  });

  it("rejects on a declared length over the ceiling, before downloading", async () => {
    const { client } = fakeDb();
    let downloaded = false;

    const fetchImpl: FetchLike = async () => {
      downloaded = true;
      return new Response(new Uint8Array(10).buffer as ArrayBuffer, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(999 * 1024 * 1024),
        },
      });
    };

    await expect(ingestOutputs(JOB, [OUTPUT], { fetchImpl, client })).rejects.toThrow(
      /larger than/,
    );
    expect(downloaded).toBe(true); // headers arrived, body was never read
    expect(storage.files.size).toBe(0);
  });

  it("rejects an empty body", async () => {
    const { client } = fakeDb();
    await expect(
      ingestOutputs(JOB, [OUTPUT], {
        fetchImpl: respondWith(new Uint8Array(0)),
        client,
      }),
    ).rejects.toThrow(/empty/);
  });

  it("rejects a non-200 response", async () => {
    const { client } = fakeDb();
    const fetchImpl: FetchLike = async () => new Response("", { status: 404 });

    await expect(ingestOutputs(JOB, [OUTPUT], { fetchImpl, client })).rejects.toThrow(
      /404/,
    );
  });

  it("rejects a transport failure", async () => {
    const { client } = fakeDb();
    const fetchImpl: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };

    await expect(ingestOutputs(JOB, [OUTPUT], { fetchImpl, client })).rejects.toThrow(
      IngestError,
    );
  });

  it("refuses a completed job that produced nothing", async () => {
    // Recording ready with no asset is exactly the failure this pipeline exists
    // to prevent — the library would show an entry that renders nothing.
    const { client } = fakeDb();
    await expect(ingestOutputs(JOB, [], { client })).rejects.toThrow(IngestError);
  });
});

describe("video handling", () => {
  it("keeps the provider's dimensions and duration when sharp cannot read it", async () => {
    const { client, rows } = fakeDb();
    const notAnImage = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);

    await ingestOutputs(
      { ...JOB, kind: "video" } as Job,
      [
        {
          url: "https://provider.example/clip.mp4",
          mime: "video/mp4",
          width: 1280,
          height: 720,
          durationMs: 5000,
        },
      ],
      { fetchImpl: respondWith(notAnImage, "video/mp4"), client },
    );

    expect(rows[0]).toMatchObject({
      width: 1280,
      height: 720,
      durationMs: 5000,
      mime: "video/mp4",
    });
  });
});
