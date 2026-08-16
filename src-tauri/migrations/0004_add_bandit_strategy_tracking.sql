ALTER TABLE cases ADD COLUMN draft_strategy TEXT;

CREATE TABLE bandit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL REFERENCES cases(id),
    payer TEXT NOT NULL,
    specialty TEXT,
    strategy TEXT NOT NULL,
    reward REAL NOT NULL,
    reward_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
