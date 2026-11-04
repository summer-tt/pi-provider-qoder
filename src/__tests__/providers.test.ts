import type { OAuthCredentials } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REGISTRY_URL } from "../update-check.js";

const patEnvNames = [
  "QODER_API_KEY",
  "QODER_PERSONAL_ACCESS_TOKEN",
  "QODER_PAT",
  "QODERCN_API_KEY",
  "QODERCN_PERSONAL_ACCESS_TOKEN",
  "QODERCN_PAT",
] as const;
const originalPats = Object.fromEntries(patEnvNames.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of patEnvNames) {
    const value = originalPats[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.useRealTimers();
  vi.doUnmock("../catalog.js");
  vi.doUnmock("../auth/oauth.js");
  vi.unstubAllGlobals();
  vi.doUnmock("@earendil-works/pi-ai/compat");
  vi.resetModules();
});

/**
 * Keep the startup catalog refresh off the real network. With stored
 * credentials on disk and a stale cache, registerProviders fetches Qoder's
 * catalog; in a sandbox without direct egress that fetch hangs until the
 * test times out, and the late completion then pollutes the next test's
 * registration counts. A failing response makes the refresh return early
 * (registerProviders already tolerates refresh failures).
 */
function stubNetworkFailure(): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
}

// Registration imports the full pi-ai compat layer; under parallel workers
// that can push these tests past vitest's 5s default, and a timeout here
// also lets the late registration pollute the next test's registry counts.
// Give this file room.
vi.setConfig({ testTimeout: 30_000 });

function liteModel(provider: "qoder" | "qoder-cn") {
  return {
    id: "Lite",
    name: "Lite",
    api: "qoder-api",
    provider,
    baseUrl: provider === "qoder-cn" ? "https://gateway.qoder.com.cn/" : "https://api3.qoder.sh/",
    reasoning: false,
    input: ["text"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 131072,
  };
}

describe("provider region binding", () => {
  it("binds qoder to global and qoder-cn to CN", async () => {
    for (const name of patEnvNames) delete process.env[name];
    stubNetworkFailure();
    const providers = new Map<string, Record<string, unknown>>();
    const pi = {
      registerProvider(providerID: string, config: Record<string, unknown>) {
        providers.set(providerID, config);
      },
      on: vi.fn(),
    };

    const { default: registerProviders } = await import("../index.js");
    await registerProviders(pi as never);

    expect(providers.get("qoder")?.baseUrl).toBe("https://api3.qoder.sh/");
    expect(providers.get("qoder-cn")?.baseUrl).toBe("https://gateway.qoder.com.cn/");

    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            userQuota: { total: 100, used: 1, remaining: 99, percentage: 1, unit: "requests" },
            orgResourcePackage: { total: 0, used: 0, remaining: 0, percentage: 0, unit: "requests" },
            totalUsagePercentage: 1,
            isQuotaExceeded: false,
            expiresAt: Date.now() + 3600_000,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const credentials: OAuthCredentials = { access: "test-token", refresh: "", expires: Date.now() + 3600_000 };
    const globalOAuth = providers.get("qoder")?.oauth as {
      fetchUsage: (credentials: OAuthCredentials) => Promise<unknown>;
    };
    const cnOAuth = providers.get("qoder-cn")?.oauth as {
      fetchUsage: (credentials: OAuthCredentials) => Promise<unknown>;
    };

    await globalOAuth.fetchUsage(credentials);
    expect(fetchMock).toHaveBeenLastCalledWith("https://openapi.qoder.sh/api/v2/quota/usage", expect.any(Object));

    await cnOAuth.fetchUsage(credentials);
    expect(fetchMock).toHaveBeenLastCalledWith("https://openapi.qoder.com.cn/api/v2/quota/usage", expect.any(Object));
  });
});

describe("qoder-api registry", () => {
  it("registers qoder-api so global streamSimple works for both regions", async () => {
    for (const name of patEnvNames) delete process.env[name];
    stubNetworkFailure();

    const actual = await vi.importActual<typeof import("@earendil-works/pi-ai/compat")>("@earendil-works/pi-ai/compat");
    const registerSpy = vi.fn((...args: Parameters<typeof actual.registerApiProvider>) => {
      return actual.registerApiProvider(...args);
    });
    vi.doMock("@earendil-works/pi-ai/compat", () => ({
      ...actual,
      registerApiProvider: registerSpy,
    }));

    const { getApiProvider, streamSimple, unregisterApiProviders } = await import("@earendil-works/pi-ai/compat");
    const { default: registerProviders } = await import("../index.js");
    // Node caches node_modules ESM, so a prior test in this file may already
    // have registered qoder-api. Drop that entry before asserting the empty state.
    unregisterApiProviders("provider:qoder");
    const emptyContext = { systemPrompt: "", messages: [] };

    expect(getApiProvider("qoder-api")).toBeUndefined();
    expect(() => streamSimple(liteModel("qoder") as never, emptyContext)).toThrow(
      /No API provider registered for api: qoder-api/,
    );

    const providers = new Map<string, Record<string, unknown>>();
    const registerProvider = vi.fn((providerID: string, config: Record<string, unknown>) => {
      providers.set(providerID, config);
    });
    const pi = {
      registerProvider,
      on: vi.fn(),
    };

    await registerProviders(pi as never);

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerProvider).toHaveBeenCalledTimes(2);
    expect(providers.has("qoder")).toBe(true);
    expect(providers.has("qoder-cn")).toBe(true);
    expect(providers.get("qoder")?.api).toBe("qoder-api");
    expect(providers.get("qoder-cn")?.api).toBe("qoder-api");
    expect(typeof providers.get("qoder")?.streamSimple).toBe("function");
    expect(typeof providers.get("qoder-cn")?.streamSimple).toBe("function");

    expect(getApiProvider("qoder-api")).toBeDefined();
    expect(() => streamSimple(liteModel("qoder") as never, emptyContext)).not.toThrow(
      /No API provider registered for api: qoder-api/,
    );
    expect(() => streamSimple(liteModel("qoder-cn") as never, emptyContext)).not.toThrow(
      /No API provider registered for api: qoder-api/,
    );
  });

  it("still registers providers when registerApiProvider is absent (OMP-style)", async () => {
    for (const name of patEnvNames) delete process.env[name];
    stubNetworkFailure();

    vi.doMock("@earendil-works/pi-ai/compat", () => ({
      // OMP bundled pi-ai/compat does not export registerApiProvider.
    }));

    const { default: registerProviders } = await import("../index.js");

    const providers = new Map<string, Record<string, unknown>>();
    const registerProvider = vi.fn((providerID: string, config: Record<string, unknown>) => {
      providers.set(providerID, config);
    });
    const pi = {
      registerProvider,
      on: vi.fn(),
    };

    await expect(registerProviders(pi as never)).resolves.toBeUndefined();

    expect(registerProvider).toHaveBeenCalledTimes(2);
    expect(providers.has("qoder")).toBe(true);
    expect(providers.has("qoder-cn")).toBe(true);
    expect(providers.get("qoder")?.api).toBe("qoder-api");
    expect(providers.get("qoder-cn")?.api).toBe("qoder-api");
    expect(typeof providers.get("qoder")?.streamSimple).toBe("function");
    expect(typeof providers.get("qoder-cn")?.streamSimple).toBe("function");
  });
});

