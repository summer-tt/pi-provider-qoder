import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
} from "@earendil-works/pi-ai";
import * as PiAi from "@earendil-works/pi-ai";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { clearQoderEndpointsCache, getAccountChatBaseUrl, getCachedChatBaseUrl } from "../endpoints.js";
import { streamQoder } from "../protocol/stream.js";
import { clearQoderChatBaseUrlOverrides } from "../region.js";
import { loadLiveFixture } from "./live-fixture.js";

vi.mock("../auth/oauth.js", () => ({
  resolveQoderIdentity: vi.fn().mockImplementation(async (token: string) => ({
    access: "fake",
    userID: token === "fake" ? "test-user" : token,
    email: "test@example.com",
    name: "Test User",
    machineID: "test-machine",
    refresh: "",
    expires: 0,
  })),
}));

const credentials = { userID: "test-user", authToken: "fake" };

const SUCCESS_SSE = loadLiveFixture("global").interactions.chat.response.body as string;

function sseEnvelope(body: object, statusCodeValue = 200, statusCode = "OK"): string {
  return (
    "data:" +
    JSON.stringify({
      headers: { "Content-Type": ["application/json"] },
      body: JSON.stringify(body),
      statusCodeValue,
      statusCode,
    }) +
    "\n\n"
  );
}

const DAILY_LIMIT_SSE = sseEnvelope({ code: "110", message: "Billing daily count exceeded" }, 403);

const DONE_SSE =
  "data:" +
  JSON.stringify({
    headers: { "Content-Type": ["application/json"] },
    body: "[DONE]",
    statusCodeValue: 200,
    statusCode: "OK",
  }) +
  "\n\n";

/** A well-formed envelope whose inner chunk is cut short (upstream payload lost mid-stream). */
function sseTruncatedPayload(body: object): string {
  const envelope = JSON.parse(sseEnvelope(body).slice("data:".length).trim()) as { body: string };
  return (
    "data:" +
    JSON.stringify({ ...envelope, body: envelope.body.slice(0, Math.max(1, envelope.body.length - 12)) }) +
    "\n\n"
  );
}

// 110 on the default node, then the rotated node loses a payload mid-stream:
// the turn must end retryable and the failed node must NOT be persisted.
const LOST_PAYLOAD_AFTER_ROTATION_SSE =
  sseEnvelope({
    choices: [
      {
        delta: {
          tool_calls: [{ index: 0, id: "call_1", function: { name: "bash", arguments: '{"command":"echo hello ' } }],
        },
      },
    ],
  }) +
  sseTruncatedPayload({
    choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'world","i":"run"}' } }] } }],
  }) +
  sseEnvelope({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }) +
  DONE_SSE;

function makeModel(): Model<Api> {
  return { id: "Lite", api: "qoder-api" as Api, provider: "qoder" } as Model<Api>;
}

function makeContext(): Context {
  return {
    systemPrompt: "test",
    messages: [{ role: "user", content: "hi" }],
    tools: [],
  } as unknown as Context;
}

async function consume(stream: AssistantMessageEventStream): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const ev of stream) {
    events.push(ev);
    if (ev.type === "done" || ev.type === "error") break;
  }
  return events;
}

// Keep the endpoints cache off the real HOME file: the rotation persists the
// serving node into it, and parallel test files would otherwise race on it.
const originalCachePath = process.env.QODER_ENDPOINTS_CACHE_PATH;
process.env.QODER_ENDPOINTS_CACHE_PATH = join(mkdtempSync(join(tmpdir(), "qoder-endpoints-test-")), "cache.json");

afterAll(() => {
  if (originalCachePath === undefined) delete process.env.QODER_ENDPOINTS_CACHE_PATH;
  else process.env.QODER_ENDPOINTS_CACHE_PATH = originalCachePath;
});

