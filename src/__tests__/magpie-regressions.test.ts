import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QoderCredentials } from "../auth/oauth.js";
import { parseQoderCatalog } from "../catalog.js";
import * as CosyVersion from "../cosy-version.js";
import { QoderCNPlugin, QoderPlugin } from "../magpie/index.js";
import { messagesResponse } from "../magpie/messages.js";
import { streamQoder } from "../protocol/stream.js";

const auth = {
  type: "oauth" as const,
  access: "access-SENSITIVE",
  refresh: "refresh-SENSITIVE|account-A|machine",
  expires: Date.now() + 3600_000,
  userID: "account-A",
  email: "a@example.com",
  name: "A",
  machineID: "machine",
};
const second = {
  ...auth,
  access: "second-access",
  refresh: "second-refresh|account-B|machine",
  userID: "account-B",
  email: "b@example.com",
};
const client = { auth: { set: vi.fn().mockResolvedValue(undefined) } };
const tools = [{ name: "read", input_schema: { type: "object" as const } }];
const auto = {
  key: "auto-key",
  display_name: "Auto",
  enable: true,
  is_reasoning: true,
  thinking_config: { disabled: {}, enabled: { efforts: { low: {}, high: {} } } },
};
const catalog = { chat: [auto] };
const messageBody = { model: "Auto", messages: [{ role: "user" as const, content: "hello" }] };
function request(body: object = {}, signal?: AbortSignal) {
  return new Request("https://qoder.invalid/v1/messages", {
    method: "POST",
    body: JSON.stringify({ ...messageBody, ...body }),
    signal,
  });
}
function envelope(body: unknown, status = 200) {
  return `data: ${JSON.stringify({ statusCodeValue: status, body: typeof body === "string" ? body : JSON.stringify(body) })}\n\n`;
}
function chunk(delta: object, finish?: string) {
  return envelope({ choices: [{ delta, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
}
const done = "data: [DONE]\n\n";
function decode(init: RequestInit) {
  const custom = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!";
  const standard = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const translated = [...Buffer.from(init.body as Uint8Array).toString()]
    .map((c) => (c === "$" ? "=" : standard[custom.indexOf(c)] || c))
    .join("");
  const third = Math.floor(translated.length / 3);
  return JSON.parse(
    Buffer.from(
      translated.slice(-third) + translated.slice(third, -third) + translated.slice(0, third),
      "base64",
    ).toString(),
  );
}
function mockChat(reply: () => Response, catalogs: (uid: string) => Response = () => Response.json(catalog)) {
  const payloads: ReturnType<typeof decode>[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("/model/list")) return catalogs(new Headers(init?.headers).get("Cosy-User") ?? "");
    if (String(url).includes("agent_chat_generation")) {
      payloads.push(decode(init as RequestInit));
      return reply();
    }
    throw new Error("Unexpected offline URL");
  });
  vi.stubGlobal("fetch", fetchMock);
  return { payloads, fetchMock };
}
function sse(text: string) {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line.split("\ndata: ")[1]));
}
function reconstructed(events: ReturnType<typeof sse>) {
  const blocks = new Map<number, { type: string; text: string }>();
  for (const event of events) {
    if (event.type === "content_block_start") blocks.set(event.index, { type: event.content_block.type, text: "" });
    if (event.type === "content_block_delta") {
      const block = blocks.get(event.index);
      expect(block).toBeDefined();
      expect(event.delta.type).toBe(
        block?.type === "thinking" ? "thinking_delta" : block?.type === "text" ? "text_delta" : "input_json_delta",
      );
      if (block) block.text += event.delta.text ?? event.delta.thinking ?? event.delta.partial_json;
    }
  }
  return [...blocks.values()];
}

beforeEach(() => {
  vi.spyOn(CosyVersion, "refreshGatewayCosyVersion").mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  client.auth.set.mockClear();
});