describe("startup discovery deadline", () => {
  it.each(["success", "fetch", "body"])("registers providers with %s discovery and a fresh catalog", async (stage) => {
    for (const name of patEnvNames) delete process.env[name];
    vi.doMock("../auth/oauth.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../auth/oauth.js")>()),
      autoLoginQoderFromEnvironment: vi.fn(),
      getCachedCredentials: vi.fn(() => ({ access: "synthetic-token", userID: "startup-user" })),
    }));
    vi.doMock("../catalog.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../catalog.js")>()),
      isCacheStale: () => false,
    }));
    const { default: registerProviders } = await import("../index.js");
    const { clearQoderEndpointsCache } = await import("../endpoints.js");
    clearQoderEndpointsCache();
    const pending = new Promise<never>(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        stage === "fetch"
          ? pending
          : Promise.resolve(
              stage === "body"
                ? { ok: true, text: () => pending }
                : new Response(JSON.stringify({ dataNodeMap: { remote_agent: ["https://startup.example/"] } })),
            ),
      ),
    );
    const registerProvider = vi.fn();
    const result = registerProviders({ registerProvider, on: vi.fn() } as never);
    await result;
    expect(registerProvider).toHaveBeenCalledTimes(2);
    const { getAccountChatBaseUrl } = await import("../endpoints.js");
    expect(getAccountChatBaseUrl("global", { userID: "startup-user", authToken: "synthetic-token" })).toBe(
      stage === "success" ? "https://startup.example/" : "https://api3.qoder.sh/",
    );
  });
});

describe("fork startup update check", () => {
  const optIn = "PI_PROVIDER_QODER_UPDATE_CHECK";
  const optOut = "PI_PROVIDER_QODER_SKIP_UPDATE_CHECK";
  const saved: Record<string, string | undefined> = {};
  let consoleError: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    saved[optIn] = process.env[optIn];
    saved[optOut] = process.env[optOut];
    // A tempting registry reply: if the fork wiring ever regresses to the
    // upstream default, both the request and the notice must fail loudly here.
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://registry.npmjs.org/")) {
        return new Response(JSON.stringify({ version: "9.9.9" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // Catalog/endpoint refreshes are tolerated (they return early on 500).
      return new Response("{}", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    consoleError.mockRestore();
  });

  async function settleStartupNotices(): Promise<void> {
    // The update check is fire-and-forget; drain its microtask chain (and the
    // mocked fetch resolution) before asserting on its side effects.
    for (let tick = 0; tick < 2; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("does not query the npm registry or print upgrade guidance by default", async () => {
    delete process.env[optIn];
    delete process.env[optOut];
    for (const name of patEnvNames) delete process.env[name];

    const { default: registerProviders } = await import("../index.js");
    const registerProvider = vi.fn();
    await registerProviders({ registerProvider, on: vi.fn() } as never);
    await settleStartupNotices();

    const requestedUrls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(requestedUrls).not.toContain(REGISTRY_URL);
    expect(requestedUrls.some((url) => url.includes("registry.npmjs.org"))).toBe(false);
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringMatching(/pi-provider-qoder\].*is available/));
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining("pi install npm:pi-provider-qoder"));
    expect(registerProvider).toHaveBeenCalledTimes(2);
    expect(registerProvider.mock.calls.map(([providerID]) => providerID)).toEqual(["qoder", "qoder-cn"]);
  });

  it("runs the upstream check when PI_PROVIDER_QODER_UPDATE_CHECK=1 opts in", async () => {
    process.env[optIn] = "1";
    for (const name of patEnvNames) delete process.env[name];

    const { default: registerProviders } = await import("../index.js");
    const registerProvider = vi.fn();
    await registerProviders({ registerProvider, on: vi.fn() } as never);
    await settleStartupNotices();

    expect(fetchMock).toHaveBeenCalledWith(REGISTRY_URL, expect.objectContaining({ signal: expect.anything() }));
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("9.9.9 is available"));
    expect(registerProvider).toHaveBeenCalledTimes(2);
  });
});
