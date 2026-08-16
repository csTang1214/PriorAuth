import Database from "@tauri-apps/plugin-sql";
import type { DeadlineRule } from "./types";

let dbPromise: ReturnType<typeof Database.load> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:priorauth.db");
  }
  return dbPromise;
}

// Placeholder only — §4.5 is explicit that real response windows are often
// legally mandated and vary by state/payer/plan. This is a stand-in until a
// payer has a real rule on file, not a researched default. Always surface it
// in the UI as an estimate, never with the same confidence as a matched rule.
export const DEFAULT_RESPONSE_WINDOW_DAYS = 14;

export async function lookupResponseWindow(
  payer: string,
  planType: string | null,
): Promise<{ days: number; matched: boolean }> {
  const db = await getDb();

  if (planType) {
    const planMatch = await db.select<DeadlineRule[]>(
      "SELECT * FROM payer_deadline_rules WHERE LOWER(payer) = LOWER($1) AND LOWER(plan_type) = LOWER($2) LIMIT 1",
      [payer, planType],
    );
    if (planMatch[0]) return { days: planMatch[0].response_window_days, matched: true };
  }

  const payerMatch = await db.select<DeadlineRule[]>(
    "SELECT * FROM payer_deadline_rules WHERE LOWER(payer) = LOWER($1) AND plan_type IS NULL LIMIT 1",
    [payer],
  );
  if (payerMatch[0]) return { days: payerMatch[0].response_window_days, matched: true };

  return { days: DEFAULT_RESPONSE_WINDOW_DAYS, matched: false };
}

export async function listDeadlineRules(): Promise<DeadlineRule[]> {
  const db = await getDb();
  return db.select<DeadlineRule[]>("SELECT * FROM payer_deadline_rules ORDER BY payer ASC");
}

export async function addDeadlineRule(
  payer: string,
  planType: string | null,
  days: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO payer_deadline_rules (payer, plan_type, response_window_days) VALUES ($1, $2, $3)",
    [payer, planType || null, days],
  );
}

export interface DeadlineInfo {
  deadlineDate: Date;
  daysRemaining: number;
  overdue: boolean;
}

export function computeDeadline(submittedAt: string, windowDays: number): DeadlineInfo {
  // SQLite's datetime('now') stores UTC without a timezone suffix — append
  // one so the JS Date parser doesn't interpret it as local time.
  const submitted = new Date(submittedAt.replace(" ", "T") + "Z");
  const deadlineDate = new Date(submitted.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const msRemaining = deadlineDate.getTime() - Date.now();
  const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
  return { deadlineDate, daysRemaining, overdue: msRemaining < 0 };
}