describe("magpie account identity regressions", () => {
  it.each([QoderPlugin, QoderCNPlugin])(
    "keeps two PAT accounts distinct when profiles have no email",
    async (factory) => {
      let current = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url, init) => {
          if (String(url).includes("exchange")) {
            current = JSON.parse(init.body).personal_token;
            return Response.json({
              token: `job-${current}`,
              refresh_token: `job-refresh-${current}`,
              expires_in: 3600_000,
            });
          }
          return Response.json({ id: current === "pt-first" ? "uid-first" : "uid-second" });
        }),
      );
      const plugin = await factory({ client });
      const method = plugin.auth.methods.at(-1);
      if (!method) throw new Error("Missing PAT method");
      const a = await method.authorize({ pat: "pt-first" });
      const b = await method.authorize({ pat: "pt-second" });
      expect(a).toMatchObject({
        type: "success",
        uid: "uid-first",
        accountId: "uid-first",
        email: "",
        access: "job-pt-first",
      });
      expect(b).toMatchObject({
        type: "success",
        uid: "uid-second",
        accountId: "uid-second",
        email: "",
        access: "job-pt-second",
      });
      expect(a).not.toMatchObject({ refresh: (b as { refresh: string }).refresh });
    },
  );
  it("does not invent an identity when both profile ID and email are unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        String(url).includes("exchange")
          ? Response.json({ token: "job", expires_in: 3600_000 })
          : new Response("unavailable", { status: 503 }),
      ),
    );
    const method = (await QoderPlugin({ client })).auth.methods.at(-1);
    expect(await method?.authorize({ pat: "pt-unknown" })).toMatchObject({ type: "success", email: "", accountId: "" });
  });
  it("normalizes refreshed identity and does not update the Pi model cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ token: "new-access", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);
    const plugin = await QoderPlugin({ client });
    expect(await plugin.auth.refresh({ ...auth, email: "user@qoder.com" })).toMatchObject({
      uid: auth.userID,
      accountId: auth.userID,
      email: "",
      access: "new-access",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(existsSync(join(process.env.HOME as string, ".pi/agent/qoder-models-cache.json"))).toBe(false);
  });
});

describe("magpie stable SSE blocks and stop reasons", () => {
  it("preserves mixed text/thinking from one upstream chunk", async () => {
    mockChat(() => new Response(chunk({ content: "pre<thinking>think</thinking>post" }, "stop") + done));
    const loader = await (await QoderPlugin({ client })).auth.loader(async () => auth);
    const response = await loader.fetch(request({ stream: true, thinking: { type: "enabled", budget_tokens: 2048 } }));
    expect(reconstructed(sse(await response.text()))).toEqual([
      { type: "text", text: "pre" },
      { type: "thinking", text: "think" },
      { type: "text", text: "post" },
    ]);
  });
  it("preserves block identity even when all pi-ai events are queued before consumption", async () => {
    mockChat(() => new Response(chunk({ content: "pre<thinking>think</thinking>post" }, "stop") + done));
    const parsed = parseQoderCatalog(catalog, "global");
    const model = parsed.models[0] as unknown as Model<Api>;
    const events = streamQoder(
      model,
      { messages: [{ role: "user", content: "hello", timestamp: 0 }] },
      { apiKey: auth.access, reasoning: "low" },
      auth as QoderCredentials,
      { modelConfig: parsed.configs.Auto, stableEvents: true, structuredErrors: true },
    );
    await events.result();
    const response = await messagesResponse(events, { ...messageBody, stream: true }, new AbortController());
    expect(reconstructed(sse(await response.text()))).toEqual([
      { type: "text", text: "pre" },
      { type: "thinking", text: "think" },
      { type: "text", text: "post" },
    ]);
  });
  it.each([false, true])("keeps max_tokens when a complete tool call ends at length (stream=%s)", async (stream) => {
    mockChat(
      () =>
        new Response(
          chunk({ tool_calls: [{ id: "c", function: { name: "read", arguments: "{}" } }] }, "length") + done,
        ),
    );
    const loader = await (await QoderPlugin({ client })).auth.loader(async () => auth);
    const response = await loader.fetch(request({ stream }));
    if (!stream)
      expect(await response.json()).toMatchObject({
        stop_reason: "max_tokens",
        content: [{ type: "tool_use", id: "c" }],
      });
    else
      expect(sse(await response.text()).find((e) => e.type === "message_delta")).toMatchObject({
        delta: { stop_reason: "max_tokens" },
      });
  });
});

