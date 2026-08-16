import Database from "@tauri-apps/plugin-sql";
import type { Case, NewCaseInput, CaseStatus, CaseOutcome } from "./types";
import type { DraftStrategy } from "./stubs";
import { normalizedEditDistance } from "./editDistance";
import { recordReward, outcomeReward } from "./bandit";

let dbPromise: ReturnType<typeof Database.load> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:priorauth.db");
  }
  return dbPromise;
}

export async function listCases(): Promise<Case[]> {
  const db = await getDb();
  // `id DESC` tiebreaks `created_at` (only second-resolution) so two cases
  // created within the same second still sort deterministically — caught by
  // the automated test suite, not observed live, but a real gap: nothing
  // about "created within the same second" is actually rare.
  return db.select<Case[]>("SELECT * FROM cases ORDER BY created_at DESC, id DESC");
}

export async function getCase(id: number): Promise<Case | null> {
  const db = await getDb();
  const rows = await db.select<Case[]>("SELECT * FROM cases WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function createCase(input: NewCaseInput): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO cases (patient_summary, payer, plan_type, procedure, specialty)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.patient_summary, input.payer, input.plan_type || null, input.procedure, input.specialty || null],
  );
  return result.lastInsertId as number;
}

/**
 * Persists the editable draft — and, as of Phase 5, also the generation
 * metadata (`generated_draft_text`, `draft_strategy`) needed to compute the
 * fast-reward signal later at Approve. Originally these only got written by
 * `approveCase`, which meant "generate → save for later → come back →
 * approve" silently lost the strategy attribution and edit-distance
 * baseline on the round trip, even though generation had genuinely
 * succeeded — caught during the Phase 1–5 deep test pass. `saveDraft` is
 * also called right after a fresh generation completes (not just when the
 * user clicks "Save without approving"), so this metadata survives a
 * navigate-away-and-back before the case is ever approved.
 */
export async function saveDraft(
  id: number,
  draftText: string,
  generatedDraftText: string | null = null,
  strategy: DraftStrategy | null = null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE cases
     SET draft_text = $1,
         generated_draft_text = COALESCE($2, generated_draft_text),
         draft_strategy = COALESCE($3, draft_strategy),
         updated_at = datetime('now')
     WHERE id = $4`,
    [draftText, generatedDraftText, strategy, id],
  );
}

export async function setStatus(id: number, status: CaseStatus): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE cases SET status = $1, updated_at = datetime('now') WHERE id = $2",
    [status, id],
  );
}

/**
 * The real "submitted" moment (spec §4.5/§4.6) — snapshots the response
 * deadline, persists which bandit arm was pulled (Phase 5), and records the
 * fast-reward edit-distance signal (§4.4) at the one point where all three
 * are meaningful to compute. `generatedDraftText` is null when generation
 * never produced anything to compare against (e.g. Ollama was unavailable
 * or refused twice — see the Refusal Detection section — and staff wrote
 * the letter from scratch) — edit_distance stays NULL, and no fast-reward
 * bandit event is recorded, rather than fabricating a signal from nothing.
 */
export async function approveCase(
  id: number,
  finalDraftText: string,
  generatedDraftText: string | null,
  responseWindowDays: number,
  strategy: DraftStrategy | null,
  payer: string,
  specialty: string | null,
): Promise<void> {
  const db = await getDb();
  const editDistance =
    generatedDraftText !== null ? normalizedEditDistance(generatedDraftText, finalDraftText) : null;

  await db.execute(
    `UPDATE cases
     SET draft_text = $1,
         status = 'submitted',
         submitted_at = datetime('now'),
         response_window_days = $2,
         edit_distance = $3,
         generated_draft_text = $4,
         draft_strategy = $5,
         updated_at = datetime('now')
     WHERE id = $6`,
    [finalDraftText, responseWindowDays, editDistance, generatedDraftText, strategy, id],
  );

  if (strategy !== null && editDistance !== null) {
    await recordReward(id, payer, specialty, strategy, "fast", 1 - editDistance);
  }
}

/**
 * Low-friction outcome logging (spec §4.5) — the single click that feeds
 * Phase 5's slow reward signal. Takes the full case (not just the id) since
 * the bandit event needs payer/specialty/draft_strategy, all of which the
 * caller already has in memory from the case list — avoids a redundant
 * round-trip just to look them up again.
 */
export async function markOutcome(caseRecord: Case, outcome: CaseOutcome): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE cases SET status = $1, decided_at = datetime('now'), updated_at = datetime('now') WHERE id = $2",
    [outcome, caseRecord.id],
  );

  if (caseRecord.draft_strategy) {
    await recordReward(
      caseRecord.id,
      caseRecord.payer,
      caseRecord.specialty,
      caseRecord.draft_strategy,
      "slow",
      outcomeReward(outcome),
    );
  }
}

/**
 * Deletes every case and everything that references one. `bandit_events.case_id`
 * is a foreign key (added in Phase 5) — deleting `cases` first without this
 * would violate that constraint and fail outright, which is exactly what
 * happened the first time this was tested after Phase 5 landed. Child table
 * goes first.
 */
export async function deleteAllCases(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM bandit_events");
  await db.execute("DELETE FROM cases");
}
