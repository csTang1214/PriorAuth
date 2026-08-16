import { invoke } from "@tauri-apps/api/core";
import type { Case } from "./types";
import type { DraftStrategy } from "./stubs";
import { retrievePolicy } from "./policy";
import { selectStrategy, type StrategySelection } from "./bandit";

export interface GeneratedDraft {
  text: string;
  strategy: DraftStrategy;
  reasoning: string;
}

/**
 * Real local LLM drafting (spec §4.3). Retrieves grounding via Phase 2's
 * `retrievePolicy`, picks a strategy via Phase 5's real bandit, then asks
 * the local Ollama server (via the `generate_draft_text` Rust command —
 * never called directly from the frontend, see development.md's Phase 3
 * design) to draft the letter. Returns which strategy was used and why, so
 * the caller can persist it (for later reward attribution) and show it.
 * Throws on failure; callers are responsible for a loading/error state
 * since this can take several seconds and Ollama may not be running.
 */
export async function generateDraft(caseRecord: Case): Promise<GeneratedDraft> {
  const policy = await retrievePolicy(caseRecord.payer, caseRecord.procedure, caseRecord.specialty);
  const selection: StrategySelection = await selectStrategy(caseRecord.payer, caseRecord.specialty);

  const text = await invoke<string>("generate_draft_text", {
    patientSummary: caseRecord.patient_summary,
    payer: caseRecord.payer,
    procedure: caseRecord.procedure,
    specialty: caseRecord.specialty,
    policyExcerpt: policy?.excerpt ?? null,
    strategy: selection.strategy,
  });

  return { text, strategy: selection.strategy, reasoning: selection.reasoning };
}
