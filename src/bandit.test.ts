import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "@tauri-apps/plugin-sql";
import type { TestDb } from "./testSupport/testDb";

vi.mock("@tauri-apps/plugin-sql", async () => {
  const { createTestDb } = await import("./testSupport/testDb");
  const testDb = createTestDb();
  return { default: { load: async () => testDb } };
});

import { selectStrategy, recordReward, outcomeReward } from "./bandit";

let testDb: TestDb;
let caseId: number;

beforeEach(async () => {
  testDb = (await Database.load("sqlite:priorauth.db")) as unknown as TestDb;
  testDb.raw.exec("DELETE FROM bandit_events; DELETE FROM cases;");
  // bandit_events.case_id is a real foreign key — every test needs a real case row to point at.
  const result = testDb.raw
    .prepare(
      "INSERT INTO cases (patient_summary, payer, procedure) VALUES ('summary', 'Aetna', 'Outpatient PT')",
    )
    .run();
  caseId = Number(result.lastInsertRowid);
});

describe("selectStrategy — cold start", () => {
  it("picks lead_with_guideline with a 'no history yet' explanation for an empty bucket", async () => {
    const result = await selectStrategy("Brand New Payer", "Some Specialty");
    expect(result.strategy).toBe("lead_with_guideline");
    expect(result.bucketEventCount).toBe(0);
    expect(result.reasoning).toMatch(/no history yet/i);
  });
});

describe("selectStrategy — exploration", () => {
  it("picks an untried arm over a proven one when other arms have zero real observations, and says so explicitly", async () => {
    // Unanimous real success for verbatim_criteria, unanimous failure for
    // lead_with_guideline — but lead_with_treatment_history and
    // lead_with_cost_effectiveness have never been tried in this bucket.
    for (let i = 0; i < 6; i++) await recordReward(caseId, "Aetna", "Physical Therapy", "verbatim_criteria", "slow", 1);
    for (let i = 0; i < 6; i++) await recordReward(caseId, "Aetna", "Physical Therapy", "lead_with_guideline", "slow", 0);

    const result = await selectStrategy("Aetna", "Physical Therapy");

    expect(["lead_with_treatment_history", "lead_with_cost_effectiveness"]).toContain(result.strategy);
    expect(result.reasoning).toMatch(/deliberate exploration, not a reversal/i);
    expect(result.reasoning).toMatch(/quote payer criteria verbatim/); // names the actual best performer
  });
});

describe("selectStrategy — exploitation", () => {
  it("picks the clear winner once every arm has substantial real data", async () => {
    const rewards: Record<string, number> = {
      verbatim_criteria: 1,
      lead_with_guideline: 0,
      lead_with_treatment_history: 0,
      lead_with_cost_effectiveness: 0,
    };
    for (const [strategy, reward] of Object.entries(rewards)) {
      for (let i = 0; i < 8; i++) {
        await recordReward(caseId, "Aetna", "Physical Therapy", strategy as any, "slow", reward);
      }
    }

    const result = await selectStrategy("Aetna", "Physical Therapy");
    expect(result.strategy).toBe("verbatim_criteria");
    expect(result.reasoning).toMatch(/^Chosen from \d+ prior case/);
  });
});

describe("selectStrategy — bucketing", () => {
  it("keeps different (payer, specialty) buckets independent", async () => {
    for (let i = 0; i < 8; i++) {
      await recordReward(caseId, "Aetna", "Physical Therapy", "verbatim_criteria", "slow", 1);
    }
    // A totally different bucket should be unaffected — still cold start.
    const otherBucket = await selectStrategy("Aetna", "Dermatology");
    expect(otherBucket.bucketEventCount).toBe(0);
  });

  it("treats a NULL specialty as its own bucket, distinct from a named specialty", async () => {
    for (let i = 0; i < 8; i++) {
      await recordReward(caseId, "Aetna", null, "verbatim_criteria", "slow", 1);
    }
    const namedSpecialtyBucket = await selectStrategy("Aetna", "Physical Therapy");
    expect(namedSpecialtyBucket.bucketEventCount).toBe(0);

    const nullSpecialtyBucket = await selectStrategy("Aetna", null);
    expect(nullSpecialtyBucket.bucketEventCount).toBe(8);
  });
});

describe("outcomeReward", () => {
  it("maps outcomes to the documented reward values", () => {
    expect(outcomeReward("approved")).toBe(1);
    expect(outcomeReward("partial")).toBe(0.5);
    expect(outcomeReward("denied")).toBe(0);
  });
});
