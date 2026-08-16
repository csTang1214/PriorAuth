import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose — that one is tailored for `tauri
// dev`/`tauri build` (fixed port, ignores src-tauri, etc.) and none of that
// applies to running tests. Tests run in plain Node (not jsdom) since
// everything under test here is data/logic (SQL, math, string handling),
// not UI rendering.
export default defineConfig({
  test: {
    environment: "node",
    // src/**/*.test.ts — the app's own logic. scripts/**/*.test.mjs — shared
    // ingestion-tooling helpers (see scripts/lib/policyIngestion.mjs, Phase 6),
    // colocated with the Node scripts they test rather than moved into src/
    // just to fit one glob, since they aren't app code.
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
