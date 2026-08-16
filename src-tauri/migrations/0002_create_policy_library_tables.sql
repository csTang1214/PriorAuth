CREATE TABLE policy_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payer TEXT NOT NULL,
    specialty TEXT NOT NULL,
    title TEXT NOT NULL,
    source_url TEXT NOT NULL,
    effective_date TEXT,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    raw_path TEXT NOT NULL
);

CREATE TABLE policy_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES policy_documents(id),
    chunk_order INTEGER NOT NULL,
    procedure_hint TEXT,
    chunk_text TEXT NOT NULL
);

CREATE VIRTUAL TABLE policy_chunks_fts USING fts5(
    chunk_text,
    content='policy_chunks',
    content_rowid='id'
);
