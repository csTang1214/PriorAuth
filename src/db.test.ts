import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "@tauri-apps/plugin-sql";
import type { TestDb } from "./testSupport/testDb";

vi.mock("@tauri-apps/plugin-sql", async () => {
  const { createTestDb } = await import("./testSupport/testDb");
  const testDb = createTestDb();
  return { default: { load: async () => testDb } };
});

import { createCase, getCase, listCases, saveDraft, approveCase, markOutcome, deleteAllCases } from "./db";
import type { NewCaseInput, Case } from "./types";

let testDb: TestDb;

const baseInput: NewCaseInput = {
  patient_summary: "Rotator cuff tendinopathy, outpatient PT referral.",
  payer: "Aetna",
  plan_type: "PPO",
  procedure: "Outpatient physical therapy",
  specialty: "Physical Therapy",
};

beforeEach(async () => {
  testDb = (await Database.load("sqlite:priorauth.db")) as unknown as TestDb;
  testDb.raw.exec("DELETE FROM bandit_events; DELETE FROM cases;");
});

describe("createCase / getCase / listCases", () => {
  it("creates a case with status defaulting to draft", async () => {
    const id = await createCase(baseInput);
    const c = await getCase(id);
    expect(c?.status).toBe("draft");
    expect(c?.payer).toBe("Aetna");
  });

  it("lists cases newest first", async () => {
    const id1 = await createCase(baseInput);
    const id2 = await createCase({ ...baseInput, payer: "Cigna" });
    const cases = await listCases();
    expect(cases.map((c) => c.id)).toEqual([id2, id1]);
  });

  it("stores an unset specialty as null, not empty string", async () => {
    const id = await createCase({ ...baseInput, specialty: "" });
    const c = await getCase(id);
    expect(c?.specialty).toBeNull();
  });
});

describe("saveDraft — regression test for lost strategy attribution (Bug 2)", () => {
  it("persists generated_draft_text and draft_strategy, not just draft_text", async () => {
    const id = await createCase(baseInput);
    await saveDraft(id, "the generated letter", "the generated letter", "verbatim_criteria");

    const c = await getCase(id);
    expect(c?.draft_text).toBe("the generated letter");
    expect(c?.generated_draft_text).toBe("the generated letter");
    expect(c?.draft_strategy).toBe("verbatim_criteria");
  });

  it("does not clobber existing generated_draft_text/draft_strategy when called without them (manual re-save)", async () => {
    const id = await createCase(baseInput);
    await saveDraft(id, "original", "original", "lead_with_guideline");

    // Simulates clicking "Save without approving" a second time after
    // hand-editing the textarea — the generation metadata shouldn't vanish.
    await saveDraft(id, "original, hand-edited");

    const c = await getCase(id);
    expect(c?.draft_text).toBe("original, hand-edited");
    expect(c?.generated_draft_text).toBe("original");
    expect(c?.draft_strategy).toBe("lead_with_guideline");
  });
});

describe("approveCase", () => {
  it("persists generated_draft_text (regression test — this was silently dropped once already)", async () => {
    const id = await createCase(baseInput);
    await approveCase(id, "final text", "generated text", 14, "lead_with_guideline", "Aetna", "Physical Therapy");

    const c = await getCase(id);
    expect(c?.generated_draft_text).toBe("generated text");
    expect(c?.draft_text).toBe("final text");
    expect(c?.status).toBe("submitted");
    expect(c?.submitted_at).not.toBeNull();
    expect(c?.response_window_days).toBe(14);
    expect(c?.draft_strategy).toBe("lead_with_guideline");
  });

  it("computes edit_distance as 0 when approved unedited", async () => {
    const id = await createCase(baseInput);
    await approveCase(id, "identical text", "identical text", 14, "lead_with_guideline", "Aetna", "Physical Therapy");
    const c = await getCase(id);
    expect(c?.edit_distance).toBe(0);
  });

  it("leaves edit_distance NULL (not 0) when there was no generated draft to compare against", async () => {
    const id = await createCase(baseInput);
    await approveCase(id, "hand-written from scratch", null, 14, null, "Aetna", "Physical Therapy");
    const c = await getCase(id);
    expect(c?.edit_distance).toBeNull();
  });

  it("records a fast-reward bandit event when a strategy and edit_distance both exist", async () => {
    const id = await createCase(baseInput);
    await approveCase(id, "final", "final", 14, "verbatim_criteria", "Aetna", "Physical Therapy");

    const events = testDb.raw.prepare("SELECT * FROM bandit_events WHERE case_id = ?").all(id);
    expect(events).toHaveLength(1);
    expect((events[0] as any).reward_type).toBe("fast");
    expect((events[0] as any).reward).toBe(1); // unedited => reward 1
  });

  it("records no bandit event when there is no strategy (hand-written draft)", async () => {
    const id = await createCase(baseInput);
    await approveCase(id, "hand-written", null, 14, null, "Aetna", "Physical Therapy");
    const events = testDb.raw.prepare("SELECT * FROM bandit_events WHERE case_id = ?").all(id);
    expect(events).toHaveLength(0);
  });
});

