import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Login from "../auth/login.js";
import * as Pat from "../auth/pat.js";
import * as Catalog from "../catalog.js";
import { QoderCNPlugin, QoderPlugin } from "../magpie/index.js";
import { requestContext } from "../magpie/messages.js";
import { quotaUsage } from "../magpie/usage.js";

const auth = {
  type: "oauth" as const,
  access: "account-token",
  refresh: "refresh|user|machine",
  expires: Date.now() + 3600_000,
  userID: "user",
  email: "user@example.com",
  name: "User",
  machineID: "machine",
};
const client = { auth: { set: vi.fn().mockResolvedValue(undefined) } };
const request = (body: object, signal?: AbortSignal) =>
  new Request("https://qoder.invalid/v1/messages", {
    method: "POST",
    body: JSON.stringify({ model: "Auto", messages: [{ role: "user", content: "Hi" }], ...body }),
    signal,
  });
function upstream(delta: object, finish = false) {
  return `data:${JSON.stringify({ statusCodeValue: 200, body: JSON.stringify({ choices: [{ delta, ...(finish ? { finish_reason: "stop" } : {}) }], usage: { prompt_tokens: 11, completion_tokens: 7 } }) })}\n\n`;
}
const reply =
  upstream({ reasoning_content: "Reason", content: "Hello" }) +
  upstream(
    {
      tool_calls: [
        { index: 0, id: "call1", function: { name: "read", arguments: '{"path":"a"}' } },
        { index: 1, id: "call2", function: { name: "read", arguments: '{"path":"b"}' } },
      ],
    },
    true,
  ) +
  "data: [DONE]\n\n";