describe("magpie HTTP and SSE error classification", () => {
  it.each([false, true].flatMap((stream) => [400, 401, 403, 429, 503].map((status) => ({ stream, status }))))(
    "preserves initial HTTP $status (stream=$stream) without server body",
    async ({ stream, status }) => {
      const sensitive = `arbitrary-server-body ${auth.access} ${auth.refresh} pt-SENSITIVE`;
      mockChat(() => new Response(sensitive, { status }));
      const loader = await (await QoderPlugin({ client })).auth.loader(async () => auth);
      const response = await loader.fetch(request({ stream }));
      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toContain("application/json");
      const body = await response.json();
      expect(body.error.type).toBe(
        (
          {
            400: "invalid_request_error",
            401: "authentication_error",
            403: "permission_error",
            429: "rate_limit_error",
            503: "api_error",
          } as Record<number, string>
        )[status],
      );
      expect(JSON.stringify(body)).not.toMatch(/arbitrary-server-body|SENSITIVE|message_start/);
    },
  );
  it.each(["access-SENSITIVE", "jrt-CURRENT", "pt-CURRENT"])(
    "redacts the current credential fragment %s even in a local validation error",
    async (secret) => {
      mockChat(() => new Response(chunk({ content: "unused" }, "stop") + done));
      const loader = await (await QoderPlugin({ client })).auth.loader(async () => ({
        ...auth,
        refresh: "pat|pt-CURRENT|jrt-CURRENT|account-A|machine",
      }));
      const response = await loader.fetch(request({ messages: [{ role: "user", content: [{ type: secret }] }] }));
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).not.toContain(secret);
      expect(text).toContain("[redacted]");
    },
  );
  it("preserves a pre-content envelope failure as HTTP 401", async () => {
    mockChat(() => new Response(envelope(`server body ${auth.access}`, 401)));
    const loader = await (await QoderPlugin({ client })).auth.loader(async () => auth);
    const response = await loader.fetch(request({ stream: true }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { type: "authentication_error" } });
  });
  it.each([401, 429, 400, 503])("classifies a midstream %s as SSE error without a success terminal", async (status) => {
    mockChat(
      () =>
        new Response(
          chunk({ content: "first" }) + envelope(`arbitrary-server-body ${auth.access} ${auth.refresh}`, status),
        ),
    );
    const loader = await (await QoderPlugin({ client })).auth.loader(async () => auth);
    const response = await loader.fetch(request({ stream: true }));
    expect(response.status).toBe(200);
    const text = await response.text();
    const events = sse(text);
    expect(events.find((e) => e.type === "error")?.error.type).toBe(
      (
        {
          400: "invalid_request_error",
          401: "authentication_error",
          429: "rate_limit_error",
          503: "api_error",
        } as Record<number, string>
      )[status],
    );
    expect(events.some((e) => e.type === "message_stop")).toBe(false);
    expect(text).not.toMatch(/arbitrary-server-body|SENSITIVE/);
  });
  it("classifies malformed upstream JSON as 502, while malformed client JSON is 400", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{not-json")));
    const loader = await (await QoderPlugin({ client })).auth.loader(async () => auth);
    expect((await loader.fetch(request())).status).toBe(502);
    const invalid = new Request("https://qoder.invalid/v1/messages", { method: "POST", body: "{not-json" });
    const response = await loader.fetch(invalid);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { type: "invalid_request_error" } });
  });
  it("preserves an identity endpoint 401 without exposing its body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`server-body ${auth.access}`, { status: 401 })));
    const loader = await (await QoderPlugin({ client })).auth.loader(async () => ({ ...auth, userID: undefined }));
    const response = await loader.fetch(request());
    expect(response.status).toBe(401);
    expect(await response.text()).not.toMatch(/server-body|SENSITIVE/);
  });
  it("returns an authentication error for expired credentials, rather than HTTP 400", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(`server-body ${auth.access} ${auth.refresh}`, { status: 401 })),
    );
    const loader = await (await QoderPlugin({ client })).auth.loader(async () => ({ ...auth, expires: 0 }));
    const response = await loader.fetch(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { type: "authentication_error" } });
  });
  it("classifies an unknown credential preparation failure as 502 and hides its message", async () => {
    const loader = await (await QoderPlugin({ client })).auth.loader(async () => {
      throw new Error(`server-body ${auth.access}`);
    });
    const response = await loader.fetch(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toMatch(/server-body|SENSITIVE/);
  });
  it("reports request cancellation after content as an SSE cancellation error", async () => {
    const abort = new AbortController();
    mockChat(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(chunk({ content: "first" })));
              abort.signal.addEventListener(
                "abort",
                () => controller.error(new DOMException("Aborted", "AbortError")),
                { once: true },
              );
            },
          }),
        ),
    );
    const loader = await (await QoderPlugin({ client })).auth.loader(async () => auth);
    const response = await loader.fetch(request({ stream: true }, abort.signal));
    abort.abort();
    const events = sse(await response.text());
    expect(events.find((e) => e.type === "error")?.error).toMatchObject({
      type: "api_error",
      message: "Qoder request cancelled",
    });
    expect(events.some((e) => e.type === "message_stop")).toBe(false);
  });
});

