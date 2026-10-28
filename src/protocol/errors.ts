/** Preserve HTTP status across the pi-ai event stream without parsing error text. */
export class QoderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "QoderHttpError";
  }
}

/** Validated scheduler information; never retains an upstream body or message. */
export class QoderQueuedError extends QoderHttpError {
  readonly waitMs: number;
  readonly queueCount?: number;
  readonly queueType?: string;

  constructor(waitMs: number, queueCount?: number, queueType?: string) {
    const wait = Number.isSafeInteger(waitMs) && waitMs > 0 ? waitMs : 0;
    const count =
      typeof queueCount === "number" && Number.isSafeInteger(queueCount) && queueCount >= 0 ? queueCount : undefined;
    const tier = typeof queueType === "string" && /^p[0-9]{1,2}$/.test(queueType) ? queueType : undefined;
    const ahead = count !== undefined ? `, ${count} ahead` : "";
    const label = tier ? ` (${tier})` : "";
    super(
      `Qoder model is busy: request queued (10605 CALL_COUNT_LIMIT${label}${ahead}, ~${Math.round(wait / 1000)}s wait, rate limit, retry-after-ms=${wait})`,
      429,
    );
    this.name = "QoderQueuedError";
    this.waitMs = wait;
    this.queueCount = count;
    this.queueType = tier;
  }
}