beforeEach(() => {
  vi.spyOn(Catalog, "fetchQoderCatalog").mockImplementation(async (_token, _uid, _name, _email, mode) => ({
    models: mode === "cn" ? Catalog.staticCnModels : Catalog.staticModels,
    configs: Object.fromEntries(
      (mode === "cn" ? Catalog.staticCnModels : Catalog.staticModels).map((m) => [
        m.id,
        { key: m.upstreamKey, is_reasoning: m.reasoning },
      ]),
    ),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  client.auth.set.mockClear();
});

describe("magpie Messages adapter", () => {
  it("converts tools, thinking, interleaved user text and tool errors without dropping IDs", () => {
    const context = requestContext(
      {
        model: "Auto",
        tools: [{ name: "read", input_schema: { type: "object" } }],
        messages: [
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "plan" },
              { type: "tool_use", id: "c", name: "read", input: { path: "a" } },
            ],
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Before" },
              { type: "tool_result", tool_use_id: "c", content: "failed", is_error: true },
              { type: "text", text: "After" },
            ],
          },
        ],
      },
      { api: "qoder-api", provider: "qoder", id: "Auto" } as Model<Api>,
    );
    expect(context.messages.map((m) => m.role)).toEqual(["assistant", "user", "toolResult", "user"]);
    expect(context.messages[2]).toMatchObject({
      toolCallId: "c",
      toolName: "read",
      isError: true,
      content: [
        { type: "text", text: "[Tool error]\n" },
        { type: "text", text: "failed" },
      ],
    });
    expect(context.tools?.[0].name).toBe("read");
    expect(() =>
      requestContext(
        { model: "Auto", messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "missing" }] }] },
        {} as Model<Api>,
      ),
    ).toThrow("matching tool call");
  });

  it.each([QoderPlugin, QoderCNPlugin])(
    "registers an independent Anthropic provider and returns complete nonstream tools",
    async (factory) => {
      const plugin = await factory({ client });
      const config: { provider?: Record<string, unknown> } = {};
      await plugin.config(config);
      expect(config.provider?.[plugin.auth.provider]).toMatchObject({ npm: "@ai-sdk/anthropic" });
      const fetchMock = vi.fn().mockResolvedValue(new Response(reply));
      vi.stubGlobal("fetch", fetchMock);
      // A stale Pi identity must not replace the account getter's credentials.
      const piAuth = join(process.env.HOME as string, ".pi/agent/auth.json");
      writeFileSync(piAuth, JSON.stringify({ [plugin.auth.provider]: { ...auth, access: "other", userID: "other" } }));
      const before = readFileSync(piAuth, "utf8");
      const loader = await plugin.auth.loader(async () => auth);
      const response = await loader.fetch(request({ stream: false, thinking: { type: "enabled" } }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        type: "message",
        stop_reason: "tool_use",
        usage: { input_tokens: 11, output_tokens: 7 },
        content: [
          { type: "thinking", thinking: "Reason" },
          { type: "text", text: "Hello" },
          { type: "tool_use", id: "call1", input: { path: "a" } },
          { type: "tool_use", id: "call2", input: { path: "b" } },
        ],
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(readFileSync(piAuth, "utf8")).toBe(before);
    },
  );

  it("emits valid Messages SSE with thinking, both tools and terminal usage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(reply)));
    const loader = await (await QoderPlugin({ client })).auth.loader(async () => auth);
    const response = await loader.fetch(request({ stream: true }));
    const events = (await response.text())
      .split("\n\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line.split("\ndata: ")[1]));
    expect(events[0].type).toBe("message_start");
    expect(events.filter((e) => e.type === "content_block_start").map((e) => e.content_block.type)).toEqual([
      "thinking",
      "text",
      "tool_use",
      "tool_use",
    ]);
    expect(
      events.filter((e) => e.delta?.type === "input_json_delta").map((e) => JSON.parse(e.delta.partial_json)),
    ).toEqual([{ path: "a" }, { path: "b" }]);
    expect(events.at(-1).type).toBe("message_stop");
    expect(events.at(-2)).toMatchObject({
      delta: { stop_reason: "tool_use" },
      usage: { input_tokens: 11, output_tokens: 7 },
    });
  });

  it.each([false, true])("propagates upstream failure without a success result (stream=%s)", async (stream) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("refused", { status: 403 })));
    const loader = await (await QoderPlugin({ client })).auth.loader(async () => auth);
    const response = await loader.fetch(request({ stream }));
    const text = await response.text();
    expect(text).toContain("permission_error");
    expect(text).toContain('"type":"error"');
    expect(text).not.toContain('"type":"message_stop"');
    expect(response.status).toBe(403);
  });

  it("rejects malformed tool JSON instead of reporting success", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            `${upstream({ tool_calls: [{ id: "c", function: { name: "read", arguments: "{" } }] })}data: [DONE]\n\n`,
          ),
        ),
    );
    const loader = await (await QoderPlugin({ client })).auth.loader(async () => auth);
    const response = await loader.fetch(request({ stream: false }));
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("Invalid or incomplete tool-call JSON");
  });

  it("cancels the upstream request when the response is cancelled", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        signal = init.signal;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(upstream({ content: "first" })));
              signal?.addEventListener("abort", () => controller.error(new Error("Aborted")), { once: true });
            },
          }),
        );
      }),
    );
    const loader = await (await QoderPlugin({ client })).auth.loader(async () => auth);
    const response = await loader.fetch(request({ stream: true }));
    await response.body?.cancel();
    expect(signal?.aborted).toBe(true);
  });

  it("does not start upstream work for an already aborted request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const abort = new AbortController();
    abort.abort();
    const loader = await (await QoderPlugin({ client })).auth.loader(async () => auth);
    expect((await loader.fetch(request({}, abort.signal))).status).toBe(499);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("magpie quota", () => {
  it("keeps three balances separate and treats expiresAt as period expiration", () => {
    const result = quotaUsage({
      expiresAt: 1900000000000,
      userQuota: { total: 100, used: 100, remaining: 0 },
      addOnQuota: { remaining: 20 },
      orgResourcePackage: { cap: 200, used: 30 },
    });
    expect(result.until).toBe(new Date(1900000000000).toISOString());
    expect(result.windows).toHaveLength(3);
    expect(result.windows[0]).toMatchObject({ used: 100, aside: true });
    expect(result.windows[1]).not.toHaveProperty("used");
    expect(result.windows[1].display).toContain("20 remaining");
    expect(result.windows[2].used).toBe(15);
    expect(JSON.stringify(result)).not.toContain("resetsAt");
    expect(result.windows.every((w) => w.display.includes("expires"))).toBe(true);
  });
  it("does not invent zero balances or percentages for a zero total", () => {
    const result = quotaUsage({ userQuota: { total: 0 }, addOnQuota: { remaining: 7 } });
    expect(result.windows[0]).not.toHaveProperty("used");
    expect(result.windows[0]).not.toHaveProperty("amount");
    expect(result).not.toHaveProperty("until");
  });
  it("uses each account getter's token without a shared quota cache and bounds fetch to 10 seconds", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ userQuota: { remaining: 5 } }));
    vi.stubGlobal("fetch", fetchMock);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const plugin = await QoderCNPlugin({ client });
    await plugin.auth.usage(async () => auth);
    await plugin.auth.usage(async () => ({ ...auth, access: "second-account" }));
    expect(fetchMock.mock.calls.map((args) => args[1].headers.Authorization)).toEqual([
      "Bearer account-token",
      "Bearer second-account",
    ]);
    expect(timeout).toHaveBeenCalledWith(10000);
  });
});

