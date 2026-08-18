// Pure logic only — no server secrets, no fetch calls. Safe to import from
// client components (e.g. to build a run's initial cells before sending
// batches to /api/attribution/process) as well as from API routes. The
// model-calling half of this lives in lib/attributionExec.ts, which is
// server-only.
import {
  AttributionCell,
  ScaleDirection,
  VignetteRow,
  ModelProvider,
} from "./types";

const MODELS: ModelProvider[] = ["GPT", "Gemini"];
const DIRECTIONS: ScaleDirection[] = ["as_written", "flipped"];

/** Which name fills the [FEMALE NAME]/[MALE NAME] slots for a given scale direction (§3). */
function slotNames(row: VignetteRow, direction: ScaleDirection) {
  if (direction === "as_written") {
    return { femaleSlotName: row.female_name, maleSlotName: row.male_name };
  }
  // Flipped: swap which name fills which slot.
  return { femaleSlotName: row.male_name, maleSlotName: row.female_name };
}

export function buildAttributionPrompt(
  template: string,
  femaleSlotName: string,
  maleSlotName: string
): string {
  return template
    .replaceAll("[FEMALE NAME]", femaleSlotName)
    .replaceAll("[MALE NAME]", maleSlotName);
}

/**
 * Parses the numeric rating out of a model response. Models were instructed
 * to "Respond with only the number" but may still add commentary — this
 * extracts the first signed number rather than silently failing, while still
 * surfacing a parse error when nothing numeric is found (§3).
 */
export function parseRating(rawText: string): { rating: number | null; parseError: string | null } {
  const trimmed = rawText.trim();
  const direct = Number(trimmed);
  if (Number.isFinite(direct) && trimmed !== "") {
    return { rating: direct, parseError: null };
  }
  const match = trimmed.match(/-?\d+(\.\d+)?/);
  if (match) {
    return { rating: Number(match[0]), parseError: null };
  }
  return { rating: null, parseError: "No numeric rating found in response." };
}

export function cellId(vignetteId: string, direction: ScaleDirection, model: ModelProvider, rep: number): string {
  return `${vignetteId}::${direction}::${model}::rep${rep}`;
}

/** Builds the full set of pending cells for a run: rows × 2 directions × 2 models × reps. */
export function buildAttributionCells(
  rows: VignetteRow[],
  repCount: number,
  gptModelSnapshot: string,
  geminiModelSnapshot: string
): AttributionCell[] {
  const snapshotFor: Record<ModelProvider, string> = {
    GPT: gptModelSnapshot,
    Gemini: geminiModelSnapshot,
  };
  const cells: AttributionCell[] = [];
  for (const row of rows) {
    for (const direction of DIRECTIONS) {
      const { femaleSlotName, maleSlotName } = slotNames(row, direction);
      for (const model of MODELS) {
        for (let rep = 1; rep <= repCount; rep++) {
          cells.push({
            id: cellId(row.vignette_id, direction, model, rep),
            vignette_id: row.vignette_id,
            domain: row.domain,
            valence: row.valence,
            scenario_number: row.scenario_number,
            order_variant: row.order_variant,
            female_name: row.female_name,
            male_name: row.male_name,
            vignette_text: row.vignette_text,
            scale_direction: direction,
            plus50_name: femaleSlotName,
            minus50_name: maleSlotName,
            model,
            model_snapshot: snapshotFor[model],
            rep,
            status: "pending",
            rating: null,
            raw_response: null,
            parse_error: null,
            error: null,
            timestamp: null,
          });
        }
      }
    }
  }
  return cells;
}
