import { useEffect, useState } from "react";
import { listCases, setStatus, markOutcome } from "../db";
import { computeDeadline } from "../deadlines";
import type { Case, CaseStatus, CaseOutcome } from "../types";

const STATUSES: CaseStatus[] = ["draft", "submitted", "approved", "denied", "partial"];
const TERMINAL_OUTCOMES: CaseOutcome[] = ["approved", "denied", "partial"];

function isOutcome(status: CaseStatus): status is CaseOutcome {
  return (TERMINAL_OUTCOMES as string[]).includes(status);
}

function DeadlineCell({ c }: { c: Case }) {
  if (!c.submitted_at || c.response_window_days === null) {
    return <span className="hint">no deadline set</span>;
  }
  const { daysRemaining, overdue } = computeDeadline(c.submitted_at, c.response_window_days);
  if (c.decided_at) {
    return <span className="hint">decided</span>;
  }
  if (overdue) {
    return <span className="deadline-badge deadline-overdue">Overdue by {Math.abs(daysRemaining)}d</span>;
  }
  return <span className="deadline-badge deadline-ok">Due in {daysRemaining}d</span>;
}

export default function CaseTracking() {
  const [cases, setCases] = useState<Case[]>([]);
  const [filter, setFilter] = useState<CaseStatus | "all">("all");

  function refresh() {
    listCases().then(setCases);
  }

  useEffect(refresh, []);

  async function handleStatusChange(caseRecord: Case, status: CaseStatus) {
    if (isOutcome(status)) {
      await markOutcome(caseRecord, status);
    } else {
      await setStatus(caseRecord.id, status);
    }
    refresh();
  }

  const visible = filter === "all" ? cases : cases.filter((c) => c.status === filter);

  return (
    <div>
      <div className="page-header">
        <h1>Case Tracking</h1>
        <select value={filter} onChange={(e) => setFilter(e.target.value as CaseStatus | "all")}>
          <option value="all">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {visible.length === 0 && <p className="empty-state">No cases match this filter.</p>}

      {visible.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Payer</th>
              <th>Procedure</th>
              <th>Status</th>
              <th>Deadline</th>
              <th>Last updated</th>
              <th>Mark outcome</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr key={c.id}>
                <td>{c.payer}</td>
                <td>{c.procedure}</td>
                <td>
                  <span className={`status-badge status-${c.status}`}>{c.status}</span>
                </td>
                <td>
                  <DeadlineCell c={c} />
                </td>
                <td>{new Date(c.updated_at).toLocaleString()}</td>
                <td>
                  <select
                    value={c.status}
                    onChange={(e) => handleStatusChange(c, e.target.value as CaseStatus)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
