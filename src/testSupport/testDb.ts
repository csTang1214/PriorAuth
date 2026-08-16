// Test-only. Backs `@tauri-apps/plugin-sql`'s `Database` interface with a
// real in-memory SQLite database (via Node's built-in `node:sqlite`) instead
// of the Tauri IPC bridge, so `src/db.ts`, `src/bandit.ts`, `src/policy.ts`,
// and `src/deadlines.ts` can be tested against real SQL — the exact schema
// and the exact queries they actually run in production — without needing a
// running Tauri app. This is deliberate: three of the real bugs found during
// manual testing (a foreign-key violation, a field silently missing from an
// UPDATE) were SQL-shaped, and a mocked query layer would never have caught
// them. See development.md's "Deep Test Pass" sections for the bug writeups
// this test suite exists to prevent a repeat of.
//
// Schema comes from src-tauri/migrations/*.sql — the same files the real
// Tauri app's `include_str!`-based migrations load — read directly here so
// there is exactly one place the schema is defined, not two that could drift.

import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "src-tauri", "migrations");

function applyMigrations(db: DatabaseSync) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    db.exec(sql);
  }
}

function toNamedParams(params: unknown[] | undefined): Record<string, unknown> | undefined {
  if (!params || params.length === 0) return undefined;
  const named: Record<string, unknown> = {};
  params.forEach((value, i) => {
    named[`$${i + 1}`] = value === undefined ? null : value;
  });
  return named;
}

export interface TestDb {
  select<T>(query: string, params?: unknown[]): Promise<T>;
  execute(query: string, params?: unknown[]): Promise<{ rowsAffected: number; lastInsertId?: number }>;
  close(): Promise<boolean>;
  raw: DatabaseSync;
}

/** A fresh, fully-migrated in-memory database — one per test for isolation. */
export function createTestDb(): TestDb {
  const raw = new DatabaseSync(":memory:");
  applyMigrations(raw);

  return {
    raw,
    async select<T>(query: string, params?: unknown[]): Promise<T> {
      const stmt = raw.prepare(query);
      const namedParams = toNamedParams(params);
      const rows = namedParams ? stmt.all(namedParams) : stmt.all();
      return rows as T;
    },
    async execute(query: string, params?: unknown[]) {
      const stmt = raw.prepare(query);
      const namedParams = toNamedParams(params);
      const result = namedParams ? stmt.run(namedParams) : stmt.run();
      return {
        rowsAffected: result.changes,
        lastInsertId: result.lastInsertRowid ? Number(result.lastInsertRowid) : undefined,
      };
    },
    async close() {
      raw.close();
      return true;
    },
  };
}

/**
 * Installs a `createTestDb()`-backed fake in place of `@tauri-apps/plugin-sql`'s
 * `Database.load`, for use with `vi.mock`. Every module under test calls
 * `Database.load("sqlite:priorauth.db")` independently and caches its own
 * connection (see each module's `getDb()`) — this factory hands out a
 * *single shared* test database per call to `mockPluginSql()`, so modules
 * that are supposed to see each other's writes within one test (e.g. a case
 * created by `db.ts` and then read by `bandit.ts`) actually do.
 */
export function mockPluginSql() {
  const testDb = createTestDb();
  return {
    default: {
      load: async () => testDb,
    },
    testDb,
  };
}
