/**
 * The bandit's action space (spec §4.4). The type lives here since it
 * predates the bandit; the real selection logic is `src/bandit.ts`'s
 * `selectStrategy` as of Phase 5 — this file no longer implements it.
 *
 * This is the only thing left in stubs.ts as of Phase 7 — `importDocument`
 * moved to `src/ocr.ts` once it stopped being a stub, the same move Phase
 * 2/3/5 made for `retrievePolicy`/`generateDraft`/`selectStrategy`.
 */
export type DraftStrategy =
  | "lead_with_guideline"
  | "lead_with_treatment_history"
  | "lead_with_cost_effectiveness"
  | "verbatim_criteria";
