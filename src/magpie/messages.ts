import { randomUUID } from "node:crypto";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
  Tool,
} from "@earendil-works/pi-ai";
import { errorResponse, MessagesInputError, publicError } from "./errors.js";

interface Block {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: Extract<AssistantMessage["content"][number], { type: "toolCall" }>["arguments"];
  tool_use_id?: string;
  content?: string | Block[];
  is_error?: boolean;
  source?: { type: string; media_type?: string; data?: string };
}
export interface MessagesRequest {
  model: string;
  messages: { role: "user" | "assistant"; content: string | Block[] }[];
  system?: string | Block[];
  tools?: { name: string; description?: string; input_schema: Tool["parameters"] }[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  thinking?: { type: string; budget_tokens?: number };
  output_config?: { effort?: SimpleStreamOptions["reasoning"] };
  tool_choice?: { type: string };
}

export const zeroUsage = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

function userContent(blocks: Block[]): Extract<Context["messages"][number], { role: "user" }>["content"] {
  return blocks.map((block) => {
    if (block.type === "text") return { type: "text" as const, text: block.text ?? "" };
    if (block.type === "image" && block.source?.type === "base64" && block.source.data && block.source.media_type) {
      return { type: "image" as const, data: block.source.data, mimeType: block.source.media_type };
    }
    throw new MessagesInputError(`Unsupported Messages content: ${block.type}`);
  });
}

/** Translate Messages explicitly; unknown blocks fail instead of losing tool history. */
export function requestContext(body: MessagesRequest, model: Model<Api>): Context {
  if (!Array.isArray(body.messages)) throw new MessagesInputError("Messages must be an array");
  if (body.tool_choice && !["auto", "none"].includes(body.tool_choice.type))
    throw new MessagesInputError("Qoder supports automatic tool choice only");
  if (
    body.tools &&
    (!Array.isArray(body.tools) ||
      body.tools.some(
        (tool) => !tool || typeof tool.name !== "string" || !tool.input_schema || typeof tool.input_schema !== "object",
      ))
  )
    throw new MessagesInputError("Invalid tools");
  const messages: Context["messages"] = [];
  const names = new Map<string, string>();
  for (const message of body.messages) {
    if (!message || (typeof message.content !== "string" && !Array.isArray(message.content)))
      throw new MessagesInputError("Invalid message content");
    const blocks = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
    if (blocks.some((block) => !block || typeof block.type !== "string"))
      throw new MessagesInputError("Invalid message block");
    if (message.role === "assistant") {
      const content: AssistantMessage["content"] = blocks.map((block) => {
        if (block.type === "text") return { type: "text", text: block.text ?? "" };
        if (block.type === "thinking")
          return { type: "thinking", thinking: block.thinking ?? "", thinkingSignature: block.signature };
        if (
          block.type === "tool_use" &&
          block.id &&
          block.name &&
          block.input &&
          typeof block.input === "object" &&
          !Array.isArray(block.input)
        ) {
          names.set(block.id, block.name);
          return { type: "toolCall", id: block.id, name: block.name, arguments: block.input };
        }
        throw new MessagesInputError(`Unsupported assistant block: ${block.type}`);
      });
      messages.push({
        role: "assistant",
        content,
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: zeroUsage(),
        stopReason: content.some((b) => b.type === "toolCall") ? "toolUse" : "stop",
        timestamp: Date.now(),
      });
    } else if (message.role === "user") {
      let pending: Block[] = [];
      const flush = () => {
        if (pending.length) messages.push({ role: "user", content: userContent(pending), timestamp: Date.now() });
        pending = [];
      };
      for (const block of blocks) {
        if (block.type !== "tool_result") {
          pending.push(block);
          continue;
        }
        flush();
        if (!block.tool_use_id || !names.has(block.tool_use_id))
          throw new MessagesInputError("Tool result has no matching tool call");
        if (block.content !== undefined && typeof block.content !== "string" && !Array.isArray(block.content))
          throw new MessagesInputError("Invalid tool result content");
        const resultContent = userContent(
          typeof block.content === "string" ? [{ type: "text", text: block.content }] : (block.content ?? []),
        ) as Extract<Context["messages"][number], { role: "toolResult" }>["content"];
        if (block.is_error) resultContent.unshift({ type: "text", text: "[Tool error]\n" });
        messages.push({
          role: "toolResult",
          toolCallId: block.tool_use_id,
          toolName: names.get(block.tool_use_id) as string,
          content: resultContent,
          isError: block.is_error ?? false,
          timestamp: Date.now(),
        });
      }
      flush();
    } else throw new MessagesInputError("Unsupported Messages role");
  }
  const systemPrompt =
    typeof body.system === "string"
      ? body.system
      : body.system
          ?.map((b) => {
            if (b.type !== "text") throw new MessagesInputError("Unsupported system block");
            return b.text ?? "";
          })
          .join("\n\n");
  return {
    systemPrompt,
    messages,
    tools:
      body.tool_choice?.type === "none"
        ? []
        : body.tools?.map((t) => ({ name: t.name, description: t.description ?? "", parameters: t.input_schema })),
  };
}

function contentOf(block: AssistantMessage["content"][number]) {
  if (block.type === "text") return { type: "text", text: block.text };
  if (block.type === "thinking")
    return { type: "thinking", thinking: block.thinking, signature: block.thinkingSignature ?? "" };
  if (block.type === "toolCall") return { type: "tool_use", id: block.id, name: block.name, input: block.arguments };
  throw new Error("Unsupported Qoder response block");
}
function usageOf(message: AssistantMessage) {
  return {
    input_tokens: message.usage.input,
    output_tokens: message.usage.output,
    cache_read_input_tokens: message.usage.cacheRead,
    cache_creation_input_tokens: message.usage.cacheWrite,
  };
}
function stopOf(message: AssistantMessage) {
  if (message.stopReason === "length") return "max_tokens";
  if (message.stopReason === "toolUse") return "tool_use";
  if (message.stopReason === "stop") return "end_turn";
  throw new Error(`Qoder stopped with ${message.stopReason}`);
}
function streamError(message: AssistantMessage): unknown {
  return (
    (message as AssistantMessage & { qoderError?: unknown }).qoderError ??
    new Error(message.errorMessage ?? "Qoder request failed")
  );
}

/** Tool arguments are emitted only after the shared Qoder parser validates them. */
export async function messagesResponse(
  events: AssistantMessageEventStream,
  body: MessagesRequest,
  abort: AbortController,
  onComplete: () => void = () => {},
  secrets: string[] = [],
): Promise<Response> {
  const id = `msg_${randomUUID()}`;
  if (body.stream === false) {
    try {
      let final: AssistantMessage | undefined;
      for await (const event of events) {
        if (event.type === "error") throw streamError(event.error);
        if (event.type === "done") final = event.message;
      }
      if (!final) throw new Error("Qoder stream ended without a result");
      return Response.json({
        id,
        type: "message",
        role: "assistant",
        model: body.model,
        content: final.content.map(contentOf),
        stop_reason: stopOf(final),
        stop_sequence: null,
        usage: usageOf(final),
      });
    } catch (error) {
      return errorResponse(error, undefined, secrets);
    } finally {
      onComplete();
    }
  }
  // Wait until there is output (or a terminal result) before committing HTTP 200.
  const iterator = events[Symbol.asyncIterator]();
  let first: Awaited<ReturnType<typeof iterator.next>>;
  try {
    while (true) {
      first = await iterator.next();
      if (first.done) throw new Error("Qoder stream ended without a result");
      const event = first.value;
      if (event.type === "error") throw streamError(event.error);
      if (event.type === "text_delta" || event.type === "thinking_delta" || event.type === "done") break;
    }
  } catch (error) {
    onComplete();
    return errorResponse(error, abort.signal.aborted ? 499 : undefined, secrets);
  }
  async function* remaining() {
    if (!first.done) yield first.value;
    while (true) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  }
  const encoder = new TextEncoder();
  let cancelled = false;
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const put = (type: string, value: object) => {
        if (!cancelled)
          controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`));
      };
      const indexes = new Map<object, number>();
      const emitted = new Map<object, number>();
      let next = 0;
      let finished = false;
      const begin = (block: AssistantMessage["content"][number]) => {
        let index = indexes.get(block);
        if (index !== undefined) return index;
        index = next++;
        indexes.set(block, index);
        const content =
          block.type === "text"
            ? { type: "text", text: "" }
            : block.type === "thinking"
              ? { type: "thinking", thinking: "", signature: "" }
              : { type: "tool_use", id: block.id, name: block.name, input: {} };
        put("content_block_start", { index, content_block: content });
        return index;
      };
      try {
        put("message_start", {
          message: {
            id,
            type: "message",
            role: "assistant",
            model: body.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        });
        for await (const event of remaining()) {
          if (event.type === "error") throw streamError(event.error);
          if (event.type === "text_delta" || event.type === "thinking_delta") {
            const block = (event as typeof event & { qoderBlock: AssistantMessage["content"][number] }).qoderBlock;
            if (!block) throw new Error("Missing stable Qoder block identity");
            const index = begin(block);
            emitted.set(block, (emitted.get(block) ?? 0) + event.delta.length);
            put("content_block_delta", {
              index,
              delta:
                event.type === "text_delta"
                  ? { type: "text_delta", text: event.delta }
                  : { type: "thinking_delta", thinking: event.delta },
            });
          }
          if (event.type === "done") {
            for (const block of event.message.content) {
              const index = begin(block);
              if (block.type === "toolCall")
                put("content_block_delta", {
                  index,
                  delta: { type: "input_json_delta", partial_json: JSON.stringify(block.arguments) },
                });
              else {
                const text = block.type === "text" ? block.text : block.thinking;
                const rest = text.slice(emitted.get(block) ?? 0);
                if (rest)
                  put("content_block_delta", {
                    index,
                    delta:
                      block.type === "text"
                        ? { type: "text_delta", text: rest }
                        : { type: "thinking_delta", thinking: rest },
                  });
              }
            }
            for (const index of indexes.values()) put("content_block_stop", { index });
            put("message_delta", {
              delta: { stop_reason: stopOf(event.message), stop_sequence: null },
              usage: usageOf(event.message),
            });
            put("message_stop", {});
            finished = true;
          }
        }
        if (!finished) throw new Error("Qoder stream ended without a result");
      } catch (error) {
        put("error", { error: publicError(error, secrets, abort.signal.aborted ? 499 : undefined).error });
      } finally {
        onComplete();
        if (!cancelled) controller.close();
      }
    },
    cancel(reason) {
      cancelled = true;
      abort.abort(reason);
      onComplete();
    },
  });
  return new Response(readable, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}
