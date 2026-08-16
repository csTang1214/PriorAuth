import { describe, expect, it } from "vitest";
import { createTestDb } from "../../src/testSupport/testDb.ts";
import { insertPolicyDocument } from "./policyIngestion.mjs";

// Worth its own test as of Phase 6 — this helper is now shared by two
// ingestion scripts (Aetna's and Cigna's), which raises the stakes of a bug
// in it beyond "one script's inline logic used exactly once."

describe("insertPolicyDocument", () => {
  it("inserts the document and every chunk, including into the FTS index", () => {
    const db = createTestDb();
    const { documentId, chunkCount } = insertPolicyDocument(db.raw, {
      payer: "TestPayer",
      specialty: "Test Specialty",
      title: "Test Policy",
      sourceUrl: "https://example.com/policy.pdf",
      effectiveDate: "01/01/2026",
      rawPath: "policy-library/testpayer/policy.pdf",
      chunks: [
        { heading: "Medical Necessity", text: "[Medical Necessity] First chunk." },
        { heading: "Exclusions", text: "[Exclusions] Second chunk." },
      ],
    });

    expect(chunkCount).toBe(2);

    const doc = db.raw.prepare("SELECT * FROM policy_documents WHERE id = ?").get(documentId);
    expect(doc.payer).toBe("TestPayer");
    expect(doc.effective_date).toBe("01/01/2026");

    const chunks = db.raw
      .prepare("SELECT chunk_order, procedure_hint, chunk_text FROM policy_chunks WHERE document_id = ? ORDER BY chunk_order")
      .all(documentId);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ chunk_order: 0, procedure_hint: "Medical Necessity", chunk_text: "[Medical Necessity] First chunk." });

    const ftsMatch = db.raw
      .prepare("SELECT chunk_text FROM policy_chunks_fts WHERE chunk_text MATCH 'chunk'")
      .all();
    expect(ftsMatch).toHaveLength(2);
  });

  it("throws rather than silently inserting a document with zero chunks", () => {
    const db = createTestDb();
    expect(() =>
      insertPolicyDocument(db.raw, {
        payer: "TestPayer",
        specialty: "Test",
        title: "Empty",
        sourceUrl: "https://example.com",
        effectiveDate: null,
        rawPath: "test.pdf",
        chunks: [],
      }),
    ).toThrow(/no chunks/i);
  });

  it("rolls back the document insert if a chunk insert fails partway through", () => {
    const db = createTestDb();
    const badChunks = [
      { heading: "ok", text: "first chunk is fine" },
      { heading: "bad", text: null }, // NOT NULL constraint on chunk_text — forces a real failure mid-transaction
    ];

    expect(() =>
      insertPolicyDocument(db.raw, {
        payer: "TestPayer",
        specialty: "Test",
        title: "Partial failure",
        sourceUrl: "https://example.com",
        effectiveDate: null,
        rawPath: "test.pdf",
        chunks: badChunks,
      }),
    ).toThrow();

    const docs = db.raw.prepare("SELECT COUNT(*) as n FROM policy_documents").get();
    const chunks = db.raw.prepare("SELECT COUNT(*) as n FROM policy_chunks").get();
    expect(docs.n).toBe(0); // the transaction rolled back, not left half-applied
    expect(chunks.n).toBe(0);
  });

  it("versions rather than overwrites — two calls for the same payer/specialty both persist", () => {
    const db = createTestDb();
    insertPolicyDocument(db.raw, {
      payer: "TestPayer",
      specialty: "Test",
      title: "v1",
      sourceUrl: "https://example.com",
      effectiveDate: null,
      rawPath: "test.pdf",
      chunks: [{ heading: null, text: "v1 chunk" }],
    });
    insertPolicyDocument(db.raw, {
      payer: "TestPayer",
      specialty: "Test",
      title: "v2",
      sourceUrl: "https://example.com",
      effectiveDate: null,
      rawPath: "test.pdf",
      chunks: [{ heading: null, text: "v2 chunk" }],
    });

    const docs = db.raw.prepare("SELECT title FROM policy_documents ORDER BY id").all();
    expect(docs.map((d) => d.title)).toEqual(["v1", "v2"]);
  });
});
