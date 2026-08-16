ALTER TABLE cases ADD COLUMN submitted_at TEXT;
ALTER TABLE cases ADD COLUMN response_window_days INTEGER;
ALTER TABLE cases ADD COLUMN decided_at TEXT;
ALTER TABLE cases ADD COLUMN generated_draft_text TEXT;
ALTER TABLE cases ADD COLUMN edit_distance INTEGER;

CREATE TABLE payer_deadline_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payer TEXT NOT NULL,
    plan_type TEXT,
    response_window_days INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
