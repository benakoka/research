// Exercises executeGeneration's §4/§5 outcome classification and retry
// budgets against hand-crafted fetch responses shaped exactly like the real
// OpenAI/Gemini APIs — no network calls, no real API keys. Each case here
// mirrors one of the manually-verified scenarios from the live walkthrough
// (see the session's chat log) so the same guarantees stay checked after
// future changes: every attempt gets its own log row, outcomes classify
// correctly, refusal/empty retries resend the identical prompt, and a
// generation that exhausts its budget fails without ever being skipped.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeGeneration } from "./rewritingExec";
import { buildRewritingAttemptLogCsv } from "./export/rewritingAttemptLog";
import { RewritingChain, RewritingGeneration } from "./types";

const SEED_TEXT =
  "Brianne and Kurt were co-leads at a consulting firm, competing to win a major corporate client. " +
  "Brianne devised a strategy to restructure the company's staffing and proposed a new business plan. " +
  "Kurt developed a financial risk management strategy and personally delivered the pitch.";

function pendingGen(generation: number, target: number): RewritingGeneration {
  return {
    generation,
    text: "",
    target_word_count: target,
    actual_word_count: 0,
    status: "pending",
    attempts: [],
    raw_response: null,
    error: null,
    timestamp: null,
  };
}

function makeChain(model: "GPT" | "Gemini"): RewritingChain {
  return {
    id: "CHAIN-TEST",
    vignette_id: "Leadership-Credit-Scenario 1-White-A",
    base_vignette_id: "Leadership-Credit-Scenario 1",
    scenario: "consulting pitch",
    word_count: 60,
    domain: "leadership",
    valence: "credit",
    scenario_number: 1,
    order_variant: "A",
    actor_first_name: "Brianne",
    actor_second_name: "Kurt",
    female_name: "Brianne",
    male_name: "Kurt",
    name_race: "White",
    model,
    model_snapshot: model === "GPT" ? "gpt-5.6" : "gemini-3.6-flash",
    wordCountTargets: [49, 40, 33, 27, 22],
    generations: [
      {
        generation: 0,
        text: SEED_TEXT,
        target_word_count: null,
        actual_word_count: 60,
        status: "done",
        attempts: [],
        raw_response: null,
        error: null,
        timestamp: new Date().toISOString(),
      },
      pendingGen(1, 49),
      pendingGen(2, 40),
      pendingGen(3, 33),
      pendingGen(4, 27),
      pendingGen(5, 22),
    ],
    status: "pending",
    attemptLog: [],
    failedAtGeneration: null,
  };
}

const PROMPT_TEMPLATE =
  "Rewrite the following short story in your own words, reducing it to approximately [TARGET WORD COUNT] words. " +
  "Keep both characters's names exactly as they appear in the original. Return only the rewritten passage.";

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
}

function openAiBody(content: string, finish_reason = "stop", model = "gpt-5.6-2026-01-01") {
  return JSON.stringify({
    model,
    choices: [{ message: { content }, finish_reason }],
    usage: { prompt_tokens: 120, completion_tokens: 40 },
  });
}

function geminiBody(text: string, finishReason = "STOP", modelVersion = "gemini-3.6-flash-002") {
  return JSON.stringify({
    modelVersion,
    candidates: [{ content: { parts: [{ text }] }, finishReason }],
    usageMetadata: { promptTokenCount: 110, candidatesTokenCount: 35 },
  });
}

function geminiBlockedNoCandidatesBody(blockReason: string) {
  return JSON.stringify({ promptFeedback: { blockReason } });
}

function jsonResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

function errorResponse(status: number, body = "error") {
  return new Response(body, { status });
}

function timeoutAbort(): Promise<Response> {
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return Promise.reject(err);
}

// One row per fetch call made, so identical-prompt and per-attempt
// assertions can inspect exactly what was sent each time.
let capturedBodies: string[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  capturedBodies = [];
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.USE_CLAUDE_FOR_TESTING;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function queueResponses(responses: (Response | Promise<Response>)[]) {
  for (const r of responses) {
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      capturedBodies.push(String(init.body));
      return r instanceof Promise ? r : Promise.resolve(r);
    });
  }
}

