import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  applyCachedChatEndpoint,
  chatEndpointCandidates,
  clearQoderEndpointsCache,
  DISCOVERY_TIMEOUT_MS,
  fetchQoderRegionEndpoints,
  getAccountChatBaseUrl,
  getCachedChatBaseUrl,
  parseQoderRegionEndpoints,
  refreshChatEndpoint,
  rememberChatBaseUrl,
  rotateChatEndpoint,
} from "../endpoints.js";
import { qoderEncodeBody } from "../protocol/encoding.js";
import { clearQoderChatBaseUrlOverrides, getQoderChatURL } from "../region.js";

const fixture = JSON.parse(readFileSync(new URL("../__fixtures__/region-endpoints.json", import.meta.url), "utf8")) as {
  encoded: string;
  plaintext: string;
};

const credentials = {
  userID: "user-id",
  authToken: "access-token",
  name: "name",
  email: "user@example.com",
  machineID: "machine-id",
};

// Keep the endpoints cache off the real HOME file: these tests write it on
// every run, and parallel test files would otherwise race on it (and pollute
// the user's own cache).
const originalCachePath = process.env.QODER_ENDPOINTS_CACHE_PATH;
process.env.QODER_ENDPOINTS_CACHE_PATH = join(mkdtempSync(join(tmpdir(), "qoder-endpoints-test-")), "cache.json");

afterAll(() => {
  if (originalCachePath === undefined) delete process.env.QODER_ENDPOINTS_CACHE_PATH;
  else process.env.QODER_ENDPOINTS_CACHE_PATH = originalCachePath;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearQoderEndpointsCache();
  clearQoderChatBaseUrlOverrides();
});

describe("parseQoderRegionEndpoints", () => {
  it("extracts the node classes from a real account map", () => {
    expect(parseQoderRegionEndpoints(JSON.parse(fixture.plaintext))).toEqual({
      inferNodes: ["https://api3.qoder.sh/"],
      remoteAgentNodes: ["https://api2.qoder.sh/"],
      securityNodes: ["https://api2.qoder.sh/"],
      centerNodes: ["https://center.qoder.sh/"],
    });
  });

  it("rejects payloads without any usable node", () => {
    expect(parseQoderRegionEndpoints({})).toBeUndefined();
    expect(parseQoderRegionEndpoints({ inferNodes: [] })).toBeUndefined();
    expect(parseQoderRegionEndpoints(null)).toBeUndefined();
  });
});

describe("chatEndpointCandidates", () => {
  it("keeps the current node first and prefers the remote-agent node", () => {
    const endpoints = parseQoderRegionEndpoints(JSON.parse(fixture.plaintext));
    expect(chatEndpointCandidates(endpoints, "https://api3.qoder.sh/")).toEqual([
      "https://api3.qoder.sh/",
      "https://api2.qoder.sh/",
    ]);
  });

  it("falls back to the current node when discovery returned nothing", () => {
    expect(chatEndpointCandidates(undefined, "https://api3.qoder.sh")).toEqual(["https://api3.qoder.sh/"]);
  });
});

describe("chat endpoint cache", () => {
  it("returns a remembered node inside the TTL and expires it after", () => {
    const now = Date.now();
    rememberChatBaseUrl("global", credentials, "https://api2.qoder.sh", now);
    expect(getCachedChatBaseUrl("global", credentials, now + 60_000)).toBe("https://api2.qoder.sh/");
    expect(getCachedChatBaseUrl("global", credentials, now + 2 * 60 * 60 * 1000)).toBeUndefined();
  });

  it("applies the cached node to chat only", () => {
    rememberChatBaseUrl("global", credentials, "https://api2.qoder.sh");
    expect(applyCachedChatEndpoint("global", credentials)).toBe("https://api2.qoder.sh/");
    expect(getQoderChatURL("global", getAccountChatBaseUrl("global", credentials))).toContain(
      "https://api2.qoder.sh/algo/api/v2/service/pro/sse",
    );
  });
});

describe("fetchQoderRegionEndpoints", () => {
  it("decodes the encoded response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(fixture.encoded, { status: 200 })));
    const endpoints = await fetchQoderRegionEndpoints("global", credentials);
    expect(endpoints?.remoteAgentNodes).toEqual(["https://api2.qoder.sh/"]);
  });

  it("accepts a plain JSON response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(fixture.plaintext, { status: 200 })));
    const endpoints = await fetchQoderRegionEndpoints("global", credentials);
    expect(endpoints?.inferNodes).toEqual(["https://api3.qoder.sh/"]);
  });

  it("returns undefined on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    await expect(fetchQoderRegionEndpoints("global", credentials)).resolves.toBeUndefined();
  });

  it("returns undefined when the body is not parseable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    await expect(fetchQoderRegionEndpoints("global", credentials)).resolves.toBeUndefined();
  });
});

describe("refreshChatEndpoint", () => {
  it("routes chat to the remote-agent node and persists it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(qoderEncodeBody(fixture.plaintext).toString("ascii"), { status: 200 })),
    );
    await expect(refreshChatEndpoint("global", credentials)).resolves.toBe("https://api2.qoder.sh/");
    expect(getAccountChatBaseUrl("global", credentials)).toBe("https://api2.qoder.sh/");
    expect(getCachedChatBaseUrl("global", credentials)).toBe("https://api2.qoder.sh/");
  });

  it("keeps the default node when discovery fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    await expect(refreshChatEndpoint("global", credentials)).resolves.toBeUndefined();
    expect(getAccountChatBaseUrl("global", credentials)).toBe("https://api3.qoder.sh/");
  });

  it("does nothing without credentials", async () => {
    await expect(refreshChatEndpoint("global", undefined)).resolves.toBeUndefined();
    expect(getAccountChatBaseUrl("global", credentials)).toBe("https://api3.qoder.sh/");
  });
});