describe("magpie account model catalogs and upstream payload", () => {
  it("keeps account A's Lite config after listing account B's Second; failures do not borrow A's catalog", async () => {
    let failSecond = false;
    const { payloads } = mockChat(
      () => new Response(chunk({ content: "ok" }, "stop") + done),
      (uid) =>
        uid === auth.userID
          ? Response.json({
              chat: [
                {
                  ...auto,
                  key: "A-key",
                  display_name: "Lite",
                  context_config: {
                    small: { token_count: 200000, is_default: true },
                    large: { token_count: 1000000, is_default: false },
                  },
                },
              ],
            })
          : failSecond
            ? new Response("refused", { status: 503 })
            : Response.json({ chat: [{ ...auto, key: "B-key", display_name: "Second" }] }),
    );
    const plugin = await QoderPlugin({ client });
    expect(Object.keys(await plugin.provider.models({ models: {} }, { auth }))).toEqual(["Lite"]);
    expect(Object.keys(await plugin.provider.models({ models: {} }, { auth: second }))).toEqual(["Second"]);
    const loaderA = await plugin.auth.loader(async () => auth);
    const responseA = await loaderA.fetch(request({ model: "Lite", stream: false }));
    expect(responseA.status).toBe(200);
    expect(payloads[0].model_config.key).toBe("A-key");
    expect(payloads[0].model_config.context_config).toMatchObject({
      small: { is_default: false },
      large: { is_default: true },
    });
    expect(payloads[0].chat_context.extra.modelConfig.key).toBe("A-key");
    failSecond = true;
    const unknownAccount = { ...second, userID: "account-C", refresh: "third-refresh" };
    await expect(plugin.provider.models({ models: {} }, { auth: unknownAccount })).rejects.toMatchObject({
      status: 503,
    });
    const failed = await (await plugin.auth.loader(async () => unknownAccount)).fetch(
      request({ model: "Lite", stream: false }),
    );
    expect(failed.status).toBe(503);
    expect(payloads).toHaveLength(1);
    expect(existsSync(join(process.env.HOME as string, ".pi/agent/qoder-models-cache.json"))).toBe(false);
  });
  it("uses matching configs for equal model names, exposes supported variants, and maps budget to effort", async () => {
    const { payloads } = mockChat(
      () => new Response(chunk({ content: "ok" }, "stop") + done),
      (uid) =>
        Response.json({
          chat: [
            {
              ...auto,
              key: uid === auth.userID ? "low-key" : "high-key",
              thinking_config: { disabled: {}, enabled: { efforts: uid === auth.userID ? { low: {} } : { high: {} } } },
            },
          ],
        }),
    );
    const plugin = await QoderPlugin({ client });
    const aModels = await plugin.provider.models({ models: {} }, { auth });
    const bModels = await plugin.provider.models({ models: {} }, { auth: second });
    expect(Object.keys(aModels.Auto.variants)).toEqual(["none", "low"]);
    expect(Object.keys(bModels.Auto.variants)).toEqual(["none", "high"]);
    const loaderA = await plugin.auth.loader(async () => auth);
    const loaderB = await plugin.auth.loader(async () => second);
    expect(
      (await loaderA.fetch(request({ stream: false, thinking: { type: "enabled", budget_tokens: 2048 } }))).status,
    ).toBe(200);
    expect(
      (await loaderB.fetch(request({ stream: false, thinking: { type: "enabled", budget_tokens: 16000 } }))).status,
    ).toBe(200);
    expect(payloads.map((p) => [p.model_config.key, p.parameters.reasoning_effort])).toEqual([
      ["low-key", "low"],
      ["high-key", "high"],
    ]);
  });
  it("sends no tools for tool_choice none and retains tool error markers in the Qoder payload", async () => {
    const { payloads } = mockChat(() => new Response(chunk({ content: "ok" }, "stop") + done));
    const loader = await (await QoderPlugin({ client })).auth.loader(async () => auth);
    const response = await loader.fetch(
      request({
        stream: false,
        tools,
        tool_choice: { type: "none" },
        messages: [
          { role: "assistant", content: [{ type: "tool_use", id: "call", name: "read", input: {} }] },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "call", content: "Permission denied", is_error: true }],
          },
        ],
      }),
    );
    expect(response.status).toBe(200);
    expect(payloads[0].tools).toEqual([]);
    expect(payloads[0].messages.find((m: { role: string }) => m.role === "tool")).toMatchObject({
      tool_call_id: "call",
      content: "[Tool error]\nPermission denied",
    });
  });
});

