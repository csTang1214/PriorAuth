import Database from "@tauri-apps/plugin-sql";

let dbPromise: ReturnType<typeof Database.load> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:priorauth.db");
  }
  return dbPromise;
}

export interface PolicyRecord {
  payer: string;
  specialty: string;
  title: string;
  sourceUrl: string;
  effectiveDate: string | null;
  fetchedAt: string;
  excerpt: string;
}

interface DocumentRow {
  id: number;
  payer: string;
  specialty: string;
  title: string;
  source_url: string;
  effective_date: string | null;
  fetched_at: string;
}

interface ChunkRow {
  chunk_text: string;
}

/**
 * Real payer-policy retrieval (spec §4.2), replacing the Phase-1 stub.
 * Scoped to whatever's actually been ingested into policy_documents /
 * policy_chunks — see scripts/ingest-policy-aetna-pt.mjs for how the first
 * corpus entry (Aetna, Physical Therapy) got there. Returns null when no
 * policy document is on file for the given payer — Phase 6 grows the set of
 * payers this can return something for; it should never fabricate a citation
 * for a payer we haven't actually ingested.
 */
export async function retrievePolicy(
  payer: string,
  procedure: string,
  // Not yet used for scoping — Phase 2 has exactly one document per payer,
  // so it's unambiguous without this. Keep it in the signature for when a
  // payer has multiple specialty-specific documents (Phase 6).
  _specialty?: string | null,
): Promise<PolicyRecord | null> {
  const db = await getDb();

  const docs = await db.select<DocumentRow[]>(
    `SELECT id, payer, specialty, title, source_url, effective_date, fetched_at
     FROM policy_documents
     WHERE LOWER(payer) = LOWER($1)
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [payer.trim()],
  );

  const doc = docs[0];
  if (!doc) return null;

  // Words like "physical"/"therapy" appear in nearly every chunk of a
  // PT-specific document and dominate bm25 ranking without adding any
  // distinguishing signal — drop them so rarer, more specific terms (e.g.
  // "shoulder", "rehabilitation") actually drive the match. This is exactly
  // the kind of keyword-search rough edge the Phase 2 design doc calls out;
  // real semantic ranking arrives with embeddings in Phase 3.
  const genericTerms = new Set(doc.specialty.toLowerCase().split(/[^a-z0-9]+/));
  const keywords = procedure
    .split(/[^a-zA-Z0-9]+/)
    .filter((w) => w.length >= 4 && !genericTerms.has(w.toLowerCase()))
    .map((w) => `"${w}"`);

  let chunk: ChunkRow | undefined;

  if (keywords.length > 0) {
    const matchQuery = keywords.join(" OR ");
    const matches = await db.select<ChunkRow[]>(
      `SELECT pc.chunk_text
       FROM policy_chunks_fts f
       JOIN policy_chunks pc ON pc.id = f.rowid
       WHERE pc.document_id = $1 AND f.chunk_text MATCH $2
       ORDER BY rank
       LIMIT 1`,
      [doc.id, matchQuery],
    );
    chunk = matches[0];
  }

  if (!chunk) {
    const fallback = await db.select<ChunkRow[]>(
      `SELECT chunk_text FROM policy_chunks
       WHERE document_id = $1
       ORDER BY chunk_order ASC
       LIMIT 1`,
      [doc.id],
    );
    chunk = fallback[0];
  }

  return {
    payer: doc.payer,
    specialty: doc.specialty,
    title: doc.title,
    sourceUrl: doc.source_url,
    effectiveDate: doc.effective_date,
    fetchedAt: doc.fetched_at,
    excerpt: chunk?.chunk_text ?? "(no citable excerpt found in this document)",
  };
}

// Only the latest version per (payer, specialty) — the corpus keeps every
// version for staleness auditing (see development.md, Phase 2 design), but
// showing them all here would make old and current versions of the same
// document look like separate, duplicate corpus entries.
export async function listPolicyDocuments(): Promise<DocumentRow[]> {
  const db = await getDb();
  return db.select<DocumentRow[]>(
    `SELECT pd.id, pd.payer, pd.specialty, pd.title, pd.source_url, pd.effective_date, pd.fetched_at
     FROM policy_documents pd
     INNER JOIN (
       SELECT payer, specialty, MAX(fetched_at) AS max_fetched_at
       FROM policy_documents
       GROUP BY payer, specialty
     ) latest
       ON pd.payer = latest.payer
       AND pd.specialty = latest.specialty
       AND pd.fetched_at = latest.max_fetched_at
     ORDER BY pd.fetched_at DESC`,
  );
}
