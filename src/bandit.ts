import Database from "@tauri-apps/plugin-sql";
import type { DraftStrategy } from "./stubs";

let dbPromise: ReturnType<typeof Database.load> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:priorauth.db");
  }
  return dbPromise;
}

export const STRATEGIES: DraftStrategy[] = [
  "lead_with_guideline",
  "lead_with_treatment_history",
  "lead_with_cost_effectiveness",
  "verbatim_criteria",
];

export const STRATEGY_LABELS: Record<DraftStrategy, string> = {
  lead_with_guideline: "lead with guideline language",
  lead_with_treatment_history: "lead with prior treatment history",
  lead_with_cost_effectiveness: "emphasize cost-effectiveness",
  verbatim_criteria: "quote payer criteria verbatim",
};

// Cold start (spec §4.4): every arm starts with one pseudo-observation at a
// neutral 0.5 reward, except `lead_with_guideline`, nudged to 0.6 — Aetna
// CPB 0325, the one real document in the corpus, is itself structured as
// "the payer states its guideline; necessity follows from meeting it," which
// is generically reasonable drafting advice regardless of the specific
// policy. This is a light tie-breaker, not evidence — see development.md's
// Phase 5 design notes before treating it as more than that.
const COLD_START_PRIOR: Record<DraftStrategy, { count: number; meanReward: number }> = {
  lead_with_guideline: { count: 1, meanReward: 0.6 },
  lead_with_treatment_history: { count: 1, meanReward: 0.5 },
  lead_with_cost_effectiveness: { count: 1, meanReward: 0.5 },
  verbatim_criteria: { count: 1, meanReward: 0.5 },
};

// Standard UCB1 exploration constant.
const EXPLORATION_ALPHA = 1.4;

interface EventRow {
  strategy: DraftStrategy;
  n: number;
  reward_sum: number;
}

export interface StrategySelection {
  strategy: DraftStrategy;
  reasoning: string;
  bucketEventCount: number;
}

/**
 * Real contextual bandit (spec §4.4), replacing the fixed stub. Bucketed by
 * (payer, specialty) — see development.md's Phase 5 design for why this is
 * a deliberately simplified d=1 LinUCB (i.e. plain UCB1 per bucket) rather
 * than a full linear-feature model: the real dataset doesn't yet justify one.
 */
export async function selectStrategy(payer: string, specialty: string | null): Promise<StrategySelection> {
  const db = await getDb();
  const rows = await db.select<EventRow[]>(
    `SELECT strategy, COUNT(*) as n, SUM(reward) as reward_sum
     FROM bandit_events
     WHERE LOWER(payer) = LOWER($1) AND (specialty IS $2 OR LOWER(specialty) = LOWER($2))
     GROUP BY strategy`,
    [payer, specialty],
  );

  const byStrategy = new Map<DraftStrategy, EventRow>();
  for (const row of rows) byStrategy.set(row.strategy, row);

  const bucketEventCount = rows.reduce((sum, r) => sum + r.n, 0);

  const stats = STRATEGIES.map((strategy) => {
    const prior = COLD_START_PRIOR[strategy];
    const real = byStrategy.get(strategy);
    const count = prior.count + (real?.n ?? 0);
    const rewardSum = prior.count * prior.meanReward + (real?.reward_sum ?? 0);
    return { strategy, count, mean: rewardSum / count };
  });

  const totalPulls = stats.reduce((sum, s) => sum + s.count, 0);

  const scored = stats.map((s) => ({
    ...s,
    ucb: s.mean + EXPLORATION_ALPHA * Math.sqrt(Math.log(totalPulls) / s.count),
  }));

  scored.sort((a, b) => b.ucb - a.ucb);
  const winner = scored[0];
  const winnerRealCount = winner.count - COLD_START_PRIOR[winner.strategy].count;
  const bucketLabel = `${payer}${specialty ? ` / ${specialty}` : ""}`;

  let reasoning: string;
  if (bucketEventCount === 0) {
    reasoning = `No history yet for ${bucketLabel} — starting with the default strategy.`;
  } else if (winnerRealCount === 0) {
    // UCB1 exploration picked an untried arm over one with real data — true
    // to the algorithm, but "why did it suggest this?" needs to say so
    // explicitly, not just report a mean that looks made up. Surface
    // whichever tried strategy is actually performing best so staff can see
    // the bandit isn't ignoring what it already knows, just deliberately
    // sampling something it hasn't tried yet in this bucket.
    const bestTried = scored
      .filter((s) => s.count - COLD_START_PRIOR[s.strategy].count > 0)
      .sort((a, b) => b.mean - a.mean)[0];
    reasoning = bestTried
      ? `Trying this approach for the first time for ${bucketLabel} — deliberate exploration, not a reversal. ` +
        `${STRATEGY_LABELS[bestTried.strategy]} has the strongest track record so far (avg. reward ${bestTried.mean.toFixed(2)} ` +
        `across ${bestTried.count - COLD_START_PRIOR[bestTried.strategy].count} case(s)), but every approach needs some real data before the ranking can be trusted.`
      : `First real case for ${bucketLabel} — trying this approach to start building history.`;
  } else {
    reasoning = `Chosen from ${bucketEventCount} prior case${bucketEventCount === 1 ? "" : "s"} for ${bucketLabel} ` +
      `(avg. reward ${winner.mean.toFixed(2)} across ${winnerRealCount} real observation${winnerRealCount === 1 ? "" : "s"} for this strategy).`;
  }

  return { strategy: winner.strategy, reasoning, bucketEventCount };
}

export type RewardType = "fast" | "slow";

export async function recordReward(
  caseId: number,
  payer: string,
  specialty: string | null,
  strategy: DraftStrategy,
  rewardType: RewardType,
  reward: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO bandit_events (case_id, payer, specialty, strategy, reward, reward_type)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [caseId, payer, specialty, strategy, reward, rewardType],
  );
}

export function outcomeReward(outcome: "approved" | "denied" | "partial"): number {
  return outcome === "approved" ? 1 : outcome === "partial" ? 0.5 : 0;
}
