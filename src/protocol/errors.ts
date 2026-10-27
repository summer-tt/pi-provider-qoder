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
