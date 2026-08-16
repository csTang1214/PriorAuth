import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listCases } from "../db";
import { computeDeadline } from "../deadlines";
import type { Case } from "../types";

function DeadlineSummary({ cases }: { cases: Case[] }) {
  const pending = cases.filter((c) => c.submitted_at && c.response_window_days !== null && !c.decided_at);
  const overdue = pending.filter((c) => computeDeadline(c.submitted_at!, c.response_window_days!).overdue);
  const dueThisWeek = pending.filter((c) => {
    const { overdue, daysRemaining } = computeDeadline(c.submitted_at!, c.response_window_days!);
    return !overdue && daysRemaining <= 7;
  });

  if (pending.length === 0) return null;

  return (
    <div className="deadline-summary">
      <span className={overdue.length > 0 ? "deadline-summary-item overdue" : "deadline-summary-item"}>
        {overdue.length} overdue
      </span>
      <span className="deadline-summary-item">{dueThisWeek.length} due this week</span>
      <span className="deadline-summary-item">{pending.length} awaiting response</span>
    </div>
  );
}

export default function Dashboard() {
  const [cases, setCases] = useState<Case[] | null>(null);

  useEffect(() => {
    listCases().then(setCases);
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <Link to="/new-case" className="btn btn-primary">
          + New Case
        </Link>
      </div>

      {cases === null && <p>Loading…</p>}
      {cases !== null && cases.length === 0 && (
        <p className="empty-state">No cases yet. Create your first one.</p>
      )}

      {cases !== null && cases.length > 0 && (
        <>
          <DeadlineSummary cases={cases} />
          <table className="table">
            <thead>
              <tr>
                <th>Payer</th>
                <th>Procedure</th>
                <th>Specialty</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id}>
                  <td>{c.payer}</td>
                  <td>{c.procedure}</td>
                  <td>{c.specialty || "—"}</td>
                  <td>
                    <span className={`status-badge status-${c.status}`}>{c.status}</span>
                  </td>
                  <td>{new Date(c.created_at).toLocaleDateString()}</td>
                  <td>
                    <Link to={`/cases/${c.id}/review`}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