describe("daily chat limit recovery", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearQoderChatBaseUrlOverrides();
    clearQoderEndpointsCache();
    vi.restoreAllMocks();
  });

  it("switches to the remote-agent node, retries, and persists the node", async () => {
    const endpointsFixture = JSON.parse(
      await import("node:fs").then((fs) =>
        fs.readFileSync(new URL("../__fixtures__/region-endpoints.json", import.meta.url), "utf8"),
      ),
    ) as { encoded: string };
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.includes("/service/region/endpoints")) {
        return new Response(endpointsFixture.encoded, { status: 200 });
      }
      if (url.startsWith("https://api3.qoder.sh/")) {
        return new Response(DAILY_LIMIT_SSE, { status: 200 });
      }
      if (url.startsWith("https://api2.qoder.sh/")) {
        return new Response(SUCCESS_SSE, { status: 200 });
      }
      return new Response("unexpected url", { status: 500 });
    }) as unknown as typeof fetch;

    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake" }));

    expect(events.some((ev) => ev.type === "error")).toBe(false);
    const chatCalls = calls.filter((url) => url.includes("agent_chat_generation"));
    expect(chatCalls[0]?.startsWith("https://api3.qoder.sh/")).toBe(true);
    expect(chatCalls[1]?.startsWith("https://api2.qoder.sh/")).toBe(true);
    expect(getAccountChatBaseUrl("global", credentials)).toBe("https://api2.qoder.sh/");
    expect(getCachedChatBaseUrl("global", credentials)).toBe("https://api2.qoder.sh/");
  });

  it("does not persist the rotated node when its turn ends in a lost-payload retryable error", async () => {
    const endpointsFixture = JSON.parse(
      await import("node:fs").then((fs) =>
        fs.readFileSync(new URL("../__fixtures__/region-endpoints.json", import.meta.url), "utf8"),
      ),
    ) as { encoded: string };
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.includes("/service/region/endpoints")) {
        return new Response(endpointsFixture.encoded, { status: 200 });
      }
      if (url.startsWith("https://api3.qoder.sh/")) {
        return new Response(DAILY_LIMIT_SSE, { status: 200 });
      }
      if (url.startsWith("https://api2.qoder.sh/")) {
        return new Response(LOST_PAYLOAD_AFTER_ROTATION_SSE, { status: 200 });
      }
      return new Response("unexpected url", { status: 500 });
    }) as unknown as typeof fetch;

    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake" }));

    const err = events.find((ev) => ev.type === "error") as { error: AssistantMessage } | undefined;
    expect(err, "expected a retryable error event").toBeDefined();
    expect(err?.error.errorMessage).toMatch(/argument stream was cut off/);
    expect(PiAi.isRetryableAssistantError(err?.error as AssistantMessage)).toBe(true);
    expect(events.some((ev) => ev.type === "done")).toBe(false);
    const chatCalls = calls.filter((url) => url.includes("agent_chat_generation"));
    expect(chatCalls[0]?.startsWith("https://api3.qoder.sh/")).toBe(true);
    expect(chatCalls[1]?.startsWith("https://api2.qoder.sh/")).toBe(true);
    // The rotated node failed the turn: only a node that served a successful
    // request may be persisted as the account's chat base.
    expect(getAccountChatBaseUrl("global", credentials)).toBe("https://api3.qoder.sh/");
    expect(getCachedChatBaseUrl("global", credentials)).toBeUndefined();
  });

  it("also rotates when the 110 rejection arrives as a plain HTTP error", async () => {
    const endpointsFixture = JSON.parse(
      await import("node:fs").then((fs) =>
        fs.readFileSync(new URL("../__fixtures__/region-endpoints.json", import.meta.url), "utf8"),
      ),
    ) as { encoded: string };
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.includes("/service/region/endpoints")) {
        return new Response(endpointsFixture.encoded, { status: 200 });
      }
      if (url.startsWith("https://api3.qoder.sh/")) {
        return new Response(JSON.stringify({ code: "110", message: "Billing daily count exceeded" }), {
          status: 403,
        });
      }
      if (url.startsWith("https://api2.qoder.sh/")) {
        return new Response(SUCCESS_SSE, { status: 200 });
      }
      return new Response("unexpected url", { status: 500 });
    }) as unknown as typeof fetch;

    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake" }));

    expect(events.some((ev) => ev.type === "error")).toBe(false);
    const chatCalls = calls.filter((url) => url.includes("agent_chat_generation"));
    expect(chatCalls[0]?.startsWith("https://api3.qoder.sh/")).toBe(true);
    expect(chatCalls[1]?.startsWith("https://api2.qoder.sh/")).toBe(true);
    expect(getAccountChatBaseUrl("global", credentials)).toBe("https://api2.qoder.sh/");
    expect(getCachedChatBaseUrl("global", credentials)).toBe("https://api2.qoder.sh/");
  });

  it("surfaces the rejection when no other node is available", async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/service/region/endpoints")) return new Response("no", { status: 500 });
      return new Response(DAILY_LIMIT_SSE, { status: 200 });
    }) as unknown as typeof fetch;

    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake" }));

    const error = events.find((ev) => ev.type === "error");
    expect(error).toBeDefined();
    expect(JSON.stringify(error)).toContain("110");
  });

  it("stops after caller abort during discovery following 110", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("region/endpoints")) {
        controller.abort();
        return new Promise<Response>(() => {});
      }
      return new Response(DAILY_LIMIT_SSE);
    });
    vi.stubGlobal("fetch", fetchMock);
    const events = await consume(
      streamQoder(makeModel(), makeContext(), { apiKey: "fake", signal: controller.signal }),
    );
    expect(events.at(-1)?.type).toBe("error");
    expect(JSON.stringify(events.at(-1))).toContain("aborted");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getCachedChatBaseUrl("global", credentials)).toBeUndefined();
  });

  it("does not retry 110 after model output", async () => {
    const content = sseEnvelope({ choices: [{ delta: { content: "visible" } }] });
    const fetchMock = vi.fn(async () => new Response(content + DAILY_LIMIT_SSE));
    vi.stubGlobal("fetch", fetchMock);
    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake" }));
    expect(JSON.stringify(events)).toContain("visible");
    expect(events.at(-1)?.type).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps concurrent accounts' selected and successful nodes separate", async () => {
    let releaseA!: () => void;
    let reachedA!: () => void;
    const waitingA = new Promise<void>((resolve) => {
      reachedA = resolve;
    });
    const pausedA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let discoveries = 0;
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("region/endpoints")) {
          const node = ++discoveries === 1 ? "a" : "b";
          return new Response(JSON.stringify({ dataNodeMap: { remote_agent: [`https://${node}.example/`] } }));
        }
        if (url.startsWith("https://api3.qoder.sh/")) return new Response(DAILY_LIMIT_SSE);
        if (url.startsWith("https://a.example/")) {
          reachedA();
          await pausedA;
        }
        return new Response(SUCCESS_SSE);
      }),
    );
    const a = consume(streamQoder(makeModel(), makeContext(), { apiKey: "account-a" }));
    await waitingA;
    const b = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "account-b" }));
    expect(b.at(-1)?.type).toBe("done");
    releaseA();
    expect((await a).at(-1)?.type).toBe("done");
    expect(discoveries).toBe(2);
    expect(calls.filter((url) => url.includes("agent_chat_generation"))).toHaveLength(4);
    expect(getCachedChatBaseUrl("global", { userID: "account-a", authToken: "account-a" })).toBe("https://a.example/");
    expect(getCachedChatBaseUrl("global", { userID: "account-b", authToken: "account-b" })).toBe("https://b.example/");
  });

  it("caps endpoint switches at three", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("region/endpoints")
        ? new Response(
            JSON.stringify({
              dataNodeMap: {
                remote_agent: ["https://a.example/", "https://b.example/", "https://c.example/", "https://d.example/"],
              },
            }),
          )
        : new Response(DAILY_LIMIT_SSE),
    );
    vi.stubGlobal("fetch", fetchMock);
    const events = await consume(streamQoder(makeModel(), makeContext(), { apiKey: "fake" }));
    expect(events.at(-1)?.type).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(getCachedChatBaseUrl("global", credentials)).toBeUndefined();
  });
});