describe("rotateChatEndpoint", () => {
  it("moves off the failing node and stops when candidates run out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(fixture.encoded, { status: 200 })));
    const attempted = new Set<string>();

    await expect(rotateChatEndpoint("global", credentials, attempted)).resolves.toBe("https://api2.qoder.sh/");
    expect(attempted).toEqual(new Set(["https://api3.qoder.sh/", "https://api2.qoder.sh/"]));
    await expect(rotateChatEndpoint("global", credentials, attempted)).resolves.toBeUndefined();
  });

  it("without discovery it can only conclude no other node exists", async () => {
    const attempted = new Set<string>();
    await expect(rotateChatEndpoint("global", undefined, attempted)).resolves.toBeUndefined();
  });
});

describe("discovery cancellation and account isolation", () => {
  it.each(["fetch", "body"])("bounds an unfinished %s", async (stage) => {
    vi.useFakeTimers();
    const pending = new Promise<never>(() => {});
    const fetchMock = vi
      .fn()
      .mockReturnValue(stage === "fetch" ? pending : Promise.resolve({ ok: true, text: () => pending }));
    vi.stubGlobal("fetch", fetchMock);
    const result = fetchQoderRegionEndpoints("global", credentials);
    await vi.advanceTimersByTimeAsync(DISCOVERY_TIMEOUT_MS);
    await expect(result).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["fetch", "body"])("stops %s discovery and rotation when the caller cancels", async (stage) => {
    const controller = new AbortController();
    const pending = new Promise<never>(() => {});
    let enteredBody!: () => void;
    const bodyStarted = new Promise<void>((resolve) => {
      enteredBody = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        stage === "fetch"
          ? pending
          : Promise.resolve({
              ok: true,
              text: () => {
                enteredBody();
                return pending;
              },
            }),
      ),
    );
    const attempted = new Set<string>();
    const result = rotateChatEndpoint("global", credentials, attempted, "https://api3.qoder.sh/", controller.signal);
    const rejected = expect(result).rejects.toThrow("cancelled");
    if (stage === "body") await bodyStarted;
    controller.abort(new Error("cancelled"));
    await rejected;
    expect(attempted).toEqual(new Set(["https://api3.qoder.sh/"]));
  });

  it("isolates discovery and persisted routes by account and region without storing tokens", async () => {
    const other = { ...credentials, userID: "other-user", authToken: "other-secret" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ dataNodeMap: { remote_agent: ["https://a.example/"] } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ dataNodeMap: { remote_agent: ["https://b.example/"] } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ dataNodeMap: { remote_agent: ["https://cn.example/"] } })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await refreshChatEndpoint("global", credentials)).toBe("https://a.example/");
    expect(await refreshChatEndpoint("global", other)).toBe("https://b.example/");
    expect(await refreshChatEndpoint("cn", credentials)).toBe("https://cn.example/");
    expect(await rotateChatEndpoint("global", credentials, new Set(), "https://api3.qoder.sh/")).toBe(
      "https://a.example/",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getAccountChatBaseUrl("global", credentials)).toBe("https://a.example/");
    expect(getCachedChatBaseUrl("global", other)).toBe("https://b.example/");
    expect(getCachedChatBaseUrl("cn", credentials)).toBe("https://cn.example/");
    const disk = readFileSync(process.env.QODER_ENDPOINTS_CACHE_PATH!, "utf8");
    expect(disk).not.toContain(credentials.authToken);
    expect(disk).not.toContain(other.authToken);
    expect(disk).not.toContain(credentials.userID);
  });

  it("does not assign a legacy region-only cache to a new account", () => {
    writeFileSync(
      process.env.QODER_ENDPOINTS_CACHE_PATH!,
      JSON.stringify({
        version: 1,
        modes: { global: { chatBaseUrl: "https://legacy.example/", updatedAt: Date.now() } },
      }),
    );
    expect(getAccountChatBaseUrl("global", credentials)).toBe("https://api3.qoder.sh/");
  });

  it("isolates legacy credentials with missing account IDs by token digest", () => {
    const first = { userID: "qoder-user", authToken: "legacy-first-secret" };
    const second = { userID: "qoder-user", authToken: "legacy-second-secret" };
    rememberChatBaseUrl("global", first, "https://first.example/");
    expect(getAccountChatBaseUrl("global", second)).toBe("https://api3.qoder.sh/");
    expect(readFileSync(process.env.QODER_ENDPOINTS_CACHE_PATH!, "utf8")).not.toContain(first.authToken);
  });

  it("retains this account's cached route after discovery fails", async () => {
    rememberChatBaseUrl("global", credentials, "https://cached.example/");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("failure", { status: 500 })));
    await expect(refreshChatEndpoint("global", credentials)).resolves.toBeUndefined();
    expect(getAccountChatBaseUrl("global", credentials)).toBe("https://cached.example/");
  });
});
