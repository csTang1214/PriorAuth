// Shared plumbing for policy-corpus ingestion scripts — extracted in Phase 6,
// the first time there were two ingestion scripts (Aetna's HTML-based one,
// Cigna's PDF-based one) and duplicating this a second time would have been
// exactly the kind of premature-then-late duplication worth avoiding.
//
// What's deliberately NOT here: source-format parsing (HTML vs PDF) and
// heading/section detection. Those stay bespoke per script — every payer's
// document has genuinely different structure, and trying to generalize that
// from two data points would be guessing, not engineering. See
// development.md's Phase 6 design notes.

import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import os from "node:os";

/** Same location Tauri's plugin-sql resolves "sqlite:priorauth.db" to on Windows. */
export const DB_PATH = join(
  os.homedir(),
  "AppData",
  "Roaming",
  "com.priorauth.app",
  "priorauth.db",
);

/**
 * Inserts one policy document plus its chunks (each `{ heading, text }`,
 * `text` already prefixed with its heading — see each script's own
 * heading-tracking logic) into the corpus, versioned by insertion (a
 * re-ingest of the same payer/specialty adds a new row rather than
 * overwriting — see development.md's Phase 2 design: "versioning, not
 * overwriting").
 *
 * `procedure_hint` on each chunk row is repurposed to hold the section
 * heading (schema's nullable "procedure/keyword this chunk is about, if
 * identifiable" — a section name fits well enough not to warrant a new column).
 */
export function insertPolicyDocument(
  db,
  { payer, specialty, title, sourceUrl, effectiveDate, rawPath, chunks },
) {
  if (chunks.length === 0) {
    throw new Error("No chunks to insert — check the source document's section boundaries.");
  }

  const insertDoc = db.prepare(`
    INSERT INTO policy_documents (payer, specialty, title, source_url, effective_date, raw_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertChunk = db.prepare(`
    INSERT INTO policy_chunks (document_id, chunk_order, procedure_hint, chunk_text)
    VALUES (?, ?, ?, ?)
  `);
  const insertFts = db.prepare(`
    INSERT INTO policy_chunks_fts (rowid, chunk_text)
    VALUES (?, ?)
  `);

  let documentId;
  db.exec("BEGIN");
  try {
    const docResult = insertDoc.run(payer, specialty, title, sourceUrl, effectiveDate, rawPath);
    documentId = docResult.lastInsertRowid;

    chunks.forEach(({ heading, text }, i) => {
      const result = insertChunk.run(documentId, i, heading, text);
      insertFts.run(result.lastInsertRowid, text);
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { documentId, chunkCount: chunks.length };
}

export function openDb() {
  return new DatabaseSync(DB_PATH);
}
