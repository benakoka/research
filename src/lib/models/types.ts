export interface ModelCallResult {
  /** Best-effort extracted text content of the response. */
  text: string;
  /** Full raw response body (JSON, stringified) — stored alongside parsed results per §3. */
  raw: string;
  usage: { inputTokens: number; outputTokens: number };
  /** The model/version string the API itself echoed back (OpenAI's `model`, Gemini's `modelVersion`) — null if the response didn't include one. */
  modelReturned: string | null;
  /** The API's own finish/block reason (OpenAI `finish_reason`, Gemini `finishReason`/`promptFeedback.blockReason`) — null if none was reported. */
  finishReason: string | null;
}

export class ModelCallError extends Error {
  constructor(message: string, public retryable: boolean, public status?: number) {
    super(message);
    this.name = "ModelCallError";
  }
}
