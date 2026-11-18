// Covers the attempt-log recovery path (applyAttemptLogToChains): rebuilding
// a run's completed-so-far progress from a previously-exported attempt log
// when this browser's own saved state was lost — see the chat log for why
// this exists (a real run lost most of its progress to a storage bug).
// Matching has to survive the rebuilt chains having completely different
// chain_ids than the original run (build order isn't guaranteed to match),
// which is exactly what these tests exercise.
import { describe, expect, it } from "vitest";
import { applyAttemptLogToChains, buildRewritingChains } from "./rewriting";
import { buildRewritingAttemptLogCsv } from "./export/rewritingAttemptLog";
import { parseAttemptLogCsv } from "./export/rewritingAttemptLog";
import { RewriteAttemptLog, VignetteRow } from "./types";

function makeRow(vignette_id: string, text: string): VignetteRow {
  return {
    vignette_id,
    base_vignette_id: vignette_id.replace(/-(White|Black|Hispanic)-[AB]$/, ""),
    scenario: "consulting pitch",
    domain: "leadership",
    valence: "credit",
    scenario_number: 1,
    order_variant: "A",
    actor_first_name: "Brianne",
    actor_second_name: "Kurt",
    female_name: "Brianne",
    male_name: "Kurt",
    vignette_text: text,
    name_race: "White",
    word_count: 60,
  };
}

const SEED_A = "Brianne and Kurt were co-leads at a consulting firm. Brianne devised a strategy. Kurt delivered the pitch.";
const SEED_B = "Brianne and Kurt achieved a historic breakthrough together in their consulting work this year.";

function makeSuccessAttempt(
  vignette_id: string,
  model: "GPT" | "Gemini",
  generation: number,
  text: string,
  timestamp: string
): RewriteAttemptLog {
  return {
    attempt_id: `attempt-${vignette_id}-${model}-${generation}`,
    chain_id: "CHAIN-ORIGINAL-WHATEVER",
    vignette_id,
    base_vignette_id: vignette_id.replace(/-(White|Black|Hispanic)-[AB]$/, ""),
    name_race: "White",
    order_variant: "A",
    model_requested: model,
    model_returned: model === "GPT" ? "gpt-6.2-sol-2026" : "gemini-4-hydrogen-2026",
    temperature: 1,
    generation,
    attempt_number: 1,
    parent_attempt_id: null,
    target_words: 40,
    output_words: 41,
    word_diff: 1,
    outcome: "success",
    finish_reason: "stop",
    error_message: null,
    timestamp,
    input_tokens: 100,
    output_tokens: 40,
    both_names_present: true,
    output_text: text,
    raw_response: JSON.stringify({ ok: true }),
  };
}