it("generates a standalone manifest without Pi discovery, lifecycle hooks or coding-agent dependencies", () => {
  const target = join(process.env.HOME as string, "magpie-package.json");
  execFileSync(process.execPath, ["scripts/magpie-manifest.mjs", target]);
  const manifest = JSON.parse(readFileSync(target, "utf8"));
  expect(manifest.name).toBe("pi-provider-qoder");
  expect(manifest.main).toBe("./dist/magpie.js");
  expect(manifest.pi).toBeUndefined();
  expect(manifest.scripts).toBeUndefined();
  expect(manifest.keywords).not.toContain("pi-package");
  expect(Object.keys(manifest.dependencies)).toEqual(["@earendil-works/pi-ai"]);
});

describe("magpie account hooks", () => {
  it("adapts the existing browser callbacks to an OpenCode auto callback", async () => {
    let finish!: (value: typeof auth) => void;
    const pending = new Promise<typeof auth>((resolve) => {
      finish = resolve;
    });
    const login = vi.spyOn(Login, "interactiveLogin").mockImplementation(async (callbacks) => {
      const adapted = callbacks as unknown as {
        onPrompt: () => Promise<string>;
        onAuth: (value: { url: string; instructions: string }) => void;
      };
      expect(await adapted.onPrompt()).toBe("");
      adapted.onAuth({ url: "https://qoder.com/device/test", instructions: "Sign in" });
      return pending;
    });
    const plugin = await QoderPlugin({ client });
    const authorization = await plugin.auth.methods[0].authorize({});
    expect(authorization).toMatchObject({ url: "https://qoder.com/device/test", method: "auto" });
    finish(auth);
    if (!("callback" in authorization)) throw new Error("Missing OAuth callback");
    expect(await authorization.callback()).toMatchObject({
      type: "success",
      access: auth.access,
      refresh: auth.refresh,
    });
    expect(login).toHaveBeenCalledOnce();
  });
  it.each([QoderPlugin, QoderCNPlugin])(
    "exchanges PAT input through the existing Qoder implementation",
    async (factory) => {
      const exchange = vi.spyOn(Pat, "credentialsFromPat").mockResolvedValue(auth);
      const plugin = await factory({ client });
      const method = plugin.auth.methods.at(-1);
      if (!method) throw new Error("Missing PAT method");
      expect(await method.authorize({ pat: "  pt-test  " })).toMatchObject({ type: "success", refresh: auth.refresh });
      expect(exchange).toHaveBeenCalledWith("pt-test", plugin.auth.provider === "qoder-cn" ? "cn" : "global");
    },
  );
  it("rejects a failed refresh rather than extending an invalid token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("refused", { status: 401 })));
    const plugin = await QoderPlugin({ client });
    await expect(plugin.auth.refresh(auth)).rejects.toThrow("Qoder authentication failed");
  });
  it("reads dynamic models using the account credentials and retains model capabilities", async () => {
    const update = vi.mocked(Catalog.fetchQoderCatalog);
    const plugin = await QoderCNPlugin({ client });
    const models = await plugin.provider.models(
      { models: { Auto: { capabilities: { reasoning: false }, api: { id: "Auto" } } } },
      { auth },
    );
    expect(update).toHaveBeenCalledWith(auth.access, auth.userID, auth.name, auth.email, "cn", undefined);
    expect(models.Auto).toMatchObject({
      id: "Auto",
      api: { id: "Auto", npm: "@ai-sdk/anthropic" },
      capabilities: { toolcall: true, input: { text: true } },
    });
    expect(Object.keys(models).length).toBeGreaterThan(1);
  });
});
