import { describe, it, expect } from "vitest";
import { isPubliclyReachable, webhookUrlFor } from "./reachability";

/**
 * Getting this wrong in either direction has a cost: too strict and we lose
 * webhooks on a real deployment; too loose and every job on a home network
 * generates ~31 failed deliveries on fal's side.
 */

describe("private addresses", () => {
  const privateOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://0.0.0.0:3000",
    "http://10.0.0.5:3000",
    "http://192.168.1.20:3000",
    "http://172.16.4.4:3000",
    "http://172.31.255.1:3000",
    "http://169.254.1.1:3000",
    "http://100.100.1.1:3000", // CGNAT / Tailscale
    "http://thunkin.local:3000",
    "http://box.lan:3000",
    "http://[::1]:3000",
    "http://[fd00::1]:3000",
  ];

  for (const origin of privateOrigins) {
    it(`treats ${origin} as unreachable`, () => {
      expect(isPubliclyReachable(origin)).toBe(false);
      expect(webhookUrlFor(origin)).toBeNull();
    });
  }
});

describe("public addresses", () => {
  const publicOrigins = [
    "https://thunkin.example.com",
    "https://thunkin.example.com:8443",
    "http://203.0.113.10:3000",
    "https://172.32.0.1", // just outside the RFC1918 block
    "https://11.0.0.1", // 11/8 is public, unlike 10/8
  ];

  for (const origin of publicOrigins) {
    it(`treats ${origin} as reachable`, () => {
      expect(isPubliclyReachable(origin)).toBe(true);
      expect(webhookUrlFor(origin)).toBe(`${origin}/api/webhooks/fal`);
    });
  }
});

describe("edges", () => {
  it("refuses to hand a provider an unparseable origin", () => {
    expect(isPubliclyReachable("not a url")).toBe(false);
    expect(webhookUrlFor("")).toBeNull();
  });

  it("does not mistake a hostname containing digits for an address", () => {
    expect(isPubliclyReachable("https://10-0-0-5.example.com")).toBe(true);
  });
});
