import { FormEvent, useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { listCases, deleteAllCases } from "../db";
import { listDeadlineRules, addDeadlineRule, DEFAULT_RESPONSE_WINDOW_DAYS } from "../deadlines";
import type { DeadlineRule } from "../types";

export default function Settings() {
  const [message, setMessage] = useState<string | null>(null);
  const [rules, setRules] = useState<DeadlineRule[]>([]);
  const [newPayer, setNewPayer] = useState("");
  const [newPlanType, setNewPlanType] = useState("");
  const [newDays, setNewDays] = useState("14");

  function refreshRules() {
    listDeadlineRules().then(setRules);
  }

  useEffect(refreshRules, []);

  async function handleExport() {
    setMessage(null);
    const cases = await listCases();
    const path = await save({
      title: "Export case data",
      defaultPath: "priorauth-export.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    await writeTextFile(path, JSON.stringify(cases, null, 2));
    setMessage(`Exported ${cases.length} case(s) to ${path}`);
  }

  async function handleDeleteAll() {
    const confirmed = window.confirm(
      "This permanently deletes all cases from the local database. This cannot be undone. Continue?",
    );
    if (!confirmed) return;
    await deleteAllCases();
    setMessage("All case data deleted.");
  }

  async function handleAddRule(e: FormEvent) {
    e.preventDefault();
    const days = parseInt(newDays, 10);
    if (!newPayer.trim() || Number.isNaN(days) || days <= 0) return;
    await addDeadlineRule(newPayer.trim(), newPlanType.trim() || null, days);
    setNewPayer("");
    setNewPlanType("");
    setNewDays("14");
    refreshRules();
  }

  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      <section className="settings-section">
        <h3>Your data</h3>
        <p className="hint">
          Everything this app stores lives in a local SQLite database on this machine. Nothing
          is uploaded anywhere. No network activity log yet — there's nothing to sync until the
          policy library (Phase 2) exists.
        </p>
        <div className="form-actions">
          <button className="btn" onClick={handleExport}>
            Export my data
          </button>
          <button className="btn btn-danger" onClick={handleDeleteAll}>
            Delete all data
          </button>
        </div>
        {message && <p className="settings-message">{message}</p>}
      </section>

      <section className="settings-section" style={{ marginTop: 20 }}>
        <h3>Payer response-window rules</h3>
        <p className="hint">
          How many days a payer has to respond, used for the deadline countdown on Case
          Tracking. Payers with no rule here fall back to a {DEFAULT_RESPONSE_WINDOW_DAYS}-day
          estimate — <strong>this is a placeholder, not researched legal guidance</strong>; real
          mandated windows vary by state, payer, and plan.
        </p>

        {rules.length > 0 && (
          <table className="table" style={{ marginBottom: 16 }}>
            <thead>
              <tr>
                <th>Payer</th>
                <th>Plan type</th>
                <th>Response window</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.payer}</td>
                  <td>{r.plan_type ?? "any"}</td>
                  <td>{r.response_window_days} days</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form className="form-row" onSubmit={handleAddRule} style={{ alignItems: "end" }}>
          <label>
            Payer
            <input
              type="text"
              value={newPayer}
              onChange={(e) => setNewPayer(e.target.value)}
              placeholder="e.g. Aetna"
              required
            />
          </label>
          <label>
            Plan type (optional)
            <input
              type="text"
              value={newPlanType}
              onChange={(e) => setNewPlanType(e.target.value)}
              placeholder="leave blank for any plan"
            />
          </label>
          <label>
            Days
            <input
              type="number"
              min={1}
              value={newDays}
              onChange={(e) => setNewDays(e.target.value)}
              required
            />
          </label>
          <button type="submit" className="btn">
            Add rule
          </button>
        </form>
      </section>
    </div>
  );
}