describe("magpie credential cancellation and usage deadline", () => {
  it("aborts identity preparation when the client cancels", async () => {
    const abort = new AbortController();
    let identitySignal: AbortSignal | undefined;
    let started!: () => void;
    const reached = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        identitySignal = init.signal;
        started();
        return new Promise<Response>((_resolve, reject) =>
          identitySignal?.addEventListener("abort", () => reject(identitySignal?.reason), { once: true }),
        );
      }),
    );
    const loader = await (await QoderPlugin({ client })).auth.loader(async () => ({ ...auth, userID: undefined }));
    const result = loader.fetch(request({}, abort.signal));
    await reached;
    abort.abort();
    expect((await result).status).toBe(499);
    expect(identitySignal?.aborted).toBe(true);
    expect(client.auth.set).not.toHaveBeenCalled();
  });
  it("aborts refresh preparation without persisting a synthetic success", async () => {
    const abort = new AbortController();
    let refreshSignal: AbortSignal | undefined;
    let started!: () => void;
    const reached = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        refreshSignal = init.signal;
        started();
        return new Promise<Response>((_resolve, reject) =>
          refreshSignal?.addEventListener("abort", () => reject(refreshSignal?.reason), { once: true }),
        );
      }),
    );
    const loader = await (await QoderPlugin({ client })).auth.loader(async () => ({ ...auth, expires: 0 }));
    const result = loader.fetch(request({}, abort.signal));
    await reached;
    abort.abort();
    expect((await result).status).toBe(499);
    expect(refreshSignal?.aborted).toBe(true);
    expect(client.auth.set).not.toHaveBeenCalled();
  });
  it("applies the usage deadline before credential preparation starts", async () => {
    vi.useFakeTimers();
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      setTimeout(() => deadline.abort(new DOMException("Timed out", "TimeoutError")), ms);
      return deadline.signal;
    });
    let identitySignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        identitySignal = init.signal;
        return new Promise<Response>((_resolve, reject) =>
          identitySignal?.addEventListener("abort", () => reject(identitySignal?.reason), { once: true }),
        );
      }),
    );
    const plugin = await QoderPlugin({ client });
    const result = expect(plugin.auth.usage(async () => ({ ...auth, userID: undefined }))).rejects.toMatchObject({
      status: 504,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(identitySignal?.aborted).toBe(true);
  });
});
