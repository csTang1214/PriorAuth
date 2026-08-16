/**
 * The bandit's action space (spec §4.4). The type lives here since it
 * predates the bandit; the real selection logic is `src/bandit.ts`'s
 * `selectStrategy` as of Phase 5 — this file no longer implements it.
 */
export type DraftStrategy =
  | "lead_with_guideline"
  | "lead_with_treatment_history"
  | "lead_with_cost_effectiveness"
  | "verbatim_criteria";

/**
 * Stub for OCR document import (spec §4.1). Not wired to any UI control yet
 * — the New Case screen's import button stays disabled until Phase 7.
 */
export function importDocument(_file: File): Promise<string> {
  return Promise.reject(new Error("Document import is not implemented yet."));
}
