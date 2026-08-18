export interface ModelCallResult {
  /** Best-effort extracted text content of the response. */
  text: string;
  /** Full raw response body (JSON, stringified) — stored alongside parsed results per §3. */
  raw: string;
  usage: { inputTokens: number; outputTokens: number };
}

export class ModelCallError extends Error {
  constructor(message: string, public retryable: boolean, public status?: number) {
    super(message);
    this.name = "ModelCallError";
  }
}
