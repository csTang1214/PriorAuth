import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "@tauri-apps/plugin-sql";
import type { TestDb } from "./testSupport/testDb";

vi.mock("@tauri-apps/plugin-sql", async () => {
  const { createTestDb } = await import("./testSupport/testDb");
  const testDb = createTestDb();
  return { default: { load: async () => testDb } };
});

import { computeDeadline, lookupResponseWindow, listDeadlineRules, addDeadlineRule, DEFAULT_RESPONSE_WINDOW_DAYS } from "./deadlines";

let testDb: TestDb;

beforeEach(async () => {
  testDb = (await Database.load("sqlite:priorauth.db")) as unknown as TestDb;
  testDb.raw.exec("DELETE FROM payer_deadline_rules");
});

describe("computeDeadline (pure)", () => {
  it("is not overdue when the deadline is in the future", () => {
    const submittedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
    const { overdue, daysRemaining } = computeDeadline(submittedAt, 14);
    expect(overdue).toBe(false);
    expect(daysRemaining).toBeGreaterThan(0);
  });

  it("is overdue when the window has already passed", () => {
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const submittedAt = twentyDaysAgo.toISOString().slice(0, 19).replace("T", " ");
    const { overdue, daysRemaining } = computeDeadline(submittedAt, 14);
    expect(overdue).toBe(true);
    expect(daysRemaining).toBeLessThan(0);
  });
});

describe("lookupResponseWindow (priority chain)", () => {
  it("falls back to the default when no rule exists at all", async () => {
    const result = await lookupResponseWindow("Nobody Insurance", "PPO");
    expect(result).toEqual({ days: DEFAULT_RESPONSE_WINDOW_DAYS, matched: false });
  });

  it("uses a payer-wide rule (plan_type NULL) when no plan-specific rule exists", async () => {
    await addDeadlineRule("Cigna", null, 21);
    const result = await lookupResponseWindow("Cigna", "EPO");
    expect(result).toEqual({ days: 21, matched: true });
  });

  it("prefers a plan-specific rule over a payer-wide rule", async () => {
    await addDeadlineRule("Aetna", null, 14);
    await addDeadlineRule("Aetna", "PPO", 7);
    const ppoResult = await lookupResponseWindow("Aetna", "PPO");
    const hmoResult = await lookupResponseWindow("Aetna", "HMO");
    expect(ppoResult).toEqual({ days: 7, matched: true });
    expect(hmoResult).toEqual({ days: 14, matched: true }); // falls through to the payer-wide rule
  });

  it("matches case-insensitively", async () => {
    await addDeadlineRule("Aetna", "PPO", 7);
    const result = await lookupResponseWindow("aetna", "ppo");
    expect(result).toEqual({ days: 7, matched: true });
  });
});

describe("listDeadlineRules / addDeadlineRule", () => {
  it("lists rules alphabetically by payer", async () => {
    await addDeadlineRule("United", null, 10);
    await addDeadlineRule("Aetna", "PPO", 7);
    const rules = await listDeadlineRules();
    expect(rules.map((r) => r.payer)).toEqual(["Aetna", "United"]);
  });
});
