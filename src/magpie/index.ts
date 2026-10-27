import { createHash } from "node:crypto";
import type { Api, Model, OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import { interactiveLogin } from "../auth/login.js";
import { type QoderCredentials, refreshQoderTokenForMode } from "../auth/oauth.js";
import { credentialsFromPat, fetchUserInfo } from "../auth/pat.js";
import { fetchQoderUsageForMode } from "../auth/usage.js";
import {
  fetchQoderCatalog,
  type QoderCatalog,
  type QoderModelDef,
  staticCnModels,
  staticModels,
  withMaxContextAsDefault,
} from "../catalog.js";
import { getMachineId } from "../cosy.js";
import { QoderHttpError } from "../protocol/errors.js";
import { streamQoder } from "../protocol/stream.js";
import { getQoderRegionConfig, type QoderMode } from "../region.js";
import { errorResponse, MessagesInputError, publicError } from "./errors.js";
import { type MessagesRequest, messagesResponse, requestContext } from "./messages.js";
import { quotaUsage } from "./usage.js";

type Auth =
  | (OAuthCredentials & {
      type: "oauth";
      userID?: string;
      name?: string;
      email?: string;
      machineID?: string;
      uid?: string;
      accountId?: string;
    })
  | { type: "api"; key: string };
type GetAuth = () => Promise<Auth>;
interface Client {
  auth: { set(input: { path: { id: string }; body: Auth }): Promise<unknown> };
}
interface Provider {
  models: Record<string, Record<string, unknown>>;
}

async function identity(auth: Auth, mode: QoderMode, signal?: AbortSignal): Promise<QoderCredentials> {
  if (auth.type === "api") return (await credentialsFromPat(auth.key, mode, signal)) as QoderCredentials;
  if (auth.userID)
    return {
      ...auth,
      machineID: auth.machineID || getMachineId(),
      email: auth.email || "",
      name: auth.name || "",
    } as QoderCredentials;
  return {
    ...auth,
    ...(await fetchUserInfo(auth.access, mode, signal, true)),
    machineID: auth.machineID || getMachineId(),
  } as QoderCredentials;
}

/** Host identity must never use shared profile placeholders as account IDs. */
function accountCredentials(creds: OAuthCredentials, mode: QoderMode) {
  const q = creds as QoderCredentials & { uid?: string; accountId?: string };
  const region = getQoderRegionConfig(mode);
  const uid = q.userID && q.userID !== "qoder-user" ? q.userID : q.uid;
  const email = q.email && q.email !== region.userEmailFallback ? q.email : "";
  return { ...q, email, uid, accountId: email || uid || "" };
}

function secretsOf(auth: Auth): string[] {
  return auth.type === "api" ? [auth.key] : [auth.access, auth.refresh, ...auth.refresh.split("|")];
}

function accountKey(creds: OAuthCredentials) {
  const parts = creds.refresh.split("|");
  return createHash("sha256")
    .update(parts[0] === "pat" ? parts[1] : creds.refresh || creds.access)
    .digest("hex");
}

function withSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    if (signal.aborted) {
      work.catch(() => {});
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function reasoningOf(body: MessagesRequest, model: Model<Api>) {
  if (!body.thinking || body.thinking.type === "disabled") return undefined;
  if (!["enabled", "adaptive"].includes(body.thinking.type)) throw new MessagesInputError("Unsupported thinking mode");
  if (!model.reasoning) return undefined;
  if (body.output_config?.effort) return body.output_config.effort;
  const budget = body.thinking.budget_tokens;
  return budget === undefined
    ? "high"
    : budget <= 4096
      ? "low"
      : budget <= 12000
        ? "medium"
        : budget <= 24000
          ? "high"
          : "xhigh";
}

function createPlugin(mode: QoderMode) {
  const region = getQoderRegionConfig(mode);
  const id = region.providerID;
  return async ({ client }: { client: Client }) => {
    const catalogs = new Map<string, QoderCatalog>();
    const credentials = async (getAuth: GetAuth, signal?: AbortSignal, secrets: string[] = []) => {
      const auth = await getAuth();
      if (!auth) throw new QoderHttpError("Sign in required", 401);
      secrets.push(...secretsOf(auth));
      signal?.throwIfAborted();
      let creds = accountCredentials(await identity(auth, mode, signal), mode);
      signal?.throwIfAborted();
      if (creds.expires <= Date.now()) {
        creds = accountCredentials(
          await refreshQoderTokenForMode(creds, mode, true, { signal, cacheModels: false }),
          mode,
        );
        signal?.throwIfAborted();
        secrets.push(creds.access, creds.refresh);
        await client.auth.set({ path: { id }, body: { ...creds, type: "oauth" } });
      } else if (auth.type === "api") await client.auth.set({ path: { id }, body: { ...creds, type: "oauth" } });
      return creds;
    };
    const catalogFor = async (creds: QoderCredentials, refresh = false, signal?: AbortSignal) => {
      const key = accountKey(creds);
      const cached = catalogs.get(key);
      if (cached && !refresh) return cached;
      const catalog = await fetchQoderCatalog(creds.access, creds.userID, creds.name, creds.email, mode, signal);
      catalog.configs = Object.fromEntries(
        Object.entries(catalog.configs).map(([modelId, config]) => [modelId, withMaxContextAsDefault(config)]),
      );
      catalogs.set(key, catalog);
      return catalog;
    };
    const models = (definitions: QoderModelDef[]) =>
      Object.fromEntries(
        definitions.map((model) => [
          model.id,
          {
            name: model.name,
            reasoning: model.reasoning,
            limit: { context: model.contextWindow, output: model.maxTokens },
            modalities: { input: model.input, output: ["text"] },
            variants: Object.fromEntries(
              Object.entries(model.thinkingLevelMap ?? {})
                .filter(([, value]) => value !== null && value !== undefined)
                .map(([level]) => [
                  level === "off" ? "none" : level,
                  level === "off"
                    ? { thinking: { type: "disabled" } }
                    : {
                        thinking: {
                          type: "enabled",
                          budgetTokens: (
                            { minimal: 1024, low: 2048, medium: 8192, high: 16000, xhigh: 32000, max: 64000 } as Record<
                              string,
                              number
                            >
                          )[level],
                        },
                        output_config: { effort: level },
                      },
                ]),
            ),
          },
        ]),
      );
    return {
      config: async (config: { provider?: Record<string, unknown> }) => {
        config.provider ??= {};
        config.provider[id] = {
          name: mode === "cn" ? "Qoder CN" : "Qoder",
          npm: "@ai-sdk/anthropic",
          api: "https://qoder.invalid/v1",
          models: models(mode === "cn" ? staticCnModels : staticModels),
        };
      },
      auth: {
        provider: id,
        methods: [
          ...(region.supportsBrowserLogin
            ? [
                {
                  type: "oauth",
                  label: "Browser OAuth",
                  async authorize() {
                    let show!: (value: { url: string; instructions?: string }) => void;
                    const shown = new Promise<{ url: string; instructions?: string }>((resolve) => {
                      show = resolve;
                    });
                    const result = interactiveLogin(
                      { onPrompt: async () => "", onAuth: show } as unknown as OAuthLoginCallbacks,
                      mode,
                    ).then(
                      (creds) => ({ ...accountCredentials(creds, mode), type: "success" as const }),
                      (error: unknown) => ({
                        type: "failed" as const,
                        error: publicError(error).error.message,
                      }),
                    );
                    const start = await Promise.race([shown, result]);
                    if (!("url" in start))
                      throw new Error("error" in start ? start.error : "Browser login did not start");
                    return { ...start, method: "auto", callback: () => result };
                  },
                },
              ]
            : []),
          {
            type: "api",
            label: "Personal Access Token",
            prompts: [
              {
                type: "text",
                key: "pat",
                message: "Qoder Personal Access Token (pt-...)",
                validate: (value: string) => (value.trim() ? undefined : "Token is required"),
              },
            ],
            async authorize(inputs: { pat?: string; credential?: string }) {
              const pat = (inputs.pat ?? inputs.credential ?? "").trim();
              if (!pat) return { type: "failed", error: "Token is required" };
              try {
                return { ...accountCredentials(await credentialsFromPat(pat, mode), mode), type: "success" };
              } catch (error) {
                return { type: "failed", error: publicError(error, [pat]).error.message };
              }
            },
          },
        ],
        refresh: async (auth: OAuthCredentials) => {
          try {
            return accountCredentials(await refreshQoderTokenForMode(auth, mode, true, { cacheModels: false }), mode);
          } catch (error) {
            const safe = publicError(error);
            throw new QoderHttpError(safe.error.message, safe.status);
          }
        },
        loader: async (getAuth: GetAuth) => ({
          apiKey: "qoder-local-adapter",
          async fetch(input: string | URL | Request, init?: RequestInit) {
            const request = new Request(input, init);
            if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/messages"))
              return errorResponse(new Error("Only Anthropic Messages requests are supported"), 400);
            const abort = new AbortController();
            const onAbort = () => abort.abort(request.signal.reason);
            if (request.signal.aborted) onAbort();
            else request.signal.addEventListener("abort", onAbort, { once: true });
            const secrets: string[] = [];
            try {
              abort.signal.throwIfAborted();
              let body: MessagesRequest;
              try {
                body = (await request.json()) as MessagesRequest;
              } catch {
                throw new MessagesInputError("Invalid JSON request");
              }
              if (!body || typeof body !== "object" || Array.isArray(body))
                throw new MessagesInputError("Expected a Messages request object");
              const creds = await withSignal(credentials(getAuth, abort.signal, secrets), abort.signal);
              const catalog = await withSignal(catalogFor(creds, false, abort.signal), abort.signal);
              const def = catalog.models.find((model) => model.id === body.model);
              if (!def || !catalog.configs[def.id]) throw new MessagesInputError(`Unknown ${id} model`);
              const model = def as unknown as Model<Api>;
              const context = requestContext(body, model);
              abort.signal.throwIfAborted();
              const reasoning = reasoningOf(body, model);
              const events = streamQoder(
                model,
                context,
                {
                  apiKey: creds.access,
                  maxTokens: body.max_tokens,
                  temperature: body.temperature,
                  reasoning,
                  signal: abort.signal,
                },
                creds,
                { modelConfig: catalog.configs[def.id], stableEvents: true, structuredErrors: true },
              );
              const response = await messagesResponse(
                events,
                body,
                abort,
                () => request.signal.removeEventListener("abort", onAbort),
                secrets,
              );
              return response;
            } catch (error) {
              request.signal.removeEventListener("abort", onAbort);
              return errorResponse(error, abort.signal.aborted ? 499 : undefined, secrets);
            }
          },
        }),
        usage: async (getAuth: GetAuth) => {
          const deadline = AbortSignal.timeout(10_000);
          const secrets: string[] = [];
          try {
            return await withSignal(
              (async () => {
                const creds = await credentials(getAuth, deadline, secrets);
                const usage = await fetchQoderUsageForMode(creds, mode, deadline);
                return {
                  plan: region.usageTitle,
                  user: creds.email || creds.name || undefined,
                  ...quotaUsage(usage.raw),
                };
              })(),
              deadline,
            );
          } catch (error) {
            const safe = publicError(error, secrets);
            throw new QoderHttpError(safe.error.message, safe.status);
          }
        },
      },
      provider: {
        id,
        models: async (provider: Provider, { auth }: { auth?: Auth }) => {
          let definitions = mode === "cn" ? staticCnModels : staticModels;
          if (auth) {
            try {
              const creds = await credentials(async () => auth);
              definitions = (await catalogFor(creds, true)).models;
            } catch (error) {
              const safe = publicError(error, secretsOf(auth));
              throw new QoderHttpError(safe.error.message, safe.status);
            }
          }
          const template = Object.values(provider.models)[0] ?? {};
          return Object.fromEntries(
            Object.entries(models(definitions)).map(([key, value]) => [
              key,
              {
                ...template,
                ...provider.models[key],
                ...value,
                id: key,
                capabilities: {
                  ...((template.capabilities as object) ?? {}),
                  reasoning: value.reasoning,
                  toolcall: true,
                  input: {
                    text: true,
                    image: value.modalities.input.includes("image"),
                    audio: false,
                    video: false,
                    pdf: false,
                  },
                  output: { text: true },
                },
                api: {
                  ...((template.api as object) ?? {}),
                  id: key,
                  npm: "@ai-sdk/anthropic",
                  url: "https://qoder.invalid/v1",
                },
              },
            ]),
          );
        },
      },
    };
  };
}

export const QoderPlugin = createPlugin("global");
export const QoderCNPlugin = createPlugin("cn");
