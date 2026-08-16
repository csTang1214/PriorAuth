import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "@tauri-apps/plugin-sql";
import type { TestDb } from "./testSupport/testDb";

vi.mock("@tauri-apps/plugin-sql", async () => {
  const { createTestDb } = await import("./testSupport/testDb");
  const testDb = createTestDb();
  return { default: { load: async () => testDb } };
});

import { retrievePolicy, listPolicyDocuments } from "./policy";

let testDb: TestDb;

function seedDocument(
  payer: string,
  specialty: string,
  fetchedAt: string,
  chunks: string[],
): number {
  const doc = testDb.raw
    .prepare(
      `INSERT INTO policy_documents (payer, specialty, title, source_url, effective_date, fetched_at, raw_path)
       VALUES (?, ?, 'Test Policy', 'https://example.com/policy', '2020-01-01', ?, 'test/path.html')`,
    )
    .run(payer, specialty, fetchedAt);
  const docId = Number(doc.lastInsertRowid);

  chunks.forEach((text, i) => {
    const chunk = testDb.raw
      .prepare("INSERT INTO policy_chunks (document_id, chunk_order, chunk_text) VALUES (?, ?, ?)")
      .run(docId, i, text);
    testDb.raw
      .prepare("INSERT INTO policy_chunks_fts (rowid, chunk_text) VALUES (?, ?)")
      .run(Number(chunk.lastInsertRowid), text);
  });

  return docId;
}

beforeEach(async () => {
  testDb = (await Database.load("sqlite:priorauth.db")) as unknown as TestDb;
  testDb.raw.exec("DELETE FROM policy_chunks_fts; DELETE FROM policy_chunks; DELETE FROM policy_documents;");
});

describe("retrievePolicy", () => {
  it("returns null for a payer with no ingested document — never fabricates a citation", async () => {
    const result = await retrievePolicy("Nobody Insurance", "Some procedure");
    expect(result).toBeNull();
  });

  it("returns the matching chunk when the procedure text hits an FTS keyword", async () => {
    seedDocument("Aetna", "Physical Therapy", "2026-01-01 00:00:00", [
      "[Scope of Policy] This bulletin addresses physical therapy.",
      "[Medical Necessity] Aetna considers physical therapy medically necessary for shoulder rehabilitation programs.",
    ]);

    const result = await retrievePolicy("Aetna", "Outpatient physical therapy, shoulder rehabilitation");
    expect(result).not.toBeNull();
    expect(result!.excerpt).toMatch(/shoulder rehabilitation/);
    expect(result!.payer).toBe("Aetna");
  });

  it("falls back to the document's first chunk when no keyword matches", async () => {
    seedDocument("Aetna", "Physical Therapy", "2026-01-01 00:00:00", [
      "[Scope of Policy] This bulletin addresses physical therapy.",
      "[Medical Necessity] Criteria involving completely unrelated vocabulary only.",
    ]);

    const result = await retrievePolicy("Aetna", "zzz nonmatching xyz");
    expect(result).not.toBeNull();
    expect(result!.excerpt).toBe("[Scope of Policy] This bulletin addresses physical therapy.");
  });

  it("matches payer case-insensitively", async () => {
    seedDocument("Aetna", "Physical Therapy", "2026-01-01 00:00:00", ["Some chunk text here."]);
    const result = await retrievePolicy("aetna", "anything");
    expect(result).not.toBeNull();
  });
});

describe("retrievePolicy — cross-payer isolation (Phase 6)", () => {
  it("never returns another payer's excerpt, even when both documents share the exact same vocabulary", async () => {
    // Deliberately overlapping wording — both payers' real documents use
    // "medically necessary physical therapy" language, so a query scoped
    // only by keyword (not payer) could plausibly match either. The payer
    // filter has to be doing real work here, not just usually working
    // because the corpus happens not to overlap.
    seedDocument("Aetna", "Physical Therapy", "2026-01-01 00:00:00", [
      "[Medical Necessity] Aetna considers physical therapy medically necessary for shoulder rehabilitation.",
    ]);
    seedDocument("Cigna", "Physical Therapy", "2026-01-01 00:00:00", [
      "[Medically Necessary] Cigna considers physical therapy medically necessary for shoulder rehabilitation.",
    ]);

    const aetnaResult = await retrievePolicy("Aetna", "Outpatient physical therapy, shoulder rehabilitation");
    const cignaResult = await retrievePolicy("Cigna", "Outpatient physical therapy, shoulder rehabilitation");

    expect(aetnaResult!.excerpt).toMatch(/^\[Medical Necessity\] Aetna considers/);
    expect(cignaResult!.excerpt).toMatch(/^\[Medically Necessary\] Cigna considers/);
    expect(aetnaResult!.payer).toBe("Aetna");
    expect(cignaResult!.payer).toBe("Cigna");
  });

  it("keeps two payers' documents independently versioned — re-ingesting one doesn't touch the other", async () => {
    seedDocument("Aetna", "Physical Therapy", "2026-01-01 00:00:00", ["aetna v1"]);
    seedDocument("Cigna", "Physical Therapy", "2026-01-01 00:00:00", ["cigna v1"]);
    seedDocument("Aetna", "Physical Therapy", "2026-02-01 00:00:00", ["aetna v2"]);

    const docs = await listPolicyDocuments();
    const cigna = docs.find((d) => d.payer === "Cigna");
    const aetna = docs.find((d) => d.payer === "Aetna");

    expect(docs).toHaveLength(2);
    expect(cigna?.fetched_at).toBe("2026-01-01 00:00:00"); // untouched by Aetna's re-ingest
    expect(aetna?.fetched_at).toBe("2026-02-01 00:00:00"); // Aetna's own latest version
  });
});

describe("listPolicyDocuments — regression test for the duplicate-version bug", () => {
  it("returns only the latest version when the same (payer, specialty) has been ingested more than once", async () => {
    seedDocument("Aetna", "Physical Therapy", "2026-01-01 00:00:00", ["old version chunk"]);
    seedDocument("Aetna", "Physical Therapy", "2026-02-01 00:00:00", ["new version chunk"]);

    const docs = await listPolicyDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0].fetched_at).toBe("2026-02-01 00:00:00");
  });

  it("lists distinct (payer, specialty) pairs as separate entries", async () => {
    seedDocument("Aetna", "Physical Therapy", "2026-01-01 00:00:00", ["chunk"]);
    seedDocument("Cigna", "Dermatology", "2026-01-01 00:00:00", ["chunk"]);

    const docs = await listPolicyDocuments();
    expect(docs).toHaveLength(2);
  });
});
