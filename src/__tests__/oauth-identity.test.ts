import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearQoderAuthMemCache, getCachedCredentials, resolveQoderIdentity } from "../auth/oauth.js";
import { clearQoderEndpointsCache, getCachedChatBaseUrl } from "../endpoints.js";
import { streamQoder } from "../protocol/stream.js";
import { loadLiveFixture } from "./live-fixture.js";

const authFile = join(process.env.HOME ?? "", ".pi", "agent", "auth.json");
const successSse = loadLiveFixture("global").interactions.chat.response.body as string;

beforeEach(() => {
  vi.stubEnv("QODER_ENDPOINTS_CACHE_PATH", join(process.env.HOME ?? "", ".pi", "agent", "identity-endpoints.json"));
  rmSync(authFile, { force: true });
  clearQoderAuthMemCache();
  clearQoderEndpointsCache();
});

afterEach(() => {
  clearQoderAuthMemCache();
  clearQoderEndpointsCache();
  rmSync(authFile, { force: true });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("oauth token identity", () => {
  it.each(["qoder", "qoder-cn"])(
    "matches stored tokens while preserving empty-token startup lookup for %s",
    (providerID) => {
      writeFileSync(authFile, JSON.stringify({ [providerID]: { access: "token-a", userID: "user-a" } }));
      expect(getCachedCredentials("token-a", providerID)?.userID).toBe("user-a");
      expect(getCachedCredentials("", providerID)?.userID).toBe("user-a");
      expect(getCachedCredentials("token-b", providerID)).toBeNull();
    },
  );

  it("resolves each token's identity before discovering and persisting its chat node", async () => {
    const calls: { url: string; userID: string; authorization: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        const userID = headers.get("Cosy-User") ?? "";
        const authorization = headers.get("Authorization");
        calls.push({ url, userID, authorization });
        if (url.endsWith("/userinfo")) {
          const id =
            authorization === "Bearer token-a" ? "user-a" : authorization === "Bearer token-b" ? "user-b" : undefined;
          if (!id) throw new Error("Unexpected synthetic identity token");
          return new Response(JSON.stringify({ id, name: id, email: `${id}@example.com` }));
        }
        if (url.includes("region/endpoints")) {
          if (userID !== "user-a" && userID !== "user-b") throw new Error("Unexpected discovery identity");
          const node = userID === "user-a" ? "https://a.example/" : "https://b.example/";
          return new Response(JSON.stringify({ dataNodeMap: { remote_agent: [node] } }));
        }
        if (url.startsWith("https://api3.qoder.sh/")) {
          return new Response(JSON.stringify({ code: "110", message: "Billing daily count exceeded" }), {
            status: 403,
          });
        }
        if (
          (userID === "user-a" && url.startsWith("https://a.example/")) ||
          (userID === "user-b" && url.startsWith("https://b.example/"))
        ) {
          return new Response(successSse);
        }
        throw new Error("Unexpected synthetic chat route");
      }),
    );
    const model = { id: "Lite", api: "qoder-api" as Api, provider: "qoder" } as Model<Api>;
    const context: Context = {
      systemPrompt: "test",
      messages: [{ role: "user", content: "hi", timestamp: 0 }],
      tools: [],
    };
    const accountA = { userID: "user-a", authToken: "token-a" };
    const accountB = { userID: "user-b", authToken: "token-b" };
    const runChat = async (apiKey: string) => {
      const stream = streamQoder(model, context, { apiKey });
      for await (const event of stream) expect(event.type).not.toBe("error");
      return stream.result();
    };

    const first = await runChat("token-a");
    expect(first.stopReason).toBe("stop");
    expect(getCachedCredentials("", "qoder")?.userID).toBe("user-a");
    expect(getCachedChatBaseUrl("global", accountA)).toBe("https://a.example/");

    const second = await runChat("token-b");
    expect(second.stopReason).toBe("stop");
    expect(getCachedCredentials("", "qoder")?.userID).toBe("user-b");
    expect(getCachedCredentials("token-b", "qoder")?.userID).toBe("user-b");
    expect(getCachedCredentials("token-a", "qoder")).toBeNull();
    expect((await resolveQoderIdentity("token-a", "qoder", "global")).userID).toBe("user-a");
    expect((await resolveQoderIdentity("token-b", "qoder", "global")).userID).toBe("user-b");
    expect(getCachedChatBaseUrl("global", accountA)).toBe("https://a.example/");
    expect(getCachedChatBaseUrl("global", accountB)).toBe("https://b.example/");
    expect(calls.filter(({ url }) => url.endsWith("/userinfo")).map(({ authorization }) => authorization)).toEqual([
      "Bearer token-a",
      "Bearer token-b",
    ]);
    expect(calls.filter(({ url }) => url.includes("region/endpoints")).map(({ userID }) => userID)).toEqual([
      "user-a",
      "user-b",
    ]);
    expect(
      calls
        .filter(({ url }) => url.includes("agent_chat_generation"))
        .map(({ url, userID }) => ({
          origin: new URL(url).origin,
          userID,
        })),
    ).toEqual([
      { origin: "https://api3.qoder.sh", userID: "user-a" },
      { origin: "https://a.example", userID: "user-a" },
      { origin: "https://api3.qoder.sh", userID: "user-b" },
      { origin: "https://b.example", userID: "user-b" },
    ]);
  });
});
