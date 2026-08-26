import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isExempt, middleware } from "./middleware";
import { mintUnlockValue } from "@/lib/auth/unlock-cookie";

/**
 * The middleware IS the access boundary, and `isExempt` is its whole surface.
 * A table nobody tests is a table nobody notices growing a hole.
 */

const SECRET = "test-session-secret-not-for-any-real-deployment";
const PASSPHRASE = "test-passphrase";

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ["SESSION_SECRET", "APP_PASSPHRASE", "PUBLIC_URL"]) {
    saved[key] = process.env[key];
  }
  process.env.SESSION_SECRET = SECRET;
  process.env.APP_PASSPHRASE = PASSPHRASE;
  process.env.PUBLIC_URL = "http://192.168.1.20:3000";
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function request(path: string, options: { cookie?: string; host?: string } = {}) {
  const headers = new Headers({ host: options.host ?? "192.168.1.20:3000" });
  if (options.cookie) headers.set("cookie", `thunkin_unlocked=${options.cookie}`);
  return new NextRequest(`http://192.168.1.20:3000${path}`, { headers });
}

describe("isExempt", () => {
  it("exempts exactly the self-authenticating and public paths", () => {
    for (const open of [
      "/api/webhooks/fal",
      "/api/internal/sweep",
      "/unlock",
      "/api/unlock",
      "/looks/quick-sketch.png",
      "/fixtures/mock-image.png",
      "/favicon.ico",
      "/manifest.webmanifest",
    ]) {
      expect(isExempt(open), open).toBe(true);
    }
  });

  it("keeps everything else closed", () => {
    for (const closed of [
      "/",
      "/studio",
      "/library",
      "/api/jobs",
      "/api/jobs/job_1",
      "/api/assets/ast_1",
      "/api/webhooks/fal/extra",
      "/_next/data/build/studio.json",
    ]) {
      expect(isExempt(closed), closed).toBe(false);
    }
  });

  it("refuses traversal and encoded escapes inside exempt prefixes", () => {
    for (const sneaky of [
      "/looks/../api/jobs",
      "/looks/%2e%2e/api/jobs",
      "/fixtures/%2E%2E/secret",
      "/looks/a%2fb",
      "/looks/a%5cb",
    ]) {
      expect(isExempt(sneaky), sneaky).toBe(false);
    }
  });
});

describe("middleware", () => {
  it("sends a locked page to the gate, remembering the destination", async () => {
    const response = await middleware(request("/studio?look=cinematic"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/unlock");
    expect(location.searchParams.get("next")).toBe("/studio?look=cinematic");
  });

  it("gives a locked API call JSON and a status, not a login page", async () => {
    const response = await middleware(request("/api/jobs"));
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("lets a valid cookie through", async () => {
    const cookie = await mintUnlockValue(SECRET, PASSPHRASE);
    const response = await middleware(request("/api/jobs", { cookie }));
    expect(response.status).toBe(200); // NextResponse.next()
  });

  it("rejects a cookie minted under a rotated passphrase", async () => {
    const cookie = await mintUnlockValue(SECRET, "the-old-passphrase");
    const response = await middleware(request("/api/jobs", { cookie }));
    expect(response.status).toBe(401);
  });

  it("fails closed when secrets are missing", async () => {
    delete process.env.SESSION_SECRET;
    const response = await middleware(request("/api/jobs"));
    expect(response.status).toBe(500);
  });

  it("refuses a foreign Host — the DNS-rebinding door", async () => {
    const cookie = await mintUnlockValue(SECRET, PASSPHRASE);
    const response = await middleware(
      request("/api/jobs", { cookie, host: "evil.example.com" }),
    );
    expect(response.status).toBe(403);
  });

  it("accepts loopback names on any port for dev", async () => {
    const cookie = await mintUnlockValue(SECRET, PASSPHRASE);
    for (const host of ["localhost:3000", "127.0.0.1:3100", "[::1]:3000"]) {
      const response = await middleware(request("/api/jobs", { cookie, host }));
      expect(response.status, host).toBe(200);
    }
  });
});