describe("markOutcome", () => {
  it("sets decided_at and records a slow-reward bandit event tied to the case's strategy", async () => {
    const id = await createCase(baseInput);
    await approveCase(id, "final", "final", 14, "lead_with_guideline", "Aetna", "Physical Therapy");
    const approved = (await getCase(id)) as Case;

    await markOutcome(approved, "approved");

    const c = await getCase(id);
    expect(c?.status).toBe("approved");
    expect(c?.decided_at).not.toBeNull();

    const events = testDb.raw
      .prepare("SELECT * FROM bandit_events WHERE case_id = ? AND reward_type = 'slow'")
      .all(id);
    expect(events).toHaveLength(1);
    expect((events[0] as any).reward).toBe(1);
  });

  it("maps denied to reward 0 and partial to reward 0.5", async () => {
    const deniedId = await createCase(baseInput);
    await approveCase(deniedId, "f", "f", 14, "lead_with_guideline", "Aetna", "Physical Therapy");
    await markOutcome((await getCase(deniedId)) as Case, "denied");

    const partialId = await createCase(baseInput);
    await approveCase(partialId, "f", "f", 14, "lead_with_guideline", "Aetna", "Physical Therapy");
    await markOutcome((await getCase(partialId)) as Case, "partial");

    const deniedEvent = testDb.raw
      .prepare("SELECT reward FROM bandit_events WHERE case_id = ? AND reward_type = 'slow'")
      .get(deniedId) as any;
    const partialEvent = testDb.raw
      .prepare("SELECT reward FROM bandit_events WHERE case_id = ? AND reward_type = 'slow'")
      .get(partialId) as any;
    expect(deniedEvent.reward).toBe(0);
    expect(partialEvent.reward).toBe(0.5);
  });

  it("records no bandit event for a case with no draft_strategy on file", async () => {
    const id = await createCase(baseInput);
    // Never approved — no strategy was ever attributed.
    const c = (await getCase(id)) as Case;
    await markOutcome(c, "denied");
    const events = testDb.raw.prepare("SELECT * FROM bandit_events WHERE case_id = ?").all(id);
    expect(events).toHaveLength(0);
  });
});

describe("deleteAllCases — regression test for the foreign-key bug (Bug 1)", () => {
  it("clears both cases and bandit_events without a foreign-key violation", async () => {
    const id = await createCase(baseInput);
    await approveCase(id, "f", "f", 14, "lead_with_guideline", "Aetna", "Physical Therapy");
    expect(testDb.raw.prepare("SELECT COUNT(*) as n FROM bandit_events").get()).toEqual({ n: 1 });

    await expect(deleteAllCases()).resolves.not.toThrow();

    expect(testDb.raw.prepare("SELECT COUNT(*) as n FROM cases").get()).toEqual({ n: 0 });
    expect(testDb.raw.prepare("SELECT COUNT(*) as n FROM bandit_events").get()).toEqual({ n: 0 });
  });

  it("really would violate the FK constraint if bandit_events weren't cleared first (sanity check on the test's own premise)", async () => {
    const id = await createCase(baseInput);
    await approveCase(id, "f", "f", 14, "lead_with_guideline", "Aetna", "Physical Therapy");

    expect(() => testDb.raw.exec("DELETE FROM cases")).toThrow(/FOREIGN KEY constraint failed/);
  });
});
