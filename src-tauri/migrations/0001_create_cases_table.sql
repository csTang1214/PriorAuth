CREATE TABLE cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_summary TEXT NOT NULL,
    payer TEXT NOT NULL,
    plan_type TEXT,
    procedure TEXT NOT NULL,
    specialty TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    draft_text TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
