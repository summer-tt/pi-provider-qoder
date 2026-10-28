import { QoderHttpError, QoderQueuedError } from "../protocol/errors.js";

export class MessagesInputError extends Error {}

export function publicError(error: unknown, secrets: string[] = [], statusOverride?: number) {
  const requestedStatus =
    statusOverride ??
    (error instanceof QoderHttpError
      ? error.status
      : error instanceof MessagesInputError
        ? 400
        : error instanceof DOMException && error.name === "AbortError"
          ? 499
          : error instanceof DOMException && error.name === "TimeoutError"
            ? 504
            : 502);
  const status =
    Number.isInteger(Number(requestedStatus)) && Number(requestedStatus) >= 400 && Number(requestedStatus) <= 599
      ? Number(requestedStatus)
      : 502;
  const type =
    status === 401
      ? "authentication_error"
      : status === 403
        ? "permission_error"
        : status === 429
          ? "rate_limit_error"
          : status === 400
            ? "invalid_request_error"
            : status === 529
              ? "overloaded_error"
              : "api_error";
  // Server bodies and arbitrary exception messages never cross this boundary.
  let message =
    status === 401
      ? "Qoder authentication failed"
      : status === 403
        ? "Qoder permission denied"
        : status === 429
          ? "Qoder rate limit exceeded"
          : status === 499
            ? "Qoder request cancelled"
            : `Qoder request failed (${status})`;
  if (error instanceof QoderQueuedError) message = error.message;
  else if (error instanceof MessagesInputError) message = error.message;
  else if (error instanceof Error && /^Invalid or incomplete tool-call JSON \(characters=\d+\)$/.test(error.message))
    message = error.message;
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length))
    message = message.split(secret).join("[redacted]");
  return { status, error: { type, message } };
}

export function errorResponse(error: unknown, status?: number, secrets: string[] = []): Response {
  const result = publicError(error, secrets, status);
  return Response.json(
    { type: "error", error: result.error },
    {
      status: result.status,
      headers:
        error instanceof QoderQueuedError && result.status === 429 && error.waitMs > 0
          ? { "retry-after": String(Math.ceil(error.waitMs / 1000)) }
          : undefined,
    },
  );
}