describe("applyAttemptLogToChains — recovering a run from an exported attempt log", () => {
  it("restores every generation the log shows as successful, matched by vignette_id+model", () => {
    const rows = [makeRow("Leadership-Credit-Scenario 1-White-A", SEED_A), makeRow("Leadership-Credit-Scenario 1-White-B", SEED_B)];
    const freshChains = buildRewritingChains(rows, [49, 40, 33, 27, 22], "gpt-6.2-sol", "gemini-4-hydrogen", {
      GPT: true,
      Gemini: true,
    });

    const log: RewriteAttemptLog[] = [
      makeSuccessAttempt("Leadership-Credit-Scenario 1-White-A", "GPT", 1, "GPT gen1 text", "2026-01-01T00:00:01Z"),
      makeSuccessAttempt("Leadership-Credit-Scenario 1-White-A", "GPT", 2, "GPT gen2 text", "2026-01-01T00:00:02Z"),
      // Gen 3 for this chain is missing — gen4/5 must stay pending even
      // though they're not in the log at all, same as gen3.
      makeSuccessAttempt("Leadership-Credit-Scenario 1-White-A", "Gemini", 1, "Gemini gen1 text", "2026-01-01T00:00:03Z"),
      // Row B has no attempts logged at all — must come back entirely untouched.
    ];

    const recovered = applyAttemptLogToChains(freshChains, log);

    const gptA = recovered.find((c) => c.vignette_id === "Leadership-Credit-Scenario 1-White-A" && c.model === "GPT")!;
    expect(gptA.generations[1].status).toBe("done");
    expect(gptA.generations[1].text).toBe("GPT gen1 text");
    expect(gptA.generations[2].status).toBe("done");
    expect(gptA.generations[2].text).toBe("GPT gen2 text");
    // The gap at gen3 must block gen4/5 from being (wrongly) marked done.
    expect(gptA.generations[3].status).toBe("pending");
    expect(gptA.generations[4].status).toBe("pending");
    expect(gptA.generations[5].status).toBe("pending");
    expect(gptA.failedAtGeneration).toBeNull();

    const geminiA = recovered.find((c) => c.vignette_id === "Leadership-Credit-Scenario 1-White-A" && c.model === "Gemini")!;
    expect(geminiA.generations[1].status).toBe("done");
    expect(geminiA.generations[1].text).toBe("Gemini gen1 text");
    expect(geminiA.generations[2].status).toBe("pending");

    const gptB = recovered.find((c) => c.vignette_id === "Leadership-Credit-Scenario 1-White-B" && c.model === "GPT")!;
    expect(gptB.generations.slice(1).every((g) => g.status === "pending")).toBe(true);
  });

  it("matches correctly even when the rebuilt chains have different chain_ids than the original run", () => {
    // Simulates the real recovery scenario: the ORIGINAL run (whose log we're
    // reading) assigned chain_ids in some order; after a storage reset, the
    // rebuilt chains start a fresh CHAIN-0001 counter over a possibly
    // reordered/filtered row set. Matching must not depend on chain_id lining up.
    const originalRowOrder = [
      makeRow("Leadership-Credit-Scenario 1-White-A", SEED_A),
      makeRow("Leadership-Credit-Scenario 1-White-B", SEED_B),
    ];
    const originalChains = buildRewritingChains(originalRowOrder, [49, 40, 33, 27, 22], "gpt-6.2-sol", "gemini-4-hydrogen", {
      GPT: true,
      Gemini: true,
    });
    // CHAIN-0001 = row A/GPT in the original build order.
    expect(originalChains[0].id).toBe("CHAIN-0001");

    const log = [makeSuccessAttempt("Leadership-Credit-Scenario 1-White-A", "GPT", 1, "recovered text", "2026-01-01T00:00:00Z")];

    // Rebuild with the rows in the OPPOSITE order — chain_ids now land
    // differently (CHAIN-0001 is row B/GPT this time), but vignette_id-based
    // matching should still find row A's GPT chain correctly.
    const reorderedRows = [...originalRowOrder].reverse();
    const rebuiltChains = buildRewritingChains(reorderedRows, [49, 40, 33, 27, 22], "gpt-6.2-sol", "gemini-4-hydrogen", {
      GPT: true,
      Gemini: true,
    });
    expect(rebuiltChains[0].vignette_id).toBe("Leadership-Credit-Scenario 1-White-B"); // confirms the reorder actually took effect

    const recovered = applyAttemptLogToChains(rebuiltChains, log);
    const gptA = recovered.find((c) => c.vignette_id === "Leadership-Credit-Scenario 1-White-A" && c.model === "GPT")!;
    expect(gptA.generations[1].status).toBe("done");
    expect(gptA.generations[1].text).toBe("recovered text");
  });

  it("round-trips through the real CSV export/import (the actual recovery file format)", () => {
    const rows = [makeRow("Leadership-Credit-Scenario 1-White-A", SEED_A)];
    const freshChains = buildRewritingChains(rows, [49, 40, 33, 27, 22], "gpt-6.2-sol", "gemini-4-hydrogen", {
      GPT: true,
      Gemini: false,
    });
    const originalLog = [
      makeSuccessAttempt("Leadership-Credit-Scenario 1-White-A", "GPT", 1, "line one\nline two, with a comma", "2026-01-01T00:00:00Z"),
    ];
    // Attach it the way a real chain would carry it, export it, then throw
    // away everything and only keep the CSV text — exactly what survives a
    // storage reset in practice.
    const chainWithLog = { ...freshChains[0], attemptLog: originalLog };
    const csv = buildRewritingAttemptLogCsv([chainWithLog]);

    const parsedLog = parseAttemptLogCsv(csv);
    expect(parsedLog).toHaveLength(1);
    expect(parsedLog[0].output_text).toBe("line one\nline two, with a comma");

    const recovered = applyAttemptLogToChains(freshChains, parsedLog);
    expect(recovered[0].generations[1].status).toBe("done");
    expect(recovered[0].generations[1].text).toBe("line one\nline two, with a comma");
  });
});
