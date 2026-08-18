import { CellStatus } from "./types";

export interface ProgressSummary {
  total: number;
  pending: number;
  running: number;
  done: number;
  error: number;
}

export function summarizeProgress(statuses: CellStatus[]): ProgressSummary {
  const summary: ProgressSummary = { total: statuses.length, pending: 0, running: 0, done: 0, error: 0 };
  for (const s of statuses) summary[s]++;
  return summary;
}