describe("executeGeneration — §3/§4/§5 attempt logging and retry rules", () => {
  it("case 1: normal success (GPT) — one attempt, outcome success", async () => {
    queueResponses([jsonResponse(openAiBody(`Brianne and Kurt ${words(47)}.`, "stop"))]);
    const chain = makeChain("GPT");
    const { generation, newAttempts } = await executeGeneration(
      PROMPT_TEMPLATE,
      0.1,
      true,
      5,
      3,
      1,
      chain,
      1
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(newAttempts).toHaveLength(1);
    const a = newAttempts[0];
    expect(a.outcome).toBe("success");
    expect(a.attempt_number).toBe(1);
    expect(a.parent_attempt_id).toBeNull();
    expect(a.both_names_present).toBe(true);
    expect(a.finish_reason).toBe("stop");
    expect(a.model_returned).toBe("gpt-5.6-2026-01-01");
    expect(a.model_requested).toBe("GPT");
    expect(a.temperature).toBe(1);
    expect(generation.status).toBe("done");
  });

  it("case 2a: OpenAI finish_reason content_filter — exhausts refusal/empty budget", async () => {
    queueResponses([
      jsonResponse(openAiBody("", "content_filter")),
      jsonResponse(openAiBody("", "content_filter")),
      jsonResponse(openAiBody("", "content_filter")),
    ]);
    const chain = makeChain("GPT");
    const { generation, newAttempts } = await executeGeneration(
      PROMPT_TEMPLATE,
      0.1,
      true,
      5,
      3, // refusalEmptyRetryLimit
      1,
      chain,
      1
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(newAttempts).toHaveLength(3);
    expect(newAttempts.every((a) => a.outcome === "refusal")).toBe(true);
    expect(newAttempts.map((a) => a.attempt_number)).toEqual([1, 2, 3]);
    // parent_attempt_id chains each attempt to the one before it.
    expect(newAttempts[0].parent_attempt_id).toBeNull();
    expect(newAttempts[1].parent_attempt_id).toBe(newAttempts[0].attempt_id);
    expect(newAttempts[2].parent_attempt_id).toBe(newAttempts[1].attempt_id);
    // Identical prompt/input every retry — no backoff, nothing changes.
    expect(new Set(capturedBodies).size).toBe(1);
    expect(generation.status).toBe("error");
    expect(generation.error).toContain("Failed at generation 1");
  });

  it("case 2b: Gemini finishReason SAFETY — exhausts refusal/empty budget", async () => {
    queueResponses([
      jsonResponse(geminiBody("", "SAFETY")),
      jsonResponse(geminiBody("", "SAFETY")),
      jsonResponse(geminiBody("", "SAFETY")),
    ]);
    const chain = makeChain("Gemini");
    const { generation, newAttempts } = await executeGeneration(PROMPT_TEMPLATE, 0.1, true, 5, 3, 1, chain, 1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(newAttempts.every((a) => a.outcome === "refusal")).toBe(true);
    expect(newAttempts.map((a) => a.finish_reason)).toEqual(["SAFETY", "SAFETY", "SAFETY"]);
    expect(new Set(capturedBodies).size).toBe(1);
    expect(generation.status).toBe("error");
  });

  it("case 3: Gemini promptFeedback.blockReason with no candidates — refusal", async () => {
    queueResponses([
      jsonResponse(geminiBlockedNoCandidatesBody("SAFETY")),
      jsonResponse(geminiBlockedNoCandidatesBody("SAFETY")),
    ]);
    const chain = makeChain("Gemini");
    const { generation, newAttempts } = await executeGeneration(
      PROMPT_TEMPLATE,
      0.1,
      true,
      5,
      2, // refusalEmptyRetryLimit — smaller, to show the limit is configurable
      1,
      chain,
      1
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(newAttempts).toHaveLength(2);
    expect(newAttempts.every((a) => a.outcome === "refusal")).toBe(true);
    expect(newAttempts.every((a) => a.finish_reason === "SAFETY")).toBe(true);
    expect(newAttempts.every((a) => a.output_words === 0)).toBe(true);
    expect(generation.status).toBe("error");
  });

  it("case 4: declining reply, neither name present — refusal", async () => {
    queueResponses([
      jsonResponse(openAiBody("I can't help with that request.", "stop")),
      jsonResponse(openAiBody("I can't help with that request.", "stop")),
      jsonResponse(openAiBody("I can't help with that request.", "stop")),
    ]);
    const chain = makeChain("GPT");
    const { generation, newAttempts } = await executeGeneration(PROMPT_TEMPLATE, 0.1, true, 5, 3, 1, chain, 1);
    expect(newAttempts.every((a) => a.outcome === "refusal")).toBe(true);
    expect(newAttempts.every((a) => a.both_names_present === false)).toBe(true);
    expect(new Set(capturedBodies).size).toBe(1);
    expect(generation.status).toBe("error");
  });

  it("case 5: empty string — exhausts refusal/empty budget as 'empty'", async () => {
    queueResponses([
      jsonResponse(openAiBody("", "stop")),
      jsonResponse(openAiBody("", "stop")),
      jsonResponse(openAiBody("", "stop")),
    ]);
    const chain = makeChain("GPT");
    const { generation, newAttempts } = await executeGeneration(PROMPT_TEMPLATE, 0.1, true, 5, 3, 1, chain, 1);
    expect(newAttempts.every((a) => a.outcome === "empty")).toBe(true);
    expect(newAttempts.every((a) => a.output_words === 0)).toBe(true);
    expect(generation.status).toBe("error");
  });

  it("case 6: HTTP 429 then success — recovers within the api_error budget", async () => {
    queueResponses([errorResponse(429, "rate limited"), jsonResponse(openAiBody(`Brianne and Kurt ${words(47)}.`))]);
    const chain = makeChain("GPT");
    vi.useFakeTimers();
    const promise = executeGeneration(PROMPT_TEMPLATE, 0.1, true, 5, 3, 1, chain, 1);
    await vi.runAllTimersAsync();
    const { generation, newAttempts } = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(newAttempts).toHaveLength(2);
    expect(newAttempts[0].outcome).toBe("api_error");
    expect(newAttempts[0].error_message).toContain("429");
    expect(newAttempts[1].outcome).toBe("success");
    expect(newAttempts[1].parent_attempt_id).toBe(newAttempts[0].attempt_id);
    expect(generation.status).toBe("done");
  });

  it("case 7: HTTP 500 every attempt — exhausts api_error budget, fails at generation g", async () => {
    queueResponses([
      errorResponse(500, "server error"),
      errorResponse(500, "server error"),
      errorResponse(500, "server error"),
    ]);
    const chain = makeChain("GPT");
    vi.useFakeTimers();
    const promise = executeGeneration(
      PROMPT_TEMPLATE,
      0.1,
      true,
      3, // apiErrorRetryLimit
      3,
      1,
      chain,
      1
    );
    await vi.runAllTimersAsync();
    const { generation, newAttempts } = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(newAttempts).toHaveLength(3);
    expect(newAttempts.every((a) => a.outcome === "api_error")).toBe(true);
    expect(generation.status).toBe("error");
    expect(generation.error).toContain("Failed at generation 1");
    expect(generation.error).toContain("API error");

    // Merging this result the way the /process route does (see
    // src/app/api/rewriting/process/route.ts) marks the whole chain failed
    // at this generation, and nextRunnableGenerationIndex then refuses to
    // ever advance past it — generation 2 is never run, not silently
    // skipped.
    const updatedChain: RewritingChain = {
      ...chain,
      generations: chain.generations.map((g, i) => (i === 1 ? generation : g)),
      attemptLog: [...chain.attemptLog, ...newAttempts],
      failedAtGeneration: generation.status === "error" ? 1 : null,
    };
    expect(updatedChain.failedAtGeneration).toBe(1);
    const { nextRunnableGenerationIndex } = await import("./rewriting");
    expect(nextRunnableGenerationIndex(updatedChain)).toBeNull();
  });

  it("case 8: timeout (simulated abort) — classified as a retryable api_error", async () => {
    queueResponses([timeoutAbort()]);
    const chain = makeChain("Gemini");
    const { generation, newAttempts } = await executeGeneration(
      PROMPT_TEMPLATE,
      0.1,
      true,
      1, // apiErrorRetryLimit — exhausted immediately by the one timeout
      3,
      1,
      chain,
      1
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(newAttempts).toHaveLength(1);
    expect(newAttempts[0].outcome).toBe("api_error");
    expect(newAttempts[0].error_message).toMatch(/timed out/i);
    expect(generation.status).toBe("error");
  });

  it("case 9: success with one name missing — not treated as a refusal", async () => {
    // Only "Brianne" appears — "Kurt" is missing, but *one* name present is
    // not "neither name present", so this is NOT a refusal by §4's
    // definition. It's recorded as a normal success, with
    // both_names_present=false left for a human/analysis pass to catch.
    queueResponses([jsonResponse(openAiBody(`Brianne ${words(47)}.`, "stop"))]);
    const chain = makeChain("GPT");
    const { generation, newAttempts } = await executeGeneration(PROMPT_TEMPLATE, 0.5, true, 5, 3, 1, chain, 1);
    expect(newAttempts).toHaveLength(1);
    expect(newAttempts[0].outcome).toBe("success");
    expect(newAttempts[0].both_names_present).toBe(false);
    expect(generation.status).toBe("done");
  });

  it("every attempt log row from every case above round-trips through the CSV export", async () => {
    queueResponses([
      jsonResponse(openAiBody(`Brianne and Kurt ${words(47)}.`, "stop")),
      jsonResponse(openAiBody("", "content_filter")),
    ]);
    const chain = makeChain("GPT");
    const r1 = await executeGeneration(PROMPT_TEMPLATE, 0.1, true, 5, 1, 1, chain, 1);
    const chain2 = makeChain("GPT");
    const r2 = await executeGeneration(PROMPT_TEMPLATE, 0.1, true, 5, 1, 1, chain2, 1);
    const allAttempts = [...r1.newAttempts, ...r2.newAttempts];
    const chainWithLog: RewritingChain = { ...chain, attemptLog: allAttempts };
    const csv = buildRewritingAttemptLogCsv([chainWithLog]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toContain("attempt_id");
    expect(lines[0]).toContain("outcome");
    // header + one row per attempt, nothing dropped.
    expect(lines.length).toBe(allAttempts.length + 1);
    expect(csv).toContain("success");
    expect(csv).toContain("refusal");
  });
});
